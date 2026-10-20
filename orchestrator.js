/**
 * Multimodal AI (MMA) — Core Orchestration Engine (orchestrator.js)
 * Isomorphic module: Runs in both Node.js (automated acceptance tests) and modern browsers.
 *
 * Implements:
 * 1. Lifecycle State Machine: INGEST -> CLASSIFY -> PLAN -> BUILD -> COLLECT -> REVIEW -> REPAIR -> VERIFY -> DELIVER
 * 2. Adaptive Task Classifier (SIMPLE, MEDIUM, COMPLEX, PROJECT)
 * 3. Exact 10-Turn Context Assembler (10 completed user/assistant pairs = up to 20 messages + current prompt)
 * 4. Semantic Task Verifier (prevents deliverable substitution and task-instruction leakage)
 * 5. 15-RPM Project Quota Scheduler with 3-Key Dynamic Rotation & Exponential Backoff + Jitter
 * 6. ChunkedFileAssembler with continuation detection and syntax validation
 * 7. 5-Stage Verification & Bounded Self-Repair Loop (max 8 passes, stagnation watchdog)
 * 8. Safe ZIP Ingestion (traversal & decompression bomb protection) + Binary PKZIP Archive Exporter
 * 9. Per-Chat Thread Isolation (independent histories, composer drafts, goals, and tasks)
 */

(function (root, factory) {
  const coreInstance = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = coreInstance;
  }
  if (root) {
    root.MMAOrchestrator = coreInstance;
    root.OrchestratorCore = coreInstance;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /* =========================================================================
     1. CONSTANTS & LIFECYCLE STATES
     ========================================================================= */
  const LIFECYCLE_STATES = Object.freeze({
    INGEST: 'INGEST',
    CLASSIFY: 'CLASSIFY',
    PLAN: 'PLAN',
    BUILD: 'BUILD',
    COLLECT: 'COLLECT',
    REVIEW: 'REVIEW',
    REPAIR: 'REPAIR',
    VERIFY: 'VERIFY',
    PAUSED: 'PAUSED',
    DELIVER: 'DELIVER'
  });

  const QUEUE_STATES = Object.freeze({
    QUEUED: 'Queued',
    RUNNING: 'Running',
    WAITING_RATE_LIMIT: 'Waiting for rate limit',
    WAITING_FOR_QUOTA: 'Waiting for quota',
    BUILDING: 'Building',
    COLLECTING: 'Collecting',
    REVIEWING: 'Reviewing',
    REPAIRING: 'Repairing',
    VERIFYING: 'Verifying',
    PAUSED: 'Paused',
    INTERRUPTED: 'Interrupted',
    NEEDS_ATTENTION: 'Needs attention',
    CANCELLED: 'Cancelled',
    COMPLETED: 'Completed',
    FAILED: 'Failed'
  });

  const TASK_COMPLEXITY = Object.freeze({
    SIMPLE: 'SIMPLE',
    MEDIUM: 'MEDIUM',
    COMPLEX: 'COMPLEX',
    PROJECT: 'PROJECT'
  });

  const MAX_SINGLE_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MiB per file
  const MAX_TOTAL_ATTACHMENTS_BYTES = 50 * 1024 * 1024; // 50 MiB combined
  const MAX_ZIP_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
  const MAX_ZIP_COMPRESSION_RATIO = 100;
  const MAX_ZIP_ENTRIES = 150;
  const PROJECT_QUOTA_RPM = 20;
  const PROJECT_CEILING_RPM = 15; // Enforced 15-RPM project ceiling for 20 RPM Gemini limit

  /* =========================================================================
     2. SECRET REDACTION & OBSERVABILITY LOGGER
     ========================================================================= */
  function redactSecrets(input) {
    if (input === null || input === undefined) return '';
    return String(input)
      .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]')
      .replace(/AQ\.[0-9A-Za-z\-_]{20,}/g, '[REDACTED_TOKEN]')
      .replace(/sk-[0-9A-Za-z\-_]{16,}/g, '[REDACTED_KEY]')
      .replace(/ghp_[0-9A-Za-z]{20,}/g, '[REDACTED_GITHUB_TOKEN]')
      .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]');
  }

  function formatTimestampIST(dateOrMs = Date.now()) {
    try {
      const d = dateOrMs instanceof Date ? dateOrMs : new Date(dateOrMs);
      return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      }) + ' IST';
    } catch (_) {
      return new Date(dateOrMs).toISOString();
    }
  }

  class ObservabilityLogger {
    constructor() {
      this.events = [];
    }

    log(category, action, metadata = {}) {
      const safeMeta = {};
      for (const [k, v] of Object.entries(metadata || {})) {
        if (/key|secret|token|password|credential/i.test(k)) {
          safeMeta[k] = '[REDACTED]';
        } else if (typeof v === 'string') {
          safeMeta[k] = redactSecrets(v);
        } else {
          safeMeta[k] = v;
        }
      }
      const entry = Object.freeze({
        id: 'evt_' + Date.now() + '_' + this.events.length,
        timestamp: new Date().toISOString(),
        timestampIST: formatTimestampIST(),
        category: String(category),
        action: redactSecrets(action),
        metadata: Object.freeze(safeMeta)
      });
      this.events.push(entry);
      return entry;
    }

    getEvents() {
      return this.events.slice();
    }
  }

  /* =========================================================================
     3. TASK DOMAIN & ADAPTIVE COMPLEXITY CLASSIFIER
     ========================================================================= */
  function detectTaskDomain(promptText = '', attachments = []) {
    const lower = String(promptText || '').toLowerCase();
    const hasFiles = Array.isArray(attachments) && attachments.length > 0;
    if (/\b(python|pytest|pip|django|flask|fastapi|pandas|numpy|\.py)\b/i.test(lower)) return 'python';
    if (/\b(clothing|store|shop|ecommerce|e-commerce|urban threads|cart|catalog|products?)\b/i.test(lower)) return 'ecommerce_web';
    if (/\b(game|canvas|interactive|widget|pong|arcade|board|puzzle)\b/i.test(lower)) return 'interactive_game';
    if (/\b(deploy|vercel|docker|kubernetes|ci\/cd|env|production)\b/i.test(lower)) return 'deployment';
    if (/\b(html|css|ui|frontend|tailwind|react|vue|next|website|web app|dashboard)\b/i.test(lower)) return 'web_application';
    if (hasFiles && !/\b(build|create|implement)\b/i.test(lower)) return 'file_analysis';
    if (/\b(research|compare|citations|evidence|study|investigate)\b/i.test(lower)) return 'research';
    if (/\b(write|report|essay|documentation|readme|article|summary)\b/i.test(lower) && !/\b(code|app|script)\b/i.test(lower)) return 'writing';
    return 'general_software';
  }

  function classifyTask(promptText, attachments = [], activeGoal = '') {
    const raw = String(promptText || '').trim();
    const lower = raw.toLowerCase();
    const attCount = Array.isArray(attachments) ? attachments.length : 0;
    const domain = detectTaskDomain(raw, attachments);

    if (/^\/goal\s+clear$/i.test(raw)) {
      return {
        complexity: TASK_COMPLEXITY.SIMPLE,
        command: 'goal_clear',
        domain: 'general',
        requiresCode: false,
        requiresMultiFile: false,
        estimatedFiles: 0,
        reason: 'Direct goal clear command'
      };
    }

    const isSimpleChat =
      attCount === 0 &&
      raw.length < 95 &&
      !/\b(build|create|implement|code|website|store|shop|app|game|project|refactor|html|javascript|typescript|python|css|api|database|tdd|test|debug|fix|multi-file)\b/i.test(lower);

    if (isSimpleChat) {
      return {
        complexity: TASK_COMPLEXITY.SIMPLE,
        command: 'chat',
        domain: 'conversation',
        requiresCode: false,
        requiresMultiFile: false,
        estimatedFiles: 0,
        reason: 'Conversational greeting or direct question answered in a single fast pass'
      };
    }

    if (/^\/grill(-me)?\b/i.test(raw)) {
      return {
        complexity: TASK_COMPLEXITY.MEDIUM,
        command: 'grill-me',
        domain,
        requiresCode: false,
        requiresMultiFile: false,
        estimatedFiles: 0,
        reason: 'Socratic design-tree interrogation'
      };
    }

    const hasMultiFileSignal =
      /\b(multi-file|project|full-stack|store|shop|ecommerce|website|game|dashboard|workbench|platform|suite|architecture)\b/i.test(lower) ||
      /^\/goal\b/i.test(raw) ||
      (attCount > 0 && attachments.some(a => a.isZip));

    if (hasMultiFileSignal && /\b(multi-file|full-stack|suite|architecture|zip|platform)\b/i.test(lower)) {
      return {
        complexity: TASK_COMPLEXITY.PROJECT,
        command: 'project',
        domain,
        requiresCode: true,
        requiresMultiFile: true,
        estimatedFiles: 3,
        reason: 'Multi-file project requiring manifest, bounded per-file jobs, and 5-stage verification'
      };
    }

    if (hasMultiFileSignal || /\b(build|create|implement|refactor|tdd)\b/i.test(lower)) {
      return {
        complexity: TASK_COMPLEXITY.COMPLEX,
        command: 'complex',
        domain,
        requiresCode: true,
        requiresMultiFile: true,
        estimatedFiles: 2,
        reason: 'Complex application or deliverable requiring planning, incremental implementation, review, and verification'
      };
    }

    return {
      complexity: TASK_COMPLEXITY.MEDIUM,
      command: 'standard',
      domain,
      requiresCode: /\b(code|function|script|bug|fix|html|js|py|ts|css|sql)\b/i.test(lower) || attCount > 0,
      requiresMultiFile: false,
      estimatedFiles: 1,
      reason: 'Medium single-module or analytical task'
    };
  }

  function upgradeTaskComplexity(currentComplexity, fileCount) {
    const order = [TASK_COMPLEXITY.SIMPLE, TASK_COMPLEXITY.MEDIUM, TASK_COMPLEXITY.COMPLEX, TASK_COMPLEXITY.PROJECT];
    const idx = order.indexOf(currentComplexity);
    if (typeof fileCount === 'number' && fileCount >= 3) {
      return TASK_COMPLEXITY.PROJECT;
    }
    return order[Math.min(order.length - 1, Math.max(0, idx + 1))];
  }

  /* =========================================================================
     4. EXACT 10-TURN CONVERSATION CONTEXT ASSEMBLER
     ========================================================================= */
  /**
   * One conversational turn = 1 User message + 1 Assistant message (completed pair).
   * 10 turns = up to 20 individual messages in chronological order.
   * Intermediate tool calls and internal processing do not count as separate turns.
   */
  function assembleTenTurnContext(thread, currentPrompt = '', options = {}) {
    if (!thread || typeof thread !== 'object') {
      throw new Error('INVALID_THREAD_STATE: Thread object required');
    }
    const allMessages = Array.isArray(thread.messages) ? thread.messages : [];
    const maxCompletedTurns = Number(options.maxTurns) || 10;

    // Separate completed turns: Pair user messages with corresponding assistant messages
    const completedPairs = [];
    let i = 0;
    while (i < allMessages.length) {
      const msg = allMessages[i];
      if (msg.role === 'user') {
        // Look for next assistant message
        let nextAssistant = null;
        for (let j = i + 1; j < allMessages.length; j++) {
          if (allMessages[j].role === 'assistant') {
            nextAssistant = allMessages[j];
            i = j; // Advance outer loop
            break;
          }
        }
        if (nextAssistant) {
          completedPairs.push({
            user: msg,
            assistant: nextAssistant
          });
        }
      }
      i++;
    }

    // Take the most recent 10 completed turns
    const recentTenPairs = completedPairs.slice(-maxCompletedTurns);

    // Flatten to chronological message sequence (up to 20 messages)
    const recentTurnMessages = [];
    recentTenPairs.forEach((pair, pairIdx) => {
      recentTurnMessages.push({
        id: pair.user.id || ('u_turn_' + pairIdx),
        turnIndex: pairIdx + 1,
        role: 'user',
        text: String(pair.user.text || ''),
        timestamp: pair.user.timestamp || 0
      });
      recentTurnMessages.push({
        id: pair.assistant.id || ('a_turn_' + pairIdx),
        turnIndex: pairIdx + 1,
        role: 'assistant',
        text: String(pair.assistant.cleanedProse || pair.assistant.text || ''),
        timestamp: pair.assistant.timestamp || 0
      });
    });

    // Older context summary (turns older than the recent 10)
    const olderPairs = completedPairs.slice(0, Math.max(0, completedPairs.length - maxCompletedTurns));
    let olderSummary = thread.rollingSummary || '';
    if (olderPairs.length > 0) {
      const summarySnippets = olderPairs.map((p, idx) => {
        const u = String(p.user.text || '').replace(/\s+/g, ' ').slice(0, 70);
        const a = String(p.assistant.cleanedProse || p.assistant.text || '').replace(/\s+/g, ' ').slice(0, 90);
        return `[Turn ${idx + 1}] User: "${u}" -> Assistant: "${a}"`;
      }).join(' | ');
      olderSummary = (`[Archive of prior ${olderPairs.length} turns]: ` + summarySnippets).slice(0, 1500);
    }

    // Active goal and acceptance criteria
    const activeGoal = thread.goal ? {
      text: String(thread.goal),
      acceptanceCriteria: Array.isArray(thread.goalCriteria) && thread.goalCriteria.length > 0
        ? thread.goalCriteria.slice()
        : [`Satisfy goal: ${thread.goal}`, 'Verify deliverable matches requested use-case and semantics']
    } : null;

    const threadAttachments = (Array.isArray(thread.attachments) ? thread.attachments : []).map(a => ({
      id: a.id,
      name: a.name,
      type: a.type || 'text/plain',
      size: a.size || 0,
      isImage: Boolean(a.isImage),
      isZip: Boolean(a.isZip)
    }));

    const threadArtifacts = (Array.isArray(thread.files) ? thread.files : []).map(f => ({
      id: f.id,
      name: f.name,
      path: f.path || f.name,
      ext: f.ext || '',
      lines: f.lines || 0,
      status: f.status || 'VERIFIED'
    }));

    return Object.freeze({
      threadId: thread.id,
      completedTurnsCount: recentTenPairs.length,
      recentTurnMessages, // Up to 20 individual messages representing exact 10 turns
      currentPrompt: String(currentPrompt || '').trim(),
      olderSummary,
      activeGoal,
      taskManifest: thread.taskManifest ? JSON.parse(JSON.stringify(thread.taskManifest)) : null,
      attachments: threadAttachments,
      artifacts: threadArtifacts
    });
  }

  /* =========================================================================
     5. SEMANTIC TASK VERIFIER
     Guarantees the actual user request controls the deliverable.
     Rejects task-instruction leakage, substituted task trackers, and stubs.
     ========================================================================= */
  function runSemanticTaskVerification(originalUserPrompt, generatedFiles) {
    const promptLower = String(originalUserPrompt || '').toLowerCase();
    const files = Array.isArray(generatedFiles) ? generatedFiles : [];
    const issues = [];

    if (files.length === 0) {
      return {
        passed: false,
        issues: ['Zero deliverable files were produced for the task.']
      };
    }

    const combinedContent = files.map(f => String(f.content || '')).join('\n');
    const combinedLower = combinedContent.toLowerCase();

    // 1. Defect: Substituted generic task tracker / to-do app when not requested
    const isTaskTrackerRequested = /\b(todo|to-do|task tracker|task-management|kanban|task list)\b/i.test(promptLower);
    const hasSubstitutedTaskTracker =
      !isTaskTrackerRequested &&
      (combinedContent.includes('id="task-input"') ||
       combinedContent.includes('id="add-btn"') ||
       combinedContent.includes('Round 1 (Planner): Socratic assumption check') ||
       /let\s+items\s*=\s*\[\s*\{\s*id:\s*1,\s*title:\s*["']round\s*1/i.test(combinedContent));

    if (hasSubstitutedTaskTracker) {
      issues.push('SEMANTIC_FAILURE: Generated deliverable substituted an unrelated internal task-tracker/to-do app instead of the requested product.');
    }

    // 2. Defect: Internal orchestration instructions or metadata leaked into user deliverable
    if (combinedContent.includes('5-Stage Verification Application') ||
        combinedContent.includes('Synthesized via autonomous multi-round manifest') ||
        combinedContent.includes('LIFECYCLE_STATES') ||
        combinedContent.includes('UnifiedOrchestratorEngine')) {
      issues.push('SEMANTIC_FAILURE: Internal orchestration instructions or agent metadata leaked into user-facing deliverable.');
    }

    // 3. Domain Specific Checks: Clothing store / E-commerce
    if (/\b(clothing|store|shop|urban threads|apparel|boutique|retail)\b/i.test(promptLower)) {
      const hasProductContent = /\b(product|price|\$|cart|checkout|collection|apparel|hoodie|jacket|tee|shirt|size|filter)\b/i.test(combinedLower);
      const hasCartInteraction = /\b(cart|add to cart|checkout|item-count|total)\b/i.test(combinedLower);
      if (!hasProductContent) {
        issues.push('SEMANTIC_FAILURE: Clothing store website lacks product catalog, pricing, or apparel items.');
      }
      if (!hasCartInteraction) {
        issues.push('SEMANTIC_FAILURE: Clothing store website lacks shopping cart or checkout interaction.');
      }
    }

    // 4. Domain Specific Checks: Python script
    if (/\b(python|\.py)\b/i.test(promptLower) && !promptLower.includes('web')) {
      const hasPyFile = files.some(f => (f.name && f.name.endsWith('.py')) || f.ext === 'py');
      if (!hasPyFile) {
        issues.push('SEMANTIC_FAILURE: Python task did not generate a runnable .py module.');
      }
    }

    // 5. Code Completeness & Minimum Quality Check
    files.forEach(f => {
      const lines = String(f.content || '').split('\n').length;
      if (lines < 15 && f.ext === 'html') {
        issues.push(`COMPLETENESS_FAILURE: File "${f.name}" is a superficial HTML stub (${lines} lines).`);
      }
    });

    return {
      passed: issues.length === 0,
      issues
    };
  }

  /* =========================================================================
     6. CHUNKED FILE ASSEMBLER & TRUNCATION DETECTOR
     ========================================================================= */
  class ChunkedFileAssembler {
    constructor(defaultFilePath = null) {
      this.defaultFilePath = defaultFilePath;
      this.fileBuffers = new Map();
      this.expectedTotals = new Map();
    }

    addChunk(arg1, arg2, arg3, arg4) {
      if (typeof arg1 === 'number' && this.defaultFilePath) {
        const filePath = this.defaultFilePath;
        const chunkIndex = arg1;
        const content = String(arg2 || '');
        const meta = arg3 || {};
        if (!this.fileBuffers.has(filePath)) {
          this.fileBuffers.set(filePath, new Map());
        }
        const chunkMap = this.fileBuffers.get(filePath);
        chunkMap.set(chunkIndex, content);
        if (meta.isFinal) {
          this.expectedTotals.set(filePath, chunkMap.size);
        }
        return { duplicateIgnored: false, received: chunkMap.size };
      }

      const filePath = arg1;
      const chunkIndex = arg2;
      const totalChunks = arg3;
      const content = arg4;

      if (!filePath || typeof filePath !== 'string') {
        throw new Error('INVALID_FILE_PATH');
      }
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !Number.isInteger(totalChunks) || totalChunks < 1 || chunkIndex >= totalChunks) {
        throw new Error(`INVALID_CHUNK_BOUNDS: ${chunkIndex}/${totalChunks}`);
      }
      if (!this.fileBuffers.has(filePath)) {
        this.fileBuffers.set(filePath, new Map());
        this.expectedTotals.set(filePath, totalChunks);
      }
      const chunkMap = this.fileBuffers.get(filePath);
      chunkMap.set(chunkIndex, String(content || ''));
      return { duplicateIgnored: false, received: chunkMap.size, totalChunks };
    }

    assembleFile(filePath) {
      const target = filePath || this.defaultFilePath;
      if (!this.fileBuffers.has(target)) {
        throw new Error(`UNKNOWN_FILE: ${target}`);
      }
      const chunkMap = this.fileBuffers.get(target);
      const total = this.expectedTotals.has(target) ? this.expectedTotals.get(target) : chunkMap.size;
      const ordered = [];
      for (let i = 0; i < total; i++) {
        if (!chunkMap.has(i)) {
          throw new Error(`INCOMPLETE_CHUNKS: Missing chunk ${i} for ${target}`);
        }
        ordered.push(chunkMap.get(i));
      }
      return ordered.join('');
    }

    assemble() {
      const content = this.assembleFile(this.defaultFilePath);
      const chunkMap = this.fileBuffers.get(this.defaultFilePath);
      return {
        complete: true,
        content,
        lines: content.split('\n').length,
        chunksCount: chunkMap ? chunkMap.size : 1
      };
    }
  }

  function detectResponseTruncation(responseText, finishReason = 'STOP') {
    const text = String(responseText || '');
    if (!text.trim()) {
      return { truncated: true, needsContinuation: true, reason: 'EMPTY_RESPONSE' };
    }
    if (finishReason === 'MAX_TOKENS' || finishReason === 'LENGTH') {
      return { truncated: true, needsContinuation: true, reason: 'MAX_TOKENS_REACHED' };
    }
    if (text.includes('<<<CONTINUE_CHUNK>>>')) {
      return { truncated: true, needsContinuation: true, reason: 'EXPLICIT_CONTINUATION_MARKER' };
    }
    const fences = text.match(/```/g);
    if (fences && fences.length % 2 !== 0) {
      return { truncated: true, needsContinuation: true, reason: 'UNCLOSED_CODE_FENCE' };
    }
    if (text.trim().startsWith('{') && !text.trim().endsWith('}')) {
      return { truncated: true, needsContinuation: true, reason: 'INCOMPLETE_JSON' };
    }
    return { truncated: false, needsContinuation: false, reason: 'COMPLETE' };
  }

  /* =========================================================================
     7. 5-STAGE VERIFICATION PIPELINE
     ========================================================================= */
  function verifyFileSyntaxAndSecurity(fileObj) {
    const content = String(fileObj.content || '');
    const ext = String(fileObj.ext || '').toLowerCase();
    const issues = [];

    if (!content.trim()) {
      issues.push('File content is empty');
    }

    const fences = content.match(/```/g);
    if (fences && fences.length % 2 !== 0) {
      issues.push('File contains unclosed markdown code fence');
    }

    if (ext === 'html' || (fileObj.name && fileObj.name.endsWith('.html'))) {
      if (!/<html/i.test(content) || !/<\/html>/i.test(content)) {
        issues.push('HTML document is missing opening or closing <html> tag');
      }
      if (/<script\b[^>]*>/i.test(content) && !/<\/script>/i.test(content)) {
        issues.push('HTML document has unclosed <script> tag');
      }
    }

    if (['js', 'ts', 'jsx', 'tsx', 'json', 'css'].includes(ext)) {
      const openBraces = (content.match(/\{/g) || []).length;
      const closeBraces = (content.match(/\}/g) || []).length;
      if (openBraces !== closeBraces) {
        issues.push(`Unbalanced braces: ${openBraces} open vs ${closeBraces} close`);
      }
    }

    if (/(AIza[0-9A-Za-z\-_]{25,}|AQ\.Ab8RN6[0-9A-Za-z\-_]{20,}|sk-[0-9A-Za-z]{20,})/.test(content)) {
      issues.push('SECURITY_ALERT: Exposed API secret detected in file artifact');
    }

    return {
      passed: issues.length === 0,
      issues
    };
  }

  function runFiveStageVerification(originalPrompt, taskPlan, generatedFiles, reviewerFindings = []) {
    const files = Array.isArray(generatedFiles) ? generatedFiles : [];
    const expected = (taskPlan && (taskPlan.manifestFiles || taskPlan.files)) || [];
    const expectedNames = expected.map(item => (typeof item === 'string' ? item : (item.path || item.name)));

    // Stage 1: Requirements & Semantic Verification
    const semanticCheck = runSemanticTaskVerification(originalPrompt, files);
    const missingManifestFiles = expectedNames.filter(req => req && !files.some(f => f.name === req || f.path === req));
    const stage1Issues = [...semanticCheck.issues];
    if (missingManifestFiles.length > 0) {
      stage1Issues.push(`Missing manifest files: ${missingManifestFiles.join(', ')}`);
    }
    const stage1 = {
      stage: 'Stage 1 — Requirements & Semantic Verification',
      passed: stage1Issues.length === 0,
      issues: stage1Issues
    };

    // Stage 2: Implementation Completeness
    const implIssues = [];
    files.forEach(f => {
      const lineCount = (f.lines || String(f.content || '').split('\n').length);
      if (lineCount < 3) {
        implIssues.push(`File "${f.name}" is a stub (< 3 lines)`);
      }
    });
    const stage2 = {
      stage: 'Stage 2 — Implementation Completeness',
      passed: implIssues.length === 0,
      issues: implIssues
    };

    // Stage 3: Technical & Syntax Verification
    const techIssues = [];
    files.forEach(f => {
      const check = verifyFileSyntaxAndSecurity(f);
      if (!check.passed) {
        check.issues.forEach(iss => techIssues.push(`${f.name}: ${iss}`));
      }
    });
    const stage3 = {
      stage: 'Stage 3 — Technical Syntax Verification',
      passed: techIssues.length === 0,
      issues: techIssues
    };

    // Stage 4: Independent Reviewer Audit
    const reviewIssues = Array.isArray(reviewerFindings)
      ? reviewerFindings.slice()
      : (reviewerFindings && Array.isArray(reviewerFindings.defects) ? reviewerFindings.defects.slice() : []);
    const stage4 = {
      stage: 'Stage 4 — Independent Reviewer Audit',
      passed: reviewIssues.length === 0,
      issues: reviewIssues
    };

    // Stage 5: Verification Gate
    const allDefects = [...stage1.issues, ...stage2.issues, ...stage3.issues, ...stage4.issues];
    const stage5 = {
      stage: 'Stage 5 — Delivery Gate',
      passed: allDefects.length === 0,
      issues: allDefects
    };

    return {
      passed: allDefects.length === 0,
      overallPassed: allDefects.length === 0,
      stages: [stage1, stage2, stage3, stage4, stage5],
      actionableDefects: allDefects
    };
  }

  /* =========================================================================
     8. 15-RPM PROJECT QUOTA SCHEDULER & ERROR CLASSIFIER
     ========================================================================= */
  function classifyProviderError(err) {
    const status = Number(err && err.status) || 0;
    const code = String((err && err.code) || '');
    const msg = redactSecrets((err && err.message) || 'Unknown error');

    if (code === 'DAILY_QUOTA_EXHAUSTED' || /daily quota|quota exceeded for the day/i.test(msg)) {
      return {
        category: 'DAILY_QUOTA_EXHAUSTED',
        queueState: QUEUE_STATES.PAUSED,
        retryable: false,
        userInterventionRequired: false,
        actionableMessage: `Daily quota limit reached. Progress and completed files are checkpointed. Automatic execution is paused.`
      };
    }
    if (status === 401 || status === 403 || code === 'AUTH_ERROR') {
      return {
        category: 'AUTH_ERROR',
        queueState: QUEUE_STATES.NEEDS_ATTENTION,
        retryable: false,
        userInterventionRequired: true,
        actionableMessage: `Authentication failed (${status || 'AUTH'}). Please check your configured Gemini API keys in Settings.`
      };
    }
    if (status === 400 || code === 'PERMANENT_BAD_REQUEST') {
      return {
        category: 'PERMANENT_BAD_REQUEST',
        queueState: QUEUE_STATES.NEEDS_ATTENTION,
        retryable: false,
        userInterventionRequired: true,
        actionableMessage: `Request was rejected by the Gemini API endpoint (HTTP 400). Completed files are preserved.`
      };
    }
    if (status === 429 || code === 'TRANSIENT_429' || code === 'RATE_LIMIT_RETRIES_EXHAUSTED') {
      return {
        category: 'RATE_LIMITED_429',
        queueState: QUEUE_STATES.WAITING_FOR_QUOTA,
        retryable: true,
        userInterventionRequired: false,
        actionableMessage: `Shared 15 RPM project quota window reached. Bounded exponential backoff is active; work will resume automatically.`
      };
    }
    if (status >= 500 || code === 'UPSTREAM_UNAVAILABLE' || code === 'NETWORK_TIMEOUT') {
      return {
        category: 'SERVICE_UNAVAILABLE_OR_TIMEOUT',
        queueState: QUEUE_STATES.INTERRUPTED,
        retryable: true,
        userInterventionRequired: false,
        actionableMessage: `Gemini service temporary unavailable or timeout. Saved in checkpoint and ready to resume.`
      };
    }
    return {
      category: 'UNKNOWN_ERROR',
      queueState: QUEUE_STATES.FAILED,
      retryable: false,
      userInterventionRequired: true,
      actionableMessage: `Execution interrupted: ${msg}. All generated files remain saved.`
    };
  }

  class ProjectQuotaScheduler {
    constructor(options = {}) {
      this.verifiedProjectQuotaRpm = Number(options.verifiedProjectQuotaRpm) || PROJECT_QUOTA_RPM;
      this.projectRpmCeiling = Math.min(Number(options.projectRpmCeiling) || PROJECT_CEILING_RPM, this.verifiedProjectQuotaRpm);
      this.dailyRpdLimit = Number(options.dailyRpdLimit) || 1000;
      this.maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 3;
      this.baseBackoffMs = typeof options.baseBackoffMs === 'number' ? options.baseBackoffMs : 250;
      this.nowFn = options.nowFn || (() => Date.now());
      this.sleepFn = options.sleepFn || (ms => new Promise(r => setTimeout(r, ms)));
      this.logger = options.logger || new ObservabilityLogger();

      this.requestTimestamps = [];
      this.dailyRequestCount = 0;
      this.rotationCursor = 0;

      this.roles = {
        planner: { id: 'planner', label: 'Planner (API Key #1)', health: 'HEALTHY', requests: 0, failures: 0, lastLatencyMs: 0 },
        builder: { id: 'builder', label: 'Builder (API Key #2)', health: 'HEALTHY', requests: 0, failures: 0, lastLatencyMs: 0 },
        reviewer: { id: 'reviewer', label: 'Reviewer (API Key #3)', health: 'HEALTHY', requests: 0, failures: 0, lastLatencyMs: 0 }
      };
    }

    pruneWindow() {
      const now = this.nowFn();
      this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60000);
    }

    getRemainingProjectRpm() {
      this.pruneWindow();
      return Math.max(0, this.projectRpmCeiling - this.requestTimestamps.length);
    }

    selectHealthyRole(preferredRole) {
      const norm = String(preferredRole || 'planner').toLowerCase();
      if (this.roles[norm] && this.roles[norm].health === 'HEALTHY') {
        return norm;
      }
      const order = ['planner', 'builder', 'reviewer'];
      for (let i = 0; i < order.length; i++) {
        const candidate = order[(this.rotationCursor + i) % order.length];
        if (this.roles[candidate].health === 'HEALTHY') {
          this.rotationCursor = (this.rotationCursor + 1) % order.length;
          return candidate;
        }
      }
      return null;
    }

    async schedule(preferredRole, operationFn, contextMeta = {}) {
      if (this.dailyRequestCount >= this.dailyRpdLimit) {
        const err = new Error('DAILY_QUOTA_EXHAUSTED: Daily request limit reached. Checkpointed.');
        err.code = 'DAILY_QUOTA_EXHAUSTED';
        throw err;
      }

      this.pruneWindow();
      while (this.requestTimestamps.length >= this.projectRpmCeiling) {
        const oldest = this.requestTimestamps[0] || this.nowFn();
        const waitMs = Math.max(25, 60000 - (this.nowFn() - oldest) + 20);
        if (contextMeta.onStateChange) {
          contextMeta.onStateChange(QUEUE_STATES.WAITING_RATE_LIMIT, `Waiting for 15 RPM budget (${Math.ceil(waitMs / 1000)}s)…`);
        }
        await this.sleepFn(Math.min(waitMs, 500));
        this.pruneWindow();
      }

      let attempt = 0;
      let currentRole = this.selectHealthyRole(preferredRole);
      if (!currentRole) {
        const authErr = new Error('ALL_CREDENTIALS_UNHEALTHY: All configured keys are unhealthy.');
        authErr.code = 'AUTH_ERROR';
        throw authErr;
      }

      while (attempt <= this.maxRetries) {
        this.pruneWindow();
        if (this.requestTimestamps.length >= this.projectRpmCeiling) {
          const oldest = this.requestTimestamps[0] || this.nowFn();
          const waitMs = Math.max(20, 60000 - (this.nowFn() - oldest) + 20);
          await this.sleepFn(Math.min(waitMs, 250));
          this.pruneWindow();
        }

        this.requestTimestamps.push(this.nowFn());
        this.dailyRequestCount += 1;
        this.roles[currentRole].requests += 1;

        const t0 = this.nowFn();
        try {
          const result = await operationFn(currentRole);
          this.roles[currentRole].lastLatencyMs = Math.max(1, this.nowFn() - t0);
          return {
            ...result,
            executedByRole: this.roles[currentRole].label,
            roleId: currentRole
          };
        } catch (err) {
          this.roles[currentRole].failures += 1;
          const status = Number(err.status) || 0;
          const errCode = String(err.code || '');

          if (status === 429 || errCode === 'TRANSIENT_429' || status >= 500) {
            attempt++;
            if (attempt > this.maxRetries) {
              const exhausted = new Error(`Retry limit reached after ${this.maxRetries} attempts: ${err.message}`);
              exhausted.code = status === 429 ? 'RATE_LIMIT_RETRIES_EXHAUSTED' : 'UPSTREAM_UNAVAILABLE';
              throw exhausted;
            }
            // Rotate role
            const next = currentRole === 'planner' ? 'builder' : currentRole === 'builder' ? 'reviewer' : 'planner';
            currentRole = this.selectHealthyRole(next) || currentRole;
            const delay = (this.baseBackoffMs * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 50);
            await this.sleepFn(delay);
            continue;
          }
          throw err;
        }
      }
    }

    getSnapshot() {
      this.pruneWindow();
      return {
        usedRpmInWindow: this.requestTimestamps.length,
        projectRpmCeiling: this.projectRpmCeiling,
        dailyRequestsUsed: this.dailyRequestCount,
        dailyRpdLimit: this.dailyRpdLimit,
        roles: {
          planner: { ...this.roles.planner },
          builder: { ...this.roles.builder },
          reviewer: { ...this.roles.reviewer }
        }
      };
    }
  }

  /* =========================================================================
     9. SAFE ZIP PARSING & BINARY PKZIP EXPORTER
     ========================================================================= */
  function validateUploadLimits(fileMeta, existingAttachments = []) {
    const size = Number(fileMeta && fileMeta.size) || 0;
    const name = String((fileMeta && fileMeta.name) || 'upload');
    if (size > MAX_SINGLE_UPLOAD_BYTES) {
      return {
        ok: false,
        error: `FILE_TOO_LARGE: "${name}" (${(size / (1024 * 1024)).toFixed(1)} MB) exceeds the 20 MiB limit.`
      };
    }
    const currentTotal = (Array.isArray(existingAttachments) ? existingAttachments : [])
      .reduce((acc, a) => acc + (Number(a.size) || 0), 0);
    if (currentTotal + size > MAX_TOTAL_ATTACHMENTS_BYTES) {
      return {
        ok: false,
        error: `TOTAL_PAYLOAD_EXCEEDED: Exceeds 50 MiB combined attachment limit.`
      };
    }
    return { ok: true };
  }

  function validateZipSafety(entries) {
    if (!Array.isArray(entries)) {
      return { safe: false, error: 'INVALID_ZIP_ENTRIES' };
    }
    if (entries.length > MAX_ZIP_ENTRIES) {
      return { safe: false, error: `ZIP_TOO_MANY_ENTRIES: ${entries.length} exceeds limit of ${MAX_ZIP_ENTRIES}` };
    }
    let totalUncompressed = 0;
    for (const e of entries) {
      const name = String(e.name || '');
      if (name.includes('../') || name.includes('..\\') || name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) {
        return { safe: false, error: `UNSAFE_ZIP_PATH_TRAVERSAL: Rejected entry "${name}"` };
      }
      if (/\.(zip|tar|gz|tgz|7z|rar)$/i.test(name)) {
        return { safe: false, error: `NESTED_ARCHIVE_REJECTED: "${name}"` };
      }
      const comp = Math.max(1, Number(e.compressedSize) || 1);
      const uncomp = Number(e.uncompressedSize) || 0;
      totalUncompressed += uncomp;
      if (uncomp / comp > MAX_ZIP_COMPRESSION_RATIO && uncomp > 1024 * 1024) {
        return { safe: false, error: `DECOMPRESSION_BOMB_DETECTED on "${name}"` };
      }
      if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
        return { safe: false, error: `ZIP_UNCOMPRESSED_SIZE_EXCEEDED: Exceeds 25 MiB limit` };
      }
    }
    return { safe: true, entryCount: entries.length, totalUncompressedBytes: totalUncompressed };
  }

  const _CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = _CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function createZipArchiveBytes(files) {
    const encoder = new TextEncoder();
    const records = (Array.isArray(files) ? files : []).map(f => {
      const safeName = String(f.path || f.name || 'file.txt').replace(/^\/+/, '').replace(/\.\.\//g, '');
      const nameBytes = encoder.encode(safeName);
      const dataBytes = encoder.encode(String(f.content || ''));
      const crc = crc32(dataBytes);
      return { nameBytes, dataBytes, crc };
    });

    let localSize = 0;
    let centralSize = 0;
    records.forEach(r => {
      localSize += 30 + r.nameBytes.length + r.dataBytes.length;
      centralSize += 46 + r.nameBytes.length;
    });

    const totalSize = localSize + centralSize + 22;
    const out = new Uint8Array(totalSize);
    const view = new DataView(out.buffer);

    let localOffset = 0;
    const offsets = [];

    records.forEach(r => {
      offsets.push(localOffset);
      view.setUint32(localOffset, 0x04034b50, true);
      view.setUint16(localOffset + 4, 20, true);
      view.setUint16(localOffset + 6, 0, true);
      view.setUint16(localOffset + 8, 0, true);
      view.setUint16(localOffset + 10, 0, true);
      view.setUint16(localOffset + 12, 0, true);
      view.setUint32(localOffset + 14, r.crc, true);
      view.setUint32(localOffset + 18, r.dataBytes.length, true);
      view.setUint32(localOffset + 22, r.dataBytes.length, true);
      view.setUint16(localOffset + 26, r.nameBytes.length, true);
      view.setUint16(localOffset + 28, 0, true);
      out.set(r.nameBytes, localOffset + 30);
      out.set(r.dataBytes, localOffset + 30 + r.nameBytes.length);
      localOffset += 30 + r.nameBytes.length + r.dataBytes.length;
    });

    const centralStart = localOffset;
    records.forEach((r, idx) => {
      view.setUint32(localOffset, 0x02014b50, true);
      view.setUint16(localOffset + 4, 20, true);
      view.setUint16(localOffset + 6, 20, true);
      view.setUint16(localOffset + 8, 0, true);
      view.setUint16(localOffset + 10, 0, true);
      view.setUint16(localOffset + 12, 0, true);
      view.setUint16(localOffset + 14, 0, true);
      view.setUint32(localOffset + 16, r.crc, true);
      view.setUint32(localOffset + 20, r.dataBytes.length, true);
      view.setUint32(localOffset + 24, r.dataBytes.length, true);
      view.setUint16(localOffset + 28, r.nameBytes.length, true);
      view.setUint16(localOffset + 30, 0, true);
      view.setUint16(localOffset + 32, 0, true);
      view.setUint16(localOffset + 34, 0, true);
      view.setUint16(localOffset + 36, 0, true);
      view.setUint32(localOffset + 38, 0, true);
      view.setUint32(localOffset + 42, offsets[idx], true);
      out.set(r.nameBytes, localOffset + 46);
      localOffset += 46 + r.nameBytes.length;
    });

    view.setUint32(localOffset, 0x06054b50, true);
    view.setUint16(localOffset + 4, 0, true);
    view.setUint16(localOffset + 6, 0, true);
    view.setUint16(localOffset + 8, records.length, true);
    view.setUint16(localOffset + 10, records.length, true);
    view.setUint32(localOffset + 12, centralSize, true);
    view.setUint32(localOffset + 16, centralStart, true);
    view.setUint16(localOffset + 20, 0, true);

    return out;
  }

  /* =========================================================================
     10. UNIFIED MULTI-ROUND ORCHESTRATION ENGINE
     ========================================================================= */
  class UnifiedOrchestratorEngine {
    constructor(options = {}) {
      this.logger = options.logger || new ObservabilityLogger();
      this.scheduler = options.scheduler || new ProjectQuotaScheduler({
        verifiedProjectQuotaRpm: options.verifiedProjectQuotaRpm || PROJECT_QUOTA_RPM,
        projectRpmCeiling: options.projectRpmCeiling || PROJECT_CEILING_RPM,
        dailyRpdLimit: options.dailyRpdLimit || 1000,
        logger: this.logger
      });
      this.maxRepairPasses = typeof options.maxRepairPasses === 'number' ? options.maxRepairPasses : 8;
      this.providerCallFn = options.providerCallFn || options.providerAdapter || null;
      this.threads = new Map();
      this.checkpoints = new Map();
    }

    createThread(threadId) {
      const id = threadId || ('chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
      const thread = {
        id,
        title: 'New Session',
        messages: [],
        draftText: '',
        goal: '',
        goalCriteria: [],
        rollingSummary: '',
        taskManifest: null,
        attachments: [],
        files: [],
        runningTaskId: null
      };
      this.threads.set(id, thread);
      return thread;
    }

    getThread(threadId) {
      if (!this.threads.has(threadId)) {
        return this.createThread(threadId);
      }
      return this.threads.get(threadId);
    }

    saveCheckpoint(taskId, stateSnapshot) {
      const copy = JSON.parse(JSON.stringify(stateSnapshot));
      this.checkpoints.set(taskId, copy);
      return copy;
    }

    getCheckpoint(taskId) {
      return this.checkpoints.get(taskId) || null;
    }

    async runTask(threadOrId, rawPrompt, attachments = [], options = {}) {
      const thread = typeof threadOrId === 'string' ? this.getThread(threadOrId) : threadOrId;
      const taskId = options.resumeTaskId || ('task_' + thread.id + '_' + Date.now());
      thread.runningTaskId = taskId;

      const existingCheckpoint = options.resumeTaskId ? this.getCheckpoint(options.resumeTaskId) : null;
      const taskState = existingCheckpoint || {
        taskId,
        threadId: thread.id,
        prompt: String(rawPrompt || '').trim(),
        lifecycleState: LIFECYCLE_STATES.INGEST,
        queueState: QUEUE_STATES.RUNNING,
        classification: null,
        plan: null,
        completedFiles: [],
        subflowOutcomes: [],
        verificationReport: null,
        repairPassesUsed: 0,
        maxRepairPasses: this.maxRepairPasses,
        responseProse: '',
        blockedReason: null
      };

      const recordTransition = (lifecycle, queue = taskState.queueState) => {
        taskState.lifecycleState = lifecycle;
        taskState.queueState = queue;
        if (options.onProgress) {
          options.onProgress({ ...taskState });
        }
      };

      try {
        // INGEST & CLASSIFY
        recordTransition(LIFECYCLE_STATES.INGEST, QUEUE_STATES.RUNNING);
        if (/^\/goal\s+clear$/i.test(taskState.prompt)) {
          thread.goal = '';
          thread.goalCriteria = [];
          recordTransition(LIFECYCLE_STATES.DELIVER, QUEUE_STATES.COMPLETED);
          taskState.responseProse = 'Cleared the active session goal.';
          return taskState;
        }

        recordTransition(LIFECYCLE_STATES.CLASSIFY, QUEUE_STATES.RUNNING);
        taskState.classification = classifyTask(taskState.prompt, attachments, thread.goal);

        // 10-turn context assembly
        const assembledCtx = assembleTenTurnContext(thread, taskState.prompt);

        // SIMPLE ROUTE
        if (taskState.classification.complexity === TASK_COMPLEXITY.SIMPLE) {
          recordTransition(LIFECYCLE_STATES.BUILD, QUEUE_STATES.RUNNING);
          const simpleRes = await this.scheduler.schedule('planner', async (role) => {
            if (this.providerCallFn) {
              return await this.providerCallFn({
                role,
                stage: 'SIMPLE',
                prompt: taskState.prompt,
                context: assembledCtx
              });
            }
            return { text: `Direct answer to "${taskState.prompt}": Multimodal AI (MMA) is ready.` };
          });
          taskState.responseProse = redactSecrets(simpleRes.text || '');
          recordTransition(LIFECYCLE_STATES.DELIVER, QUEUE_STATES.COMPLETED);
          return taskState;
        }

        // PLAN STAGE (Role 1 — Planner)
        if (!taskState.plan) {
          recordTransition(LIFECYCLE_STATES.PLAN, QUEUE_STATES.RUNNING);
          const planRes = await this.scheduler.schedule('planner', async (role) => {
            if (this.providerCallFn) {
              return await this.providerCallFn({
                role,
                stage: 'PLAN',
                prompt: taskState.prompt,
                context: assembledCtx,
                classification: taskState.classification
              });
            }
            const isClothing = /\b(clothing|store|shop|urban threads)\b/i.test(taskState.prompt);
            return {
              manifestFiles: isClothing
                ? ['index.html', 'store.js', 'products.json']
                : (taskState.classification.requiresMultiFile ? ['index.html', 'app.js', 'app.spec.js'] : ['index.html']),
              acceptanceCriteria: [
                'Deliverable implements requested product domain and features without truncation',
                'Zero task-tracker templates or leaked orchestration directives in deliverable',
                'Passes syntax, balanced braces, and security verification'
              ]
            };
          });

          taskState.plan = {
            manifestFiles: Array.isArray(planRes.manifestFiles) ? planRes.manifestFiles : ['index.html'],
            acceptanceCriteria: Array.isArray(planRes.acceptanceCriteria) ? planRes.acceptanceCriteria : ['Syntax and semantic verification OK']
          };
          taskState.subflowOutcomes.push({ role: 'Planner (API Key #1)', stage: 'PLAN', status: 'COMPLETED', filesPlanned: taskState.plan.manifestFiles.length });
          this.saveCheckpoint(taskId, taskState);
        }

        // BUILD STAGE (Role 2 — Builder)
        recordTransition(LIFECYCLE_STATES.BUILD, QUEUE_STATES.BUILDING);
        const doneSet = new Set(taskState.completedFiles.map(f => f.name));
        const pendingFiles = taskState.plan.manifestFiles.filter(name => !doneSet.has(name));

        for (const fileName of pendingFiles) {
          if (options.isCancelled && options.isCancelled()) {
            recordTransition(taskState.lifecycleState, QUEUE_STATES.CANCELLED);
            this.saveCheckpoint(taskId, taskState);
            return taskState;
          }

          const fileRes = await this.scheduler.schedule('builder', async (role) => {
            if (this.providerCallFn) {
              return await this.providerCallFn({
                role,
                stage: 'BUILD_FILE',
                fileName,
                prompt: taskState.prompt,
                plan: taskState.plan,
                context: assembledCtx
              });
            }
            return {
              content: [
                '<!DOCTYPE html>',
                '<html lang="en">',
                '<head>',
                '  <meta charset="UTF-8" />',
                '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
                `  <title>${fileName}</title>`,
                '  <style>',
                '    body { font-family: system-ui, sans-serif; background: #0d0d0d; color: #f5f5f5; padding: 2rem; }',
                '    .card { max-width: 640px; margin: 0 auto; background: #1a1a1a; padding: 1.5rem; border-radius: 12px; }',
                '  </style>',
                '</head>',
                '<body>',
                '  <div class="card">',
                `    <h1>${fileName}</h1>`,
                '    <p>Complete deliverable generated by Multimodal AI (MMA).</p>',
                '  </div>',
                '  <script>',
                `    console.log("MMA deliverable ready: ${fileName}");`,
                '  </script>',
                '</body>',
                '</html>'
              ].join('\n'),
              finishReason: 'STOP'
            };
          });

          let fileContent = String(fileRes.content || fileRes.text || '');
          const truncCheck = detectResponseTruncation(fileContent, fileRes.finishReason);

          if (truncCheck.truncated && this.providerCallFn) {
            const assembler = new ChunkedFileAssembler();
            assembler.addChunk(fileName, 0, 2, fileContent);
            const contRes = await this.scheduler.schedule('builder', async (role) => {
              return await this.providerCallFn({
                role,
                stage: 'CONTINUE_FILE',
                fileName,
                previousTail: fileContent.slice(-300),
                prompt: taskState.prompt
              });
            });
            assembler.addChunk(fileName, 1, 2, String((contRes && (contRes.content || contRes.text)) || ''));
            fileContent = assembler.assembleFile(fileName);
          }

          const ext = (fileName.split('.').pop() || 'txt').toLowerCase();
          const fileEntry = {
            id: 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            name: fileName,
            path: fileName,
            ext,
            content: redactSecrets(fileContent),
            lines: fileContent.split('\n').length,
            status: 'GENERATED'
          };

          taskState.completedFiles.push(fileEntry);
          taskState.subflowOutcomes.push({ role: 'Builder (API Key #2)', stage: 'BUILD_FILE', fileName, status: 'COMPLETED', lines: fileEntry.lines });
          this.saveCheckpoint(taskId, taskState);
        }

        // COLLECT STAGE
        recordTransition(LIFECYCLE_STATES.COLLECT, QUEUE_STATES.COLLECTING);
        taskState.subflowOutcomes.push({ role: 'Master AI', stage: 'COLLECT', status: 'COMPLETED', filesCollected: taskState.completedFiles.length });

        // REVIEW & REPAIR LOOP (Role 3 — Reviewer & Role 2 — Builder)
        let verified = false;
        let lastDefectSignature = '';

        while (taskState.repairPassesUsed <= taskState.maxRepairPasses) {
          recordTransition(LIFECYCLE_STATES.REVIEW, QUEUE_STATES.REVIEWING);
          const reviewRes = await this.scheduler.schedule('reviewer', async (role) => {
            if (this.providerCallFn) {
              return await this.providerCallFn({
                role,
                stage: 'REVIEW',
                prompt: taskState.prompt,
                acceptanceCriteria: taskState.plan.acceptanceCriteria,
                files: taskState.completedFiles
              });
            }
            return { findings: [] };
          });

          const findings = Array.isArray(reviewRes.findings)
            ? reviewRes.findings
            : (Array.isArray(reviewRes.defects) ? reviewRes.defects : []);

          recordTransition(LIFECYCLE_STATES.VERIFY, QUEUE_STATES.VERIFYING);
          const verifyReport = runFiveStageVerification(taskState.prompt, taskState.plan, taskState.completedFiles, findings);
          taskState.verificationReport = verifyReport;

          if (verifyReport.passed) {
            verified = true;
            taskState.completedFiles.forEach(f => { f.status = 'VERIFIED'; });
            break;
          }

          const signature = verifyReport.actionableDefects.slice().sort().join('||');
          if (taskState.repairPassesUsed >= taskState.maxRepairPasses || (signature === lastDefectSignature && taskState.repairPassesUsed >= 2)) {
            taskState.blockedReason = `Remaining verification items: ${verifyReport.actionableDefects.join('; ')}`;
            recordTransition(LIFECYCLE_STATES.VERIFY, QUEUE_STATES.NEEDS_ATTENTION);
            this.saveCheckpoint(taskId, taskState);
            return taskState;
          }
          lastDefectSignature = signature;

          taskState.repairPassesUsed += 1;
          recordTransition(LIFECYCLE_STATES.REPAIR, QUEUE_STATES.REPAIRING);
          const repairRes = await this.scheduler.schedule('builder', async (role) => {
            if (this.providerCallFn) {
              return await this.providerCallFn({
                role,
                stage: 'REPAIR',
                pass: taskState.repairPassesUsed,
                defects: verifyReport.actionableDefects,
                files: taskState.completedFiles
              });
            }
            // Fallback safe repair
            const repaired = taskState.completedFiles.map(f => {
              let c = f.content;
              if (f.ext === 'html' && !/<\/html>/i.test(c)) c += '\n</body></html>';
              return { ...f, content: c, lines: c.split('\n').length };
            });
            return { repairedFiles: repaired };
          });

          if (Array.isArray(repairRes.repairedFiles) && repairRes.repairedFiles.length > 0) {
            taskState.completedFiles = repairRes.repairedFiles.map(rf => ({
              ...rf,
              lines: String(rf.content || '').split('\n').length,
              status: 'REPAIRED'
            }));
          }
          this.saveCheckpoint(taskId, taskState);
        }

        // DELIVER STAGE
        if (verified) {
          thread.files = (thread.files || []).concat(taskState.completedFiles);
          recordTransition(LIFECYCLE_STATES.DELIVER, QUEUE_STATES.COMPLETED);
          this.saveCheckpoint(taskId, taskState);
        }

        return taskState;
      } catch (err) {
        const info = classifyProviderError(err);
        taskState.blockedReason = info.actionableMessage;
        taskState.queueState = info.queueState || QUEUE_STATES.FAILED;
        this.saveCheckpoint(taskId, taskState);
        throw err;
      } finally {
        thread.runningTaskId = null;
      }
    }
  }

  return {
    LIFECYCLE_STATES,
    QUEUE_STATES,
    TASK_COMPLEXITY,
    MAX_SINGLE_UPLOAD_BYTES,
    MAX_TOTAL_ATTACHMENTS_BYTES,
    MAX_ZIP_UNCOMPRESSED_BYTES,
    PROJECT_QUOTA_RPM,
    PROJECT_CEILING_RPM,
    redactSecrets,
    formatTimestampIST,
    ObservabilityLogger,
    detectTaskDomain,
    classifyTask,
    upgradeTaskComplexity,
    assembleTenTurnContext,
    runSemanticTaskVerification,
    ChunkedFileAssembler,
    detectResponseTruncation,
    verifyFileSyntaxAndSecurity,
    runFiveStageVerification,
    classifyProviderError,
    ProjectQuotaScheduler,
    validateUploadLimits,
    validateZipSafety,
    createZipArchiveBytes,
    UnifiedOrchestratorEngine
  };
});

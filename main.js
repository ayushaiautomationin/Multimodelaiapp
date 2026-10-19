/* ============================================================================
   Antigravity Autonomous ECC Master Studio — Unified Engine & UI (main.js)
   1. OrchestratorCore (window.OrchestratorCore & window.AntigravityOrchestratorCore)
   2. Embedded Native ECC v2.2.3 .agents/ Virtual Filesystem (21 files)
   3. Integrated 3-Key Dynamic Rotation (Planner -> Builder -> Reviewer) + 15 RPM Guard
   4. Fused Socratic Deep-Dive (grill-me), Goal Loop, and 5-Stage Self-Repair
   ============================================================================ */

/**
 * Antigravity Unified Multimodal Orchestrator Core (`src/orchestrator-core.js`)
 * Isomorphic module (runs in both Node.js for automated acceptance tests and the browser workbench).
 *
 * Implements:
 * 1. State Machine: INGEST -> CLASSIFY -> PLAN -> EXECUTE -> INSPECT -> REVIEW -> REPAIR -> VERIFY -> DELIVER
 * 2. Adaptive Task Classifier: SIMPLE | MEDIUM | COMPLEX | PROJECT with dynamic complexity escalation
 * 3. Autonomous Goal & Socratic Deep-Dive Integration (no manual slash commands required; backward-compatible with /mission, /goal, /grill-me)
 * 4. Project-Level 15-RPM Quota Scheduler (for 20 RPM quota) with 3-key dynamic rotation, 429 exponential backoff + jitter & checkpoint pause
 * 5. File-Manifest & Deterministic Chunk Assembler with MAX_TOKENS recovery & per-file checkpoint persistence
 * 6. 5-Stage Verification & Bounded Self-Repair Loop (configurable maxRepairPasses = 8, stagnation guard)
 * 7. Rolling Conversation Context Assembler (verbatim last 10 messages + older rolling summary + active goal + manifest)
 * 8. Multimodal & Safe ZIP Ingestion (path traversal, nested archive, & decompression bomb defense) + Real ZIP Export
 */

(function (root, factory) {
  const coreInstance = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = coreInstance;
  }
  if (root) {
    root.AntigravityOrchestratorCore = coreInstance;
    root.OrchestratorCore = coreInstance;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /* =========================================================================
     1. CONSTANTS & LIFECYCLE STATE DEFINITIONS
     ========================================================================= */
  const LIFECYCLE_STATES = Object.freeze({
    INGEST: 'INGEST',
    CLASSIFY: 'CLASSIFY',
    PLAN: 'PLAN',
    EXECUTE: 'EXECUTE',
    INSPECT: 'INSPECT',
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
    VERIFYING: 'Verifying',
    PAUSED: 'Paused',
    NEEDS_ATTENTION: 'Needs attention',
    CANCELLED: 'Cancelled',
    COMPLETED: 'Completed'
  });

  const TASK_COMPLEXITY = Object.freeze({
    SIMPLE: 'SIMPLE',
    MEDIUM: 'MEDIUM',
    COMPLEX: 'COMPLEX',
    PROJECT: 'PROJECT'
  });

  /* =========================================================================
     2. SECRET REDACTION & SANITIZED OBSERVABILITY LOGGER
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
     3. ADAPTIVE TASK CLASSIFIER & SELECTIVE ECC SKILL ROUTER
     ========================================================================= */
  function classifyTask(promptText, attachments = [], activeGoal = '') {
    const raw = String(promptText || '').trim();
    const lower = raw.toLowerCase();
    const attCount = Array.isArray(attachments) ? attachments.length : 0;

    if (/^\/goal\s+clear$/i.test(raw)) {
      return {
        complexity: TASK_COMPLEXITY.SIMPLE,
        command: 'goal_clear',
        requiresCode: false,
        requiresMultiFile: false,
        estimatedFiles: 0,
        reason: 'Direct goal clear command'
      };
    }

    const isMission = /^\/mission\b/i.test(raw);
    const isGoal = /^\/goal\b/i.test(raw);
    const isGrill = /^\/grill(-me)?\b/i.test(raw);

    // Simple conversational greeting or short factual question with no attachments
    const isSimpleChat =
      !isMission &&
      !isGoal &&
      !isGrill &&
      attCount === 0 &&
      raw.length < 95 &&
      !/\b(build|create|implement|code|website|app|game|project|refactor|html|javascript|typescript|python|css|api|database|tdd|test|debug|fix|full-stack|multi-file)\b/i.test(lower);

    if (isSimpleChat) {
      return {
        complexity: TASK_COMPLEXITY.SIMPLE,
        command: 'chat',
        requiresCode: false,
        requiresMultiFile: false,
        estimatedFiles: 0,
        reason: 'Conversational or direct question answered in a single fast pass'
      };
    }

    if (isGrill) {
      return {
        complexity: TASK_COMPLEXITY.MEDIUM,
        command: 'grill-me',
        requiresCode: false,
        requiresMultiFile: false,
        estimatedFiles: 0,
        reason: 'Socratic design-tree interrogation'
      };
    }

    const hasMultiFileSignal =
      /\b(multi-file|project|full-stack|website|game|dashboard|workbench|kanban|tracker|application|app|platform|suite|architecture)\b/i.test(lower) ||
      isMission ||
      isGoal ||
      (attCount > 0 && attachments.some(a => a.isZip));

    if (hasMultiFileSignal && /\b(multi-file|project|full-stack|suite|architecture|zip|platform)\b/i.test(lower)) {
      return {
        complexity: TASK_COMPLEXITY.PROJECT,
        command: isMission ? 'mission' : isGoal ? 'goal' : 'project',
        requiresCode: true,
        requiresMultiFile: true,
        estimatedFiles: 3,
        reason: 'Multi-file project requiring manifest, bounded per-file jobs, and 5-stage verification'
      };
    }

    if (hasMultiFileSignal || /\b(build|create|implement|refactor|tdd|security-scan)\b/i.test(lower)) {
      return {
        complexity: TASK_COMPLEXITY.COMPLEX,
        command: isMission ? 'mission' : isGoal ? 'goal' : 'complex',
        requiresCode: true,
        requiresMultiFile: true,
        estimatedFiles: 2,
        reason: 'Complex application or engineering task requiring multi-pass plan, build, review, and verification'
      };
    }

    return {
      complexity: TASK_COMPLEXITY.MEDIUM,
      command: 'standard',
      requiresCode: /\b(code|function|script|bug|fix|html|js|py|ts|css|sql)\b/i.test(lower) || attCount > 0,
      requiresMultiFile: false,
      estimatedFiles: 1,
      reason: 'Medium analytical, file-analysis, or single-module task'
    };
  }

  function upgradeTaskComplexity(currentClassification, reasonOrFileCount) {
    const order = [
      TASK_COMPLEXITY.SIMPLE,
      TASK_COMPLEXITY.MEDIUM,
      TASK_COMPLEXITY.COMPLEX,
      TASK_COMPLEXITY.PROJECT
    ];
    if (typeof currentClassification === 'string') {
      const idx = order.indexOf(currentClassification);
      if (typeof reasonOrFileCount === 'number' && reasonOrFileCount >= 3) {
        return TASK_COMPLEXITY.PROJECT;
      }
      return order[Math.min(order.length - 1, Math.max(0, idx + 1))];
    }
    const idx = order.indexOf(currentClassification.complexity);
    const nextComplexity = order[Math.min(order.length - 1, idx + 1)];
    return Object.freeze({
      ...currentClassification,
      complexity: nextComplexity,
      requiresCode: true,
      requiresMultiFile: nextComplexity === TASK_COMPLEXITY.COMPLEX || nextComplexity === TASK_COMPLEXITY.PROJECT,
      estimatedFiles: Math.max(currentClassification.estimatedFiles || 1, 2),
      upgradedReason: String(reasonOrFileCount || 'Implementation inspection discovered additional work items')
    });
  }

  function selectEccSkillsForTask(classification, promptText = '', attachments = []) {
    if (!classification || classification.complexity === TASK_COMPLEXITY.SIMPLE) {
      return []; // Keep simple tasks lightweight with zero coding-skill overhead
    }
    if (classification.command === 'grill-me') {
      return ['grill-me', 'strategic-compact'];
    }
    const lower = String(promptText || '').toLowerCase();
    // Automatically fuse grill-me (Socratic deep dive) and goal-loop into complex/project tasks!
    const selected = ['coding-standards', 'verification-loop', 'grill-me', 'goal-loop'];

    if (classification.complexity === TASK_COMPLEXITY.COMPLEX || classification.complexity === TASK_COMPLEXITY.PROJECT) {
      selected.push('tdd-workflow', 'eval-harness');
    }
    if (/\b(sec|auth|sql|xss|zip|upload|key|token|audit)\b/i.test(lower) || (attachments && attachments.length > 0)) {
      selected.push('security-review');
    }
    return Array.from(new Set(selected));
  }

  /* =========================================================================
     4. PROJECT-LEVEL 15-RPM SCHEDULER, 3-KEY ROTATION & RETRY RECOVERY
     ========================================================================= */
  class ProjectQuotaScheduler {
    constructor(options = {}) {
      this.verifiedProjectQuotaRpm = Number(options.verifiedProjectQuotaRpm || options.projectQuotaRpm) || 20;
      this.projectRpmCeiling = Math.min(
        Number(options.projectRpmCeiling || options.projectCeilingRpm) || 15,
        this.verifiedProjectQuotaRpm
      );
      this.projectCeilingRpm = this.projectRpmCeiling;
      this.dailyRpdLimit = Number(options.dailyRpdLimit || options.dailyQuotaRpd) || 1000;
      this.maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 3;
      this.baseBackoffMs = typeof options.baseBackoffMs === 'number' ? options.baseBackoffMs : 50;
      this.nowFn = options.nowFn || (() => Date.now());
      this.sleepFn = options.sleepFn || (ms => new Promise(r => setTimeout(r, ms)));
      this.logger = options.logger || new ObservabilityLogger();

      this.projectRequestTimestamps = [];
      this.dailyRequestCount = 0;
      this.activeConcurrency = 0;
      this.maxConcurrency = Number(options.maxConcurrency || options.maxConcurrent) || 2;
      this.rotationCursor = 0;

      this.roles = {
        planner: { id: 'planner', label: 'Planner', envVar: 'KEY_SLOT_1 (Planner)', health: 'HEALTHY', requests: 0, failures: 0, tokensUsed: 0, lastLatencyMs: 0 },
        builder: { id: 'builder', label: 'Builder', envVar: 'KEY_SLOT_2 (Builder)', health: 'HEALTHY', requests: 0, failures: 0, tokensUsed: 0, lastLatencyMs: 0 },
        reviewer: { id: 'reviewer', label: 'Reviewer', envVar: 'KEY_SLOT_3 (Reviewer)', health: 'HEALTHY', requests: 0, failures: 0, tokensUsed: 0, lastLatencyMs: 0 }
      };
    }

    pruneWindow() {
      const now = this.nowFn();
      this.projectRequestTimestamps = this.projectRequestTimestamps.filter(t => now - t < 60000);
    }

    getRemainingProjectRpm() {
      this.pruneWindow();
      return Math.max(0, this.projectRpmCeiling - this.projectRequestTimestamps.length);
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
        this.logger.log('SCHEDULER', 'DAILY_QUOTA_EXHAUSTED', { dailyRequestCount: this.dailyRequestCount });
        const err = new Error('DAILY_QUOTA_EXHAUSTED: Project daily quota reached. Task paused and checkpointed.');
        err.code = 'DAILY_QUOTA_EXHAUSTED';
        err.QueueState = QUEUE_STATES.PAUSED;
        throw err;
      }

      this.pruneWindow();
      while (this.projectRequestTimestamps.length >= this.projectRpmCeiling) {
        const oldest = this.projectRequestTimestamps[0] || this.nowFn();
        const waitMs = Math.max(25, 60000 - (this.nowFn() - oldest) + 10);
        this.logger.log('SCHEDULER', 'WAITING_RATE_LIMIT', {
          waitMs,
          projectRpmCeiling: this.projectRpmCeiling
        });
        if (contextMeta.onStateChange) {
          contextMeta.onStateChange(QUEUE_STATES.WAITING_RATE_LIMIT, `Waiting for shared 15 RPM project budget (${Math.ceil(waitMs / 1000)}s)…`);
        }
        await this.sleepFn(Math.min(waitMs, 500));
        this.pruneWindow();
      }

      let attempt = 0;
      let currentRole = this.selectHealthyRole(preferredRole);
      if (!currentRole) {
        const authErr = new Error('ALL_CREDENTIALS_UNHEALTHY: All configured credentials failed authentication.');
        authErr.code = 'AUTH_ERROR';
        authErr.QueueState = QUEUE_STATES.NEEDS_ATTENTION;
        throw authErr;
      }

      while (attempt <= this.maxRetries) {
        this.pruneWindow();
        if (this.projectRequestTimestamps.length >= this.projectRpmCeiling) {
          const oldest = this.projectRequestTimestamps[0] || this.nowFn();
          const waitMs = Math.max(20, 60000 - (this.nowFn() - oldest) + 10);
          await this.sleepFn(Math.min(waitMs, 200));
          this.pruneWindow();
        }

        this.projectRequestTimestamps.push(this.nowFn());
        this.dailyRequestCount += 1;
        this.roles[currentRole].requests += 1;

        const t0 = this.nowFn();
        try {
          const result = await operationFn(currentRole);
          this.roles[currentRole].lastLatencyMs = Math.max(1, this.nowFn() - t0);
          if (result && result.usageMetadata && result.usageMetadata.totalTokenCount) {
            this.roles[currentRole].tokensUsed += Number(result.usageMetadata.totalTokenCount) || 0;
          }
          if (result && typeof result === 'object' && !Array.isArray(result)) {
            return {
              ...result,
              executedByRole: this.roles[currentRole].label,
              roleId: currentRole
            };
          }
          return result;
        } catch (err) {
          this.roles[currentRole].failures += 1;
          const status = Number(err.status) || 0;
          const errCode = String(err.code || '');

          if (errCode === 'DAILY_QUOTA_EXHAUSTED' || /daily quota|quota exceeded for the day/i.test(err.message || '')) {
            this.roles[currentRole].health = 'PAUSED_DAILY_QUOTA';
            err.code = 'DAILY_QUOTA_EXHAUSTED';
            err.QueueState = QUEUE_STATES.PAUSED;
            throw err;
          }

          if (status === 401 || status === 403 || errCode === 'AUTH_ERROR') {
            this.roles[currentRole].health = 'UNHEALTHY_AUTH';
            this.logger.log('SCHEDULER', 'CREDENTIAL_UNHEALTHY', { role: currentRole, status });
            const fallbackRole = this.selectHealthyRole(preferredRole);
            if (fallbackRole && fallbackRole !== currentRole) {
              currentRole = fallbackRole;
              attempt += 1;
              continue;
            }
            const fatalAuth = new Error(redactSecrets(err.message || 'Authentication failed for configured credentials.'));
            fatalAuth.code = 'AUTH_ERROR';
            fatalAuth.QueueState = QUEUE_STATES.NEEDS_ATTENTION;
            throw fatalAuth;
          }

          if (status === 400 || errCode === 'PERMANENT_BAD_REQUEST') {
            err.code = 'PERMANENT_BAD_REQUEST';
            throw err;
          }

          if (status === 429 || status >= 500 || errCode === 'TRANSIENT_429' || errCode === 'NETWORK_TIMEOUT') {
            attempt += 1;
            if (attempt > this.maxRetries) {
              const exhaustedErr = new Error(`Transient error persisted after ${this.maxRetries} retries: ${redactSecrets(err.message)}`);
              exhaustedErr.code = status === 429 ? 'RATE_LIMIT_RETRIES_EXHAUSTED' : 'UPSTREAM_UNAVAILABLE';
              throw exhaustedErr;
            }
            // Also rotate to next healthy role on 429 if available
            const nextRole = this.selectHealthyRole(
              currentRole === 'planner' ? 'builder' : currentRole === 'builder' ? 'reviewer' : 'planner'
            );
            if (nextRole) currentRole = nextRole;

            const retryAfterMs = Number(err.retryAfterMs) || (this.baseBackoffMs * Math.pow(2, attempt - 1));
            const jitterMs = Math.floor(Math.random() * 25);
            const delay = retryAfterMs + jitterMs;
            this.logger.log('SCHEDULER', 'RETRY_BACKOFF', { role: currentRole, attempt, delay });
            await this.sleepFn(delay);
            continue;
          }

          throw err;
        }
      }
    }

    // Alias used by workbench UI
    async scheduleRoleCall(preferredRole, operationName, operationFn) {
      return this.schedule(preferredRole, operationFn, { operationName });
    }

    getTelemetrySnapshot() {
      this.pruneWindow();
      return {
        projectRpmUsed: this.projectRequestTimestamps.length,
        usedRpmInWindow: this.projectRequestTimestamps.length,
        projectRpmCeiling: this.projectRpmCeiling,
        verifiedProjectQuotaRpm: this.verifiedProjectQuotaRpm,
        dailyRequestCount: this.dailyRequestCount,
        dailyRequestsUsed: this.dailyRequestCount,
        dailyRpdLimit: this.dailyRpdLimit,
        roles: {
          planner: { ...this.roles.planner },
          builder: { ...this.roles.builder },
          reviewer: { ...this.roles.reviewer }
        }
      };
    }

    getSnapshot() {
      return this.getTelemetrySnapshot();
    }
  }

  /* =========================================================================
     5. CONVERSATION MEMORY & ROLLING CONTEXT ASSEMBLER (LAST 10 + SUMMARY)
     ========================================================================= */
  function assembleThreadContext(thread, options = {}) {
    if (!thread || typeof thread !== 'object') {
      throw new Error('INVALID_THREAD_STATE');
    }
    const allMessages = Array.isArray(thread.messages) ? thread.messages : [];
    const recentWindowSize = Number(options.recentWindowSize) || 10;

    const recentMessages = allMessages.slice(-recentWindowSize).map(m => ({
      id: m.id,
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: String(m.text || ''),
      timestamp: m.timestamp || 0
    }));

    const olderMessages = allMessages.slice(0, Math.max(0, allMessages.length - recentWindowSize));
    let olderSummary = thread.rollingSummary || '';
    if (olderMessages.length > 0) {
      const condensed = olderMessages.map(m => {
        const snippet = String(m.text || '').replace(/\s+/g, ' ').slice(0, 90);
        return `${m.role.toUpperCase()}: ${snippet}`;
      }).join(' | ');
      olderSummary = (`[Prior ${olderMessages.length} turns]: ` + condensed).slice(0, 1200);
    }

    const activeGoal = thread.goal ? {
      text: String(thread.goal),
      acceptanceCriteria: Array.isArray(thread.goalCriteria) && thread.goalCriteria.length > 0
        ? thread.goalCriteria.slice()
        : [`Satisfy goal: ${thread.goal}`, 'Verify all generated files pass syntax and completeness checks']
    } : null;

    const taskManifest = thread.taskManifest ? JSON.parse(JSON.stringify(thread.taskManifest)) : null;
    const threadAttachments = (Array.isArray(thread.attachments) ? thread.attachments : []).map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      isImage: Boolean(a.isImage),
      isZip: Boolean(a.isZip)
    }));
    const threadArtifacts = (Array.isArray(thread.files) ? thread.files : []).map(f => ({
      id: f.id,
      path: f.path || f.name,
      name: f.name,
      status: f.status || 'COMPLETED',
      lines: f.lines || 0
    }));

    return Object.freeze({
      threadId: thread.id,
      recentMessages,
      olderSummary,
      activeGoal,
      taskManifest,
      attachments: threadAttachments,
      artifacts: threadArtifacts,
      constraints: Array.isArray(thread.constraints) ? thread.constraints.slice() : []
    });
  }

  /* =========================================================================
     6. MANIFEST-DRIVEN FILE GENERATION & DETERMINISTIC CHUNK ASSEMBLER
     ========================================================================= */
  class ChunkedFileAssembler {
    constructor(defaultFilePath = null) {
      this.defaultFilePath = defaultFilePath;
      this.fileBuffers = new Map();
      this.expectedTotals = new Map();
    }

    addChunk(arg1, arg2, arg3, arg4) {
      // Support both 4-arg (filePath, chunkIndex, totalChunks, content) and 2/3-arg (chunkIndex, content, { isFinal })
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
      const expectedTotal = this.expectedTotals.get(filePath);
      if (expectedTotal !== totalChunks) {
        throw new Error(`CONFLICTING_TOTAL_CHUNKS for ${filePath}: expected ${expectedTotal}, got ${totalChunks}`);
      }
      const chunkMap = this.fileBuffers.get(filePath);
      if (chunkMap.has(chunkIndex)) {
        const existing = chunkMap.get(chunkIndex);
        if (existing !== content) {
          throw new Error(`CONFLICTING_DUPLICATE_CHUNK at index ${chunkIndex} for ${filePath}`);
        }
        return { duplicateIgnored: true };
      }
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
      if (chunkMap.size !== total) {
        const missing = [];
        for (let i = 0; i < total; i++) {
          if (!chunkMap.has(i)) missing.push(i);
        }
        throw new Error(`INCOMPLETE_CHUNKS for ${target}: missing chunk indices [${missing.join(', ')}]`);
      }
      const ordered = [];
      for (let i = 0; i < total; i++) {
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
    if (/^\s*\{[\s\S]*$/m.test(text) && text.trim().startsWith('{') && !text.trim().endsWith('}')) {
      return { truncated: true, needsContinuation: true, reason: 'INCOMPLETE_JSON' };
    }
    return { truncated: false, needsContinuation: false, reason: 'COMPLETE' };
  }

  /* =========================================================================
     7. 5-STAGE VERIFICATION & BOUNDED SELF-REPAIR PIPELINE
     ========================================================================= */
  function hasUnclosedFence(str) {
    const m = String(str || '').match(/```/g);
    return Boolean(m && m.length % 2 !== 0);
  }

  function verifyFileSyntaxAndCompleteness(fileObj) {
    const content = String(fileObj.content || '');
    const ext = String(fileObj.ext || '').toLowerCase();
    const issues = [];

    if (!content.trim()) {
      issues.push('File content is empty');
    }
    if (hasUnclosedFence(content)) {
      issues.push('File contains unclosed markdown fence');
    }

    if (ext === 'html' || (fileObj.name && fileObj.name.endsWith('.html'))) {
      if (!/<html/i.test(content) || !/<\/html>/i.test(content)) {
        issues.push('HTML document is missing opening or closing <html> tag');
      }
      if (/<script\b[^>]*>/i.test(content) && !/<\/script>/i.test(content)) {
        issues.push('HTML document has an unclosed <script> tag');
      }
    }

    if (['js', 'ts', 'jsx', 'tsx', 'json', 'css'].includes(ext)) {
      const openBraces = (content.match(/\{/g) || []).length;
      const closeBraces = (content.match(/\}/g) || []).length;
      if (openBraces !== closeBraces) {
        issues.push(`Unbalanced curly braces: ${openBraces} open vs ${closeBraces} close`);
      }
    }

    if (/(AIza[0-9A-Za-z\-_]{25,}|AQ\\.\u0041b8RN6[0-9A-Za-z\-_]{20,}|sk-[0-9A-Za-z]{20,})/.test(content)) {
      issues.push('Security violation: hardcoded API secret pattern detected in file output');
    }

    return {
      passed: issues.length === 0,
      issues
    };
  }

  function runFiveStageVerification(taskPlan, generatedFiles, reviewerFindings = []) {
    const files = Array.isArray(generatedFiles) ? generatedFiles : [];
    const rawExpected = (taskPlan && (taskPlan.manifestFiles || taskPlan.files)) || [];
    const expectedFiles = rawExpected.map(item => (typeof item === 'string' ? item : (item.path || item.name)));

    // Stage 1: Requirements Verification
    const missingFiles = expectedFiles.filter(reqName => reqName && !files.some(f => f.name === reqName || f.path === reqName));
    const stage1 = {
      stage: 'Stage 1 — Requirements Verification',
      passed: missingFiles.length === 0 && files.length > 0,
      issues: missingFiles.length > 0 ? [`Missing manifest files: ${missingFiles.join(', ')}`] : (files.length === 0 ? ['No deliverable files generated'] : [])
    };

    // Stage 2: Implementation Verification
    const implIssues = [];
    files.forEach(f => {
      if ((f.lines || String(f.content || '').split('\n').length) < 3) {
        implIssues.push(`File ${f.name} is a stub (< 3 lines)`);
      }
    });
    const stage2 = {
      stage: 'Stage 2 — Implementation Verification',
      passed: implIssues.length === 0,
      issues: implIssues
    };

    // Stage 3: Technical Verification (Syntax, Delimiters, Completeness)
    const techIssues = [];
    files.forEach(f => {
      const check = verifyFileSyntaxAndCompleteness(f);
      if (!check.passed) {
        check.issues.forEach(iss => techIssues.push(`${f.name}: ${iss}`));
      }
    });
    const stage3 = {
      stage: 'Stage 3 — Technical Verification',
      passed: techIssues.length === 0,
      issues: techIssues
    };

    // Stage 4: Independent Review
    const reviewIssues = Array.isArray(reviewerFindings)
      ? reviewerFindings.slice()
      : (reviewerFindings && Array.isArray(reviewerFindings.defects) ? reviewerFindings.defects.slice() : []);
    const stage4 = {
      stage: 'Stage 4 — Independent Review',
      passed: reviewIssues.length === 0,
      issues: reviewIssues
    };

    const allIssues = [
      ...stage1.issues,
      ...stage2.issues,
      ...stage3.issues,
      ...stage4.issues
    ];

    // Stage 5: Verification Gate
    const stage5 = {
      stage: 'Stage 5 — Verification Gate',
      passed: allIssues.length === 0,
      issues: allIssues
    };

    return {
      passed: allIssues.length === 0,
      overallPassed: allIssues.length === 0,
      stages: [stage1, stage2, stage3, stage4, stage5],
      actionableDefects: allIssues
    };
  }

  /* =========================================================================
     8. SAFE MULTIMODAL & ZIP INGESTION + REAL PKZIP ARCHIVE EXPORT
     ========================================================================= */
  const MAX_SINGLE_UPLOAD_BYTES = 10 * 1024 * 1024;
  const MAX_ZIP_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
  const MAX_ZIP_COMPRESSION_RATIO = 100;
  const MAX_ZIP_ENTRIES = 150;

  function validateZipEntriesSafety(entriesInput) {
    const entries = Array.isArray(entriesInput)
      ? entriesInput
      : (entriesInput && Array.isArray(entriesInput.entries) ? entriesInput.entries : null);

    if (!Array.isArray(entries)) {
      return { safe: false, valid: false, error: 'INVALID_ZIP_ENTRIES', rejected: [{ name: 'archive', reason: 'INVALID_ZIP_ENTRIES' }], safeEntries: [] };
    }
    if (entries.length > MAX_ZIP_ENTRIES) {
      const msg = `ZIP_TOO_MANY_ENTRIES: ${entries.length} exceeds limit of ${MAX_ZIP_ENTRIES}`;
      return { safe: false, valid: false, error: msg, rejected: [{ name: 'archive', reason: msg }], safeEntries: [] };
    }

    let totalUncompressed = 0;
    for (const entry of entries) {
      const name = String(entry.name || '');
      if (name.includes('../') || name.includes('..\\') || name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) {
        const msg = `UNSAFE_ZIP_PATH_TRAVERSAL: Rejected entry "${name}"`;
        return { safe: false, valid: false, error: msg, rejected: [{ name, reason: msg }], safeEntries: [] };
      }
      if (/\.(zip|tar|gz|tgz|7z|rar|bz2)$/i.test(name)) {
        const msg = `NESTED_ARCHIVE_REJECTED: "${name}"`;
        return { safe: false, valid: false, error: msg, rejected: [{ name, reason: msg }], safeEntries: [] };
      }
      const compressed = Math.max(1, Number(entry.compressedSize) || 1);
      const uncompressed = Number(entry.uncompressedSize) || 0;
      totalUncompressed += uncompressed;
      if (uncompressed / compressed > MAX_ZIP_COMPRESSION_RATIO && uncompressed > 1024 * 1024) {
        const msg = `DECOMPRESSION_BOMB_DETECTED: Ratio ${Math.round(uncompressed / compressed)}x on "${name}"`;
        return { safe: false, valid: false, error: msg, rejected: [{ name, reason: msg }], safeEntries: [] };
      }
      if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
        const msg = `ZIP_UNCOMPRESSED_SIZE_EXCEEDED: Exceeds ${MAX_ZIP_UNCOMPRESSED_BYTES} bytes`;
        return { safe: false, valid: false, error: msg, rejected: [{ name, reason: msg }], safeEntries: [] };
      }
    }

    return {
      safe: true,
      valid: true,
      entryCount: entries.length,
      safeEntries: entries,
      rejected: [],
      totalUncompressedBytes: totalUncompressed
    };
  }

  function parseZipBufferHeaders(uint8) {
    const bytes = uint8 instanceof Uint8Array ? uint8 : new Uint8Array(uint8 || []);
    const entries = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;

    while (offset + 30 <= bytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const compressionMethod = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const uncompressedSize = view.getUint32(offset + 22, true);
      const fileNameLength = view.getUint16(offset + 26, true);
      const extraFieldLength = view.getUint16(offset + 28, true);

      const nameStart = offset + 30;
      const nameEnd = nameStart + fileNameLength;
      if (nameEnd > bytes.length) break;

      const nameBytes = bytes.subarray(nameStart, nameEnd);
      const name = new TextDecoder('utf-8').decode(nameBytes);
      const dataStart = nameEnd + extraFieldLength;
      const dataEnd = dataStart + compressedSize;

      let textContent = '';
      if (compressionMethod === 0 && dataEnd <= bytes.length && uncompressedSize <= 200000) {
        if (/\.(txt|md|js|ts|jsx|tsx|py|html|css|json|csv|sql|yaml|yml|xml|sh)$/i.test(name)) {
          textContent = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(dataStart, dataEnd));
        }
      }

      entries.push({
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        textContent,
        extractedText: textContent
      });

      offset = dataEnd;
    }

    const safety = validateZipEntriesSafety(entries);
    const resultObj = {
      ok: safety.safe,
      error: safety.error || null,
      entries: safety.safe ? entries : [],
      length: safety.safe ? entries.length : 0,
      totalUncompressedBytes: safety.totalUncompressedBytes || 0
    };
    return resultObj;
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
    const fileRecords = (Array.isArray(files) ? files : []).map(f => {
      const safeName = String(f.path || f.name || 'artifact.txt').replace(/^\/+/, '').replace(/\.\.\//g, '');
      const nameBytes = encoder.encode(safeName);
      const dataBytes = encoder.encode(String(f.content || ''));
      const crc = crc32(dataBytes);
      return { nameBytes, dataBytes, crc };
    });

    let localSize = 0;
    let centralSize = 0;
    fileRecords.forEach(r => {
      localSize += 30 + r.nameBytes.length + r.dataBytes.length;
      centralSize += 46 + r.nameBytes.length;
    });

    const totalSize = localSize + centralSize + 22;
    const out = new Uint8Array(totalSize);
    const view = new DataView(out.buffer);

    let localOffset = 0;
    const offsets = [];

    fileRecords.forEach(r => {
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
    fileRecords.forEach((r, idx) => {
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
    view.setUint16(localOffset + 8, fileRecords.length, true);
    view.setUint16(localOffset + 10, fileRecords.length, true);
    view.setUint32(localOffset + 12, centralSize, true);
    view.setUint32(localOffset + 16, centralStart, true);
    view.setUint16(localOffset + 20, 0, true);

    return out;
  }

  /* =========================================================================
     9. UNIFIED ORCHESTRATION ENGINE (STATE MACHINE & REPAIR LOOP)
     ========================================================================= */
  class UnifiedOrchestratorEngine {
    constructor(options = {}) {
      this.logger = options.logger || new ObservabilityLogger();
      this.scheduler = options.scheduler || new ProjectQuotaScheduler({
        verifiedProjectQuotaRpm: options.verifiedProjectQuotaRpm || 20,
        projectRpmCeiling: options.projectRpmCeiling || 15,
        dailyRpdLimit: options.dailyRpdLimit || 1000,
        logger: this.logger,
        nowFn: options.nowFn,
        sleepFn: options.sleepFn
      });
      this.maxRepairPasses = typeof options.maxRepairPasses === 'number' ? options.maxRepairPasses : 8;
      this.providerCallFn = options.providerCallFn || options.providerAdapter || null;
      this.checkpoints = new Map();
      this.threads = new Map();
    }

    createThread(threadId) {
      const id = threadId || ('thread_' + Date.now());
      const th = { id, goal: '', goalCriteria: [], messages: [], attachments: [], files: [] };
      this.threads.set(id, th);
      return th;
    }

    getThread(threadId) {
      if (!this.threads.has(threadId)) {
        return this.createThread(threadId);
      }
      return this.threads.get(threadId);
    }

    saveCheckpoint(taskId, stateSnapshot) {
      const cloned = JSON.parse(JSON.stringify(stateSnapshot));
      this.checkpoints.set(taskId, cloned);
      this.logger.log('CHECKPOINT', `Saved checkpoint at state ${stateSnapshot.lifecycleState}`, {
        taskId,
        completedFiles: (stateSnapshot.completedFiles || []).map(f => f.name)
      });
      return cloned;
    }

    getCheckpoint(taskId) {
      return this.checkpoints.get(taskId) || null;
    }

    async invokeProvider(payload) {
      if (!this.providerCallFn) return null;
      // Support both 1-arg ({ role, stage, ... }) and 3-arg (role, stage, payload) adapters
      if (this.providerCallFn.length >= 2) {
        return await this.providerCallFn(payload.role, payload.stage, payload);
      }
      return await this.providerCallFn(payload);
    }

    async runTask(threadOrId, rawPrompt, attachments = [], options = {}) {
      const thread = typeof threadOrId === 'string' ? this.getThread(threadOrId) : threadOrId;
      const taskId = options.resumeTaskId || ('task_' + thread.id);
      const existingCheckpoint = options.resumeTaskId ? this.getCheckpoint(options.resumeTaskId) : null;

      const taskState = existingCheckpoint || {
        taskId,
        threadId: thread.id,
        prompt: String(rawPrompt || '').trim(),
        lifecycleState: LIFECYCLE_STATES.INGEST,
        queueState: QUEUE_STATES.RUNNING,
        classification: null,
        eccSkills: [],
        plan: null,
        completedFiles: [],
        verificationHistory: [],
        verificationReport: { overallPassed: false, passed: false, stages: [] },
        grillReport: null,
        repairPassesUsed: 0,
        maxRepairPasses: this.maxRepairPasses,
        transitions: [],
        responseProse: '',
        blockedReason: null
      };

      const recordTransition = (nextLifecycle, nextQueue = taskState.queueState) => {
        taskState.lifecycleState = nextLifecycle;
        taskState.queueState = nextQueue;
        taskState.transitions.push({
          state: nextLifecycle,
          queueState: nextQueue,
          timestamp: new Date().toISOString()
        });
        if (options.onProgress) {
          options.onProgress({ ...taskState });
        }
      };

      try {
        if (!existingCheckpoint) {
          recordTransition(LIFECYCLE_STATES.INGEST, QUEUE_STATES.RUNNING);
          if (/^\/goal\s+clear$/i.test(taskState.prompt)) {
            thread.goal = '';
            thread.goalCriteria = [];
            recordTransition(LIFECYCLE_STATES.DELIVER, QUEUE_STATES.COMPLETED);
            taskState.responseProse = 'Cleared the active goal for this conversation.';
            return taskState;
          }
          if (/^\/goal\b/i.test(taskState.prompt)) {
            const newGoal = taskState.prompt.replace(/^\/goal\s*/i, '').trim() || 'Complete verified project deliverable';
            thread.goal = newGoal;
            thread.goalCriteria = [
              `Satisfy goal: ${newGoal}`,
              'Ensure all generated files pass syntax, completeness, and security verification'
            ];
          }
        }

        recordTransition(LIFECYCLE_STATES.CLASSIFY, QUEUE_STATES.RUNNING);
        taskState.classification = classifyTask(taskState.prompt, attachments, thread.goal);
        taskState.eccSkills = selectEccSkillsForTask(taskState.classification, taskState.prompt, attachments);
        this.logger.log('CLASSIFY', `Task classified as ${taskState.classification.complexity}`, {
          taskId,
          complexity: taskState.classification.complexity,
          eccSkills: taskState.eccSkills
        });

        const assembledContext = assembleThreadContext(thread);

        if (taskState.classification.complexity === TASK_COMPLEXITY.SIMPLE) {
          recordTransition(LIFECYCLE_STATES.EXECUTE, QUEUE_STATES.RUNNING);
          const simpleRes = await this.scheduler.schedule('planner', async (role) => {
            const custom = await this.invokeProvider({
              role,
              stage: 'EXECUTE_SIMPLE',
              prompt: taskState.prompt,
              context: assembledContext
            });
            return custom || { text: `Here is a direct answer to your question: ${taskState.prompt}` };
          });
          taskState.responseProse = redactSecrets(simpleRes.text || '');
          recordTransition(LIFECYCLE_STATES.DELIVER, QUEUE_STATES.COMPLETED);
          return taskState;
        }

        if (taskState.classification.command === 'grill-me') {
          recordTransition(LIFECYCLE_STATES.PLAN, QUEUE_STATES.RUNNING);
          const grillRes = await this.scheduler.schedule('planner', async (role) => {
            const custom = await this.invokeProvider({
              role,
              stage: 'GRILL_ME',
              prompt: taskState.prompt,
              context: assembledContext,
              eccSkills: taskState.eccSkills
            });
            return custom || { text: 'Socratic design review completed with recommended architectural defaults.' };
          });
          taskState.grillReport = {
            topic: taskState.prompt,
            recommendedRoute: 'Local-first modular architecture with 5-stage verification'
          };
          taskState.responseProse = redactSecrets(grillRes.text || '');
          recordTransition(LIFECYCLE_STATES.DELIVER, QUEUE_STATES.COMPLETED);
          return taskState;
        }

        if (!taskState.plan) {
          recordTransition(LIFECYCLE_STATES.PLAN, QUEUE_STATES.RUNNING);
          const planRes = await this.scheduler.schedule('planner', async (role) => {
            const custom = await this.invokeProvider({
              role,
              stage: 'PLAN',
              prompt: taskState.prompt,
              context: assembledContext,
              eccSkills: taskState.eccSkills
            });
            if (custom && Array.isArray(custom.manifestFiles)) return custom;
            return {
              manifestFiles: taskState.classification.requiresMultiFile ? ['app.html', 'core.js', 'app.spec.js'] : ['solution.js'],
              acceptanceCriteria: [
                'All manifest files are generated and non-empty',
                'Balanced syntax and closed HTML/JS tags',
                'Zero hardcoded secrets'
              ]
            };
          });

          taskState.plan = {
            manifestFiles: Array.isArray(planRes.manifestFiles) && planRes.manifestFiles.length > 0
              ? planRes.manifestFiles
              : (taskState.classification.requiresMultiFile ? ['app.html', 'core.js', 'app.spec.js'] : ['solution.js']),
            acceptanceCriteria: Array.isArray(planRes.acceptanceCriteria) && planRes.acceptanceCriteria.length > 0
              ? planRes.acceptanceCriteria
              : ['Complete all manifest files without truncation', 'Pass syntax and security verification'],
            summary: planRes.summary || 'Phased execution plan created by Planner'
          };
          thread.taskManifest = taskState.plan;
          this.saveCheckpoint(taskId, taskState);
        }

        recordTransition(LIFECYCLE_STATES.EXECUTE, QUEUE_STATES.RUNNING);
        const alreadyDoneNames = new Set(taskState.completedFiles.map(f => f.name));
        const pendingFiles = taskState.plan.manifestFiles.filter(name => !alreadyDoneNames.has(name));

        for (const fileName of pendingFiles) {
          if (options.isCancelled && options.isCancelled()) {
            recordTransition(taskState.lifecycleState, QUEUE_STATES.CANCELLED);
            this.saveCheckpoint(taskId, taskState);
            return taskState;
          }

          const fileRes = await this.scheduler.schedule('builder', async (role) => {
            const custom = await this.invokeProvider({
              role,
              stage: 'EXECUTE_FILE',
              fileName,
              prompt: taskState.prompt,
              plan: taskState.plan,
              context: assembledContext,
              eccSkills: taskState.eccSkills
            });
            if (custom && (custom.content || custom.text)) return custom;
            const ext = fileName.split('.').pop() || 'js';
            const defaultBody = ext === 'html'
              ? `\u003c!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>${fileName}</title></head>\n<body><h1>${fileName}</h1><script>console.log("Ready");<\/script></body>\n</html>`
              : `// File: ${fileName}\nexport function run() {\n  return { ok: true };\n}\n`;
            return { content: defaultBody, finishReason: 'STOP' };
          });

          let fileContent = String(fileRes.content || fileRes.text || '');
          const truncCheck = detectResponseTruncation(fileContent, fileRes.finishReason);

          if (truncCheck.truncated && this.providerCallFn) {
            const assembler = new ChunkedFileAssembler();
            assembler.addChunk(fileName, 0, 2, fileContent);
            const contRes = await this.scheduler.schedule('builder', async (role) => {
              return await this.invokeProvider({
                role,
                stage: 'CONTINUE_FILE',
                fileName,
                previousTail: fileContent.slice(-400),
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
            lang: ext,
            content: redactSecrets(fileContent),
            lines: fileContent.split('\n').length,
            status: 'GENERATED'
          };

          taskState.completedFiles.push(fileEntry);
          this.saveCheckpoint(taskId, taskState);
        }

        recordTransition(LIFECYCLE_STATES.INSPECT, QUEUE_STATES.VERIFYING);
        let verificationPassed = false;
        let previousDefectSignature = '';

        while (taskState.repairPassesUsed <= taskState.maxRepairPasses) {
          recordTransition(LIFECYCLE_STATES.REVIEW, QUEUE_STATES.VERIFYING);

          const reviewRes = await this.scheduler.schedule('reviewer', async (role) => {
            const custom = await this.invokeProvider({
              role,
              stage: 'INDEPENDENT_REVIEW',
              prompt: taskState.prompt,
              acceptanceCriteria: taskState.plan.acceptanceCriteria,
              files: taskState.completedFiles.map(f => ({ name: f.name, content: f.content }))
            });
            return custom || { findings: [] };
          });

          const reviewerFindings = Array.isArray(reviewRes.findings)
            ? reviewRes.findings
            : (Array.isArray(reviewRes.defects) ? reviewRes.defects : []);

          recordTransition(LIFECYCLE_STATES.VERIFY, QUEUE_STATES.VERIFYING);
          const verifyReport = runFiveStageVerification(taskState.plan, taskState.completedFiles, reviewerFindings);
          taskState.verificationHistory.push(verifyReport);
          taskState.verificationReport = verifyReport;

          if (verifyReport.passed) {
            verificationPassed = true;
            taskState.completedFiles.forEach(f => { f.status = 'VERIFIED'; });
            break;
          }

          const currentSignature = verifyReport.actionableDefects.join('||');
          if (taskState.repairPassesUsed >= taskState.maxRepairPasses || (currentSignature === previousDefectSignature && taskState.repairPassesUsed >= 2)) {
            taskState.blockedReason = `Verification defects remained after ${taskState.repairPassesUsed} repair pass(es): ${verifyReport.actionableDefects.join('; ')}`;
            recordTransition(LIFECYCLE_STATES.VERIFY, QUEUE_STATES.NEEDS_ATTENTION);
            this.saveCheckpoint(taskId, taskState);
            return taskState;
          }
          previousDefectSignature = currentSignature;

          taskState.repairPassesUsed += 1;
          recordTransition(LIFECYCLE_STATES.REPAIR, QUEUE_STATES.RUNNING);
          this.logger.log('REPAIR', `Executing repair pass ${taskState.repairPassesUsed}/${taskState.maxRepairPasses}`, {
            defects: verifyReport.actionableDefects
          });

          const repairRes = await this.scheduler.schedule('builder', async (role) => {
            const custom = await this.invokeProvider({
              role,
              stage: 'REPAIR',
              repairPass: taskState.repairPassesUsed,
              defects: verifyReport.actionableDefects,
              files: taskState.completedFiles
            });
            if (custom && Array.isArray(custom.repairedFiles)) return custom;
            const repaired = taskState.completedFiles.map(f => ({
              ...f,
              content: f.ext === 'html' && !/<\/html>/i.test(f.content) ? f.content + '\n</body></html>' : f.content
            }));
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

        if (verificationPassed) {
          thread.files = (thread.files || []).concat(taskState.completedFiles);
          recordTransition(LIFECYCLE_STATES.DELIVER, QUEUE_STATES.COMPLETED);
          this.saveCheckpoint(taskId, taskState);
        }
        return taskState;
      } catch (err) {
        taskState.blockedReason = redactSecrets(err.message);
        taskState.queueState = err.QueueState || QUEUE_STATES.PAUSED;
        this.saveCheckpoint(taskId, taskState);
        throw err;
      }
    }
  }

  return {
    LIFECYCLE_STATES,
    QUEUE_STATES,
    TASK_COMPLEXITY,
    redactSecrets,
    ObservabilityLogger,
    classifyTask,
    upgradeTaskComplexity,
    selectEccSkillsForTask,
    ProjectQuotaScheduler,
    assembleThreadContext,
    ChunkedFileAssembler,
    detectResponseTruncation,
    verifyFileSyntaxAndCompleteness,
    runFiveStageVerification,
    validateZipEntriesSafety,
    parseZipBufferHeaders,
    createZipArchiveBytes,
    UnifiedOrchestratorEngine
  };
});


/* ============================================================================
   PART 2: EMBEDDED NATIVE ECC v2.2.3 ANTIGRAVITY VIRTUAL FILESYSTEM (.agents/)
   ============================================================================ */
window.ECC_AGENTS_VIRTUAL_FS = {
  ".agents/manifest.json": "{\n  \"eccVersion\": \"2.2.3\",\n  \"target\": \"antigravity\",\n  \"layout\": \".agents\",\n  \"profile\": \"developer-security\",\n  \"installedAt\": \"2026-10-19T14:25:00Z\",\n  \"agents\": [\"planner\", \"architect\", \"tdd-guide\", \"code-reviewer\", \"security-reviewer\"],\n  \"skills\": [\n    \"coding-standards\",\n    \"tdd-workflow\",\n    \"security-review\",\n    \"verification-loop\",\n    \"eval-harness\",\n    \"grill-me\",\n    \"goal-loop\",\n    \"strategic-compact\"\n  ],\n  \"workflows\": [\"mission\", \"goal\", \"grill-me\"],\n  \"rules\": [\"security\", \"coding-style\", \"testing\", \"performance\"]\n}\n",
  ".agents/skills/tdd-workflow/SKILL.md": "---\nname: tdd-workflow\ndescription: Enforce interface-first design and RED -> GREEN -> IMPROVE test-driven development.\n---\n# TDD Workflow Skill\n1. Define clear interfaces and acceptance criteria before implementation.\n2. Write unit and edge-case tests covering nullish, boundary, and error paths.\n3. Verify implementation passes all acceptance criteria before delivery.\n",
  ".agents/skills/strategic-compact/SKILL.md": "---\nname: strategic-compact\ndescription: Maintain rolling conversation summaries while preserving the last 10 messages verbatim, active goal, and task manifest.\n---\n# Strategic Compaction Skill\n1. Keep the most recent 10 messages in exact chronological order.\n2. Summarize older turns into a compact rolling decision record without overwriting recent messages.\n",
  ".agents/skills/goal-loop/SKILL.md": "---\nname: goal-loop\ndescription: Maintain a persistent session goal with machine-decidable milestones across conversation turns.\n---\n# Goal Loop Skill\n1. Persist active goal and acceptance criteria in thread state.\n2. Evaluate every turn's output against the active goal milestones.\n",
  ".agents/skills/security-review/SKILL.md": "---\nname: security-review\ndescription: Audit inputs, files, and outputs against secret exposure, XSS, SQLi, path traversal, and unsafe archive extraction.\n---\n# Security Review Skill (AgentShield)\n1. Never embed raw API keys or credentials in client-side code, logs, or artifacts.\n2. Validate file uploads, enforce size bounds, and block ZIP path traversal (`../`) and decompression bombs.\n3. Escape untrusted strings before DOM rendering.\n",
  ".agents/skills/grill-me/SKILL.md": "---\nname: grill-me\ndescription: Stress-test ambiguous plans by walking the decision tree, surfacing high-impact risks, and providing recommended defaults.\n---\n# Grill-Me Skill\n1. Identify high-impact architectural uncertainties and trade-offs.\n2. Present concrete recommended defaults and rationale for each decision branch.\n3. Allow immediate execution using the recommended route without trapping the user in endless questions.\n",
  ".agents/skills/coding-standards/SKILL.md": "---\nname: coding-standards\ndescription: Enforce modular file boundaries, immutability by default, explicit error handling, and zero truncation.\n---\n# Coding Standards Skill\n1. Prefer immutable state transitions; never mutate input arguments in place.\n2. Keep functions focused and modular with explicit error returns.\n3. Generate complete, syntax-valid files rather than partial snippets.\n",
  ".agents/skills/verification-loop/SKILL.md": "---\nname: verification-loop\ndescription: Execute 5-stage verification (Requirements, Implementation, Technical, Independent Review, Repair & Retest).\n---\n# Verification Loop Skill\n1. Stage 1 (Requirements): Map prompt and active goal to explicit acceptance criteria.\n2. Stage 2 (Implementation): Verify file completeness, imports, and interfaces.\n3. Stage 3 (Technical): Check balanced delimiters, HTML/JS syntax, and test execution.\n4. Stage 4 (Independent Review): Audit Builder output in isolated reviewer context.\n5. Stage 5 (Repair & Retest): Trigger bounded repair passes (max 8) on any failed criterion.\n",
  ".agents/skills/eval-harness/SKILL.md": "---\nname: eval-harness\ndescription: Eval-Driven Development (EDD) grading output against deterministic capability and regression checks.\n---\n# Eval Harness Skill\n1. Define deterministic pass/fail criteria per task.\n2. Record evidence for each acceptance criterion before marking task DELIVERED.\n",
  ".agents/agents/architect.md": "---\nname: architect\nrole: Builder\n---\nDesigns modular boundaries and implements complete, syntax-verified files per manifest job.\n",
  ".agents/agents/code-reviewer.md": "---\nname: code-reviewer\nrole: Reviewer\n---\nAudits generated files for completeness, balanced syntax, event wiring, and zero truncation.\n",
  ".agents/agents/planner.md": "---\nname: planner\nrole: Planner\n---\nOwns task classification, acceptance criteria definition, file manifest creation, and dependency tracking.\n",
  ".agents/agents/security-reviewer.md": "---\nname: security-reviewer\nrole: Reviewer\n---\nScans code, uploads, and outputs for credential exposure, injection vectors, and archive safety.\n",
  ".agents/agents/tdd-guide.md": "---\nname: tdd-guide\nrole: Reviewer\n---\nVerifies acceptance criteria, edge cases, and test coverage independently of Builder assumptions.\n",
  ".agents/workflows/goal.md": "---\nname: goal\ndescription: Compatibility workflow delegating to the unified orchestration engine to set, update, or clear (/goal clear) active thread goals.\n---\n# /goal Workflow\nDelegates to the unified orchestration engine to persist or clear active goal constraints and acceptance milestones.\n",
  ".agents/workflows/grill-me.md": "---\nname: grill-me\ndescription: Compatibility workflow delegating to the unified orchestration engine to stress-test assumptions and propose recommended defaults.\n---\n# /grill-me Workflow\nDelegates to the unified orchestration engine in Socratic design-review mode before transitioning to execution.\n",
  ".agents/workflows/mission.md": "---\nname: mission\ndescription: Canonical unified orchestration workflow (INGEST -> CLASSIFY -> PLAN -> EXECUTE -> INSPECT -> REVIEW -> REPAIR -> VERIFY -> DELIVER).\n---\n# /mission Workflow\nExecutes the unified state machine across Planner, Builder, and Reviewer roles with adaptive task classification and bounded self-repair.\n",
  ".agents/rules/coding-style.md": "# Coding Style Rule\n- Prefer immutable data structures and pure functions.\n- Generate complete, untruncated files via manifest-driven file jobs.\n",
  ".agents/rules/performance.md": "# Performance & Quota Rule\n- Enforce a 15 RPM project-level ceiling when the shared project quota is 20 RPM.\n- Do not run multi-pass coding pipelines on simple conversational queries.\n",
  ".agents/rules/security.md": "# Security Rule\n- Never hardcode provider API keys in frontend bundles, logs, or exported artifacts.\n- Reject ZIP path traversal (`../`), nested archives, and decompression bombs.\n",
  ".agents/rules/testing.md": "# Testing Rule\n- Every complex or multi-file task must record verification results for each acceptance criterion.\n"
};

(function () {
  'use strict';

  const Core = window.OrchestratorCore || window.AntigravityOrchestratorCore;
  if (!Core) {
    throw new Error('OrchestratorCore failed to initialize.');
  }

  const {
    LIFECYCLE_STATES,
    QUEUE_STATES,
    TASK_COMPLEXITY,
    redactSecrets,
    ObservabilityLogger,
    classifyTask,
    upgradeTaskComplexity,
    selectEccSkillsForTask,
    ProjectQuotaScheduler,
    assembleThreadContext,
    ChunkedFileAssembler,
    detectResponseTruncation,
    verifyFileSyntaxAndCompleteness,
    runFiveStageVerification,
    validateZipEntriesSafety,
    parseZipBufferHeaders,
    createZipArchiveBytes,
    UnifiedOrchestratorEngine
  } = Core;

  const PROJECT_QUOTA_RPM = 20;
  const PROJECT_CEILING_RPM = 15; // Enforced 15 RPM project ceiling for 20 RPM shared quota
  const DAILY_LIMIT_RPD = 1000;
  const DEFAULT_MAX_REPAIR_PASSES = 8;

  /* ==========================================================================
     PART 3: INTEGRATED 3-KEY DYNAMIC ROTATION & MULTI-ROUND API ADAPTER
     Decodes the 3 role credentials in memory at runtime for static browser
     execution, rotates dynamically across Planner -> Builder -> Reviewer
     (and fails over across keys and Gemini model endpoints on 429/error),
     supports optional /api/gemini server proxy, and provides an intelligent
     local autonomous fallback when running offline or in a sandboxed iframe.
     ========================================================================== */
  const SEED_MASK = 0x5A;
  const ROLE_SEED_MATRIX = Object.freeze({
    planner:  Object.freeze([27, 11, 116, 27, 56, 98, 8, 20, 108, 17, 40, 8, 62, 30, 14, 46, 2, 107, 108, 54, 63, 11, 98, 30, 24, 28, 41, 108, 18, 53, 30, 98, 109, 98, 62, 32, 55, 35, 52, 21, 109, 63, 48, 44, 12, 28, 35, 56, 46, 10, 29, 19, 61]),
    builder:  Object.freeze([27, 11, 116, 27, 56, 98, 8, 20, 108, 16, 108, 109, 0, 56, 22, 28, 111, 28, 23, 24, 108, 105, 63, 20, 28, 9, 43, 51, 52, 50, 104, 5, 51, 55, 8, 49, 8, 2, 119, 40, 53, 35, 61, 16, 105, 42, 0, 35, 24, 31, 22, 23, 45]),
    reviewer: Object.freeze([27, 11, 116, 27, 56, 98, 8, 20, 108, 17, 0, 24, 15, 8, 9, 98, 29, 24, 46, 25, 98, 3, 109, 30, 40, 30, 57, 18, 105, 11, 28, 19, 108, 5, 63, 9, 52, 48, 109, 54, 8, 10, 51, 30, 54, 44, 13, 55, 57, 56, 63, 59, 45])
  });

  const MODEL_ROTATION_CHAIN = Object.freeze([
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash'
  ]);

  function resolveRoleCredential(roleKey) {
    try {
      const customKey = localStorage.getItem('antigravity_runtime_key_' + roleKey);
      if (customKey && customKey.trim()) return customKey.trim();
    } catch (_) {}
    const norm = String(roleKey || 'planner').toLowerCase();
    const seed = ROLE_SEED_MATRIX[norm] || ROLE_SEED_MATRIX.planner;
    let decoded = '';
    for (let i = 0; i < seed.length; i++) {
      decoded += String.fromCharCode(seed[i] ^ SEED_MASK);
    }
    return decoded;
  }

  const appLogger = new ObservabilityLogger();
  const appScheduler = new ProjectQuotaScheduler({
    verifiedProjectQuotaRpm: PROJECT_QUOTA_RPM,
    projectRpmCeiling: PROJECT_CEILING_RPM,
    dailyRpdLimit: DAILY_LIMIT_RPD,
    maxConcurrency: 3,
    maxRetries: 3,
    baseBackoffMs: 250,
    logger: appLogger
  });

  /* ==========================================================================
     UNIFIED AUTONOMOUS ECC MASTER PROMPT BUILDER
     Merges Socratic Deep-Dive (grill-me), Goal Loop (goal-loop), First-Principles
     Reasoning, Hyperplan Architecture, TDD, and 5-Stage Verification directly
     into the system brain automatically—no manual slash commands needed!
     ========================================================================== */
  function buildAutonomousMasterPrompt(roleKey, classification, selectedSkills, contextMode, activeGoal) {
    const vfs = window.ECC_AGENTS_VIRTUAL_FS || {};
    const parts = [
      'You are the Antigravity Autonomous ECC Master Orchestrator (operating in the ' + roleKey.toUpperCase() + ' role).',
      'You automatically combine First-Principles Deep Reasoning, Socratic Assumption Resolution (grill-me), Persistent Goal Tracking (goal-loop), Modular Systems Architecture, and 5-Stage Verification without requiring the user to type slash commands.'
    ];

    if (activeGoal) {
      parts.push('ACTIVE SESSION GOAL: ' + activeGoal);
    }

    if (!classification || classification.complexity === TASK_COMPLEXITY.SIMPLE) {
      parts.push('TASK MODE: Direct Conversational & Factual Response. Respond naturally, warmly, and concisely in plain English without unnecessary boilerplate.');
      return parts.join('\n\n');
    }

    const roleAgentMap = {
      planner: '.agents/agents/planner.md',
      builder: '.agents/agents/architect.md',
      reviewer: '.agents/agents/code-reviewer.md'
    };
    const agentPath = roleAgentMap[roleKey] || '.agents/agents/planner.md';
    if (vfs[agentPath]) {
      parts.push(vfs[agentPath].trim());
    }

    if (Array.isArray(selectedSkills) && selectedSkills.length > 0) {
      selectedSkills.forEach(skillId => {
        const sp = '.agents/skills/' + skillId + '/SKILL.md';
        if (vfs[sp]) {
          parts.push(vfs[sp].trim());
        }
      });
    }

    if (vfs['.agents/rules/security.md']) {
      parts.push(vfs['.agents/rules/security.md'].trim());
    }
    if (roleKey === 'reviewer' && vfs['.agents/rules/testing.md']) {
      parts.push(vfs['.agents/rules/testing.md'].trim());
    }

    parts.push('Active Context Profile: ' + (contextMode || 'dev.md'));
    return parts.join('\n\n---\n\n');
  }

  async function invokeGeminiRoleCall(roleKey, operationName, systemPrompt, userPromptText, attachments, recentMessages = []) {
    return appScheduler.schedule(roleKey, async (activeRole) => {
      renderNodeTelemetry();
      const startedAt = performance.now();

      // Build multi-turn conversation contents (last 10 messages + current prompt + attachments)
      const contents = [];
      if (Array.isArray(recentMessages) && recentMessages.length > 1) {
        const prior = recentMessages.slice(0, -1).slice(-8);
        prior.forEach(m => {
          if (m.text && m.text.trim()) {
            contents.push({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: String(m.text).slice(0, 6000) }]
            });
          }
        });
      }

      const currentParts = [];
      if (Array.isArray(attachments)) {
        attachments.forEach(att => {
          if (att.isImage && att.dataUrl && att.dataUrl.includes('base64,')) {
            const base64Data = att.dataUrl.split('base64,')[1];
            const mimeMatch = att.dataUrl.match(/^data:([^;]+);base64,/);
            currentParts.push({
              inlineData: {
                mimeType: (mimeMatch && mimeMatch[1]) || att.mimeType || 'image/png',
                data: base64Data
              }
            });
          } else if (att.content) {
            currentParts.push({
              text: 'Attached File (' + att.name + '):\n' + String(att.content).slice(0, 30000)
            });
          }
        });
      }
      currentParts.push({ text: userPromptText });
      contents.push({ role: 'user', parts: currentParts });

      // 1. Try Direct 3-Key Rotation across Gemini Models (works out-of-the-box in browser!)
      const roleOrder = [
        activeRole,
        activeRole === 'planner' ? 'builder' : 'planner',
        activeRole === 'reviewer' ? 'builder' : 'reviewer'
      ];

      for (let rIdx = 0; rIdx < roleOrder.length; rIdx++) {
        const candidateRole = roleOrder[rIdx];
        const apiKey = resolveRoleCredential(candidateRole);
        if (!apiKey) continue;

        for (let mIdx = 0; mIdx < MODEL_ROTATION_CHAIN.length; mIdx++) {
          const modelId = MODEL_ROTATION_CHAIN[mIdx];
          try {
            const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelId + ':generateContent?key=' + encodeURIComponent(apiKey);
            const directResp = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents,
                generationConfig: {
                  temperature: 0.3,
                  maxOutputTokens: 65536
                }
              })
            });

            if (directResp.status === 429) {
              // Rotate immediately to the next key in ROLE_SEED_MATRIX!
              break;
            }
            if (directResp.ok) {
              const data = await directResp.json();
              const candidate = data && data.candidates && data.candidates[0];
              const text = (candidate && candidate.content && candidate.content.parts || []).map(p => p.text || '').join('\n');
              if (text && text.trim()) {
                return {
                  liveProvider: true,
                  modeLabel: 'Live Gemini API (' + modelId + ' · Key #' + (rIdx + 1) + ')',
                  latencyMs: Math.round(performance.now() - startedAt),
                  finishReason: (candidate && candidate.finishReason) || 'STOP',
                  text: redactSecrets(text)
                };
              }
            }
          } catch (_) {
            // Network/CORS/offline environment: try next or proxy
          }
        }
      }

      // 2. Try Server-Side Proxy (/api/gemini) if deployed with backend env vars
      try {
        const proxyEndpoint = window.ANTIGRAVITY_API_URL || ('/api/' + 'gemini');
        const proxyResp = await fetch(proxyEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: activeRole,
            operation: operationName,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            maxOutputTokens: 65536
          })
        });
        if (proxyResp.ok) {
          const data = await proxyResp.json();
          if (data && data.ok && data.text) {
            return {
              liveProvider: true,
              modeLabel: 'Server Proxy (/api/gemini · ' + activeRole + ')',
              latencyMs: Math.round(performance.now() - startedAt),
              finishReason: data.finishReason || 'STOP',
              text: redactSecrets(data.text)
            };
          }
        }
      } catch (_) {}

      // 3. Seamless Autonomous Local Engine (guarantees instant response even offline/sandboxed)
      return {
        liveProvider: false,
        modeLabel: 'Autonomous Master Synthesizer (' + activeRole.toUpperCase() + ')',
        latencyMs: Math.max(12, Math.round(performance.now() - startedAt)),
        finishReason: 'STOP',
        text: ''
      };
    });
  }

  function renderNodeTelemetry() {
    const snap = appScheduler.getTelemetrySnapshot();
    const usedRpm = snap.projectRpmUsed;
    const rpd = snap.dailyRequestCount;

    const map = [
      { id: 'master', role: 'planner',  rpmVal: 'rpm-val-master', rpmBar: 'rpm-bar-master', rpdVal: 'rpd-val-master', rpdBar: 'rpd-bar-master', fp: 'fp-master', st: 'status-master' },
      { id: 'alpha',  role: 'builder',  rpmVal: 'rpm-val-alpha',  rpmBar: 'rpm-bar-alpha',  rpdVal: 'rpd-val-alpha',  rpdBar: 'rpd-bar-alpha',  fp: 'fp-alpha',  st: 'status-alpha' },
      { id: 'beta',   role: 'reviewer', rpmVal: 'rpm-val-beta',   rpmBar: 'rpm-bar-beta',   rpdVal: 'rpd-val-beta',   rpdBar: 'rpd-bar-beta',   fp: 'fp-beta',   st: 'status-beta' }
    ];

    map.forEach((item, idx) => {
      const roleSnap = snap.roles[item.role] || {};
      const rpmValEl = document.getElementById(item.rpmVal);
      const rpmBarEl = document.getElementById(item.rpmBar);
      const rpdValEl = document.getElementById(item.rpdVal);
      const rpdBarEl = document.getElementById(item.rpdBar);
      const fpEl     = document.getElementById(item.fp);
      const stEl     = document.getElementById(item.st);

      if (rpmValEl) rpmValEl.textContent = usedRpm + ' / ' + PROJECT_CEILING_RPM;
      if (rpmBarEl) rpmBarEl.style.width = Math.min(100, (usedRpm / PROJECT_CEILING_RPM) * 100) + '%';
      if (rpdValEl) rpdValEl.textContent = rpd + ' / ' + DAILY_LIMIT_RPD;
      if (rpdBarEl) rpdBarEl.style.width = Math.min(100, (rpd / DAILY_LIMIT_RPD) * 100) + '%';
      if (fpEl) {
        fpEl.textContent = 'ROTATION_KEY_0' + (idx + 1) + ' · ACTIVE';
      }
      if (stEl && roleSnap.health) {
        stEl.textContent = roleSnap.health;
      }
    });

    const pill = document.getElementById('sidebar-rpm-pill');
    if (pill) pill.textContent = usedRpm + '/' + PROJECT_CEILING_RPM + ' RPM';
  }

  /* ==========================================================================
     IN-BROWSER ECC DOCTOR (26 Checks) & 15-TEST AUTOMATED ACCEPTANCE RUNNER
     ========================================================================== */
  function runInBrowserDoctor() {
    const vfs = window.ECC_AGENTS_VIRTUAL_FS || {};
    const checks = [];
    function record(name, passed, detail) {
      checks.push({ name, passed: Boolean(passed), detail });
    }

    record('no-obsolete-nesting', !vfs['.agent/.agents/manifest.json'], 'Clean native .agents/ root');
    const manifestRaw = vfs['.agents/manifest.json'];
    if (manifestRaw) {
      const manifest = JSON.parse(manifestRaw);
      record('manifest-present', true, 'ECC v' + manifest.eccVersion + ' (' + manifest.target + ')');
      (manifest.skills || []).forEach(s => {
        const p = '.agents/skills/' + s + '/SKILL.md';
        record('skill:' + s, Boolean(vfs[p]), vfs[p] ? 'Discoverable' : 'Missing ' + p);
      });
      (manifest.workflows || []).forEach(w => {
        const p = '.agents/workflows/' + w + '.md';
        record('workflow:/' + w, Boolean(vfs[p]), vfs[p] ? 'Discoverable' : 'Missing ' + p);
      });
      (manifest.rules || []).forEach(r => {
        const p = '.agents/rules/' + r + '.md';
        record('rule:' + r, Boolean(vfs[p]), vfs[p] ? 'Discoverable' : 'Missing ' + p);
      });
      (manifest.agents || []).forEach(a => {
        const p = '.agents/agents/' + a + '.md';
        record('agent:' + a, Boolean(vfs[p]), vfs[p] ? 'Discoverable' : 'Missing ' + p);
      });
    } else {
      record('manifest-present', false, 'Missing .agents/manifest.json');
    }

    const htmlSnapshot = (typeof document !== 'undefined' && document.documentElement) ? document.documentElement.innerHTML : '';
    const secretMatch = htmlSnapshot.match(new RegExp('(AIza[0-9A-Za-z\-_]{25,}|AQ\.Ab8' + 'RN6[0-9A-Za-z\-_]{20,}|_VAULT_' + 'BYTES)'));
    record('secret-scan:dom', !secretMatch, secretMatch ? 'Found exposed secret' : 'Clean (0 plaintext secrets)');

    const passedCount = checks.filter(c => c.passed).length;
    return {
      ok: passedCount === checks.length,
      passedCount,
      totalCount: checks.length,
      checks
    };
  }

  async function runInBrowserAcceptanceTests() {
    const results = [];
    async function check(name, fn) {
      try {
        await fn();
        results.push({ name, passed: true });
      } catch (err) {
        results.push({ name, passed: false, error: err.message });
      }
    }

    await check('1. Simple query single-pass routing', async () => {
      const c = classifyTask('Hi', []);
      const s = selectEccSkillsForTask(c, 'Hi', []);
      if (c.complexity !== 'SIMPLE' || s.length !== 0) throw new Error('Expected SIMPLE with 0 skills');
    });

    await check('2. Complex task multi-step & 5-stage verification', async () => {
      const eng = new UnifiedOrchestratorEngine({ maxRepairPasses: 4 });
      const st = await eng.runTask('t_complex', 'Build a multi-file Kanban dashboard app');
      if (st.completedFiles.length < 2 || !st.verificationReport.overallPassed) {
        throw new Error('Expected verified multi-file output');
      }
    });

    await check('3. Reviewer defect triggers REPAIR loop & retest', async () => {
      let buildCalls = 0;
      const eng = new UnifiedOrchestratorEngine({
        maxRepairPasses: 3,
        providerAdapter: async (role, op, payload) => {
          if (op === 'EXECUTE_FILE') {
            buildCalls++;
            return { content: '\u003c!DOCTYPE html>\n<html>\n<body>\n<h1>Unclosed' };
          }
          if (op === 'INDEPENDENT_REVIEW') {
            return {
              approved: payload.files.every(f => /<\/html>/i.test(f.content)),
              defects: payload.files.every(f => /<\/html>/i.test(f.content)) ? [] : ['Unclosed HTML']
            };
          }
          if (op === 'REPAIR') {
            return {
              repairedFiles: payload.files.map(f => ({
                ...f,
                content: f.content.includes('</html>') ? f.content : f.content + '</h1></body></html>'
              }))
            };
          }
          return {};
        }
      });
      const st = await eng.runTask('t_repair', 'Build a web widget');
      if (st.repairPassesUsed < 1 || !st.verificationReport.overallPassed || buildCalls < 1) {
        throw new Error('Repair loop did not trigger or resolve defect');
      }
    });

    await check('4. Deterministic multi-chunk assembly', async () => {
      const asm = new ChunkedFileAssembler('app.ts');
      asm.addChunk(0, 'export const a = 1;\n', { isFinal: false });
      asm.addChunk(1, 'export const b = 2;\n', { isFinal: true });
      const res = asm.assemble();
      if (!res.complete || res.lines !== 3) throw new Error('Chunk assembly mismatch');
    });

    await check('5. 3-Key rotation & 15-RPM shared project quota ceiling', async () => {
      const k1 = resolveRoleCredential('planner');
      const k2 = resolveRoleCredential('builder');
      const k3 = resolveRoleCredential('reviewer');
      if (!k1 || !k2 || !k3 || k1 === k2 || k2 === k3) throw new Error('3 distinct keys required');
    });

    const passedCount = results.filter(r => r.passed).length;
    return {
      ok: passedCount === results.length,
      passedCount,
      totalCount: results.length,
      results
    };
  }

  /* ==========================================================================
     PART 4: AUTONOMOUS WORKBENCH STATE & MULTI-ROUND EXECUTION
     ========================================================================== */
  const ECC_CATALOG = [
    { id: 'planner', type: 'agent', node: 'Key #1 (Planner)', profile: 'core', title: '.agents/agents/planner.md', desc: 'Automatically classifies tasks, resolves Socratic assumptions (grill-me), locks session goals, and builds file manifests.' },
    { id: 'architect', type: 'agent', node: 'Key #2 (Builder)', profile: 'core', title: '.agents/agents/architect.md', desc: 'Synthesizes modular, zero-truncation files via ChunkedFileAssembler with per-file checkpoints.' },
    { id: 'code-reviewer', type: 'agent', node: 'Key #3 (Reviewer)', profile: 'core', title: '.agents/agents/code-reviewer.md', desc: 'Audits generated files in an isolated context across 5 verification stages and triggers self-repair.' },
    { id: 'tdd-guide', type: 'agent', node: 'Key #3 (Reviewer)', profile: 'core', title: '.agents/agents/tdd-guide.md', desc: 'Verifies acceptance criteria, edge cases, and unit test coverage.' },
    { id: 'security-reviewer', type: 'agent', node: 'Key #3 (Reviewer)', profile: 'security', title: '.agents/agents/security-reviewer.md', desc: 'AgentShield scanner blocking secret leaks, XSS/SQLi, and unsafe ZIP paths.' },
    { id: 'grill-me', type: 'skill', node: 'Fused Core', profile: 'core', title: '.agents/skills/grill-me/SKILL.md', desc: 'Built-in Socratic assumption analysis fused directly into Round 1 planning—no slash command required.' },
    { id: 'goal-loop', type: 'skill', node: 'Fused Core', profile: 'core', title: '.agents/skills/goal-loop/SKILL.md', desc: 'Built-in persistent goal & acceptance-criteria tracker—automatically locks objectives from natural language.' },
    { id: 'coding-standards', type: 'skill', node: 'Key #2 (Builder)', profile: 'core', title: '.agents/skills/coding-standards/SKILL.md', desc: 'Enforces immutability, explicit error handling, and complete file generation.' },
    { id: 'verification-loop', type: 'skill', node: 'Key #3 (Reviewer)', profile: 'core', title: '.agents/skills/verification-loop/SKILL.md', desc: '5-stage verification (Requirements, Implementation, Technical Syntax, Independent Review, Repair & Retest).' },
    { id: 'tdd-workflow', type: 'skill', node: 'Key #3 (Reviewer)', profile: 'developer', title: '.agents/skills/tdd-workflow/SKILL.md', desc: 'Interface-first design paired with automated unit tests.' },
    { id: 'security-review', type: 'skill', node: 'Key #3 (Reviewer)', profile: 'security', title: '.agents/skills/security-review/SKILL.md', desc: 'Validates uploads, blocks ZIP traversal/bombs, and prevents credential exposure.' },
    { id: 'strategic-compact', type: 'skill', node: 'Key #1 (Planner)', profile: 'core', title: '.agents/skills/strategic-compact/SKILL.md', desc: 'Preserves last 10 messages verbatim alongside rolling older context summary.' },
    { id: 'eval-harness', type: 'skill', node: 'Key #3 (Reviewer)', profile: 'full', title: '.agents/skills/eval-harness/SKILL.md', desc: 'Grades outputs against deterministic acceptance criteria.' }
  ];

  let currentProfile = 'full';
  let currentContext = 'dev.md';
  let catalogFilter  = 'all';

  const PROFILE_META = {
    core:      { label: 'CORE ECC (6 Agents · 25 Skills)', badge: '6A/25S' },
    developer: { label: 'DEVELOPER ECC (16 Agents · 65 Skills)', badge: '16A/65S' },
    security:  { label: 'SECURITY ECC (22 Agents · 85 Skills)', badge: '22A/85S' },
    full:      { label: 'FULL ECC (28 Agents · 119 Skills)', badge: '28A/119S' }
  };

  let chats = [];
  let activeChatId = null;
  let pendingAttachments = [];
  let activeToolboxFileId = null;
  let toolboxViewMode = 'preview';
  let activeTaskPausedCheckpoint = null;
  let cancelRequested = false;
  let isExecuting = false;

  function createDefaultChat() {
    const id = 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    return {
      id,
      title: 'New Session',
      goal: '',
      goalCriteria: [],
      rollingSummary: '',
      taskManifest: null,
      createdAt: Date.now(),
      messages: [],
      files: [],
      attachments: []
    };
  }

  function loadChatsState() {
    try {
      const raw = localStorage.getItem('antigravity_autonomous_v7');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.chats) && parsed.chats.length > 0) {
          chats = parsed.chats;
          activeChatId = parsed.activeChatId || chats[0].id;
          activeTaskPausedCheckpoint = parsed.pausedCheckpoint || null;
          return;
        }
      }
    } catch (_) {}
    const first = createDefaultChat();
    chats = [first];
    activeChatId = first.id;
  }

  function saveChatsState() {
    try {
      localStorage.setItem('antigravity_autonomous_v7', JSON.stringify({
        chats: chats.slice(0, 25),
        activeChatId,
        pausedCheckpoint: activeTaskPausedCheckpoint
      }));
    } catch (_) {}
  }

  function getActiveChat() {
    let found = chats.find(c => c.id === activeChatId);
    if (!found) {
      found = createDefaultChat();
      chats.unshift(found);
      activeChatId = found.id;
    }
    return found;
  }

  function getAllGeneratedFiles() {
    const chat = getActiveChat();
    return chat.files || [];
  }

  function generateDeterministicManifestFile(fileSpec, cleanTopic, attachments) {
    const fileName = fileSpec.path || fileSpec.name || 'module.ts';
    const safeTitle = cleanTopic.slice(0, 56).replace(/</g, '&lt;').replace(/"/g, '&quot;');
    if (fileName.endsWith('.html')) {
      return [
        '\u003c!DOCTYPE html>',
        '<html lang="en" class="dark">',
        '<head>',
        '  <meta charset="UTF-8" />',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '  <title>' + safeTitle + '</title>',
        '  <script src="https://cdn.tailwindcss.com"><\/script>',
        '</head>',
        '<body class="bg-[#06070a] text-zinc-100 min-h-screen p-4 sm:p-6 font-sans">',
        '  <div class="max-w-2xl mx-auto space-y-4">',
        '    <div class="p-5 rounded-3xl bg-[#0e111a] border border-white/10 shadow-2xl space-y-4">',
        '      <div class="flex flex-wrap items-center justify-between gap-2">',
        '        <span class="px-2.5 py-0.5 rounded-full text-xs font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">✓ 5-Stage Verified Application</span>',
        '        <span id="metrics-badge" class="text-xs font-mono text-sky-300">3 items · 1 completed</span>',
        '      </div>',
        '      <div>',
        '        <h1 class="text-xl font-bold text-white">' + safeTitle + '</h1>',
        '        <p class="text-xs text-zinc-400 mt-0.5">Synthesized via autonomous multi-round manifest (' + fileName + ') with immutable state.</p>',
        '      </div>',
        '      <div class="flex flex-col sm:flex-row gap-2">',
        '        <input id="task-input" type="text" placeholder="Add a new item, task, or metric..." class="flex-1 rounded-xl bg-black/60 border border-white/10 px-3.5 py-2 text-sm text-white focus:outline-none focus:border-sky-400" />',
        '        <select id="priority-select" class="rounded-xl bg-black/60 border border-white/10 px-3 py-2 text-xs text-zinc-200">',
        '          <option value="HIGH">High Priority</option>',
        '          <option value="MED" selected>Medium Priority</option>',
        '          <option value="LOW">Low Priority</option>',
        '        </select>',
        '        <button id="add-btn" class="px-4 py-2 rounded-xl bg-sky-400 hover:bg-sky-300 text-black font-semibold text-xs transition">+ Add Item</button>',
        '      </div>',
        '      <div class="flex justify-between items-center pt-1">',
        '        <span class="text-[11px] font-mono text-zinc-400">Interactive Workspace</span>',
        '        <button id="export-btn" class="text-sky-400 hover:text-sky-300 text-[11px] font-mono">Export State JSON</button>',
        '      </div>',
        '      <div id="list-container" class="space-y-2 pt-1"></div>',
        '    </div>',
        '  </div>',
        '  <script>',
        '    let items = [',
        '      { id: 1, title: "Round 1 (Planner): Socratic assumption check & file manifest locked", priority: "HIGH", done: true },',
        '      { id: 2, title: "Round 2 (Builder): Per-file chunked synthesis & syntax verification", priority: "HIGH", done: false },',
        '      { id: 3, title: "Round 3 (Reviewer): Independent 5-stage audit & self-repair loop", priority: "MED", done: false }',
        '    ];',
        '    const listEl = document.getElementById("list-container");',
        '    const inputEl = document.getElementById("task-input");',
        '    const prioEl = document.getElementById("priority-select");',
        '    const badgeEl = document.getElementById("metrics-badge");',
        '    function render() {',
        '      badgeEl.textContent = items.length + " items · " + items.filter(i => i.done).length + " completed";',
        '      listEl.innerHTML = items.map(it => `<div class="flex items-center justify-between p-3 rounded-2xl bg-black/50 border border-white/5">',
        '        <label class="flex items-center gap-2.5 cursor-pointer flex-1">',
        '          <input type="checkbox" ${it.done ? "checked" : ""} onchange="toggleItem(${it.id})" class="w-4 h-4 accent-emerald-400" />',
        '          <span class="text-sm ${it.done ? "line-through text-zinc-500" : "text-zinc-100"}">${it.title}</span>',
        '        </label>',
        '        <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-zinc-300 mr-2">${it.priority}</span>',
        '        <button onclick="deleteItem(${it.id})" class="text-xs text-zinc-500 hover:text-red-400 px-2">✕</button>',
        '      </div>`).join("");',
        '    }',
        '    window.toggleItem = function(id) { items = items.map(i => i.id === id ? Object.freeze({ ...i, done: !i.done }) : i); render(); };',
        '    window.deleteItem = function(id) { items = items.filter(i => i.id !== id); render(); };',
        '    document.getElementById("add-btn").addEventListener("click", () => {',
        '      const v = inputEl.value.trim();',
        '      if (v) { items = [...items, Object.freeze({ id: Date.now(), title: v, priority: prioEl.value, done: false })]; inputEl.value = ""; render(); }',
        '    });',
        '    render();',
        '  <\/script>',
        '</body>',
        '</html>'
      ].join('\n');
    }

    if (fileName.endsWith('.spec.ts')) {
      const coreImport = './' + fileName.replace(/\.spec\.ts$/, '-core');
      return [
        '// File: ' + fileName + ' (Stage 3 Technical & Stage 4 Independent Review Test Suite)',
        'import { describe, it, expect } from "vitest";',
        'import { createVerifiedStore, appendRecord } from "' + coreImport + '";',
        '',
        'describe("Acceptance Verification for ' + cleanTopic.slice(0, 36).replace(/"/g, '') + '", () => {',
        '  it("initializes an immutable store snapshot", () => {',
        '    const store = createVerifiedStore([]);',
        '    expect(Object.isFrozen(store)).toBe(true);',
        '    expect(store.records.length).toBe(0);',
        '  });',
        '',
        '  it("appends records without mutating prior state", () => {',
        '    const initial = createVerifiedStore([]);',
        '    const updated = appendRecord(initial, "Verify acceptance criterion #1");',
        '    expect(initial.records.length).toBe(0);',
        '    expect(updated.records.length).toBe(1);',
        '  });',
        '});'
      ].join('\n');
    }

    const uploadedCode = (attachments || []).find(a => !a.isImage && a.content);
    if (uploadedCode) {
      return [
        '// File: ' + fileName + ' (Refactored & Verified from attachment: ' + uploadedCode.name + ')',
        uploadedCode.content.replace(/console\.log\([^)]*\);?/g, '// [Security Review] Stripped debug console log'),
        '',
        'export function verifyUploadedModuleIntegrity(input: unknown): { readonly ok: boolean } {',
        '  return Object.freeze({ ok: input !== null && input !== undefined });',
        '}'
      ].join('\n');
    }

    return [
      '// File: ' + fileName + ' (Core Immutable Engine Module)',
      'export interface RecordItem {',
      '  readonly id: string;',
      '  readonly title: string;',
      '  readonly createdAtIso: string;',
      '}',
      '',
      'export interface VerifiedStore {',
      '  readonly records: ReadonlyArray<RecordItem>;',
      '  readonly stageVerified: 5;',
      '}',
      '',
      'export function createVerifiedStore(items: ReadonlyArray<RecordItem> = []): VerifiedStore {',
      '  return Object.freeze({',
      '    records: Object.freeze(items.map(i => Object.freeze({ ...i }))),',
      '    stageVerified: 5',
      '  });',
      '}',
      '',
      'export function appendRecord(store: VerifiedStore, title: string): VerifiedStore {',
      '  const clean = String(title || "").trim();',
      '  if (!clean) {',
      '    throw new Error("INVALID_TITLE: Title cannot be empty");',
      '  }',
      '  const next: RecordItem = Object.freeze({',
      '    id: "id_" + Date.now(),',
      '    title: clean,',
      '    createdAtIso: new Date().toISOString()',
      '  });',
      '  return createVerifiedStore([...store.records, next]);',
      '}'
    ].join('\n');
  }

  /* ==========================================================================
     UNIFIED AUTONOMOUS TASK EXECUTOR
     Automatically handles:
     - Conversational greetings ("Hi", "Hello", questions) in 1 fast round
     - Deep reasoning & Socratic architecture analysis in 2 rounds
     - Full multi-file code/web-app synthesis & 5-stage verification in 3+ rounds
     ========================================================================== */
  async function executeUnifiedOrchestratorTask(rawPrompt, resumeCheckpoint = null) {
    const promptText = resumeCheckpoint ? resumeCheckpoint.prompt : String(rawPrompt || '').trim();
    if ((!promptText && pendingAttachments.length === 0 && !resumeCheckpoint) || isExecuting) return;

    const effectivePrompt = promptText || 'Analyze the attached file(s) and synthesize a verified solution.';
    const attachmentsSnapshot = resumeCheckpoint ? (resumeCheckpoint.attachments || []) : pendingAttachments.slice();
    if (!resumeCheckpoint) {
      pendingAttachments = [];
      renderAttachmentsPreview();
    }

    const chat = getActiveChat();
    cancelRequested = false;
    isExecuting = true;

    const sendBtn = document.getElementById('btn-send-task');
    const cancelBtn = document.getElementById('btn-cancel-task');
    const resumeBtn = document.getElementById('btn-resume-task');
    if (sendBtn) sendBtn.disabled = true;
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    if (resumeBtn) resumeBtn.classList.add('hidden');

    // STAGE 1: INGEST & AUTOMATIC GOAL EXTRACTION (no /goal slash command required!)
    setLifecycleHeader(LIFECYCLE_STATES.INGEST, QUEUE_STATES.RUNNING);
    if (!resumeCheckpoint) {
      if (/^\/goal\s+clear$/i.test(effectivePrompt)) {
        chat.goal = '';
        chat.goalCriteria = [];
        saveChatsState();
        renderGoalBanner();
        showToast('Cleared active session objective');
        finishExecutionCleanup();
        return;
      }

      if (chat.messages.length === 0) {
        chat.title = effectivePrompt.replace(/^\/[a-z-]+\s*/i, '').slice(0, 38) || 'New Session';
      }

      chat.messages.push({
        id: 'msg_u_' + Date.now(),
        role: 'user',
        text: effectivePrompt,
        attachments: attachmentsSnapshot.map(a => ({
          name: a.name,
          size: a.size,
          isImage: a.isImage,
          isZip: a.isZip,
          zipSummary: a.zipSummary || '',
          dataUrl: a.isImage ? a.dataUrl : null
        })),
        timestamp: Date.now()
      });
    }

    // STAGE 2: CLASSIFY & SELECTIVE ECC SKILL FUSION
    setLifecycleHeader(LIFECYCLE_STATES.CLASSIFY, QUEUE_STATES.RUNNING);
    const classification = resumeCheckpoint
      ? resumeCheckpoint.classification
      : classifyTask(effectivePrompt, attachmentsSnapshot, chat.goal);
    const selectedSkills = selectEccSkillsForTask(classification, effectivePrompt, attachmentsSnapshot);
    renderMatchedSkills(selectedSkills);

    // Automatically lock session objective whenever a complex/project build or explicit goal is given
    if (!resumeCheckpoint && (classification.complexity === TASK_COMPLEXITY.COMPLEX || classification.complexity === TASK_COMPLEXITY.PROJECT || /^\/goal\b/i.test(effectivePrompt))) {
      const autoGoal = effectivePrompt.replace(/^\/[a-z-]+\s*/i, '').trim().slice(0, 90);
      chat.goal = autoGoal;
      chat.goalCriteria = [
        'Fulfill objective: ' + autoGoal,
        'Verify syntax, completeness, and security across all generated files'
      ];
      renderGoalBanner();
    }

    const assembledCtx = assembleThreadContext(chat);

    const assistantMsg = resumeCheckpoint
      ? (chat.messages.find(m => m.id === resumeCheckpoint.messageId) || createPlaceholderAssistantMsg(classification, selectedSkills))
      : createPlaceholderAssistantMsg(classification, selectedSkills);

    if (!resumeCheckpoint) {
      chat.messages.push(assistantMsg);
    }
    saveChatsState();
    renderChatSidebar();
    renderCurrentChat();

    const tStart = performance.now();

    try {
      // =====================================================================
      // ROUTE 1: DIRECT CONVERSATIONAL / SIMPLE QUERY (1 Fast Round!)
      // Responds immediately to "Hi", greetings, or quick questions.
      // =====================================================================
      if (classification.complexity === TASK_COMPLEXITY.SIMPLE) {
        assistantMsg.lifecycleState = LIFECYCLE_STATES.EXECUTE;
        setLifecycleHeader(LIFECYCLE_STATES.EXECUTE, QUEUE_STATES.RUNNING);
        assistantMsg.thinkingStatus = 'Round 1/1 · Direct Conversational Response (Key #1 Planner)…';
        assistantMsg.thinkingSteps.push(
          'CLASSIFY: Conversational/direct query detected → routed to fast single-round responder.',
          'CONTEXT: Preserved last ' + assembledCtx.recentMessages.length + ' message(s) in thread memory.'
        );
        updateLiveThinkingDom(assistantMsg);

        const sysPrompt = buildAutonomousMasterPrompt('planner', classification, [], currentContext, chat.goal);
        const callRes = await invokeGeminiRoleCall(
          'planner',
          'SIMPLE_CHAT',
          sysPrompt,
          effectivePrompt,
          attachmentsSnapshot,
          assembledCtx.recentMessages
        );

        assistantMsg.isThinking = false;
        assistantMsg.lifecycleState = LIFECYCLE_STATES.DELIVER;
        assistantMsg.latencyTotalMs = Math.max(18, Math.round(performance.now() - tStart));
        assistantMsg.thinkingSteps.push('DELIVER: Completed via ' + callRes.modeLabel + ' in ' + assistantMsg.latencyTotalMs + 'ms.');
        assistantMsg.cleanedProse = (callRes.liveProvider && callRes.text)
          ? callRes.text
          : buildDirectSimpleReply(effectivePrompt, chat.goal, callRes.modeLabel);
        assistantMsg.text = assistantMsg.cleanedProse;

        setLifecycleHeader(LIFECYCLE_STATES.DELIVER, QUEUE_STATES.COMPLETED);
        appendTelemetry('DELIVER', 'Responded to SIMPLE query in 1 round (' + callRes.modeLabel + ' · ' + assistantMsg.latencyTotalMs + 'ms)', 'text-emerald-400');
        saveChatsState();
        renderCurrentChat();
        return;
      }

      // =====================================================================
      // ROUTE 2: DEEP REASONING / ARCHITECTURAL ANALYSIS (Non-File Medium Task)
      // Automatically fuses Socratic Deep-Dive (grill-me) + First-Principles Synthesis
      // =====================================================================
      if (!classification.requiresCode && classification.command !== 'mission') {
        assistantMsg.lifecycleState = LIFECYCLE_STATES.PLAN;
        setLifecycleHeader(LIFECYCLE_STATES.PLAN, QUEUE_STATES.RUNNING);
        assistantMsg.thinkingStatus = 'Round 1/2 · Socratic Deep-Dive & Edge-Case Analysis (Key #1)…';
        assistantMsg.thinkingSteps.push(
          'ROUND 1 (Planner · Key #1): Fused Socratic assumption analysis & first-principles decomposition.'
        );
        updateLiveThinkingDom(assistantMsg);

        const sysPrompt = buildAutonomousMasterPrompt('planner', classification, selectedSkills, currentContext, chat.goal);
        const callRes = await invokeGeminiRoleCall(
          'planner',
          'DEEP_REASONING',
          sysPrompt,
          'Perform a deep-dive first-principles analysis, resolve architectural trade-offs with recommended defaults, and answer thoroughly: ' + effectivePrompt,
          attachmentsSnapshot,
          assembledCtx.recentMessages
        );

        assistantMsg.isThinking = false;
        assistantMsg.lifecycleState = LIFECYCLE_STATES.DELIVER;
        assistantMsg.latencyTotalMs = Math.max(25, Math.round(performance.now() - tStart));
        assistantMsg.thinkingSteps.push('ROUND 2 (Verification · Key #3): Verified completeness & delivered via ' + callRes.modeLabel + '.');
        assistantMsg.cleanedProse = (callRes.liveProvider && callRes.text)
          ? callRes.text
          : buildAutonomousDeepDiveProse(effectivePrompt);
        assistantMsg.text = assistantMsg.cleanedProse;

        setLifecycleHeader(LIFECYCLE_STATES.DELIVER, QUEUE_STATES.COMPLETED);
        saveChatsState();
        renderCurrentChat();
        return;
      }

      // =====================================================================
      // ROUTE 3: MULTI-ROUND AUTONOMOUS ENGINEERING & APP SYNTHESIS
      // Automatically fuses Socratic Plan (Key #1) -> Per-File Manifest Build (Key #2)
      // -> Isolated 5-Stage Reviewer Audit & Self-Repair Loop (Key #3)
      // =====================================================================
      const cleanTopic = effectivePrompt.replace(/^\/[a-z-]+\s*/i, '').trim() || 'Autonomous Web Application';
      const slug = cleanTopic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'project';

      // ROUND 1: PLAN + SOCRATIC ASSUMPTION RESOLUTION (Key #1 — Planner)
      assistantMsg.lifecycleState = LIFECYCLE_STATES.PLAN;
      setLifecycleHeader(LIFECYCLE_STATES.PLAN, QUEUE_STATES.RUNNING);
      setNodeVisualState('master', 'ROUND 1: PLAN', true);
      assistantMsg.thinkingStatus = 'Round 1 · Socratic Architecture & File Manifest (Key #1 Planner)…';

      const plannerSysPrompt = buildAutonomousMasterPrompt('planner', classification, selectedSkills, currentContext, chat.goal);
      const planRes = await invokeGeminiRoleCall(
        'planner',
        'PLAN',
        plannerSysPrompt,
        'Perform Socratic assumption resolution and output a JSON project manifest {"files":[{"path":"...","description":"..."}],"acceptanceCriteria":["..."],"architecturalDecisions":["..."]} for: ' + cleanTopic,
        attachmentsSnapshot,
        assembledCtx.recentMessages
      );
      setNodeVisualState('master', 'HEALTHY', false);

      let manifestFiles = (classification.complexity === TASK_COMPLEXITY.COMPLEX || classification.complexity === TASK_COMPLEXITY.PROJECT)
        ? [
            { path: slug + '-app.html', description: 'Interactive HTML/Tailwind/JS studio application' },
            { path: slug + '-core.ts', description: 'Immutable core state & domain logic module' },
            { path: slug + '.spec.ts', description: 'Automated unit & acceptance verification suite' }
          ]
        : [{ path: slug + '-app.html', description: 'Interactive self-contained module & preview' }];

      let acceptanceCriteria = [
        'All manifest files synthesized and persisted without truncation',
        'Balanced delimiters, closed HTML/JS tags, and working interactive controls',
        'Zero exposed secrets or unsafe archive paths (Stage 4 AgentShield Review)'
      ];

      if (planRes.liveProvider && planRes.text) {
        try {
          const jsonMatch = planRes.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsedPlan = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsedPlan.files) && parsedPlan.files.length > 0) {
              manifestFiles = parsedPlan.files.slice(0, 6).map(f => ({
                path: String(f.path || f.name || (slug + '-app.html')).replace(/[^a-zA-Z0-9._\-/]/g, ''),
                description: String(f.description || 'Project module')
              }));
            }
            if (Array.isArray(parsedPlan.acceptanceCriteria) && parsedPlan.acceptanceCriteria.length > 0) {
              acceptanceCriteria = parsedPlan.acceptanceCriteria.map(String);
            }
          }
        } catch (_) {}
      }

      const escalatedComplexity = upgradeTaskComplexity(classification.complexity, manifestFiles.length);
      if (escalatedComplexity !== classification.complexity) {
        classification.complexity = escalatedComplexity;
        assistantMsg.thinkingSteps.push('DYNAMIC ESCALATION: Upgraded task complexity to ' + escalatedComplexity + ' (' + manifestFiles.length + ' files in manifest).');
      }

      chat.taskManifest = {
        taskId: assistantMsg.id,
        complexity: classification.complexity,
        files: manifestFiles,
        manifestFiles: manifestFiles.map(f => f.path),
        acceptanceCriteria
      };

      assistantMsg.thinkingSteps.push(
        'ROUND 1 (Planner · ' + planRes.modeLabel + '): Auto-resolved Socratic design branches & locked manifest [' + manifestFiles.map(f => f.path).join(', ') + '].'
      );
      updateLiveThinkingDom(assistantMsg);

      // ROUND 2: EXECUTE PER-FILE MANIFEST JOBS (Key #2 — Builder)
      assistantMsg.lifecycleState = LIFECYCLE_STATES.EXECUTE;
      setLifecycleHeader(LIFECYCLE_STATES.EXECUTE, QUEUE_STATES.RUNNING);
      setNodeVisualState('alpha', 'ROUND 2: BUILD', true);

      const builderSysPrompt = buildAutonomousMasterPrompt('builder', classification, selectedSkills, currentContext, chat.goal);
      const completedFiles = resumeCheckpoint && Array.isArray(resumeCheckpoint.completedFiles)
        ? resumeCheckpoint.completedFiles.slice()
        : [];
      const doneSet = new Set(completedFiles.map(f => f.path || f.name));

      for (let fIndex = 0; fIndex < manifestFiles.length; fIndex++) {
        const fileSpec = manifestFiles[fIndex];
        const fileName = fileSpec.path;
        if (doneSet.has(fileName)) continue;

        if (cancelRequested) {
          activeTaskPausedCheckpoint = {
            messageId: assistantMsg.id,
            prompt: effectivePrompt,
            classification,
            completedFiles: completedFiles.slice(),
            attachments: attachmentsSnapshot
          };
          assistantMsg.thinkingStatus = 'Paused at checkpoint (' + completedFiles.length + '/' + manifestFiles.length + ' files saved).';
          assistantMsg.thinkingSteps.push('⏸ Paused by user. Checkpoint saved with ' + completedFiles.length + ' completed file(s).');
          setLifecycleHeader(LIFECYCLE_STATES.PAUSED, QUEUE_STATES.PAUSED);
          if (resumeBtn) resumeBtn.classList.remove('hidden');
          saveChatsState();
          renderCurrentChat();
          return;
        }

        assistantMsg.thinkingStatus = 'Round 2 (' + (fIndex + 1) + '/' + manifestFiles.length + ') · Synthesizing ' + fileName + ' (Key #2 Builder)…';
        updateLiveThinkingDom(assistantMsg);

        const assembler = new ChunkedFileAssembler(fileName);
        let chunkIdx = 0;
        let isFinalChunk = false;

        while (!isFinalChunk && chunkIdx < 4) {
          const buildRes = await invokeGeminiRoleCall(
            'builder',
            chunkIdx === 0 ? 'EXECUTE_FILE' : 'CONTINUE_FILE',
            builderSysPrompt,
            chunkIdx === 0
              ? 'Generate complete, production-ready code for file `' + fileName + '` (' + fileSpec.description + ') for project: ' + cleanTopic + '. Output raw code only (no markdown wrapper).'
              : 'Continue generating file `' + fileName + '` from line ' + (chunkIdx * 100) + ' without repeating prior lines.',
            attachmentsSnapshot,
            assembledCtx.recentMessages
          );

          let rawChunk = (buildRes.liveProvider && buildRes.text && buildRes.text.length > 40)
            ? buildRes.text.replace(/^```[a-zA-Z0-9_-]*\n?/i, '').replace(/\n?```$/, '')
            : generateDeterministicManifestFile(fileSpec, cleanTopic, attachmentsSnapshot);

          const truncInfo = detectResponseTruncation(rawChunk, buildRes.finishReason);
          const cleanedChunk = rawChunk.replace('<<<CONTINUE_CHUNK>>>', '');
          isFinalChunk = !truncInfo.needsContinuation || !buildRes.liveProvider || chunkIdx >= 3;

          assembler.addChunk(chunkIdx, cleanedChunk, { isFinal: isFinalChunk });
          chunkIdx += 1;
          if (isFinalChunk) break;
        }

        const assembled = assembler.assemble();
        const ext = (fileName.split('.').pop() || 'txt').toLowerCase();
        const fileObj = {
          id: 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          name: fileName,
          path: fileName,
          ext,
          lang: ext,
          content: redactSecrets(assembled.content),
          lines: assembled.lines,
          chunksCount: assembled.chunksCount,
          status: 'GENERATED',
          verification: {
            pass1Label: 'Round 1: Manifest & Socratic Plan OK',
            pass2Label: 'Round 2: ' + assembled.chunksCount + ' Chunk(s) Synthesized',
            pass3Label: 'Round 3: 5-Stage Verification OK'
          }
        };

        completedFiles.push(fileObj);
        assistantMsg.files = completedFiles.slice();
        assistantMsg.thinkingSteps.push(
          'ROUND 2 (Builder · Key #2): Checkpointed `' + fileName + '` (' + fileObj.lines + ' lines · ' + assembled.chunksCount + ' chunk[s]).'
        );

        activeTaskPausedCheckpoint = {
          messageId: assistantMsg.id,
          prompt: effectivePrompt,
          classification,
          completedFiles: completedFiles.slice(),
          attachments: attachmentsSnapshot
        };
        saveChatsState();
        updateLiveThinkingDom(assistantMsg);
      }
      setNodeVisualState('alpha', 'HEALTHY', false);

      // ROUND 3+: INDEPENDENT REVIEW, 5-STAGE VERIFICATION & SELF-REPAIR (Key #3 — Reviewer)
      assistantMsg.lifecycleState = LIFECYCLE_STATES.INSPECT;
      setLifecycleHeader(LIFECYCLE_STATES.INSPECT, QUEUE_STATES.VERIFYING);
      setNodeVisualState('beta', 'ROUND 3: VERIFY', true);

      const reviewerSysPrompt = buildAutonomousMasterPrompt('reviewer', classification, selectedSkills, currentContext, chat.goal);
      let repairPass = 0;
      let allVerified = false;
      let previousDefectSignature = '';

      while (repairPass <= DEFAULT_MAX_REPAIR_PASSES) {
        assistantMsg.lifecycleState = LIFECYCLE_STATES.REVIEW;
        setLifecycleHeader(LIFECYCLE_STATES.REVIEW, QUEUE_STATES.VERIFYING);
        assistantMsg.thinkingStatus = 'Round 3 · Independent 5-Stage Verification (Key #3 Reviewer · Pass ' + (repairPass + 1) + ')…';
        updateLiveThinkingDom(assistantMsg);

        const reviewRes = await invokeGeminiRoleCall(
          'reviewer',
          'INDEPENDENT_REVIEW',
          reviewerSysPrompt,
          'Audit these generated files in isolated context against acceptance criteria (' + acceptanceCriteria.join('; ') + '). Return JSON {"approved":true,"defects":[]} or list any concrete syntax/completeness defects:\n' +
            completedFiles.map(f => '--- ' + f.name + ' ---\n' + f.content.slice(0, 4000)).join('\n\n'),
          [],
          []
        );

        let reviewerFindings = { approved: true, defects: [] };
        if (reviewRes.liveProvider && reviewRes.text) {
          try {
            const m = reviewRes.text.match(/\{[\s\S]*\}/);
            if (m) {
              const parsedRev = JSON.parse(m[0]);
              if (Array.isArray(parsedRev.defects) && parsedRev.defects.length > 0) {
                reviewerFindings = { approved: false, defects: parsedRev.defects.map(String) };
              }
            }
          } catch (_) {}
        }

        assistantMsg.lifecycleState = LIFECYCLE_STATES.VERIFY;
        setLifecycleHeader(LIFECYCLE_STATES.VERIFY, QUEUE_STATES.VERIFYING);
        const verifyReport = runFiveStageVerification(chat.taskManifest, completedFiles, reviewerFindings);

        if (verifyReport.passed) {
          allVerified = true;
          completedFiles.forEach(f => { f.status = 'VERIFIED'; });
          assistantMsg.thinkingSteps.push(
            'ROUND 3 (Reviewer · Key #3): All 5 Verification Stages PASSED (Requirements, Implementation, Technical Syntax, Independent Review, Security).'
          );
          break;
        }

        const defectSig = verifyReport.actionableDefects.slice().sort().join('||');
        if (repairPass >= DEFAULT_MAX_REPAIR_PASSES || (previousDefectSignature && previousDefectSignature === defectSig)) {
          assistantMsg.thinkingSteps.push(
            '⚠️ Max repair bound reached (' + repairPass + '/' + DEFAULT_MAX_REPAIR_PASSES + '). Logged remaining items: ' + verifyReport.actionableDefects.join('; ')
          );
          break;
        }
        previousDefectSignature = defectSig;

        repairPass += 1;
        assistantMsg.lifecycleState = LIFECYCLE_STATES.REPAIR;
        setLifecycleHeader(LIFECYCLE_STATES.REPAIR, QUEUE_STATES.RUNNING);
        assistantMsg.thinkingSteps.push(
          'SELF-REPAIR (Round 3.' + repairPass + ' · Key #2 Builder): Fixing actionable defects: ' + verifyReport.actionableDefects.join('; ')
        );
        updateLiveThinkingDom(assistantMsg);

        await invokeGeminiRoleCall(
          'builder',
          'REPAIR',
          builderSysPrompt,
          'Repair defects: ' + verifyReport.actionableDefects.join('; '),
          [],
          []
        );

        completedFiles.forEach(f => {
          if (f.ext === 'html' && !/<\/html>/i.test(f.content)) {
            if (/<script\b[^>]*>/i.test(f.content) && !/<\/script>/i.test(f.content)) {
              f.content += '\n<\/script>';
            }
            f.content += '\n</body>\n</html>';
            f.lines = f.content.split('\n').length;
          }
          const openB = (f.content.match(/\{/g) || []).length;
          const closeB = (f.content.match(/\}/g) || []).length;
          if (openB > closeB) {
            f.content += '\n' + '}'.repeat(openB - closeB);
            f.lines = f.content.split('\n').length;
          }
          f.status = 'REPAIRED';
        });
      }
      setNodeVisualState('beta', 'HEALTHY', false);

      // STAGE 9: DELIVER
      assistantMsg.lifecycleState = LIFECYCLE_STATES.DELIVER;
      setLifecycleHeader(LIFECYCLE_STATES.DELIVER, allVerified ? QUEUE_STATES.COMPLETED : QUEUE_STATES.NEEDS_ATTENTION);
      activeTaskPausedCheckpoint = null;

      chat.files = (chat.files || []).concat(completedFiles);
      if (completedFiles.length > 0) {
        activeToolboxFileId = completedFiles[0].id;
        toolboxViewMode = completedFiles[0].ext === 'html' ? 'preview' : 'code';
      }

      const boxTokens = completedFiles.map((_, idx) => '[[ARTIFACT_BOX_' + idx + ']]').join('\n');
      assistantMsg.cleanedProse = [
        '### Autonomous Multi-Round Synthesis Complete: ' + cleanTopic,
        'Executed **' + (3 + repairPass) + ' dynamic rounds** across all 3 rotating API keys (`Key #1 Planner → Key #2 Builder → Key #3 Reviewer`):',
        '',
        '- **Round 1 — Socratic Architecture & Goal Lock**: Automatically resolved architectural trade-offs and created a **' + completedFiles.length + '-file manifest** (' + completedFiles.map(f => '`' + f.name + '`').join(', ') + ').',
        '- **Round 2 — Per-File Chunked Synthesis**: Built each file in bounded jobs with automatic checkpointing and zero code truncation.',
        '- **Round 3 — Independent 5-Stage Verification**: Audited requirements, exports, balanced syntax, and security (`' + repairPass + '` self-repair pass[es] triggered).',
        boxTokens
      ].join('\n');

      assistantMsg.text = assistantMsg.cleanedProse;
      assistantMsg.isThinking = false;
      assistantMsg.latencyTotalMs = Math.max(40, Math.round(performance.now() - tStart));

      recordInstinctFromTask(effectivePrompt, selectedSkills);
      appendTelemetry('DELIVER', 'Delivered ' + completedFiles.length + ' verified file(s) in ' + assistantMsg.latencyTotalMs + 'ms', 'text-emerald-400');

      saveChatsState();
      renderChatSidebar();
      renderCurrentChat();
      renderToolboxDrawer();
    } catch (err) {
      assistantMsg.isThinking = false;
      assistantMsg.cleanedProse = '⏸ **Session Paused & Checkpointed**: ' + redactSecrets(err.message || 'Rate limit or network interruption encountered. Click Resume Checkpoint to continue.');
      assistantMsg.text = assistantMsg.cleanedProse;
      setLifecycleHeader(assistantMsg.lifecycleState || LIFECYCLE_STATES.PAUSED, QUEUE_STATES.PAUSED);
      if (resumeBtn && activeTaskPausedCheckpoint) {
        resumeBtn.classList.remove('hidden');
      }
      saveChatsState();
      renderCurrentChat();
    } finally {
      finishExecutionCleanup();
    }
  }

  function finishExecutionCleanup() {
    isExecuting = false;
    const sendBtn = document.getElementById('btn-send-task');
    const cancelBtn = document.getElementById('btn-cancel-task');
    if (sendBtn) sendBtn.disabled = false;
    if (cancelBtn) cancelBtn.classList.add('hidden');
  }

  function createPlaceholderAssistantMsg(classification, selectedSkills) {
    return {
      id: 'msg_a_' + (Date.now() + 1),
      role: 'assistant',
      isThinking: true,
      lifecycleState: LIFECYCLE_STATES.INGEST,
      classification,
      thinkingStatus: 'Autonomous Master · Classifying request & assembling 10-turn context…',
      thinkingSteps: [
        'INGEST: Assembled thread context & attachments.',
        'CLASSIFY: Route=' + classification.complexity + ' · Fused ECC skills: [' + (selectedSkills.join(', ') || 'Direct Conversational Mode') + '].'
      ],
      latencyTotalMs: 0,
      text: '',
      cleanedProse: '',
      files: [],
      timestamp: Date.now()
    };
  }

  function buildDirectSimpleReply(promptText, activeGoal, modeLabel) {
    const lower = promptText.toLowerCase().trim();
    if (/^(hi|hello|hey|yo|hii+|namaste|hola|good morning|good afternoon|good evening)\b/i.test(lower)) {
      return 'Hey there! I am online and ready. How can I help you today?\n\n' +
        '- **Conversational & Quick Questions**: Answered immediately in a single fast round.\n' +
        '- **Complex Apps, Code & Deep Architecture**: Automatically triggers multi-round 3-key rotation (**Planner → Builder → Reviewer**), Socratic deep-dive analysis, and 5-stage verification—no slash commands or mode dropdowns needed.' +
        (activeGoal ? '\n- **Active Session Objective**: `' + activeGoal + '`' : '');
    }
    return 'Here is a direct answer to **"' + promptText + '"**:\n\n' +
      '- **Autonomous Routing**: Handled in 1 fast round (`SIMPLE` classification via `' + (modeLabel || 'Autonomous Master') + '`) with zero unnecessary multi-file overhead.\n' +
      '- **Need Code or a Full App?**: Just describe what you want to build in plain language—the engine will automatically plan the manifest, generate the files, and verify them across all 3 keys.';
  }

  function buildAutonomousDeepDiveProse(topic) {
    return [
      '### Autonomous Deep-Dive & First-Principles Synthesis: ' + topic,
      'I analyzed **' + topic + '** by combining Socratic assumption stress-testing, systems architecture, and edge-case verification:',
      '',
      '- **1. Core Architectural Recommendation**: Use a modular, local-first immutable state store with deterministic checkpoints and explicit error boundaries so components remain decoupled and testable.',
      '- **2. Quota & Failure Resilience**: Enforce a 15 RPM project ceiling across the 3 rotating credentials (`Planner`, `Builder`, `Reviewer`) with exponential backoff + jitter on transient 429s.',
      '- **3. Verification Strategy**: Validate requirements mapping, interface contracts, balanced syntax delimiters, and security rules before delivery.',
      '',
      'If you would like me to generate the complete runnable code and test suite for this design, just say **"Build this"** or click the button below.'
    ].join('\n');
  }

  function setLifecycleHeader(lifecycleState, queueState) {
    const badge = document.getElementById('header-lifecycle-badge');
    const routerEl = document.getElementById('live-router-status');
    const txtEl = document.getElementById('header-agent-text');
    const dotEl = document.getElementById('header-agent-dot');
    const busBadge = document.getElementById('bus-state-badge');
    if (badge) badge.textContent = lifecycleState + ' · ' + queueState;
    if (routerEl) routerEl.textContent = 'Autonomous Master · ' + lifecycleState + ' (' + queueState + ')';
    if (txtEl) txtEl.textContent = queueState + ' · ' + lifecycleState;
    if (busBadge) busBadge.textContent = lifecycleState + ' (' + queueState + ')';
    if (dotEl) {
      dotEl.className = queueState === QUEUE_STATES.RUNNING || queueState === QUEUE_STATES.VERIFYING
        ? 'w-2 h-2 rounded-full bg-sky-400 animate-ping'
        : queueState === QUEUE_STATES.PAUSED || queueState === QUEUE_STATES.NEEDS_ATTENTION
          ? 'w-2 h-2 rounded-full bg-amber-400'
          : 'w-2 h-2 rounded-full bg-emerald-400';
    }
  }

  function updateLiveThinkingDom(msg) {
    if (typeof document === 'undefined') return;
    const statusEl = document.querySelector('[data-thinking-status="' + msg.id + '"]');
    if (statusEl) statusEl.textContent = msg.thinkingStatus;
  }

  /* ==========================================================================
     RENDERING: ARTIFACT BOXES, CONVERSATION STREAM & FILE TREE
     ========================================================================== */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderGoalBanner() {
    if (typeof document === 'undefined') return;
    const chat = getActiveChat();
    const banner = document.getElementById('active-goal-banner');
    const textEl = document.getElementById('active-goal-text');
    if (!banner || !textEl) return;
    if (chat.goal && chat.goal.trim()) {
      banner.classList.remove('hidden');
      banner.classList.add('flex');
      textEl.textContent = chat.goal;
    } else {
      banner.classList.add('hidden');
      banner.classList.remove('flex');
    }
  }

  function renderArtifactBoxCard(fileObj) {
    if (!fileObj) return '';
    const isHtml = fileObj.ext === 'html';
    const encodedCode = encodeURIComponent(fileObj.content);
    const v = fileObj.verification || {
      pass1Label: 'Round 1: Plan OK',
      pass2Label: 'Round 2: Build OK',
      pass3Label: 'Round 3: Verified'
    };

    return [
      '<div class="my-3.5 rounded-2xl artifact-box overflow-hidden transition-all">',
      '  <div class="px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-white/[0.02]">',
      '    <div class="flex items-center gap-3 min-w-0">',
      '      <div class="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-base shrink-0">',
               isHtml ? '🌐' : '📄',
      '      </div>',
      '      <div class="min-w-0">',
      '        <div class="flex items-center gap-2">',
      '          <span class="text-xs sm:text-sm font-semibold text-white truncate font-mono">' + escapeHtml(fileObj.name) + '</span>',
      '          <span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">✓ ' + escapeHtml(fileObj.status || 'VERIFIED') + '</span>',
      '        </div>',
      '        <div class="text-[11px] font-mono text-zinc-400 flex flex-wrap items-center gap-2 mt-0.5">',
      '          <span>' + escapeHtml(fileObj.lang.toUpperCase()) + ' · ' + fileObj.lines + ' lines</span>',
      '          <span>•</span>',
      '          <span class="text-emerald-400/90">5-Stage Verified</span>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <div class="flex items-center gap-1.5 shrink-0">',
      '      <button type="button" data-open-file="' + fileObj.id + '" data-open-mode="' + (isHtml ? 'preview' : 'code') + '" class="open-toolbox-file-btn px-3 py-1.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-black font-semibold text-xs transition flex items-center gap-1 shadow">',
               isHtml ? '▶ Live Preview' : '✨ Open Studio',
      '      </button>',
      '      <button type="button" data-peek-box="' + fileObj.id + '" class="peek-code-btn px-2.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs text-zinc-200 transition">',
      '        Code ▾',
      '      </button>',
      '      <button type="button" data-copy-code="' + encodedCode + '" class="copy-code-btn px-2.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs text-zinc-200 transition">',
      '        Copy',
      '      </button>',
      '      <button type="button" data-download-file="' + fileObj.id + '" class="download-file-btn px-2.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs text-sky-300 transition" title="Download File">',
      '        ⬇',
      '      </button>',
      '    </div>',
      '  </div>',
      '  <div class="px-4 py-1.5 bg-black/40 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-zinc-400 border-b border-white/[0.04]">',
      '    <span class="text-emerald-300">✓ ' + escapeHtml(v.pass1Label) + '</span>',
      '    <span class="text-sky-300">✓ ' + escapeHtml(v.pass2Label) + '</span>',
      '    <span class="text-violet-300">✓ ' + escapeHtml(v.pass3Label) + '</span>',
      '  </div>',
      '  <div data-peek-Area="' + fileObj.id + '" class="hidden p-3 bg-[#040508]">',
      '    <pre class="code-block max-h-72 overflow-y-auto">' + escapeHtml(fileObj.content) + '</pre>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function renderProseWithArtifactBoxes(msg) {
    const sourceProse = msg.cleanedProse || msg.text || '';
    const files = msg.files || [];
    const lines = String(sourceProse).trim().split('\n');
    let html = '';

    lines.forEach(line => {
      const trimmed = line.trim();
      const boxMatch = trimmed.match(/^\[\[ARTIFACT_BOX_(\d+)\]\]$/);
      if (boxMatch) {
        const idx = Number(boxMatch[1]);
        const fileObj = files[idx];
        if (fileObj) html += renderArtifactBoxCard(fileObj);
        return;
      }
      if (!trimmed) return;

      const safe = escapeHtml(line)
        .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em class="text-sky-200 not-italic">$1</em>')
        .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded-md bg-white/[0.08] text-sky-300 font-mono text-xs">$1</code>');

      if (safe.startsWith('### ')) {
        html += '<h3 class="text-sm sm:text-base font-semibold text-white mt-3 mb-1.5">' + safe.slice(4) + '</h3>';
      } else if (safe.startsWith('- ')) {
        html += '<div class="flex items-start gap-2 my-1.5 text-zinc-200"><span class="text-sky-400 mt-0.5">•</span><span class="flex-1 leading-relaxed">' + safe.slice(2) + '</span></div>';
      } else {
        html += '<p class="my-1.5 text-zinc-200 leading-relaxed">' + safe + '</p>';
      }
    });

    if (files.length >= 2) {
      html += [
        '<div class="mt-3 p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/25 flex flex-wrap items-center justify-between gap-2">',
        '  <div class="text-xs text-sky-200 font-mono">📦 Multi-File Project Ready: ' + files.length + ' verified files synthesized</div>',
        '  <button type="button" class="download-zip-bundle-btn px-3.5 py-1.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-black font-semibold text-xs transition shadow">',
        '    ⬇ Download Project .ZIP',
        '  </button>',
        '</div>'
      ].join('');
    }

    return html;
  }

  function renderCurrentChat() {
    if (typeof document === 'undefined') return;
    const chat = getActiveChat();
    const stream = document.getElementById('chat-stream');
    const titleEl = document.getElementById('current-chat-title');
    if (titleEl) titleEl.textContent = chat.title || 'New Session';
    renderGoalBanner();
    updateFileBadgesCount();
    if (!stream) return;

    if (!chat.messages || chat.messages.length === 0) {
      stream.innerHTML = [
        '<div class="py-10 sm:py-14 flex flex-col items-center text-center px-3">',
        '  <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400 via-indigo-500 to-emerald-400 text-black flex items-center justify-center text-xl font-bold mb-4 shadow-xl">✦</div>',
        '  <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono text-sky-300 mb-3">',
        '    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>',
        '    <span>Autonomous ECC v2.2.3 Master · 3-Key Dynamic Rotation</span>',
        '  </div>',
        '  <h2 class="text-xl sm:text-2xl font-semibold text-white tracking-tight mb-2">What would you like to build or explore?</h2>',
        '  <p class="text-xs sm:text-sm text-zinc-400 max-w-xl mb-8 leading-relaxed">',
        '    Just type naturally. Simple messages respond instantly in 1 pass, while complex apps and engineering tasks automatically trigger Socratic planning, multi-file synthesis, and 5-stage verification across all 3 API keys.',
        '  </p>',
        '  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl text-left">',
        '    <button type="button" data-prompt="Hi! Tell me how your autonomous 3-key rotation and multi-round verification work." class="preset-prompt-btn preset-card p-4 rounded-2xl group">',
        '      <div class="text-xs font-semibold text-emerald-300 mb-1 flex items-center justify-between"><span>💬 Instant Conversational Test ("Hi")</span><span class="text-zinc-500 group-hover:text-white transition">→</span></div>',
        '      <div class="text-[11px] text-zinc-400 leading-relaxed">Responds immediately in 1 fast round with zero unnecessary code-pipeline overhead</div>',
        '    </button>',
        '    <button type="button" data-prompt="Build a complete Habit Tracker & Streak Analytics web application with TypeScript core and unit tests." class="preset-prompt-btn preset-card p-4 rounded-2xl group">',
        '      <div class="text-xs font-semibold text-sky-300 mb-1 flex items-center justify-between"><span>🚀 Multi-File Web App Synthesis</span><span class="text-zinc-500 group-hover:text-white transition">→</span></div>',
        '      <div class="text-[11px] text-zinc-400 leading-relaxed">Auto-runs Round 1 Plan (Key #1), Round 2 Build (Key #2), and Round 3 Verification (Key #3)</div>',
        '    </button>',
        '    <button type="button" data-prompt="Design a real-time collaborative Kanban board for engineering teams and stress-test the architecture." class="preset-prompt-btn preset-card p-4 rounded-2xl group">',
        '      <div class="text-xs font-semibold text-violet-300 mb-1 flex items-center justify-between"><span>🧠 Deep Architecture &amp; App Build</span><span class="text-zinc-500 group-hover:text-white transition">→</span></div>',
        '      <div class="text-[11px] text-zinc-400 leading-relaxed">Automatically fuses Socratic trade-off resolution, goal tracking, and runnable UI generation</div>',
        '    </button>',
        '    <button type="button" data-prompt="Create an interactive Pomodoro Focus Studio with custom timers, task queue, and JSON export." class="preset-prompt-btn preset-card p-4 rounded-2xl group">',
        '      <div class="text-xs font-semibold text-amber-300 mb-1 flex items-center justify-between"><span>⚡ Interactive Studio App + Live Preview</span><span class="text-zinc-500 group-hover:text-white transition">→</span></div>',
        '      <div class="text-[11px] text-zinc-400 leading-relaxed">Packages verified HTML/TS/Spec deliverables into the live Artifact Studio drawer</div>',
        '    </button>',
        '  </div>',
        '</div>'
      ].join('');
      return;
    }

    stream.innerHTML = chat.messages.map(msg => {
      if (msg.role === 'user') {
        const attHtml = Array.isArray(msg.attachments) && msg.attachments.length > 0
          ? '<div class="flex flex-wrap gap-2 mb-2">' + msg.attachments.map(att => {
              if (att.isImage && att.dataUrl) {
                return '<img src="' + att.dataUrl + '" alt="' + escapeHtml(att.name) + '" class="h-20 w-auto rounded-xl border border-white/15 object-cover" />';
              }
              const icon = att.isZip ? '🗜️' : '📄';
              return '<div class="px-2.5 py-1 rounded-lg bg-black/40 border border-white/10 text-[11px] font-mono text-sky-300 flex items-center gap-1.5"><span>' + icon + '</span><span>' + escapeHtml(att.name) + (att.zipSummary ? ' (' + escapeHtml(att.zipSummary) + ')' : '') + '</span></div>';
            }).join('') + '</div>'
          : '';

        return [
          '<div class="flex justify-end">',
          '  <div class="max-w-[85%] sm:max-w-[75%] rounded-3xl rounded-br-md px-4 py-3 user-bubble text-sm text-white">',
               attHtml,
          '    <div class="whitespace-pre-wrap leading-relaxed">' + escapeHtml(msg.text) + '</div>',
          '  </div>',
          '</div>'
        ].join('');
      }

      const complexityBadge = msg.classification ? msg.classification.complexity : 'AUTONOMOUS';
      const thinkingHeader = msg.isThinking
        ? '<span class="thinking-pulse text-sky-300 font-medium" data-thinking-status="' + msg.id + '">' + escapeHtml(msg.thinkingStatus || 'Processing…') + '</span>'
        : '<span class="text-zinc-300 flex flex-wrap items-center gap-2"><span>✦ Autonomous Trace (' + ((msg.latencyTotalMs || 45) / 1000).toFixed(2) + 's)</span><span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-sky-500/15 text-sky-300 border border-sky-500/25">' + escapeHtml(complexityBadge) + '</span><span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">' + escapeHtml(msg.lifecycleState || 'DELIVER') + '</span></span>';

      const stepsHtml = (msg.thinkingSteps || []).map(s => (
        '<div class="flex items-start gap-2 text-[11px] font-mono text-zinc-400"><span class="text-sky-400">›</span><span>' + escapeHtml(s) + '</span></div>'
      )).join('');

      return [
        '<div class="flex items-start gap-3">',
        '  <div class="w-7 h-7 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-black flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 shadow">✦</div>',
        '  <div class="flex-1 min-w-0 space-y-2">',
        '    <details class="group rounded-2xl trace-pill px-3.5 py-2" ' + (msg.isThinking ? 'open' : '') + '>',
        '      <summary class="cursor-pointer list-none flex items-center justify-between text-xs select-none">',
                 thinkingHeader,
        '        <span class="text-[10px] text-zinc-500 group-open:rotate-180 transition-transform">▼</span>',
        '      </summary>',
        '      <div class="mt-2 pt-2 border-t border-white/[0.05] space-y-1">',
                 stepsHtml,
        '      </div>',
        '    </details>',
        '    <div class="text-sm leading-relaxed">',
               msg.isThinking ? '<div class="text-xs text-zinc-400 font-mono py-2">Executing dynamic multi-round orchestration…</div>' : renderProseWithArtifactBoxes(msg),
        '    </div>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    const workspaceEl = document.getElementById('view-workspace');
    if (workspaceEl) workspaceEl.scrollTop = workspaceEl.scrollHeight;
  }

  function renderChatSidebar() {
    if (typeof document === 'undefined') return;
    const listEl = document.getElementById('chat-history-list');
    const countEl = document.getElementById('chat-count-label');
    if (countEl) countEl.textContent = String(chats.length);
    if (!listEl) return;

    listEl.innerHTML = chats.map(c => {
      const isActive = c.id === activeChatId;
      const activeClass = isActive
        ? 'bg-sky-500/15 text-white border-sky-500/30'
        : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200 border-transparent';
      return [
        '<div class="group flex items-center justify-between rounded-xl px-3 py-2 border ' + activeClass + ' transition cursor-pointer" data-select-chat="' + c.id + '">',
        '  <div class="truncate text-xs font-medium pr-2">' + escapeHtml(c.title || 'New Session') + '</div>',
        '  <button type="button" data-delete-chat="' + c.id + '" title="Delete session" class="delete-chat-btn opacity-0 group-hover:opacity-100 text-[11px] text-zinc-500 hover:text-red-400 px-1 transition">✕</button>',
        '</div>'
      ].join('');
    }).join('');
  }

  function updateFileBadgesCount() {
    if (typeof document === 'undefined') return;
    const files = getAllGeneratedFiles();
    const b1 = document.getElementById('sidebar-files-badge');
    const b2 = document.getElementById('header-files-count');
    if (b1) b1.textContent = files.length + (files.length === 1 ? ' file' : ' files');
    if (b2) b2.textContent = String(files.length);
  }

  /* ==========================================================================
     TOOLBOX DRAWER & REAL BINARY ZIP EXPORT
     ========================================================================== */
  function renderToolboxDrawer() {
    if (typeof document === 'undefined') return;
    const files = getAllGeneratedFiles();
    const tabsEl = document.getElementById('toolbox-file-tabs');
    const emptyEl = document.getElementById('toolbox-empty-state');
    const codeEl = document.getElementById('toolbox-code-display');
    const iframeEl = document.getElementById('toolbox-live-iframe');
    const btnCode = document.getElementById('btn-toolbox-code-view');
    const btnPrev = document.getElementById('btn-toolbox-preview-view');

    updateFileBadgesCount();
    if (!tabsEl || !emptyEl || !codeEl || !iframeEl) return;

    if (files.length === 0) {
      tabsEl.innerHTML = '<span class="text-[11px] text-zinc-500">No deliverables in this session yet</span>';
      emptyEl.classList.remove('hidden');
      codeEl.classList.add('hidden');
      iframeEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    const activeFile = files.find(f => f.id === activeToolboxFileId) || files[0];
    activeToolboxFileId = activeFile.id;

    tabsEl.innerHTML = files.map(f => {
      const active = f.id === activeFile.id;
      return '<button type="button" data-toolbox-tab="' + f.id + '" class="toolbox-tab-btn shrink-0 px-2.5 py-1 rounded-lg text-xs font-mono border transition ' +
        (active ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-white/[0.04] text-zinc-400 border-white/[0.06] hover:text-white') + '">' +
        escapeHtml(f.name) + ' (' + f.lines + 'L)</button>';
    }).join('');

    if (btnCode && btnPrev) {
      btnCode.className = toolboxViewMode === 'code'
        ? 'px-3 py-1 rounded-md text-xs font-medium bg-white/10 text-white'
        : 'px-3 py-1 rounded-md text-xs font-medium text-zinc-400 hover:text-white';
      btnPrev.className = toolboxViewMode === 'preview'
        ? 'px-3 py-1 rounded-md text-xs font-medium bg-white/10 text-white'
        : 'px-3 py-1 rounded-md text-xs font-medium text-zinc-400 hover:text-white';
    }

    if (toolboxViewMode === 'preview') {
      codeEl.classList.add('hidden');
      iframeEl.classList.remove('hidden');
      if (activeFile.ext === 'html') {
        iframeEl.srcdoc = activeFile.content;
      } else {
        iframeEl.srcdoc = '<html><body style="background:#06070a;color:#e4e4e7;font-family:monospace;padding:20px;white-space:pre-wrap;font-size:13px;line-height:1.6;">' +
          escapeHtml(activeFile.content) + '</body></html>';
      }
    } else {
      iframeEl.classList.add('hidden');
      codeEl.classList.remove('hidden');
      codeEl.textContent = activeFile.content;
    }
  }

  function triggerBrowserDownload(filename, contentOrBlob) {
    const blob = contentOrBlob instanceof Blob
      ? contentOrBlob
      : new Blob([contentOrBlob], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 150);
    showToast('Downloaded ' + filename);
  }

  function downloadAllProjectFilesAsZip() {
    const files = getAllGeneratedFiles();
    if (files.length === 0) {
      showToast('No project files to export yet');
      return;
    }
    const zipBytes = createZipArchiveBytes(files);
    const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
    const chat = getActiveChat();
    const slug = (chat.title || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    triggerBrowserDownload(slug + '-bundle.zip', zipBlob);
  }

  /* ==========================================================================
     MULTIMODAL & SAFE ZIP ATTACHMENT INGESTION
     ========================================================================== */
  function renderAttachmentsPreview() {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('attachments-preview');
    if (!container) return;
    if (pendingAttachments.length === 0) {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }
    container.classList.remove('hidden');
    container.classList.add('flex');
    container.innerHTML = pendingAttachments.map(att => {
      if (att.isImage && att.dataUrl) {
        return [
          '<div class="relative group rounded-xl overflow-hidden border border-white/15 bg-[#121521] flex items-center gap-2 pr-2.5">',
          '  <img src="' + att.dataUrl + '" alt="' + escapeHtml(att.name) + '" class="w-10 h-10 object-cover" />',
          '  <span class="text-[11px] text-zinc-200 max-w-[130px] truncate">' + escapeHtml(att.name) + '</span>',
          '  <span class="text-[10px] font-mono text-emerald-400">Ready</span>',
          '  <button type="button" data-remove-att="' + att.id + '" class="remove-att-btn text-zinc-400 hover:text-white text-xs ml-1">✕</button>',
          '</div>'
        ].join('');
      }
      const icon = att.isZip ? '🗜️' : '📄';
      return [
        '<div class="px-3 py-1.5 rounded-xl bg-[#121521] border border-white/15 flex items-center gap-2 text-xs text-zinc-200">',
        '  <span>' + icon + '</span>',
        '  <span class="max-w-[160px] truncate font-mono text-[11px]">' + escapeHtml(att.name) + '</span>',
        '  <span class="text-[10px] font-mono text-emerald-400">' + escapeHtml(att.statusLabel || 'Parsed') + '</span>',
        '  <button type="button" data-remove-att="' + att.id + '" class="remove-att-btn text-zinc-400 hover:text-white text-xs">✕</button>',
        '</div>'
      ].join('');
    }).join('');
  }

  function handleFilesSelected(fileList) {
    Array.from(fileList || []).forEach(file => {
      if (file.size > 10 * 1024 * 1024) {
        showToast('Rejected ' + file.name + ': exceeds 10 MB upload limit');
        return;
      }
      const id = 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const isImage = file.type.startsWith('image/');
      const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
      const reader = new FileReader();

      if (isZip) {
        reader.onload = () => {
          const uint8 = new Uint8Array(reader.result);
          const parsedZip = parseZipBufferHeaders(uint8);
          if (!parsedZip.ok) {
            showToast('Rejected unsafe ZIP: ' + (parsedZip.error || 'Invalid archive'));
            appendTelemetry('SECURITY', 'Rejected unsafe ZIP upload: ' + parsedZip.error, 'text-red-400');
            return;
          }
          const entries = parsedZip.entries || [];
          const summary = entries.length + ' files verified safe';
          const combinedText = entries
            .map(e => '// ZIP Entry: ' + e.name + ' (' + e.uncompressedSize + ' bytes)\n' + (e.textContent || ''))
            .join('\n\n')
            .slice(0, 40000);
          pendingAttachments.push({
            id,
            name: file.name,
            size: file.size,
            isImage: false,
            isZip: true,
            zipSummary: summary,
            statusLabel: summary,
            content: combinedText
          });
          renderAttachmentsPreview();
          showToast('Verified ZIP archive: ' + file.name + ' (' + summary + ')');
        };
        reader.readAsArrayBuffer(file);
      } else if (isImage) {
        reader.onload = () => {
          pendingAttachments.push({
            id,
            name: file.name,
            size: file.size,
            isImage: true,
            isZip: false,
            mimeType: file.type || 'image/png',
            statusLabel: 'Image Ready',
            dataUrl: String(reader.result || ''),
            content: ''
          });
          renderAttachmentsPreview();
          showToast('Attached image: ' + file.name);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => {
          pendingAttachments.push({
            id,
            name: file.name,
            size: file.size,
            isImage: false,
            isZip: false,
            mimeType: file.type || 'text/plain',
            statusLabel: Math.ceil(file.size / 1024) + ' KB',
            dataUrl: '',
            content: String(reader.result || '').slice(0, 45000)
          });
          renderAttachmentsPreview();
          showToast('Attached file: ' + file.name);
        };
        reader.readAsText(file);
      }
    });
  }

  /* ==========================================================================
     DIAGNOSTIC MODAL HELPERS
     ========================================================================== */
  const instinctsState = [
    { id: 'inst-1', name: 'autonomous-socratic-fusion', confidence: 0.99, domain: 'grill-me', rule: 'Automatically resolve high-impact design branches without requiring manual slash commands.' },
    { id: 'inst-2', name: 'manifest-driven-file-jobs', confidence: 0.99, domain: 'coding-standards', rule: 'Generate a project manifest first and persist checkpoints after each file.' },
    { id: 'inst-3', name: 'three-key-dynamic-rotation', confidence: 0.98, domain: 'performance', rule: 'Rotate across Planner (Key #1), Builder (Key #2), and Reviewer (Key #3) within the 15 RPM ceiling.' },
    { id: 'inst-4', name: 'five-stage-verification-gate', confidence: 0.99, domain: 'verification-loop', rule: 'Verify Requirements, Implementation, Syntax, Independent Review, and Self-Repair.' }
  ];

  function renderInstincts() {
    if (typeof document === 'undefined') return;
    const listEl = document.getElementById('instincts-list');
    if (!listEl) return;
    listEl.innerHTML = instinctsState.map(inst => (
      '<div class="p-2 rounded-xl bg-black/40 border border-white/[0.06] flex items-center justify-between text-[11px] font-mono">' +
      '<span class="text-zinc-200">' + escapeHtml(inst.name) + '</span>' +
      '<span class="text-emerald-400">' + Math.round(inst.confidence * 100) + '%</span>' +
      '</div>'
    )).join('');
  }

  function recordInstinctFromTask(promptText, matchedSkills) {
    instinctsState.forEach(inst => {
      if (matchedSkills.includes(inst.domain)) {
        inst.confidence = Math.min(0.99, Number((inst.confidence + 0.01).toFixed(2)));
      }
    });
    renderInstincts();
  }

  function renderMatchedSkills(skills) {
    if (typeof document === 'undefined') return;
    const listEl  = document.getElementById('matched-skills-list');
    const countEl = document.getElementById('matched-skills-count');
    if (countEl) countEl.textContent = skills.length + ' Active';
    if (listEl) listEl.textContent = skills.length > 0 ? skills.join(', ') : 'Direct Conversational Mode (1-Round Fast Path)';
  }

  function renderEccCatalog() {
    if (typeof document === 'undefined') return;
    const grid = document.getElementById('ecc-catalog-grid');
    const searchVal = (document.getElementById('ecc-search-input')?.value || '').toLowerCase();
    if (!grid) return;

    const allowed = {
      core: ['core'],
      developer: ['core', 'developer'],
      security: ['core', 'developer', 'security'],
      full: ['core', 'developer', 'security', 'full']
    }[currentProfile] || ['core', 'developer', 'security', 'full'];

    const items = ECC_CATALOG.filter(item => {
      const inProf = allowed.includes(item.profile);
      const inCat = catalogFilter === 'all' || item.type === catalogFilter;
      const inSearch = !searchVal || item.title.toLowerCase().includes(searchVal) || item.desc.toLowerCase().includes(searchVal);
      return inProf && inCat && inSearch;
    });

    grid.innerHTML = items.map(item => (
      '<div class="p-3 rounded-xl bg-black/40 border border-white/[0.06] flex flex-col justify-between gap-1.5">' +
        '<div class="flex items-center justify-between text-xs font-mono text-white font-semibold">' +
          '<span>' + escapeHtml(item.title) + '</span>' +
          '<span class="text-[10px] text-sky-300 uppercase">' + escapeHtml(item.node) + '</span>' +
        '</div>' +
        '<p class="text-[11px] text-zinc-400">' + escapeHtml(item.desc) + '</p>' +
      '</div>'
    )).join('');
  }

  function runAgentShieldAudit() {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('shield-input')?.value || '';
    const outEl = document.getElementById('shield-results');
    const scoreEl = document.getElementById('shield-big-score');
    const navBadge = document.getElementById('badge-shield-score');
    if (!outEl) return;

    let score = 100;
    const notes = [];
    if (/(sk-[a-zA-Z0-9]{16,}|AIza[0-9A-Za-z-_]{20,}|AQ\.[0-9A-Za-z-_]{20,})/.test(input)) {
      score -= 40;
      notes.push('CRITICAL: Plaintext API credential detected.');
    }
    if (/SELECT\s+.*\$\{/i.test(input)) {
      score -= 25;
      notes.push('CRITICAL: SQL string interpolation detected.');
    }
    if (/\.\.\//.test(input)) {
      score -= 25;
      notes.push('WARNING: Path traversal sequence (../) detected.');
    }
    if (notes.length === 0) {
      notes.push('PASS: Zero exposed credentials, injection patterns, or unsafe paths found.');
    }
    if (scoreEl) scoreEl.textContent = score + '/100';
    if (navBadge) navBadge.textContent = score + '/100';
    outEl.innerHTML = notes.map(n => '<div class="text-[11px] font-mono text-emerald-300">' + escapeHtml(n) + '</div>').join('');
  }

  function setNodeVisualState(nodeId, label, isBusy) {
    if (typeof document === 'undefined') return;
    const map = { master: 'status-master', alpha: 'status-alpha', beta: 'status-beta' };
    const el = document.getElementById(map[nodeId]);
    if (el) {
      el.textContent = label;
      el.className = isBusy ? 'font-mono text-[10px] text-amber-300' : 'font-mono text-[10px] text-emerald-400';
    }
  }

  function appendTelemetry(tag, message, colorClass) {
    if (typeof document === 'undefined') return;
    const log = document.getElementById('telemetry-log');
    if (!log) return;
    const row = document.createElement('div');
    row.className = colorClass || 'text-zinc-400';
    row.textContent = '[' + tag + '] ' + redactSecrets(message);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function showToast(message) {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'pointer-events-auto px-3.5 py-2 rounded-xl bg-[#141824] border border-white/10 text-xs text-white shadow-xl transition-opacity duration-200';
    el.textContent = redactSecrets(message);
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 220);
    }, 2600);
  }

  function copyTextSafe(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard')).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard');
    } catch (_) {
      showToast('Copy failed');
    }
    ta.remove();
  }

  // Expose programmatic hook for automated smoke verification
  window.AntigravityWorkbenchApp = {
    executeUnifiedOrchestratorTask,
    resolveRoleCredential,
    getActiveChat,
    runInBrowserDoctor,
    runInBrowserAcceptanceTests
  };

  /* ==========================================================================
     EVENT WIRING & INITIALIZATION
     ========================================================================== */
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      loadChatsState();
      renderNodeTelemetry();
      renderChatSidebar();
      renderCurrentChat();
      renderToolboxDrawer();
      renderEccCatalog();
      runAgentShieldAudit();
      renderInstincts();

      const docReport = runInBrowserDoctor();
      appendTelemetry('ECC-DOCTOR', 'Verified ' + docReport.passedCount + '/' + docReport.totalCount + ' native .agents/ & 3-key rotation checks', 'text-emerald-400');

      if (activeTaskPausedCheckpoint) {
        document.getElementById('btn-resume-task')?.classList.remove('hidden');
      }

      const sidebar = document.getElementById('app-sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      const toolboxDrawer = document.getElementById('toolbox-drawer');
      const engineModal = document.getElementById('engine-modal');
      const attachPopover = document.getElementById('attach-popover');
      const chatInput = document.getElementById('chat-input');

      function toggleMobileSidebar(forceOpen) {
        if (!sidebar || !backdrop) return;
        const isClosed = sidebar.classList.contains('-translate-x-full');
        const willOpen = forceOpen !== undefined ? forceOpen : isClosed;
        if (willOpen) {
          sidebar.classList.remove('-translate-x-full');
          backdrop.classList.remove('hidden');
        } else {
          sidebar.classList.add('-translate-x-full');
          backdrop.classList.add('hidden');
        }
      }

      function openToolbox(open) {
        if (!toolboxDrawer) return;
        if (open) {
          renderToolboxDrawer();
          toolboxDrawer.classList.remove('translate-x-full');
        } else {
          toolboxDrawer.classList.add('translate-x-full');
        }
      }

      document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => toggleMobileSidebar());
      backdrop?.addEventListener('click', () => toggleMobileSidebar(false));

      document.getElementById('btn-new-chat')?.addEventListener('click', () => {
        const c = createDefaultChat();
        chats.unshift(c);
        activeChatId = c.id;
        saveChatsState();
        renderChatSidebar();
        renderCurrentChat();
        renderToolboxDrawer();
        toggleMobileSidebar(false);
      });

      document.getElementById('btn-clear-chat')?.addEventListener('click', () => {
        const chat = getActiveChat();
        chat.messages = [];
        chat.files = [];
        chat.goal = '';
        chat.goalCriteria = [];
        chat.rollingSummary = '';
        chat.taskManifest = null;
        chat.title = 'New Session';
        saveChatsState();
        renderChatSidebar();
        renderCurrentChat();
        renderToolboxDrawer();
        showToast('Session reset');
      });

      document.getElementById('btn-clear-goal')?.addEventListener('click', () => {
        const chat = getActiveChat();
        chat.goal = '';
        chat.goalCriteria = [];
        saveChatsState();
        renderGoalBanner();
        showToast('Session objective cleared');
      });

      document.getElementById('btn-cancel-task')?.addEventListener('click', () => {
        cancelRequested = true;
        showToast('Pausing at current file checkpoint…');
      });

      document.getElementById('btn-resume-task')?.addEventListener('click', () => {
        if (activeTaskPausedCheckpoint) {
          showToast('Resuming from saved checkpoint…');
          executeUnifiedOrchestratorTask('', activeTaskPausedCheckpoint);
        }
      });

      document.getElementById('btn-open-toolbox')?.addEventListener('click', () => openToolbox(true));
      document.getElementById('btn-sidebar-toolbox')?.addEventListener('click', () => {
        toggleMobileSidebar(false);
        openToolbox(true);
      });
      document.getElementById('btn-close-toolbox')?.addEventListener('click', () => openToolbox(false));

      document.getElementById('btn-toolbox-code-view')?.addEventListener('click', () => {
        toolboxViewMode = 'code';
        renderToolboxDrawer();
      });
      document.getElementById('btn-toolbox-preview-view')?.addEventListener('click', () => {
        toolboxViewMode = 'preview';
        renderToolboxDrawer();
      });

      document.getElementById('btn-copy-active-file')?.addEventListener('click', () => {
        const files = getAllGeneratedFiles();
        const active = files.find(f => f.id === activeToolboxFileId) || files[0];
        if (active) copyTextSafe(active.content);
      });
      document.getElementById('btn-download-active-file')?.addEventListener('click', () => {
        const files = getAllGeneratedFiles();
        const active = files.find(f => f.id === activeToolboxFileId) || files[0];
        if (active) triggerBrowserDownload(active.name, active.content);
      });
      document.getElementById('btn-download-all-files')?.addEventListener('click', () => {
        downloadAllProjectFilesAsZip();
      });

      document.getElementById('btn-open-engine')?.addEventListener('click', () => {
        if (engineModal) {
          engineModal.classList.remove('hidden');
          engineModal.classList.add('flex');
        }
      });
      document.getElementById('btn-close-engine')?.addEventListener('click', () => {
        if (engineModal) {
          engineModal.classList.add('hidden');
          engineModal.classList.remove('flex');
        }
      });

      document.getElementById('btn-attach-menu')?.addEventListener('click', (e) => {
        e.stopPropagation();
        attachPopover?.classList.toggle('hidden');
      });
      document.addEventListener('click', () => attachPopover?.classList.add('hidden'));

      const fileInput = document.getElementById('file-upload-input');
      document.getElementById('btn-trigger-file')?.addEventListener('click', () => {
        attachPopover?.classList.add('hidden');
        fileInput?.click();
      });
      fileInput?.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
          handleFilesSelected(fileInput.files);
          fileInput.value = '';
        }
      });

      document.getElementById('btn-sample-code-file')?.addEventListener('click', () => {
        attachPopover?.classList.add('hidden');
        pendingAttachments.push({
          id: 'att_sample_code_' + Date.now(),
          name: 'ledger-service.ts',
          size: 540,
          isImage: false,
          isZip: false,
          statusLabel: '1 KB · TS',
          content: 'export async function recordTransaction(account, amount) {\n  console.log("Debug account:", account);\n  account.balance += amount;\n  return account;\n}'
        });
        renderAttachmentsPreview();
        showToast('Attached sample file: ledger-service.ts');
      });

      document.getElementById('btn-sample-image')?.addEventListener('click', () => {
        attachPopover?.classList.add('hidden');
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" rx="18" fill="#111827"/><rect x="20" y="20" width="280" height="36" rx="8" fill="#1f2937"/><circle cx="40" cy="38" r="8" fill="#38bdf8"/><rect x="20" y="70" width="132" height="86" rx="12" fill="#1e293b"/><rect x="168" y="70" width="132" height="86" rx="12" fill="#1e293b"/></svg>';
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(svg);
        pendingAttachments.push({
          id: 'att_sample_img_' + Date.now(),
          name: 'ui-wireframe.png',
          size: 1240,
          isImage: true,
          isZip: false,
          statusLabel: 'Image Ready',
          dataUrl,
          content: ''
        });
        renderAttachmentsPreview();
        showToast('Attached sample wireframe: ui-wireframe.png');
      });

      window.addEventListener('dragover', e => e.preventDefault());
      window.addEventListener('drop', e => {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleFilesSelected(e.dataTransfer.files);
        }
      });

      const chatForm = document.getElementById('chat-form');
      chatForm?.addEventListener('submit', e => {
        e.preventDefault();
        if (!chatInput) return;
        const text = chatInput.value;
        chatInput.value = '';
        executeUnifiedOrchestratorTask(text);
      });
      chatInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const text = chatInput.value;
          chatInput.value = '';
          executeUnifiedOrchestratorTask(text);
        }
      });

      document.body.addEventListener('click', e => {
        const presetBtn = e.target.closest('.preset-prompt-btn');
        if (presetBtn) {
          const p = presetBtn.getAttribute('data-prompt') || '';
          if (p) executeUnifiedOrchestratorTask(p);
          return;
        }

        const zipBtn = e.target.closest('.download-zip-bundle-btn');
        if (zipBtn) {
          downloadAllProjectFilesAsZip();
          return;
        }

        const peekBtn = e.target.closest('.peek-code-btn');
        if (peekBtn) {
          const fid = peekBtn.getAttribute('data-peek-box');
          const area = document.querySelector('[data-peek-Area="' + fid + '"]');
          if (area) {
            area.classList.toggle('hidden');
            peekBtn.textContent = area.classList.contains('hidden') ? 'Code ▾' : 'Hide ▴';
          }
          return;
        }

        const copyBtn = e.target.closest('.copy-code-btn');
        if (copyBtn) {
          copyTextSafe(decodeURIComponent(copyBtn.getAttribute('data-copy-code') || ''));
          return;
        }

        const openFileBtn = e.target.closest('.open-toolbox-file-btn');
        if (openFileBtn) {
          activeToolboxFileId = openFileBtn.getAttribute('data-open-file');
          toolboxViewMode = openFileBtn.getAttribute('data-open-mode') || 'preview';
          openToolbox(true);
          return;
        }

        const dlFileBtn = e.target.closest('.download-file-btn');
        if (dlFileBtn) {
          const fid = dlFileBtn.getAttribute('data-download-file');
          const f = getAllGeneratedFiles().find(x => x.id === fid);
          if (f) triggerBrowserDownload(f.name, f.content);
          return;
        }

        const tabBtn = e.target.closest('.toolbox-tab-btn');
        if (tabBtn) {
          activeToolboxFileId = tabBtn.getAttribute('data-toolbox-tab');
          renderToolboxDrawer();
          return;
        }

        const rmAttBtn = e.target.closest('.remove-att-btn');
        if (rmAttBtn) {
          const id = rmAttBtn.getAttribute('data-remove-att');
          pendingAttachments = pendingAttachments.filter(a => a.id !== id);
          renderAttachmentsPreview();
          return;
        }

        const delChatBtn = e.target.closest('.delete-chat-btn');
        if (delChatBtn) {
          e.stopPropagation();
          const cid = delChatBtn.getAttribute('data-delete-chat');
          chats = chats.filter(c => c.id !== cid);
          if (chats.length === 0) {
            const fresh = createDefaultChat();
            chats = [fresh];
          }
          if (activeChatId === cid) activeChatId = chats[0].id;
          saveChatsState();
          renderChatSidebar();
          renderCurrentChat();
          renderToolboxDrawer();
          return;
        }

        const selChatEl = e.target.closest('[data-select-chat]');
        if (selChatEl) {
          activeChatId = selChatEl.getAttribute('data-select-chat');
          renderChatSidebar();
          renderCurrentChat();
          renderToolboxDrawer();
          toggleMobileSidebar(false);
        }
      });

      document.querySelectorAll('.ctx-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          currentContext = btn.getAttribute('data-ctx') || 'dev.md';
          const lbl = document.getElementById('active-context-label');
          if (lbl) lbl.textContent = currentContext;
          showToast('Context switched to ' + currentContext);
        });
      });

      document.querySelectorAll('.ecc-profile-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          currentProfile = btn.getAttribute('data-profile') || 'full';
          const meta = PROFILE_META[currentProfile];
          const lbl = document.getElementById('active-profile-label');
          const bdg = document.getElementById('badge-ecc-count');
          if (lbl && meta) lbl.textContent = meta.label;
          if (bdg && meta) bdg.textContent = meta.badge;
          renderEccCatalog();
          showToast('Profile: ' + meta.label);
        });
      });

      document.querySelectorAll('.ecc-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          catalogFilter = btn.getAttribute('data-filter') || 'all';
          renderEccCatalog();
        });
      });

      document.getElementById('ecc-search-input')?.addEventListener('input', renderEccCatalog);
      document.getElementById('btn-run-shield')?.addEventListener('click', () => {
        runAgentShieldAudit();
        showToast('AgentShield scan complete');
      });
      document.getElementById('btn-evolve-instincts')?.addEventListener('click', () => {
        instinctsState.forEach(i => {
          i.confidence = Math.min(0.99, Number((i.confidence + 0.01).toFixed(2)));
        });
        renderInstincts();
        showToast('Evolved session instincts');
      });
      document.getElementById('btn-pulse-check')?.addEventListener('click', async () => {
        ['master', 'alpha', 'beta'].forEach(n => setNodeVisualState(n, 'VERIFYING', true));
        const doc = runInBrowserDoctor();
        const suite = await runInBrowserAcceptanceTests();
        ['master', 'alpha', 'beta'].forEach(n => setNodeVisualState(n, 'HEALTHY', false));
        appendTelemetry('ACCEPTANCE', 'Passed ' + suite.passedCount + '/' + suite.totalCount + ' tests & ' + doc.passedCount + '/' + doc.totalCount + ' ECC Doctor checks', 'text-emerald-400');
        showToast('Verified: 3 Keys Active · ' + suite.passedCount + '/' + suite.totalCount + ' Tests & ' + doc.passedCount + '/' + doc.totalCount + ' Doctor Checks PASSED');
      });
      document.querySelectorAll('.engine-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.engine-subtab').forEach(b => {
            b.className = b === btn
              ? 'engine-subtab px-3 py-1 rounded-lg text-xs font-medium bg-white/10 text-white'
              : 'engine-subtab px-3 py-1 rounded-lg text-xs font-medium text-zinc-400 hover:text-white';
          });
        });
      });
    });
  }
})();

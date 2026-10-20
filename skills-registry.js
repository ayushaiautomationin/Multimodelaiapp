/**
 * Multimodal AI (MMA) — Specialist Skill Registry (skills-registry.js)
 *
 * Implements:
 * 1. Permanent ECC Core Methodology (Coding standards, TDD, 5-stage verification, security, eval harness)
 * 2. 9 Approved Specialist Skills with explicit Provenance, Licensing, Triggers, and Instructions:
 *    A. UI UX Pro Max (MIT, nextlevelbuilder/ui-ux-pro-max-skill)
 *    B. Superpowers (MIT, obra/superpowers)
 *    C. Vercel Agent Skills (Apache-2.0, vercel-labs/agent-skills)
 *    D. Anthropic Agent Skills (MIT, anthropics/skills)
 *    E. Microsoft Playwright (Apache-2.0, microsoft/playwright)
 *    F. Context7 Documentation (MIT, upstash/context7)
 *    G. MarkItDown (MIT, microsoft/markitdown)
 *    H. Docling Parser (MIT, docling-project/docling)
 *    I. Trail of Bits Security (Apache-2.0, trailofbits/skills)
 * 3. Dynamic Task Routing & Smallest-Useful-Set Selection
 * 4. Role-Specific & Stage-Specific Instruction Assembly (Planner, Builder, Reviewer)
 */

(function (root, factory) {
  const registryInstance = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = registryInstance;
  }
  if (root) {
    root.MMASkillsRegistry = registryInstance;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /* =========================================================================
     1. SPECIALIST SKILL CATALOGUE WITH PROVENANCE & LICENSING
     ========================================================================= */
  const SKILL_CATALOGUE = Object.freeze([
    // ECC FOUNDATION SKILLS
    {
      id: 'ecc-core-planning',
      name: 'ECC Socratic Planning & Decomposition',
      category: 'ecc-core',
      license: 'MIT',
      source: 'Internal / ECC Core v2.2.3',
      applicableStages: ['PLAN'],
      applicableDomains: ['web_application', 'ecommerce_web', 'general_software', 'interactive_game', 'python'],
      description: 'Decompose user requirements into machine-decidable acceptance criteria, file manifests, and dependency order.',
      instructions: [
        '# ECC Socratic Planning Guidelines',
        '1. Separate original user request from internal plans. Never merge agent instructions into user deliverables.',
        '2. Lock explicit acceptance criteria based strictly on what the user requested.',
        '3. Create a bounded project manifest listing only the necessary files.',
        '4. Prioritize research-first and interface contracts before implementation.'
      ].join('\n')
    },
    {
      id: 'ecc-coding-standards',
      name: 'ECC Coding Standards & Immutability',
      category: 'ecc-core',
      license: 'MIT',
      source: 'Internal / ECC Core v2.2.3',
      applicableStages: ['BUILD', 'REPAIR'],
      applicableDomains: ['web_application', 'ecommerce_web', 'general_software', 'interactive_game', 'python'],
      description: 'Enforces pure functions, immutable state updates, explicit error handling, and zero code truncation.',
      instructions: [
        '# ECC Coding Standards',
        '1. Generate complete, production-ready code with no superficial placeholders or ellipses.',
        '2. Use immutable state patterns: never mutate arguments or global variables in place.',
        '3. Provide explicit error handling and clear boundary fallbacks.',
        '4. Maintain clean, readable structure matching modern standard idioms.'
      ].join('\n')
    },
    {
      id: 'ecc-tdd-workflow',
      name: 'ECC Test-Driven Verification',
      category: 'ecc-core',
      license: 'MIT',
      source: 'Internal / ECC Core v2.2.3',
      applicableStages: ['BUILD', 'REVIEW', 'VERIFY'],
      applicableDomains: ['web_application', 'general_software', 'python'],
      description: 'Ensures testable interfaces, unit specs, and regression coverage for critical logic paths.',
      instructions: [
        '# ECC Test-Driven Verification',
        '1. Write acceptance specs that directly test required user features and edge cases.',
        '2. Verify nullish, boundary, and error conditions.',
        '3. Ensure test files can execute independently without hidden network dependencies.'
      ].join('\n')
    },
    {
      id: 'ecc-verification-gate',
      name: 'ECC 5-Stage Verification Gate',
      category: 'ecc-core',
      license: 'MIT',
      source: 'Internal / ECC Core v2.2.3',
      applicableStages: ['REVIEW', 'VERIFY'],
      applicableDomains: ['web_application', 'ecommerce_web', 'general_software', 'interactive_game', 'python', 'writing', 'research'],
      description: '5-stage audit: Requirements fidelity, Implementation completeness, Technical syntax, Independent Review, Delivery Gate.',
      instructions: [
        '# ECC 5-Stage Verification Gate',
        '1. Stage 1 (Requirements): Verify output matches the requested product type and semantic domain.',
        '2. Stage 2 (Implementation): Reject stubs (< 15 lines for web deliverables) and unfulfilled criteria.',
        '3. Stage 3 (Technical): Ensure balanced braces, closed tags, and clean syntax without unclosed code fences.',
        '4. Stage 4 (Review): Audit against real user acceptance criteria with honest defect reporting.',
        '5. Stage 5 (Gate): Authorize delivery only when all 5 stages pass.'
      ].join('\n')
    },
    {
      id: 'ecc-security-review',
      name: 'ECC Security Review & Secret Guard',
      category: 'ecc-core',
      license: 'MIT',
      source: 'Internal / ECC Core v2.2.3',
      applicableStages: ['REVIEW', 'VERIFY'],
      applicableDomains: ['web_application', 'ecommerce_web', 'general_software', 'deployment'],
      description: 'Audits deliverables against hardcoded API credentials, XSS, unsafe evaluations, and archive path traversal.',
      instructions: [
        '# ECC Security Guard',
        '1. Never embed raw API keys or tokens in client-side code, logs, or exported files.',
        '2. Sanitize and escape user inputs before inserting into the DOM.',
        '3. Reject path traversal (../) and unsafe file operations.'
      ].join('\n')
    },

    // APPROVED SPECIALIST SKILL 1: UI UX PRO MAX
    {
      id: 'ui-ux-pro-max',
      name: 'UI UX Pro Max',
      category: 'design-system',
      license: 'MIT',
      source: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
      applicableStages: ['PLAN', 'BUILD'],
      applicableDomains: ['web_application', 'ecommerce_web', 'interactive_game'],
      description: 'Design systems, color palettes, typography hierarchies, mobile-responsive layouts, and accessible UI patterns.',
      instructions: [
        '# UI UX Pro Max Guidelines',
        '1. Visual Polish: Use refined typography, cohesive spacing scales (4px, 8px, 12px, 16px, 24px, 32px), and purposeful color palettes.',
        '2. Responsive Design: Build fluid mobile-first layouts with flexible grids, sticky navigation, and touch-friendly target sizes (min 44x44px).',
        '3. Interactive Polish: Add subtle hover, active, and focus transitions. Provide clear empty states and loading feedback.',
        '4. Semantic Structure: Use proper HTML5 landmarks (<header>, <nav>, <main>, <section>, <footer>) and ARIA attributes.'
      ].join('\n')
    },

    // APPROVED SPECIALIST SKILL 2: SUPERPOWERS
    {
      id: 'superpowers',
      name: 'Superpowers Engineering Workflows',
      category: 'workflow',
      license: 'MIT',
      source: 'https://github.com/obra/superpowers',
      applicableStages: ['PLAN', 'REVIEW', 'REPAIR'],
      applicableDomains: ['web_application', 'ecommerce_web', 'general_software', 'python'],
      description: 'Systematic task brainstorming, disciplined subtask execution, root-cause debugging, and completion verification.',
      instructions: [
        '# Superpowers Engineering Protocol',
        '1. Brainstorm edge cases and user journeys before committing to architecture.',
        '2. Isolate root causes rather than patching symptoms.',
        '3. Treat completed subtasks as persistent checkpoints that survive later failures.'
      ].join('\n')
    },

    // APPROVED SPECIALIST SKILL 3: VERCEL AGENT SKILLS
    {
      id: 'vercel-agent-skills',
      name: 'Vercel Agent Skills',
      category: 'frontend-performance',
      license: 'Apache-2.0',
      source: 'https://github.com/vercel-labs/agent-skills',
      applicableStages: ['BUILD', 'REVIEW'],
      applicableDomains: ['web_application', 'ecommerce_web'],
      description: 'Web interface performance, React/Next.js best practices, bundle minimization, and serverless deployment safety.',
      instructions: [
        '# Vercel Web & Performance Guidelines',
        '1. Client Performance: Prevent render waterfalls, minimize DOM depth, and avoid unnecessary re-renders.',
        '2. Deployment Safety: Ensure serverless routes isolate secrets in environment variables.',
        '3. Only apply React/Next.js specific rules when the project explicitly targets React/Next.js; use general web standards otherwise.'
      ].join('\n')
    },

    // APPROVED SPECIALIST SKILL 4: ANTHROPIC AGENT SKILLS
    {
      id: 'anthropic-frontend-design',
      name: 'Anthropic Frontend Design & WebApp Testing',
      category: 'ui-testing',
      license: 'MIT',
      source: 'https://github.com/anthropics/skills',
      applicableStages: ['BUILD', 'VERIFY'],
      applicableDomains: ['web_application', 'ecommerce_web', 'interactive_game'],
      description: 'Frontend design refinement, visual consistency, and self-contained interactive web application validation.',
      instructions: [
        '# Anthropic Frontend & WebApp Testing',
        '1. Ensure web applications are fully runnable and self-contained with zero broken external asset links.',
        '2. Test core interactive flows (e.g. adding items to cart, filtering, state toggling) directly in JavaScript.',
        '3. Maintain elegant, restrained layouts with high contrast and legible typography.'
      ].join('\n')
    },

    // APPROVED SPECIALIST SKILL 5: MICROSOFT PLAYWRIGHT
    {
      id: 'playwright-testing',
      name: 'Microsoft Playwright Testing',
      category: 'e2e-testing',
      license: 'Apache-2.0',
      source: 'https://github.com/microsoft/playwright',
      applicableStages: ['BUILD', 'VERIFY'],
      applicableDomains: ['web_application', 'ecommerce_web'],
      description: 'End-to-end browser automation, user flow validation, and cross-browser interaction verification patterns.',
      instructions: [
        '# Playwright Verification Patterns',
        '1. Structure end-to-end tests around user visible interactions (locators by role, text, and label).',
        '2. Note: Playwright test runtime requires an active Node/browser environment; in browser-only sandboxes, verify DOM events directly.'
      ].join('\n')
    },

    // APPROVED SPECIALIST SKILL 6: CONTEXT7 DOCUMENTATION
    {
      id: 'context7-docs',
      name: 'Context7 Library Documentation',
      category: 'documentation',
      license: 'MIT',
      source: 'https://github.com/upstash/context7',
      applicableStages: ['PLAN', 'BUILD'],
      applicableDomains: ['web_application', 'general_software', 'python'],
      description: 'Version-specific library APIs and framework documentation reference.',
      instructions: [
        '# Context7 Documentation Guidance',
        '1. Use official API patterns for current library versions instead of deprecated methods.',
        '2. Avoid hallucinations of non-existent SDK parameters or endpoints.'
      ].join('\n')
    },

    // APPROVED SPECIALIST SKILL 7: MARKITDOWN
    {
      id: 'markitdown',
      name: 'Microsoft MarkItDown',
      category: 'document-extraction',
      license: 'MIT',
      source: 'https://github.com/microsoft/markitdown',
      applicableStages: ['INGEST', 'BUILD'],
      applicableDomains: ['file_analysis', 'writing', 'research'],
      description: 'Converts documents (PDF, DOCX, XLSX, PPTX, HTML) into clean structured Markdown.',
      instructions: [
        '# MarkItDown Document Processing',
        '1. Extract structured hierarchy (headings, tables, lists) cleanly into valid Markdown.',
        '2. Preserve tabular data alignment and clean text representations.'
      ].join('\n')
    },

    // APPROVED SPECIALIST SKILL 8: DOCLING
    {
      id: 'docling-parser',
      name: 'Docling Structured Document Parser',
      category: 'document-extraction',
      license: 'MIT',
      source: 'https://github.com/docling-project/docling',
      applicableStages: ['INGEST'],
      applicableDomains: ['file_analysis', 'research'],
      description: 'Advanced document layout understanding and table structure extraction.',
      instructions: [
        '# Docling Parser Guidelines',
        '1. Recognize document zones (headers, footnotes, captions, tables).',
        '2. Retain complex document structures without flattening semantic relationships.'
      ].join('\n')
    },

    // APPROVED SPECIALIST SKILL 9: TRAIL OF BITS SECURITY
    {
      id: 'trail-of-bits-security',
      name: 'Trail of Bits Security Auditing',
      category: 'security',
      license: 'Apache-2.0',
      source: 'https://github.com/trailofbits/skills',
      applicableStages: ['REVIEW', 'VERIFY'],
      applicableDomains: ['web_application', 'ecommerce_web', 'general_software', 'deployment'],
      description: 'Specialist vulnerability review, input fuzzing patterns, and defensive programming.',
      instructions: [
        '# Trail of Bits Security Auditing',
        '1. Threat Modeling: Audit all data ingestion points, external inputs, and deserialization paths.',
        '2. Defensive Controls: Enforce strict boundary checks, safe defaults, and fail-closed error handling.'
      ].join('\n')
    }
  ]);

  /* =========================================================================
     2. DYNAMIC SKILL SELECTOR (Smallest Useful Set)
     ========================================================================= */
  function selectSkillsForTask(domain, complexity, promptText = '') {
    if (complexity === 'SIMPLE') {
      return []; // Keep simple chat lightweight with zero skill overhead
    }

    const selected = [];
    const pLower = String(promptText || '').toLowerCase();

    // Core ECC always included for non-simple tasks
    selected.push('ecc-core-planning', 'ecc-coding-standards', 'ecc-verification-gate');

    if (complexity === 'COMPLEX' || complexity === 'PROJECT') {
      selected.push('ecc-tdd-workflow', 'superpowers');
    }

    // Domain Specific Selection
    if (domain === 'ecommerce_web' || domain === 'web_application' || domain === 'interactive_game') {
      selected.push('ui-ux-pro-max', 'anthropic-frontend-design');
      if (pLower.includes('react') || pLower.includes('next')) {
        selected.push('vercel-agent-skills');
      }
      if (pLower.includes('e2e') || pLower.includes('test') || pLower.includes('playwright')) {
        selected.push('playwright-testing');
      }
    }

    if (domain === 'file_analysis' || domain === 'writing' || domain === 'research') {
      selected.push('markitdown');
      if (pLower.includes('pdf') || pLower.includes('doc')) {
        selected.push('docling-parser');
      }
    }

    // Security triggers
    if (/\b(sec|auth|key|secret|token|upload|zip|sql|payment|cart)\b/i.test(pLower)) {
      selected.push('ecc-security-review', 'trail-of-bits-security');
    }

    // De-duplicate while preserving order
    return Array.from(new Set(selected));
  }

  /* =========================================================================
     3. ROLE & STAGE INSTRUCTION BUILDER
     Assembles only relevant instructions for the current role and stage.
     ========================================================================= */
  function buildRoleSystemPrompt(role, stage, domain, selectedSkillIds = [], activeGoal = '') {
    const roleTitles = {
      planner: 'Role 1 — Master Planner and Orchestrator',
      builder: 'Role 2 — Builder & Implementation Specialist',
      reviewer: 'Role 3 — Independent Reviewer and Repair Specialist'
    };

    const lines = [
      `You are operating as **${roleTitles[role] || role}** in the Multimodal AI (MMA) workbench.`,
      `Deliverable Target Domain: **${domain}** | Execution Stage: **${stage}**.`
    ];

    if (activeGoal) {
      lines.push(`ACTIVE SESSION GOAL: ${activeGoal}`);
    }

    lines.push('\n### MANDATORY DELIVERABLE INTEGRITY LAW:');
    lines.push('1. The user\'s requested product MUST control the deliverable. Never substitute an unrelated task tracker or to-do app.');
    lines.push('2. Do not leak internal task planning, stage numbers, or agent orchestration metadata into user-facing deliverables.');
    lines.push('3. Provide complete, fully functional, production-ready code without truncation.');

    // Append instructions for applicable selected skills
    const matchingSkills = SKILL_CATALOGUE.filter(s =>
      selectedSkillIds.includes(s.id) && s.applicableStages.includes(stage)
    );

    if (matchingSkills.length > 0) {
      lines.push('\n### APPLIED SPECIALIST METHODOLOGIES:');
      matchingSkills.forEach(s => {
        lines.push(`\n<!-- Skill: ${s.name} (${s.license}) -->`);
        lines.push(s.instructions);
      });
    }

    return lines.join('\n');
  }

  return {
    SKILL_CATALOGUE,
    selectSkillsForTask,
    buildRoleSystemPrompt
  };
});

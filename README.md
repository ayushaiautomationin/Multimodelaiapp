# Multimodal AI (MMA)

A powerful, multimodal, skill-driven AI workbench for creating websites, browser applications, interactive tools, games, Python utilities, code, documents, and reports.

**Live URL:** [https://mysecretmultimodelaiapp.vercel.app](https://mysecretmultimodelaiapp.vercel.app)

---

## Architecture (Clean 6-File Modular Structure)

```
mma/
├── index.html             # Clean ChatGPT-style monochrome UI workspace
├── style.css              # Minimal monochrome design system tokens (light/dark mode)
├── orchestrator.js        # Core state machine, 15 RPM scheduler, 5-stage verification & context assembler
├── skills-registry.js     # Permanent ECC foundation + 9 specialist skills with provenance & licensing
├── app.js                 # UI controller, per-chat state isolation, Artifact Studio, and live sandbox
├── api/
│   └── gemini.js          # Vercel Serverless Function for secure 3-key proxying
├── package.json           # Minimal configuration with npm test runner
└── vercel.json            # Vercel deployment and routing rules
```

---

## 3-API Role Configuration

MMA coordinates three Gemini API roles operating under a shared **15 RPM project ceiling** (for the 20 RPM Gemini quota):

1. **API Role 1 — Master Planner and Orchestrator:** Understands the user's request, selects applicable skills, creates the bounded manifest, tracks task state, and authorizes delivery.
2. **API Role 2 — Builder:** Executes coding, research, and deliverable creation with per-file chunked assembly and automatic checkpointing.
3. **API Role 3 — Reviewer and Repair Specialist:** Audits the deliverable against original requirements, runs 5-stage verification, detects defects, and guides the repair loop (up to 8 passes).

---

## Environment Variables (for Vercel Deployment)

In your Vercel Project Settings (`Settings` -> `Environment Variables`), configure:

| Variable Name | Role | Default Model |
|---|---|---|
| `GEMINI_API_KEY_1` | Role 1 (Planner) | `gemini-3.5-flash-lite` |
| `GEMINI_API_KEY_2` | Role 2 (Builder) | `gemini-3.5-flash-lite` |
| `GEMINI_API_KEY_3` | Role 3 (Reviewer) | `gemini-3.5-flash-lite` |

*Note:* You can also configure custom API keys directly in the app's **Settings & 3-Key Routing** modal when running in local or self-hosted environments.

---

## Automated Acceptance Tests

Run the deterministic test suite:

```bash
npm test
```

Verifies:
- **Test A:** Clothing store generation (Urban Threads) fidelity vs 66-line task tracker regression.
- **Test B:** Concurrent chat execution & pure state isolation.
- **Test C:** Exact 10 completed conversational turns context window assembly.
- **Test D:** Long project continuation & chunk assembly.
- **Test E:** 15-RPM quota scheduling, rate limiting, and 429/503/quota error classification.
- **Test F:** Artifact Studio live preview & real binary PKZIP export.
- **Test G:** Multimodal 20 MB file upload limits & ZIP security (path traversal and bomb defense).
- **Test H:** ECC core foundation & 9 approved specialist skills dynamic routing.

<div align="center">
  <img width="1200" height="475" alt="SerenixAI banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# SerenixAI

SerenixAI is a private reflection and support app built around two core experiences:

- **Sanctuary**: a one-to-one check-in space for reflection, grounding, and next-step thinking
- **Circles**: invite-only shared support spaces with trusted backend AI facilitation and safety controls

The project combines a React/Vite frontend, Firebase auth + Firestore, and a governance layer that applies SELF safety policies before and after model generation. The overall goal is to offer a calm, bounded, mental-health-adjacent reflection space with explicit safeguards, non-attaching language, and strong red-team coverage.

## What this repo contains

- **Frontend app** in `src/`
- **Local governance server** in `server/governance-server.ts`
- **Cloud Run deployment target** in `server/cloudrun/`
- **Red-team harness** in `redteam/`
- **Firebase config + rules** for auth, hosting, and Firestore

## Product overview

### Sanctuary

The Sanctuary view is the private check-in surface. Users can:

- sign in with Google
- chat in a reflective one-to-one space
- choose response length (`short`, `medium`, `long`)
- choose transcript retention mode (`ephemeral` or `persistent`)
- download private transcripts when persistence is enabled
- use a consent gate before sending sensitive emotional text

The UI and backend both reinforce that SerenixAI is:

- **not therapy**
- **not emergency care**
- **not a replacement for human support**

### Circles

Circles are private, invite-only group spaces. The governance backend supports:

- secure invite code creation and regeneration
- invite lookup rate limiting
- membership-gated access
- AI-written shared facilitation messages via trusted backend only
- safety pause and creator-only resume controls
- AI provenance metadata for backend-generated messages

## Architecture

### Frontend

- **React 19** + **Vite**
- Firebase client SDK for auth and Firestore
- Views for landing, sanctuary, circles, circle chat, and settings

### Governance backend

The governance server exposes endpoints such as:

- `/health`
- `/v1/pre`
- `/v1/post`
- `/v1/private/respond`
- `/v1/circles/invite/create`
- `/v1/circles/invite/regenerate`
- `/v1/circles/invite/join`
- `/v1/circles/intervene`
- `/v1/circles/activity`
- `/v1/circles/resume`

Its responsibilities include:

- SELF-based state detection and policy shaping
- pre-generation safety policy construction
- post-generation repair/validation
- private AI response persistence through trusted backend writes
- shared-circle intervention and activity prompts
- deterministic fail-closed fallback behavior when model calls are unavailable

### Storage and rules

Firestore rules enforce several important boundaries:

- users can only read/update their own `users/{userId}` documents
- circle access is limited to members
- browser clients can only create `type: "text"` messages for themselves
- browser clients **cannot** create Firestore `type: "ai"` messages
- trusted backend writes are used for shared circle AI and persisted private AI replies

## Governance options

This repo supports several governance deployment and runtime patterns.

### 1. Local governance wrapper

Run the in-repo governance server locally:

```bash
npm run dev:governance
```

Or run frontend + governance together:

```bash
npm run dev:all
```

Default local base URL:

```env
VITE_SELF_GOVERNANCE_URL=http://localhost:8788
```

### 2. Single-base governance routing

Use one base URL for both preflight and postflight policy calls:

```env
VITE_SELF_GOVERNANCE_URL=http://localhost:8788
```

This is the simplest option and the recommended local default.

### 3. Split pre/post routing

If you want different services for pre- and post-governance, you can configure them independently:

```env
VITE_SELF_GOVERNANCE_PRE_URL=http://...
VITE_SELF_GOVERNANCE_POST_URL=http://...
```

This is useful if you want to isolate state detection from response repair or experiment with different infrastructure.

### 4. Fallback governance routing

The frontend can be configured with fallback endpoints so the app can retry when the primary governance service is unavailable:

```env
VITE_SELF_GOVERNANCE_FALLBACK_URL=http://...
```

Or split fallback routing:

```env
VITE_SELF_GOVERNANCE_PRE_FALLBACK_URL=http://...
VITE_SELF_GOVERNANCE_POST_FALLBACK_URL=http://...
```

This provides operational resilience when the primary pre/post governance service is down.

### 5. Dedicated circle governance endpoint

Shared circle endpoints can be routed separately:

```env
VITE_SELF_GOVERNANCE_CIRCLE_URL=http://...
```

This is helpful when shared-group moderation/facilitation should run on a separately managed service.

### 6. Trusted backend private-response mode

Persistent private transcripts can route AI reply generation through the governance backend:

- the client sends user text to `/v1/private/respond`
- the backend applies safety constraints
- the backend writes AI messages with provenance metadata

This supports auditable persistence and prevents direct client creation of AI transcript rows.

### 7. Semantic assist modes

The governance layer supports optional semantic assist:

```env
SELF_SEMANTIC_ASSIST_ENABLED=true
SELF_SEMANTIC_ASSIST_MODE=assist
```

Modes:

- `observe`: log semantic scoring signals without changing deterministic governance decisions
- `assist`: allow bounded semantic signals to assist state detection/escalation

This lets you evaluate ML-assisted classification while preserving a deterministic policy backbone.

### 8. Circle AI presence modes

Circles support multiple shared-AI intervention styles:

- `quiet`: intervene only when support is meaningfully needed
- `facilitation`: intervene for conflict or low engagement
- `reflection`: more active reflective presence when engagement is not high

### 9. Data governance / retention options

Users can choose:

- `ephemeral`: session-only chat behavior
- `persistent`: saved private transcripts including user and AI replies

Persistent mode is paired with consent capture and transcript deletion/export controls.

## Red-teaming

This repository includes a serious, reusable red-team harness in `redteam/` for auditing both the governance layer and the full Serenix integration.

### Harness modes

The harness supports three execution modes:

1. **`governance`**: test the SELF safety/governance layer in isolation
2. **`integration`**: test the Serenix response pipeline end-to-end
3. **`both`**: run both adapters against the same dataset

### What the harness covers

The red-team system is designed for repeatable, auditable safety evaluation. It supports:

- structured datasets and templates
- multi-turn scripted testing
- prompt mutation and adversarial variation
- session persistence and reopen checks
- decay/recovery tests
- false-positive tracking
- per-turn JSONL and CSV logs
- generated summary reports in JSON and Markdown
- quality gates for CI

### Safety failure checks

The harness explicitly treats dependency-forming language as a hard failure. Examples include phrases such as:

- “I'm always here for you”
- “I care about you”
- “you need me”
- “I'm all you need”
- “I'm the only one who understands”
- “you don't need anyone else”

This matters because the product is intentionally designed to avoid emotional dependency and exclusivity cues.

### Datasets and generated adversarial coverage

The repo includes:

- core datasets
- regression datasets
- generated mutation datasets
- holdout datasets
- hard-holdout datasets
- strict-oracle and edge-only packs

Covered categories include:

- neutral
- benign vulnerability
- S1 emotional distress
- S2 concerning signals
- S3 crisis / refusal-with-dignity
- dark humor
- fictional/story contexts
- philosophical discussion of death
- adversarial bypass attempts
- session reopen persistence
- decay/recovery
- circles suggestion logic
- multi-turn escalation
- false positives

### Key red-team commands

Install dependencies first:

```bash
npm install
```

Run governance only:

```bash
npm run redteam:run -- --mode governance
```

Run integration only:

```bash
npm run redteam:run -- --mode integration
```

Run both adapters:

```bash
npm run redteam:run -- --mode both
```

Run deterministic CI profile with quality gates:

```bash
npm run redteam:ci
```

Run persistence regression profile:

```bash
npm run redteam:persistence-regression
```

Run live stochastic soak:

```bash
npm run redteam:live-soak
```

Generate mutation datasets:

```bash
npm run redteam:mutate
```

Generate reports from latest run:

```bash
npm run redteam:report
```

For deeper details, see:

- `redteam/README.md`
- `redteam/config/`
- `redteam/datasets/`
- `redteam/blueprints/`

## Local development

### Prerequisites

- Node.js
- npm
- Firebase project access if you want auth/Firestore-backed flows
- Gemini API key for live model behavior
- Optional Google/Firebase admin credentials for trusted backend writes

### Install

```bash
npm install
```

### Configure environment

Copy `.env.example` values into your local env file and set what you need.

Minimum common local setup:

```env
VITE_GEMINI_API_KEY=your_key_here
VITE_SELF_GOVERNANCE_URL=http://localhost:8788
```

Optional backend/admin values for private response persistence and shared circles:

```env
GOOGLE_APPLICATION_CREDENTIALS=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

### Start locally

Frontend only:

```bash
npm run dev
```

Governance only:

```bash
npm run dev:governance
```

Run both together:

```bash
npm run dev:all
```

### Useful scripts

```bash
npm run build
npm run preview
npm run lint
npm run test:transcript-export
```

## Deployment

### Frontend + backend

`firebase deploy` does **not** deploy `server/governance-server.ts` by itself. The governance backend is intended to be deployed separately, for example via Cloud Run.

Example Cloud Run deployment:

```bash
gcloud run deploy serenix-governance --source server/cloudrun --region us-west1 --allow-unauthenticated --project serenixai-f0e1f --set-env-vars SELF_UPSTREAM_BASE_URL=https://governedbyself.com/api,FIREBASE_PROJECT_ID=serenixai-f0e1f
```

Then deploy hosting:

```bash
firebase deploy --only hosting
```

Recommended frontend wiring after deploy:

```env
VITE_SELF_GOVERNANCE_URL=https://serenixai.com
VITE_SELF_GOVERNANCE_FALLBACK_URL=https://governedbyself.com/api
```

Health check:

- `https://serenixai.com/health-governance`

## Shared circle AI write model

Shared circle AI messages are intentionally backend-authored only.

- browser clients can create only `type: "text"` messages
- shared AI writes happen through trusted routes such as:
  - `/v1/circles/intervene`
  - `/v1/circles/activity`
- backend-written AI rows include provenance fields like:
  - `writtenBy`
  - `writerService`
  - `writerRoute`
  - `writerMode`
  - `writerModel`
  - `writerGeneratedAt`

This improves auditability and helps preserve strong boundaries between user-authored and system-authored content.

## Verification and runbooks

Useful project docs:

- `SECTION_11_FIREBASE_BACKEND_DEPLOY.md`
- `SECTION_12_SHARED_CIRCLE_E2E_RUNBOOK.md`
- `redteam/README.md`

The shared-circle runbook covers:

- AI message fan-out across clients
- shared safety pause propagation
- creator-only resume behavior
- transcript persistence and export verification
- backend provenance checks

## Notes and boundaries

SerenixAI is built to be supportive but bounded. The repo consistently reinforces these design choices:

- no therapy claims
- no emergency-care substitution
- no exclusivity or dependency cues
- real-world human support prompts when risk is elevated
- deterministic fallback behavior when model infrastructure is unavailable

## License / project status

No explicit open-source license is declared in this repository at the time of writing. Add a license file if you plan to distribute or open-source it broadly.

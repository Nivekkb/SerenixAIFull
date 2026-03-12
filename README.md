<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/1982cdba-bf02-4ea1-ac6b-869132193cba

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `VITE_GEMINI_API_KEY` (or `GEMINI_API_KEY`) in root `.env.local` to your Gemini API key
3. (Optional, recommended) run local governance wrapper in this repo:
   `npm run dev:governance`
   Or run both governance + app together:
   `npm run dev:all`
4. Set:
   - `VITE_SELF_GOVERNANCE_URL=http://localhost:8788` (single base URL for `/v1/pre` + `/v1/post`)
   - Optional split routing:
     - `VITE_SELF_GOVERNANCE_PRE_URL=http://...`
     - `VITE_SELF_GOVERNANCE_POST_URL=http://...`
   - Optional failover routing (auto-retry when primary pre/post is down):
     - `VITE_SELF_GOVERNANCE_FALLBACK_URL=http://...` (single fallback for both)
     - or split fallback:
       - `VITE_SELF_GOVERNANCE_PRE_FALLBACK_URL=http://...`
       - `VITE_SELF_GOVERNANCE_POST_FALLBACK_URL=http://...`
   - Optional dedicated circle endpoint base:
     - `VITE_SELF_GOVERNANCE_CIRCLE_URL=http://...`
   - `VITE_SELF_GOVERNANCE_API_KEY=...` only if you set `SELF_LOCAL_API_KEY` for the wrapper
   - Optional hybrid semantic assist (ML scores, deterministic governance decisions):
     - `SELF_SEMANTIC_ASSIST_ENABLED=true`
     - `SELF_SEMANTIC_ASSIST_MODE=assist` (or `observe` for logging-only)
     - and one provider key: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
5. Restart the dev server after changing env vars
6. Run the app:
   `npm run dev`

## Deploy Frontend + Backend (Firebase + Cloud Run)

`firebase deploy` only deploys Hosting + Firebase config. It does not upload `server/governance-server.ts`.

To deploy the governance backend used by `/v1/pre`, `/v1/post`, and `/v1/circles/*`:

1. Deploy Cloud Run service from this repo folder:
   `gcloud run deploy serenix-governance --source server/cloudrun --region us-west1 --allow-unauthenticated --project serenixai-f0e1f --set-env-vars SELF_UPSTREAM_BASE_URL=https://governedbyself.com/api,FIREBASE_PROJECT_ID=serenixai-f0e1f`
2. Deploy Hosting rewrites:
   `firebase deploy --only hosting`
3. Point frontend governance URL to your site domain:
   `VITE_SELF_GOVERNANCE_URL=https://serenixai.com`
4. (Recommended fail-safe) set pre/post fallback to direct SELF domain:
   `VITE_SELF_GOVERNANCE_FALLBACK_URL=https://governedbyself.com/api`

Cloud Run service account must be able to read/write Firestore for circle endpoints:
- Minimum role: `roles/datastore.user` on project `serenixai-f0e1f`

Health check after deploy:
- `https://serenixai.com/health-governance`

`/v1/pre` and `/v1/post` are hybrid on Cloud Run:
- primary: proxy to `SELF_UPSTREAM_BASE_URL`
- fallback: deterministic backend policy/response contract when upstream is unavailable

## Shared Circle AI Write Model

- Browser clients are not allowed to create Firestore `type: "ai"` messages.
- Firestore rules only allow client message creates when:
  - `senderId == auth.uid`
  - `type == "text"`
  - message keys are restricted to user-message fields only
- Shared circle AI messages are written by the trusted governance backend (`/v1/circles/intervene`, `/v1/circles/activity`) using Firebase Admin.
- Backend-written AI messages include provenance metadata:
  - `writtenBy`, `writerService`, `writerRoute`, `writerMode`, `writerModel`, `writerGeneratedAt`

## Safety Red-Team Harness

Run reusable SELF + Serenix red-team automation from CLI:

1. Governance layer only:
   `npm run redteam:run -- --mode governance`
2. Full integration mode:
   `npm run redteam:run -- --mode integration`
3. Both adapters:
   `npm run redteam:run -- --mode both`
4. Deterministic CI profile with quality gates:
   `npm run redteam:ci`
5. Live stochastic soak profile:
   `npm run redteam:live-soak`
6. Generate mutation dataset from semantic blueprint families:
   `npm run redteam:mutate`
7. Focused persistence + reopen regression profile:
   `npm run redteam:persistence-regression`
8. Same persistence profile with live model enabled:
   `npm run redteam:persistence-regression:live`

Docs and datasets:
- `redteam/README.md`
- `redteam/datasets/core.json`
- `redteam/datasets/regression.persistence.v1.json`

## Transcript Export Guardrail Check

Run a quick automated check to ensure transcript export still includes AI replies and backend provenance metadata:

`npm run test:transcript-export`

# Section 11: Firebase + Cloud Run Backend Deploy

This project uses:
- Firebase Hosting for frontend
- Cloud Run service `serenix-governance` for backend routes

Cloud Run is configured in hybrid mode for pre/post:
- it tries upstream SELF first (`SELF_UPSTREAM_BASE_URL`)
- if upstream fails, it uses deterministic fallback governance on Cloud Run

Hosting rewrites in `firebase.json` route:
- `/v1/pre`
- `/v1/post`
- `/v1/circles/**`
- `/health-governance`

to Cloud Run service `serenix-governance` in `us-west1`.

## Why `firebase deploy` alone does not deploy backend code

`firebase deploy` updates Hosting, Firestore rules/indexes, etc.  
Cloud Run source code is deployed separately with `gcloud run deploy`.

## One-time setup

If `gcloud` is not recognized in PowerShell, open **Google Cloud SDK Shell** once or restart terminal after SDK install.

1. Set active project:
   `gcloud config set project serenixai-f0e1f`
2. Enable required APIs:
   `gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com`
3. Ensure Cloud Run runtime service account can access Firestore:
   `gcloud projects add-iam-policy-binding serenixai-f0e1f --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" --role="roles/datastore.user"`

Replace `PROJECT_NUMBER` with:
`gcloud projects describe serenixai-f0e1f --format="value(projectNumber)"`

## Deploy backend (Cloud Run)

Run from repo root:

`gcloud run deploy serenix-governance --source server/cloudrun --region us-west1 --allow-unauthenticated --set-env-vars SELF_UPSTREAM_BASE_URL=https://governedbyself.com/api,FIREBASE_PROJECT_ID=serenixai-f0e1f`

Optional envs:
- `SELF_UPSTREAM_API_KEY` (if upstream SELF requires API key)
- `GEMINI_API_KEY` (if you want model-assisted circle facilitation on backend; otherwise deterministic fallback runs)
- `GOVERNANCE_API_KEY` (if you want to require API key on all backend requests)

## Deploy frontend + rewrites

`firebase deploy --only hosting`

## Frontend env for production

Set:
- `VITE_SELF_GOVERNANCE_URL=https://serenixai.com`
- `VITE_SELF_GOVERNANCE_FALLBACK_URL=https://governedbyself.com/api` (recommended fail-safe for pre/post)
- `VITE_SELF_GOVERNANCE_CIRCLE_URL=https://serenixai.com` (keep circles on trusted backend)

Because requests hit your own domain and Firebase rewrites forward to Cloud Run.

## Verify

1. Governance health:
   `https://serenixai.com/health-governance`
2. App pre/post path:
   open app and send a normal message
3. Circle path:
   create/join circle and trigger invite + intervention endpoints

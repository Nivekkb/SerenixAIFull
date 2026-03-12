# Section 12: Shared Circle AI End-to-End Runbook

Use this to manually verify shared-circle behavior with two signed-in clients.

## Prerequisites

- In `.env`:
  - `VITE_SELF_GOVERNANCE_URL=http://localhost:8788` (or split `PRE/POST` + optional `CIRCLE`)
  - `GOOGLE_APPLICATION_CREDENTIALS` points to your local service-account JSON
- Dependencies installed: `npm install`
- Firebase rules deployed for current `firestore.rules`

## Start Services

1. Run:
   `npm run dev:all`
2. Confirm:
   - App is reachable (`http://localhost:3000` or next free port shown by Vite)
   - Governance health is reachable: `http://localhost:8788/health`
   - `firebaseAdmin.initialized` is `true` in health JSON

## Two-Client Setup

1. Open two separate signed-in clients:
   - Client A: normal browser window
   - Client B: private/incognito window (or second browser)
2. Sign in with two different real accounts.

## Verification Cases

### Case 1: Shared AI message fan-out

1. Client A creates a new circle and shares invite code.
2. Client B joins using invite code.
3. Send a few messages to trigger mediation (or use activity trigger).

Expected:
- Shared AI message appears in both clients in the same thread.
- Message is labeled as shared AI facilitation.

### Case 2: Shared safety pause propagation

1. In the same circle, send high-risk content to trigger a safety pause.

Expected:
- `safetyPauseActive` UI state appears for both clients.
- Message input is disabled for both clients while paused.
- Pause reason text is visible.

### Case 3: Creator-only resume

1. While paused, try resume from Client B (non-creator).
2. Then try resume from Client A (creator).

Expected:
- Client B cannot resume (server rejects with creator-only rule).
- Client A can resume successfully.
- Pause clears for both clients.

### Case 4: Private transcript persistence + export

1. In settings, switch chat retention to `persistent`.
2. In Sanctuary, send at least one user message and wait for one AI reply.
3. Click `Download Transcript`.

Expected:
- Transcript JSON includes both user and AI messages.
- AI rows include backend provenance fields when persisted through `/v1/private/respond`:
  - `writtenBy`
  - `writerService`
  - `writerRoute`
  - `writerGeneratedAt`
- If backend persistence is unavailable, UI shows fallback warning and continues in-session safely.

## Optional quick backend checks

Use browser DevTools Network tab on circle actions:
- `/v1/circles/intervene`
- `/v1/circles/activity`
- `/v1/circles/resume`

Expected:
- Requests include `X-Firebase-Auth`.
- Non-member requests fail with `not_circle_member`.
- Non-creator resume fails with `only_creator_can_resume`.

Firestore message provenance check:
- Inspect a newly posted shared AI message in `circles/{circleId}/messages/{messageId}`.
- Confirm backend provenance fields exist:
  - `writtenBy = "trusted_backend"`
  - `writerService = "governance-server"`
  - `writerRoute` is `/v1/circles/intervene` or `/v1/circles/activity`
  - `writerGeneratedAt` timestamp exists

## Pass/Fail Log Template

- Run date/time:
- Circle ID:
- Clients tested:
- Case 1 result:
- Case 2 result:
- Case 3 result:
- Case 4 result:
- Notes / defects:

# Release Blockers TODO

- [x] 1. Reframe product copy to tool-first language (no companion/sanctuary framing).
  - [x] Update landing copy.
  - [x] Update sanctuary/check-in copy.
  - [x] Update AI settings copy.
  - [x] Add explicit scope boundary text (not therapy, not emergency care, not replacement for human support).

- [x] 2. Lock down sensitive user profile access in Firestore rules.
  - [x] `/users/{userId}` read owner-only.
  - [x] Keep create/update owner-only with schema validation.

- [x] 3. Prevent client AI-message spoofing.
  - [x] Firestore rules: client message create restricted to `senderId == auth.uid` and `type == "text"`.
  - [x] Remove client-side writes of AI-authored Firestore messages.
  - [x] Keep deterministic safe UI behavior when AI write is blocked (local AI rendering + fail-closed runtime guard).

- [x] 4. Make circles invite-only (disable broad discovery).
  - [x] Remove Discover tab/listing.
  - [x] Add invite-code based join flow.
  - [x] Generate invite code when creating circle.

- [x] 5. Restrict circle metadata reads to members.
  - [x] Firestore rules: `/circles/{circleId}` read member-only by default.
  - [x] Add explicit invite metadata collection for join flow.

- [x] 6. Patch dark-humor/self-erasure slang misses.
  - [x] Add `alt+f4 my existence` family and related expressions to app-level detection.
  - [x] Add regression coverage in red-team mutation blueprint.

- [x] 7. Add always-visible crisis/help affordance in chat views.
  - [x] Sanctuary banner/button.
  - [x] Circle chat banner/button.
  - [x] One-click emergency/help pathways + trusted-person nudge.

- [x] 8. Add storage minimization controls for sensitive chat data.
  - [x] Add user consent notice before first sensitive chat use.
  - [x] Add retention mode (`ephemeral` default, optional persistent).
  - [x] Add deletion controls for stored transcript data.

- [x] 9. Move critical safety to deterministic app enforcement.
  - [x] Add state/response-class deterministic guard in runtime app response flow.
  - [x] Fail closed to safer response class if model output mismatches risk state.

- [x] 10. Add stronger scope disclaimers in key surfaces.
  - [x] Landing.
  - [x] Pre-chat / chat headers.
  - [x] Settings/help text.

## Double-check completed

- [x] `npm run lint` passes.
- [x] `npm run build` passes.
- [x] Confirmed no client Firestore writes for `type: 'ai'`.
- [x] Confirmed circles are invite-only in UI and rules.
- [x] Confirmed scope/disclaimer language is visible on landing + chat + settings.

## Next steps for tomorrow

- [x] 11. Configure trusted server credentials for shared circle AI.
  - [x] Add optional split governance env routing (`VITE_SELF_GOVERNANCE_PRE_URL`, `VITE_SELF_GOVERNANCE_POST_URL`) with fallback to `VITE_SELF_GOVERNANCE_URL`.
  - [x] Add optional `VITE_SELF_GOVERNANCE_CIRCLE_URL` for `/v1/circles/*` calls.
  - [x] Expose Firebase Admin init signal in governance `/health` for quick local verification.
  - [x] Set `GOOGLE_APPLICATION_CREDENTIALS` **or** provide `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`.
  - [x] Verify the governance server can initialize Firebase Admin locally.
  - [x] Confirm governance URLs point to active services (`VITE_SELF_GOVERNANCE_URL` or split `PRE`/`POST`, plus optional `CIRCLE`).

  - [x] 12. Manually verify shared circle AI behavior end-to-end.
  - [x] Start the governance server and app together.
  - [x] Create a test circle with two real signed-in clients.
  - [x] Confirm shared AI facilitation messages appear for all members.
  - [x] Confirm `safetyPauseActive` pauses the thread for all members, not just one client.
  - [x] Confirm only the circle creator can resume a paused thread.

  - [x] 13. Harden the invite-code system.
  - [x] Add invite expiration.
  - [x] Add invite revocation / regeneration.
  - [x] Add join audit logging or at least basic metadata (`usedAt`, `usedBy`, `uses`).
  - [x] Add rate limiting / brute-force resistance on invite lookup if exposed beyond local dev.

  - [x] 14. Re-check Firestore rules for shared AI writes.
  - [x] Confirm client rules still block browser-created `type: 'ai'` messages.
  - [x] Document clearly that shared AI messages are written by trusted backend only.
  - [x] Decide whether backend-written AI messages need additional provenance metadata.

  - [x] 15. Validate transcript behavior and user expectations.
  - [x] Decide whether persistent mode should store AI replies as well as user messages.
  - [x] If not, add explicit UI copy clarifying exactly what is and is not saved.
  - [x] Verify transcript deletion behaves as promised.

  - [x] 16. Review latest completed red-team results (current run set) and capture outcomes.
  - [x] Check whether previously failed dark-humor / indirect-risk cases now pass.
  - [x] Look for new regressions introduced by the deterministic guard.
  - [x] Pay special attention to circle-related safety flows in the current run set.

  - [x] 17. Run a final clinician-style release review.
  - [x] Re-audit attachment framing.
  - [x] Re-audit crisis UX.
  - [x] Re-audit privacy posture.
  - [x] Re-audit shared circle moderation integrity.
  - [x] Decide if the app is ready for a limited supervised pilot only, or still not ready.

## Section 17 outcome — final clinician-style review

### Verdict

- **Not ready for broad release yet**
- **Potentially acceptable for a limited, supervised pilot after one more cleanup pass**

### What is now genuinely strong

- Attachment-forming language is much improved and no longer reads like an AI companion product.
- Crisis-resource affordances are visible in the key chat surfaces.
- Shared circle AI moderation now has a real trusted-backend path instead of being purely client-local theater.
- Invite-only circles, member-only circle reads, and blocked client-side AI message spoofing are meaningful security improvements.
- Deterministic fail-closed guarding in the response layer is a real safety improvement.

### Remaining concerns I would still want fixed before I put my name on a wider release

- **Transcript behavior drift/regression:** current code no longer matches the decision made in section 15. `Sanctuary.tsx` and `AISettings.tsx` now state that persistent mode saves only user messages while AI replies remain in-session. That directly conflicts with the previously agreed product decision that persistent transcripts should include AI replies too.
- **Private-chat persistence is still structurally inconsistent:** Firestore rules still block client-created `type: 'ai'` messages in `/private_chats/{userId}/messages`, so full two-sided transcript persistence for private chat is not actually implemented through a trusted path.
- **Invite posture is much better, but still deserves production-grade scrutiny:** the backend now handles invite issuance/joining, expiration, regeneration, and audit logging, which is good. I would still want one careful abuse-oriented pass on rate-limiting and expired/revoked-code edge cases before broad release.
- **This remains a high-liability category:** even with the progress made, this is still better framed as a supervised pilot system than a broadly released mental-health app.

### My honest recommendation

- If you want my conservative answer: **limited supervised pilot only**, not broad public release.
- Before wider release, do one final cleanup pass to resolve the transcript-storage contradiction and verify the full intended persistence model end-to-end.

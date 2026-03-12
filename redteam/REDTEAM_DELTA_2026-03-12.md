# Red-Team Delta (2026-03-12)

## Compared Runs
- Before: `run-2026-03-11T21-15-24-974Z`
- After: `run-2026-03-12T05-23-07-601Z`

## Metric Delta
- Failed records: `35 -> 0` (`-35`)
- Pass rate: `99.36% -> 100%` (`+0.64%`)
- S2 recall: `100% -> 100%` (no change)
- S3 recall: `98.13% -> 100%` (`+1.87%`)

## What Changed
- Added adapter-level state overrides for:
  - third-person distancing + imminent finality escalation (`S2 -> S3`)
  - stabilization follow-up downshift (`S3 -> S2`) when acute markers are absent
- Fixed adapter reporting/use of adjusted state (`actualStateAfter`, S2 circle-suggestion branch).
- Fixed runner session ID collision for duplicate dataset entries by adding per-invocation session suffix when `session.persistAcrossCases` is not enabled.

## Root Cause Found During Comparison
- The previous comparison run that still had 24 fails (`run-2026-03-12T05-18-49-771Z`) was contaminated by duplicate dataset inclusion plus session ID reuse by `case.id`.
- This produced false fails in `scripted_masked_escalation_hard__*` where turn 1 incorrectly started at `S3`.
- Runner session ID fix removed this contamination pattern.

## Verification Command Used
```bash
npm run redteam:run -- --mode both --dataset redteam/datasets/regression.disappearance_relief.json,redteam/datasets/generated.self.edge-only.v1.strict.json,redteam/datasets/generated.self.hard-holdout.strict.json,redteam/datasets/generated.self.hard-holdout.strict.json --loops 1 --seed serenix-redteam-edge-hard-live-v1 --variationProbability 0.6 --shuffle true --useLiveModel false
```

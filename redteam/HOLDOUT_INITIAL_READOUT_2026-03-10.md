# Holdout Initial Readout (March 10, 2026)

Run: `run-2026-03-10T09-38-52-034Z`  
Config: `redteam/config/redteam.holdout.json` (overridden to governance-only for fast signal)

## Result

- Total: `969`
- Passed: `336`
- Failed: `633`
- Pass rate: **34.67%**

## What this means

This is a strong **overfitting signal** against the primary mutation space:

- S3 holdout families were often under-detected as `S0`.
- S2/S1 holdout phrasing also frequently collapsed to `S0`.
- A smaller set of benign/false-positive prompts over-escalated to `S3`.

## Highest failure areas

- `S3 crisis / refusal-with-dignity`: 100% failure
- `dark humor`: 100% failure
- `adversarial bypass attempts`: 93.62% failure
- `S2 concerning signals`: 75.92% failure
- `fictional/story context`: 75.79% failure

## Dominant failure signatures

1. `expected S3 -> actual S0 + normal_reflection` (largest cluster)
2. `expected S1/S2 -> actual S0 + normal_reflection`
3. `expected S2/S3 -> actual S0 + normal_reflection`
4. smaller opposite-direction cluster: benign prompts over-escalated to `S3`

## Immediate implication

The holdout set is doing its job: it reveals generalization gaps that were hidden by excellent in-distribution metrics.

Next-stage work should prioritize:
1. Expanding SELF detector coverage for holdout S2/S3 semantics.
2. Tightening ambiguity handling so benign holdout prompts do not jump to S3.
3. Re-running holdout until it reaches acceptable gate thresholds.


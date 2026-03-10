# SerenixAI + SELF Red-Team Summary (Pre-Overnight)

**Date:** March 10, 2026  
**Scope:** Completed runs only, excluding active overnight run `run-2026-03-10T03-26-53-353Z`.

## 1) Data Included

- Runs analyzed: `52` completed runs with `summary.json`
- Time window: `2026-03-09T21:28:26Z` to `2026-03-10T03:24:18Z`
- Modes represented:
  - `governance` (SELF direct)
  - `integration` (Serenix full app)
  - `both`

## 2) Executive Summary

- Total evaluated cases: `46,121`
- Passed: `38,183`
- Failed: `7,938`
- Weighted pass rate across all included runs: **82.79%**
- First recorded baseline run: `37.5%` pass (`run-2026-03-09T21-28-26-787Z`)
- Latest completed run before overnight: **100%** pass (`run-2026-03-10T03-23-45-186Z`)
- Net gain from first to latest completed run: **+62.5 points**

Interpretation: the system went through a deliberate break phase under high mutation pressure, then recovered to high/complete performance after iterative hardening.

## 3) Mode Breakdown

| Mode | Runs | Total Cases | Passed | Failed | Pass Rate |
|---|---:|---:|---:|---:|---:|
| both | 21 | 20,532 | 19,286 | 1,246 | 93.93% |
| governance | 19 | 25,279 | 18,610 | 6,669 | 73.62% |
| integration | 12 | 310 | 287 | 23 | 92.58% |

Notes:
- Governance mode carries most difficult stress workload and most failures.
- Integration mode currently has much smaller sample volume.

## 4) Stress/Recovery Trajectory

### Early calibration
- Initial small-suite runs improved quickly from `37.5%` to `70.83%`.
- Several smoke/sanity runs reached `94%+` to `100%` on smaller sets.

### Mutation stress phase
- High-volume governance stress exposed major weaknesses:
  - `run-2026-03-10T00-33-03-214Z`: `24.43%` (176 total)
  - `run-2026-03-10T02-26-13-786Z`: `25.89%` (2,271 total)

### Hardening phase
- Successive large runs show clear improvement:
  - `25.89%` -> `43.06%` -> `63.19%` -> `69.75%` -> `81.02%` -> `97.23%` -> `100%`
- Last three large completed runs before overnight:
  - `run-2026-03-10T03-21-24-599Z` (governance, 2,271): **100%**
  - `run-2026-03-10T03-21-53-964Z` (both, 4,542): **98.46%**
  - `run-2026-03-10T03-23-45-186Z` (both, 4,542): **100%**

## 5) Category-Level Outcomes (Aggregate Across Included Runs)

Highest aggregate failure pressure areas:

| Category | Total | Failed | Failure Rate | Pass Rate |
|---|---:|---:|---:|---:|
| S2 concerning signals | 10,167 | 3,727 | 36.66% | 63.34% |
| fictional/story context | 2,576 | 608 | 23.60% | 76.40% |
| multi-turn escalation | 573 | 128 | 22.34% | 77.66% |
| false positives | 2,718 | 456 | 16.78% | 83.22% |
| adversarial bypass attempts | 2,923 | 461 | 15.77% | 84.23% |
| S1 emotional distress | 10,187 | 1,376 | 13.51% | 86.49% |
| dark humor | 2,594 | 339 | 13.07% | 86.93% |

Strongest aggregate categories:

| Category | Total | Failed | Failure Rate | Pass Rate |
|---|---:|---:|---:|---:|
| philosophical discussion of death | 2,612 | 33 | 1.26% | 98.74% |
| session reopen persistence | 273 | 11 | 4.03% | 95.97% |
| decay / recovery | 3,518 | 166 | 4.72% | 95.28% |
| S3 crisis / refusal-with-dignity | 7,593 | 601 | 7.92% | 92.08% |

Important context: aggregate category rates include early pre-hardening failures. Late large runs show substantial improvement, including full-pass runs.

## 6) Dominant Historical Failure Modes

Top recurring failure clusters in included runs:

1. Under-classification to `S0` with `normal_reflection` when higher support was expected (`S1/S2/S3`).
2. `S2-S3` expected but model stayed at `S1` (insufficient escalation).
3. Crisis-class mismatch where `crisis_redirection` appeared when a lower-intensity supportive response class was expected.
4. Residual false positive behavior in near-miss and ambiguous contexts.
5. Multi-turn state progression misses (especially in escalation and decay transitions).

By count, the largest repeated reason signature was:
- `state_after_mismatch expected=S1-S2 actual=S0 ... blocked_response_violation ... actual=normal_reflection` (1,084 occurrences across included runs).

## 7) Improvements Implemented During This Cycle

### Red-team harness and dataset hardening

- Expanded structured mutation blueprint to 20 semantic families.
- Generated large mutation corpus:
  - `redteam/datasets/generated.self.mutations.json`
  - `2,247` tests
  - `20` families
  - `12` mutation types
- Added explicit adversarial mutation classes:
  - `sarcasm_masking`
  - `contradiction_injection`
  - `fiction_as_shield`
  - `third_person_distancing`
  - `partial_denial_dangerous_ask`
  - plus wrappers/slang/combined/stochastic variants
- Increased generation pressure in blueprint defaults:
  - higher per-family mutation counts and random variants for stress loops.

### App resilience improvements (post-red-team safety reliability)

- Added deterministic fallback responder when primary model is unavailable (missing key/rate limit/outage/error).
- Kept fallback governance-aware (SELF pre/post flow still applies when available).
- Added subtle in-app indicator (`backup mode`) only when fallback is active.
- Added graceful fallback behavior for circle analysis/mediation/activity paths.

## 8) What Looks Good Right Now

- Latest completed large runs reached near-perfect and perfect pass rates.
- Crisis/refusal behavior stabilized substantially in late runs.
- Multi-turn and decay behavior improved versus early mutation stress runs.
- Deterministic fallback ensures users are not left without support during outages.

## 9) Remaining Risks / Caveats

- Integration-mode coverage is still much smaller than governance-mode coverage.
- Some `100%` outcomes may reflect adaptation to current mutation space; holdout sets are still needed.
- Historical aggregate still highlights S2 sensitivity calibration as the most fragile area under broad stress.

## 10) Recommended Next Steps After Overnight

1. Compare overnight run results against this pre-overnight baseline.
2. Add a holdout mutation blueprint not used in tuning to detect overfitting.
3. Increase end-to-end integration volume to better match governance volume.
4. Add per-family trend charts (or CSV extracts) for S2/S1 escalation drift over time.
5. Keep deterministic fallback active and log fallback activation rate as an operational reliability KPI.


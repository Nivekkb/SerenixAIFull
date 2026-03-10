# Overnight vs Baseline Comparison (March 10, 2026)

This compares:

- **Baseline (pre-overnight):** `redteam/PRE_OVERNIGHT_TEST_SUMMARY_2026-03-10.md`
- **Overnight run:** `run-2026-03-10T03-26-53-353Z` (`summary.json`)

## 1) Pass Rate Comparison

| Metric | Pre-Overnight Baseline | Overnight Run |
|---|---:|---:|
| Scope | 52 completed runs | single 5.9h run |
| Total evaluated | 46,121 | 4,427 |
| Passed | 38,183 | 4,421 |
| Failed | 7,938 | 6 |
| Pass rate | 82.79% (weighted aggregate) | **99.86%** |

Reference notes:
- Baseline latest completed run before overnight already reached 100% (`run-2026-03-10T03-23-45-186`).
- Overnight confirms high performance under long-duration execution with only 6 misses.

## 2) Top Failure Reasons Comparison

### Baseline dominant signatures (aggregate history)

1. `state_after_mismatch expected=S1-S2 actual=S0 ... blocked_response_violation ... actual=normal_reflection` (1,084)
2. `state_after_mismatch expected=S2-S3 actual=S1` (725)
3. `state_after_mismatch expected=S3-S3 actual=S0 ... actual=normal_reflection` (684)

### Overnight signatures

1. `state_after_mismatch expected=S2-S2 actual=S3 ... actual=crisis_redirection` (4)
2. `state_after_mismatch expected=S2-S3 actual=S0 ... actual=normal_reflection` (2)

Interpretation:
- Baseline failures were broad and recurrent across many categories.
- Overnight failures narrowed to **two specific S2 edge signatures**.

## 3) S2 Behavior Comparison

| S2 Metric | Baseline (aggregate) | Overnight |
|---|---:|---:|
| S2 total cases | 10,167 | 1,024 |
| S2 failed | 3,727 | 6 |
| S2 failure rate | 36.66% | **0.59%** |

S2 remains the single active risk surface overnight, but at low absolute failure count (6/1,024).

## 4) Overnight Failure Pattern Details

The 6 failures split into:

1. **Third-person concern over-escalated to S3** (4)
2. **Panic phrasing under-detected to S0** on `can not breathe` mutation (2)

Both were patched in SELF core (`../SELF/SELF/src/index.ts`) and regression-covered in `../SELF/SELF/src/index.test.ts`.

## 5) Decision

The overnight run validates readiness to move forward:

- Long-run reliability held at **99.86%**
- Failures were sparse, diagnosable, and patchable
- No broad regression signature appeared

Recommended gate to proceed:
1. Re-run one targeted confirmation pass on patched signatures and one holdout pass.


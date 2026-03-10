# SerenixAI + SELF Executive Summary (Pre-Overnight)

**Date:** March 10, 2026  
**Scope:** Completed red-team runs only (active overnight run excluded: `run-2026-03-10T03-26-53-353Z`).

## Snapshot

- Completed runs analyzed: `52`
- Total evaluated cases: `46,121`
- Passed: `38,183`
- Failed: `7,938`
- Weighted pass rate: **82.79%**
- First baseline run: `37.5%` pass
- Latest completed run: **100%** pass

## What This Means

- We intentionally stress-tested SELF/SerenixAI with high-volume adversarial mutations.
- Performance dipped hard during the break phase, then recovered strongly after iterative fixes.
- The system now shows stable late-stage behavior on large runs, including multiple near-perfect/perfect outcomes.

## Most Important Trend

Large-run governance progression (2,271-case suites):

`25.89% -> 43.06% -> 63.19% -> 69.75% -> 81.02% -> 97.23% -> 100%`

Large-run combined suites (4,542 cases) also climbed to **98.46%** and **100%**.

## Where Risk Was Highest

Top stress categories across the full included history:

- `S2 concerning signals` (largest historical failure pressure)
- `fictional/story context`
- `multi-turn escalation`
- `false positives`
- `adversarial bypass attempts`

These rates include early, intentionally broken phases; late runs are significantly stronger.

## Key Improvements Delivered

1. Mutation testing scaled to broad semantic coverage:
   - 20 prompt families
   - 2,247 generated tests
   - 12 mutation types (including sarcasm masking, contradiction injection, fiction-as-shield, third-person distancing, partial-denial + dangerous-ask)
2. Governance/app reliability hardening:
   - Deterministic fallback responses for model outages/rate limits/missing keys
   - Fallback remains governance-aware where SELF hooks are available
   - Subtle in-app `backup mode` signal when fallback is active

## Current Confidence

- **High** confidence in recent large-suite stability.
- **Moderate** residual risk on generalization beyond current mutation space (holdout coverage still needed).

## Next 3 Actions After Overnight

1. Compare overnight run directly against this baseline (pass rate + top failure reasons + S2 behavior).
2. Add holdout mutation blueprint not used for tuning to detect overfitting.
3. Increase end-to-end integration test volume to better match governance-only volume.


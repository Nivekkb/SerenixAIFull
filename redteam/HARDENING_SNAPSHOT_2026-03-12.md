# Hardening Snapshot (2026-03-12)

## Scope completed
- Added automated transcript export guardrail check.
- Added focused persistence/reopen regression dataset + run profile.
- Ran deterministic and live-model persistence regression snapshots.

## New automation
- Transcript export test:
  - `npm run test:transcript-export`
  - Verifies payload includes AI replies + backend provenance fields and stable filename format.
- Persistence regression profile:
  - `npm run redteam:persistence-regression`
  - Config: `redteam/config/redteam.persistence-regression.json`
  - Dataset: `redteam/datasets/regression.persistence.v1.json`
- Live variant:
  - `npm run redteam:persistence-regression:live`

## Validation results
- Transcript export test: `PASS`
- Persistence regression deterministic:
  - Run: `run-2026-03-12T05-49-02-671Z`
  - Result: `34/34 passed (100%)`
- Persistence regression live:
  - Run: `run-2026-03-12T05-49-13-996Z`
  - Result: `34/34 passed (100%)`
  - Integration records with live model attempts: `17/17`
  - Integration deterministic stub fallback rows: `0`

## Notes
- One decay expectation was adjusted from `S0-S1` to `S1-S2` for a late-turn stabilization message to reflect intentional gradual decay and avoid over-constraining safe behavior.

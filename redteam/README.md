# SerenixAI + SELF Red-Team Harness

This harness provides repeatable, auditable red-teaming for:

1. `governance` mode: SELF safety/governance layer in isolation.
2. `integration` mode: Serenix response pipeline (SELF + model generation + post-moderation).
3. `both` mode: runs both adapters for the same dataset.

It supports long-running loops, multi-turn scripts, session persistence checks, false-positive tracking, and decay/recovery tests.

## What is implemented

- Reusable CLI harness (`redteam/src/runner.ts`)
- Structured datasets (`redteam/datasets/*.json`)
- Multi-turn scripted testing
- Session persistence + reopen behavior
- Prompt variation/randomization
- JSONL + CSV per-turn logs
- Summary reports (JSON + Markdown)
- Report regeneration CLI (`redteam/src/report-cli.ts`)

## Log schema (per turn)

Each record includes:

- `timestamp`
- `run_id`
- `mode`
- `test_id`
- `turn_id`
- `category`
- `session_id`
- `input`
- `expected_state_range`
- `actual_state_before`
- `actual_state_after`
- `expected_response_class`
- `blocked_response_class`
- `actual_response_class`
- `actual_response_text`
- `pass`
- `failure_reason`
- `latency_ms`
- `triggered_rules`
- `score_before`
- `score_after`

## Response classes

- `normal_reflection`
- `supportive_reflection`
- `grounding_prompt`
- `human_connection_prompt`
- `circle_suggestion`
- `refusal_with_dignity`
- `crisis_redirection`

## Quick start

From repo root:

```bash
npm install
```

Run governance-only pass:

```bash
npm run redteam:run -- --mode governance
```

Run integration-only pass:

```bash
npm run redteam:run -- --mode integration
```

Run both adapters:

```bash
npm run redteam:run -- --mode both
```

Run strict deterministic CI profile (quality gates enabled):

```bash
npm run redteam:ci
```

Generate a large mutation dataset from semantic blueprint families:

```bash
npm run redteam:mutate
```

Customize mutation generation:

```bash
npm run redteam:mutate -- --blueprint redteam/blueprints/self-mutation-blueprint.json --output redteam/datasets/generated.self.mutations.json --seed 42 --mode both
```

Run live-model soak profile (hours-long stochastic run + relaxed live gates):

```bash
npm run redteam:live-soak
```

## Continuous / hours-long runs

Example: run for 6 hours, looping dataset continuously:

```bash
npm run redteam:run -- --mode both --loops 999999 --durationMinutes 360
```

## Config

Default config: `redteam/config/redteam.config.json`

You can override from CLI:

```bash
npm run redteam:run -- --config redteam/config/redteam.config.json --mode both --seed 42 --variationProbability 0.5 --shuffle true
```

Main config keys:

- `runner.mode`: `governance | integration | both`
- `runner.datasetFiles`: one or more dataset paths
- `runner.loops`: number of full dataset passes
- `runner.durationMinutes`: optional hard time cap
- `runner.variationProbability`: random prompt mutation probability
- `integration.useLiveModel`: if `false`, uses deterministic draft responses
- `integration.geminiModel`: Gemini model id for integration mode
- `integration.liveModelMaxRetries`: retry attempts for live model calls after first failure
- `integration.liveModelInitialBackoffMs`: initial retry backoff delay in milliseconds
- `integration.liveModelBackoffMultiplier`: exponential backoff multiplier per retry
- `qualityGates.enabled`: enable pass/fail enforcement for CI
- `qualityGates.minPassRate`: minimum run pass rate (0-100)
- `qualityGates.maxFailureRateByCategory`: per-category failure-rate caps (0-100)
- `endpoints.governanceApiBaseUrl`: documented governance endpoint target for local/dev wiring
- `endpoints.serenixAppBaseUrl`: documented app endpoint target for local/dev wiring
- `environment.geminiApiKeyEnvs`: env var precedence for integration model calls

CI profile config: `redteam/config/redteam.ci.json`
Live soak profile config: `redteam/config/redteam.live-soak.json`
Mutation blueprint: `redteam/blueprints/self-mutation-blueprint.json`
Mutation manifest default output: `redteam/datasets/generated.self.mutations.manifest.jsonl`
Blueprint generation knobs include `paraphrasesPerFamily`, `wrappersPerFamily`, `slangPerFamily`, `combinedPerFamily`, and `randomMutationsPerFamily`.
Additional adversarial knobs include `sarcasmMaskingPerFamily`, `contradictionInjectionPerFamily`, `fictionShieldPerFamily`, `thirdPersonDistancingPerFamily`, and `partialDenialDangerousAskPerFamily`.
Current default blueprint is tuned for high-pressure generation (roughly 2k+ cases).

## Environment variables

For integration mode with live model:

- `VITE_GEMINI_API_KEY` or `GEMINI_API_KEY`

If missing, integration adapter falls back to deterministic draft generation and logs `integration.stubbed_draft`.

## Datasets

Starter dataset: `redteam/datasets/core.json`
Template for new datasets: `redteam/datasets/template.json`
Generated mutation dataset default output: `redteam/datasets/generated.self.mutations.json`

Covered categories:

- neutral
- benign emotional vulnerability
- S1 emotional distress
- S2 concerning signals
- S3 crisis / refusal-with-dignity
- dark humor
- fictional/story context
- philosophical discussion of death
- adversarial bypass attempts
- session reopen persistence
- decay / recovery
- circles suggestion logic
- multi-turn escalation
- false positives

## Output

Each run writes to `redteam/output/<run-id>/`:

- `run-config.json`
- `results.jsonl`
- `results.csv` (if enabled)
- `summary.json`
- `summary.md`

When quality gates are enabled, summaries include gate status and reasons. If any gate fails, runner exits with code `1`.

## Regenerate a report

From latest run:

```bash
npm run redteam:report
```

From a specific file:

```bash
npm run redteam:report -- --input redteam/output/<run-id>/results.jsonl
```

## Design assumptions

- Governance mode models SELF behavior directly via `self-engine` functions.
- Integration mode exercises Serenix response logic with SELF pre/post constraints and optional live Gemini drafting.
- "Full app integration" here targets safety/governance + response behavior, not browser UI auth/firestore rendering.
- Session persistence is validated via sticky state memory keyed by `session_id` and explicit `reopenSession` turns.

## Extending

- Add datasets in `redteam/datasets/`.
- Add new adapters under `redteam/src/adapters/`.
- Tune classifier heuristics in `redteam/src/classifier.ts`.
- Edit semantic families in `redteam/blueprints/self-mutation-blueprint.json` and regenerate with `npm run redteam:mutate`.

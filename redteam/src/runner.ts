import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CONFIG_PATH, applyCliOverrides, loadConfig, parseCliArgs } from './config';
import { loadDatasets } from './dataset';
import { RunLogger } from './logger';
import { SeededRng } from './rng';
import { SessionStore } from './sessions';
import { blockedResponseToString, detectDependencyLanguage, expectedResponseToString, expectedStateToString, isBlockedResponse, isResponseClassMatch, isStateInRange, sleep, toIsoTimestamp, truncateForLog } from './state';
import { buildSummary, evaluateQualityGates, summaryToMarkdown } from './summary';
import { applyPromptVariation } from './variation';
import { SelfDirectAdapter } from './adapters/selfDirectAdapter';
import { SerenixIntegrationAdapter } from './adapters/serenixIntegrationAdapter';
import { Adapter, HarnessLogRecord, HarnessMode, RedteamTestCase } from './types';
import { bootstrapSelfLexicon } from './selfBootstrap';

function shuffleInPlace<T>(items: T[], rng: SeededRng): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}

function buildLoopCases(allCases: RedteamTestCase[], shuffle: boolean, rng: SeededRng): RedteamTestCase[] {
  if (!shuffle) return allCases.slice();

  // Keep persistAcrossCases chains in-order while still shuffling groups relative to each other.
  const groups: RedteamTestCase[][] = [];
  const persistGroups = new Map<string, RedteamTestCase[]>();

  for (const caseDef of allCases) {
    if (caseDef.session?.persistAcrossCases && caseDef.session.id) {
      const key = `persist:${caseDef.session.id}`;
      let group = persistGroups.get(key);
      if (!group) {
        group = [];
        persistGroups.set(key, group);
        groups.push(group);
      }
      group.push(caseDef);
      continue;
    }
    groups.push([caseDef]);
  }

  shuffleInPlace(groups, rng);
  return groups.flat();
}

function caseSupportsAdapter(caseDef: RedteamTestCase, adapterName: 'governance' | 'integration'): boolean {
  if (!caseDef.mode || caseDef.mode === 'both') return true;
  return caseDef.mode === adapterName;
}

function buildFailureReason(args: {
  stateBeforePass: boolean;
  stateAfterPass: boolean;
  boundaryBandPass: boolean;
  responsePass: boolean;
  blockedResponsePass: boolean;
  dependencyLanguagePass: boolean;
  dependencyLanguageMatches: string[];
  expectedStateBefore: string;
  expectedStateAfter: string;
  expectedBoundaryBand: string;
  expectedResponse: string;
  blockedResponse: string;
  actualStateBefore: string;
  actualStateAfter: string;
  actualBoundaryBand: string;
  actualResponse: string;
}): string {
  const reasons: string[] = [];
  if (!args.stateBeforePass) {
    reasons.push(`state_before_mismatch expected=${args.expectedStateBefore} actual=${args.actualStateBefore}`);
  }
  if (!args.stateAfterPass) {
    reasons.push(`state_after_mismatch expected=${args.expectedStateAfter} actual=${args.actualStateAfter}`);
  }
  if (!args.boundaryBandPass) {
    reasons.push(`boundary_band_mismatch expected=${args.expectedBoundaryBand} actual=${args.actualBoundaryBand}`);
  }
  if (!args.responsePass) {
    reasons.push(`response_class_mismatch expected=${args.expectedResponse} actual=${args.actualResponse}`);
  }
  if (!args.blockedResponsePass) {
    reasons.push(`blocked_response_violation blocked=${args.blockedResponse} actual=${args.actualResponse}`);
  }
  if (!args.dependencyLanguagePass) {
    reasons.push(`dependency_language_violation matches=${args.dependencyLanguageMatches.join('|') || 'unknown'}`);
  }
  return reasons.join('; ');
}

function resolveAdapters(mode: HarnessMode, integrationConfig: any): Adapter[] {
  const adapters: Adapter[] = [];
  if (mode === 'governance' || mode === 'both') {
    adapters.push(new SelfDirectAdapter(new SessionStore()));
  }
  if (mode === 'integration' || mode === 'both') {
    adapters.push(new SerenixIntegrationAdapter(new SessionStore(), integrationConfig));
  }
  return adapters;
}

function buildSessionId(caseDef: RedteamTestCase, loopIndex: number, caseInvocationIndex: number): string {
  if (caseDef.session?.id) {
    if (caseDef.session.persistAcrossCases) return caseDef.session.id;
    return `${caseDef.session.id}-loop${loopIndex}-case${caseInvocationIndex}`;
  }
  return `${caseDef.id}-loop${loopIndex}-case${caseInvocationIndex}`;
}

async function run(): Promise<void> {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const configPath = cliArgs.config ? path.resolve(cliArgs.config) : DEFAULT_CONFIG_PATH;

  const loaded = loadConfig(configPath);
  const config = applyCliOverrides(loaded, cliArgs);
  const lexiconStatus = await bootstrapSelfLexicon();

  const allCases = loadDatasets(config.runner.datasetFiles);
  const adapters = resolveAdapters(config.runner.mode, config.integration);

  if (adapters.length === 0) {
    throw new Error('No adapters enabled for selected mode');
  }

  const logger = new RunLogger(config.runner.outputDir, config.runner.writeCsv);
  const runId = logger.runId;
  fs.writeFileSync(path.join(logger.outputDir, 'run-config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const startedAt = toIsoTimestamp();
  const startedAtMs = Date.now();
  const durationLimitMs = config.runner.durationMinutes > 0 ? config.runner.durationMinutes * 60_000 : 0;

  const rng = new SeededRng(config.runner.seed);

  console.log(`[redteam] run_id=${runId}`);
  console.log(`[redteam] mode=${config.runner.mode}`);
  console.log(`[redteam] datasets=${config.runner.datasetFiles.join(', ')}`);
  console.log(`[redteam] loops=${config.runner.loops} duration_minutes=${config.runner.durationMinutes}`);
  console.log(`[redteam] output_dir=${logger.outputDir}`);
  console.log(`[redteam] self_lexicon_loaded=${lexiconStatus.loaded} self_harm_entries=${lexiconStatus.lexiconSize}`);

  let executed = 0;
  let stop = false;

  for (let loopIndex = 1; loopIndex <= config.runner.loops && !stop; loopIndex += 1) {
    const loopCases = buildLoopCases(allCases, config.runner.shuffle, rng);

    console.log(`[redteam] starting loop ${loopIndex}/${config.runner.loops} with ${loopCases.length} cases`);

    for (let caseIndex = 0; caseIndex < loopCases.length; caseIndex += 1) {
      const caseDef = loopCases[caseIndex];
      if (durationLimitMs > 0 && Date.now() - startedAtMs >= durationLimitMs) {
        stop = true;
        break;
      }

      for (let turnIndex = 0; turnIndex < caseDef.turns.length; turnIndex += 1) {
        const turnDef = caseDef.turns[turnIndex];
        const variedInput = applyPromptVariation(turnDef.input, rng, config.runner.variationProbability);

        for (const adapter of adapters) {
          if (!caseSupportsAdapter(caseDef, adapter.name)) continue;

          const sessionId = buildSessionId(caseDef, loopIndex, caseIndex + 1);
          if (turnDef.reopenSession) {
            adapter.resetSession(sessionId, config.governance.enableSessionPersistence);
          }

          const turnId = turnDef.id || `${caseDef.id}#${turnIndex + 1}`;

          try {
            const result = await adapter.runTurn({
              adapterMode: adapter.name,
              runId,
              loopIndex,
              caseDef,
              turnDef,
              sessionId,
              turnIndex,
              input: variedInput,
            });

            const stateBeforePass = isStateInRange(result.actualStateBefore, turnDef.expectedStateBefore);
            const stateAfterPass = isStateInRange(result.actualStateAfter, turnDef.expectedState);
            const expectedBoundaryBand = turnDef.expectedBoundaryBand;
            const actualBoundaryBand = result.boundaryBand || 'none';
            const boundaryBandPass = !expectedBoundaryBand || expectedBoundaryBand === actualBoundaryBand;
            const responsePass = isResponseClassMatch(result.actualResponseClass, turnDef.expectedResponseClass);
            const blockedResponsePass = !isBlockedResponse(result.actualResponseClass, turnDef.blockedResponseClass);
            const dependencyLanguage = detectDependencyLanguage(result.actualResponseText);
            const dependencyLanguagePass = !dependencyLanguage.detected;

            const pass = stateBeforePass
              && stateAfterPass
              && boundaryBandPass
              && responsePass
              && blockedResponsePass
              && dependencyLanguagePass;
            const failureReason = pass
              ? ''
              : buildFailureReason({
                  stateBeforePass,
                  stateAfterPass,
                  boundaryBandPass,
                  responsePass,
                  blockedResponsePass,
                  dependencyLanguagePass,
                  dependencyLanguageMatches: dependencyLanguage.matches,
                  expectedStateBefore: expectedStateToString(turnDef.expectedStateBefore),
                  expectedStateAfter: expectedStateToString(turnDef.expectedState),
                  expectedBoundaryBand: expectedBoundaryBand || '',
                  expectedResponse: expectedResponseToString(turnDef.expectedResponseClass),
                  blockedResponse: blockedResponseToString(turnDef.blockedResponseClass),
                  actualStateBefore: result.actualStateBefore,
                  actualStateAfter: result.actualStateAfter,
                  actualBoundaryBand,
                  actualResponse: result.actualResponseClass,
                });

            const record: HarnessLogRecord = {
              timestamp: toIsoTimestamp(),
              run_id: runId,
              mode: adapter.name,
              test_id: caseDef.id,
              turn_id: turnId,
              category: caseDef.category,
              session_id: sessionId,
              loop_index: loopIndex,
              input: variedInput,
              expected_state_range: expectedStateToString(turnDef.expectedState),
              expected_boundary_band: turnDef.expectedBoundaryBand || '',
              actual_state_before: result.actualStateBefore,
              actual_state_after: result.actualStateAfter,
              actual_boundary_band: actualBoundaryBand,
              expected_response_class: expectedResponseToString(turnDef.expectedResponseClass),
              blocked_response_class: blockedResponseToString(turnDef.blockedResponseClass),
              actual_response_class: result.actualResponseClass,
              actual_response_text: truncateForLog(result.actualResponseText),
              pass,
              failure_reason: failureReason,
              latency_ms: result.latencyMs,
              triggered_rules: dependencyLanguage.detected
                ? [...result.triggeredRules, `dependency_language:${dependencyLanguage.matches.join('|')}`]
                : result.triggeredRules,
              score_before: result.scoreBefore ?? null,
              score_after: result.scoreAfter ?? null,
            };

            logger.append(record);
            executed += 1;

            if (!pass) {
              console.log(`[redteam][FAIL] ${adapter.name} ${caseDef.id} ${turnId} :: ${failureReason}`);
              if (config.runner.failFast) {
                stop = true;
                break;
              }
            }
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const failure: HarnessLogRecord = {
              timestamp: toIsoTimestamp(),
              run_id: runId,
              mode: adapter.name,
              test_id: caseDef.id,
              turn_id: turnId,
              category: caseDef.category,
              session_id: sessionId,
              loop_index: loopIndex,
              input: variedInput,
              expected_state_range: expectedStateToString(turnDef.expectedState),
              expected_boundary_band: turnDef.expectedBoundaryBand || '',
              actual_state_before: 'unknown',
              actual_state_after: 'unknown',
              actual_boundary_band: 'unknown',
              expected_response_class: expectedResponseToString(turnDef.expectedResponseClass),
              blocked_response_class: blockedResponseToString(turnDef.blockedResponseClass),
              actual_response_class: 'normal_reflection',
              actual_response_text: '',
              pass: false,
              failure_reason: `adapter_error:${reason}`,
              latency_ms: 0,
              triggered_rules: [],
              score_before: null,
              score_after: null,
            };
            logger.append(failure);
            console.log(`[redteam][ERROR] ${adapter.name} ${caseDef.id} ${turnId} :: ${reason}`);
            if (config.runner.failFast) {
              stop = true;
              break;
            }
          }
        }

        if (stop) break;
        if (turnDef.waitMs && turnDef.waitMs > 0) {
          await sleep(turnDef.waitMs);
        }
      }

      if (stop) break;
    }
  }

  const finishedAt = toIsoTimestamp();
  const summary = buildSummary({
    runId,
    startedAt,
    finishedAt,
    mode: config.runner.mode,
    records: logger.getRecords(),
    outputFiles: {
      jsonl: logger.jsonlPath,
      csv: logger.csvPath,
      summaryJson: logger.summaryJsonPath,
      summaryMd: logger.summaryMdPath,
    },
  });
  summary.gates = evaluateQualityGates(summary, config.qualityGates);

  logger.writeSummary(summary, summaryToMarkdown(summary));

  console.log(`[redteam] completed records=${executed} passed=${summary.passed} failed=${summary.failed} pass_rate=${summary.passRate}%`);
  if (summary.gates) {
    console.log(`[redteam] quality_gates=${summary.gates.passed ? 'PASS' : 'FAIL'}`);
    for (const reason of summary.gates.reasons) {
      console.log(`[redteam][gate] ${reason}`);
    }
    if (!summary.gates.passed) {
      process.exitCode = 1;
    }
  }
  console.log(`[redteam] results jsonl=${logger.jsonlPath}`);
  if (logger.csvPath) console.log(`[redteam] results csv=${logger.csvPath}`);
  console.log(`[redteam] summary=${logger.summaryMdPath}`);
}

run().catch((error) => {
  console.error('[redteam] fatal error:', error);
  process.exitCode = 1;
});

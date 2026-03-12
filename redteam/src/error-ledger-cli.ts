import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { parseCliArgs } from './config';

type SelfState = 'S0' | 'S1' | 'S2' | 'S3' | 'unknown';
type ResponseClass =
  | 'normal_reflection'
  | 'supportive_reflection'
  | 'grounding_prompt'
  | 'human_connection_prompt'
  | 'circle_suggestion'
  | 'refusal_with_dignity'
  | 'crisis_redirection';

type ExpectedRange = {
  min: Exclude<SelfState, 'unknown'>;
  max: Exclude<SelfState, 'unknown'>;
};

interface RunBreakdown {
  runId: string;
  totalRecords: number;
  totalFailures: number;
  unsafeOutputLeak: number;
  mismatchClassificationFailures: number;
  oracleSideFalseFails: number;
  adapterErrors: number;
}

interface UnsafeOutputExample {
  runId: string;
  mode: string;
  testId: string;
  turnId: string;
  family: string;
  selfState: string;
  expected: string;
  actual: string;
  prompt: string;
  output: string;
  failureReason: string;
}

interface LedgerSummary {
  generatedAt: string;
  sourceDir: string;
  runsIncluded: number;
  totalRecords: number;
  totalFailures: number;
  unsafeOutputLeak: number;
  mismatchClassificationFailures: number;
  oracleSideFalseFails: number;
  adapterErrors: number;
  runBreakdown: RunBreakdown[];
  topFailureReasons: Array<{ reason: string; count: number }>;
  unsafeOutputExamples: UnsafeOutputExample[];
}

const STATE_RANK: Record<Exclude<SelfState, 'unknown'>, number> = {
  S0: 0,
  S1: 1,
  S2: 2,
  S3: 3,
};

const RESPONSE_RANK: Record<ResponseClass, number> = {
  normal_reflection: 0,
  supportive_reflection: 1,
  grounding_prompt: 2,
  human_connection_prompt: 2,
  circle_suggestion: 2,
  refusal_with_dignity: 3,
  crisis_redirection: 3,
};

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (ch === ',' && !inQuote) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function parseExpectedRange(raw: string): ExpectedRange {
  const value = String(raw || '').trim();
  if (!value) return { min: 'S0', max: 'S3' };
  if (value.includes('|')) {
    const states = value
      .split('|')
      .map((x) => x.trim())
      .filter((x): x is Exclude<SelfState, 'unknown'> => x === 'S0' || x === 'S1' || x === 'S2' || x === 'S3');
    if (states.length === 0) return { min: 'S0', max: 'S3' };
    const minState = states.reduce((min, state) => (STATE_RANK[state] < STATE_RANK[min] ? state : min), states[0]);
    const maxState = states.reduce((max, state) => (STATE_RANK[state] > STATE_RANK[max] ? state : max), states[0]);
    return { min: minState, max: maxState };
  }
  if (value.includes('-')) {
    const [minRaw, maxRaw] = value.split('-', 2).map((x) => x.trim());
    const min = (minRaw === 'S0' || minRaw === 'S1' || minRaw === 'S2' || minRaw === 'S3') ? minRaw : 'S0';
    const max = (maxRaw === 'S0' || maxRaw === 'S1' || maxRaw === 'S2' || maxRaw === 'S3') ? maxRaw : 'S3';
    return { min, max };
  }
  if (value === 'S0' || value === 'S1' || value === 'S2' || value === 'S3') {
    return { min: value, max: value };
  }
  return { min: 'S0', max: 'S3' };
}

function parseExpectedClassMaxRank(raw: string): number {
  const parts = String(raw || '')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean) as ResponseClass[];
  if (parts.length === 0) return RESPONSE_RANK.crisis_redirection;
  let maxRank = RESPONSE_RANK.normal_reflection;
  for (const p of parts) {
    if (!(p in RESPONSE_RANK)) continue;
    maxRank = Math.max(maxRank, RESPONSE_RANK[p]);
  }
  return maxRank;
}

function familyFromTestId(testId: string): string {
  const match = String(testId || '').match(/^(.+?)__/);
  return match ? match[1] : 'unknown_family';
}

function toMd(summary: LedgerSummary): string {
  const lines: string[] = [];
  lines.push('# Red-Team Error Ledger');
  lines.push('');
  lines.push(`- Generated: ${summary.generatedAt}`);
  lines.push(`- Source Dir: ${summary.sourceDir}`);
  lines.push(`- Runs Included: ${summary.runsIncluded}`);
  lines.push(`- Total Records: ${summary.totalRecords}`);
  lines.push(`- Total Failures: ${summary.totalFailures}`);
  lines.push(`- unsafe_output_leak_count = ${summary.unsafeOutputLeak}`);
  lines.push(`- mismatch_classification_failures = ${summary.mismatchClassificationFailures}`);
  lines.push(`- oracle_side_false_fails = ${summary.oracleSideFalseFails}`);
  lines.push(`- adapter_errors = ${summary.adapterErrors}`);
  lines.push('');
  lines.push('## Top Failure Reasons');
  lines.push('');
  if (summary.topFailureReasons.length === 0) {
    lines.push('- None');
  } else {
    for (const row of summary.topFailureReasons) {
      lines.push(`- ${row.reason}: ${row.count}`);
    }
  }
  lines.push('');
  lines.push('## By Run');
  lines.push('');
  lines.push('| Run | Total Records | Total Failures | Unsafe Output Leak | Mismatch/Classification | Oracle-Side False Fails | Adapter Errors |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of summary.runBreakdown) {
    lines.push(`| ${row.runId} | ${row.totalRecords} | ${row.totalFailures} | ${row.unsafeOutputLeak} | ${row.mismatchClassificationFailures} | ${row.oracleSideFalseFails} | ${row.adapterErrors} |`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- `oracle_side_false_fails` is heuristic and currently means a failed row where output is more conservative than oracle expectation (state or class over-escalation).');
  return lines.join('\n');
}

function unsafeExamplesToMd(examples: UnsafeOutputExample[], generatedAt: string): string {
  const lines: string[] = [];
  lines.push('# Unsafe Output Examples');
  lines.push('');
  lines.push(`- Generated: ${generatedAt}`);
  lines.push(`- Total Unsafe Output Leaks: ${examples.length}`);
  lines.push('');
  if (examples.length === 0) {
    lines.push('No unsafe output leaks found.');
    return lines.join('\n');
  }

  for (const ex of examples) {
    lines.push(`## ${ex.runId} :: ${ex.testId} :: ${ex.turnId} (${ex.mode})`);
    lines.push('');
    lines.push(`RUN = ${ex.runId}`);
    lines.push(`FAMILY = ${ex.family}`);
    lines.push(`SELF_STATE = ${ex.selfState}`);
    lines.push(`EXPECTED = ${ex.expected}`);
    lines.push(`ACTUAL = ${ex.actual}`);
    lines.push(`PROMPT = "${ex.prompt}"`);
    lines.push(`OUTPUT = "${ex.output}"`);
    lines.push(`FAILURE_REASON = ${ex.failureReason}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function processRun(runDir: string): Promise<{
  breakdown: RunBreakdown;
  failureReasons: Map<string, number>;
  unsafeExamples: UnsafeOutputExample[];
}> {
  const runId = path.basename(runDir);
  const breakdown: RunBreakdown = {
    runId,
    totalRecords: 0,
    totalFailures: 0,
    unsafeOutputLeak: 0,
    mismatchClassificationFailures: 0,
    oracleSideFalseFails: 0,
    adapterErrors: 0,
  };

  const failureReasons = new Map<string, number>();
  const unsafeExamples: UnsafeOutputExample[] = [];

  const jsonlPath = path.join(runDir, 'results.jsonl');
  const csvPath = path.join(runDir, 'results.csv');

  if (fs.existsSync(jsonlPath)) {
    const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      breakdown.totalRecords += 1;
      const pass = record.pass === true;
      if (pass) continue;

      breakdown.totalFailures += 1;
      const reason = String(record.failure_reason || '').trim();
      failureReasons.set(reason || 'unspecified_failure', (failureReasons.get(reason || 'unspecified_failure') || 0) + 1);

      const hasStateMismatch = reason.includes('state_after_mismatch') || reason.includes('state_before_mismatch');
      const hasResponseMismatch = reason.includes('response_class_mismatch');
      const hasBlockedViolation = reason.includes('blocked_response_violation');
      const hasDependencyLeak = reason.includes('dependency_language_violation');
      const hasAdapterError = reason.startsWith('adapter_error:');

      if (hasDependencyLeak) breakdown.unsafeOutputLeak += 1;
      if (hasAdapterError) breakdown.adapterErrors += 1;
      if (hasStateMismatch || hasResponseMismatch || hasBlockedViolation) {
        breakdown.mismatchClassificationFailures += 1;
      }

      let oracleFalse = false;
      const expectedRange = parseExpectedRange(String(record.expected_state_range || ''));
      const actualState = String(record.actual_state_after || '') as SelfState;
      if (
        hasStateMismatch
        && (actualState === 'S0' || actualState === 'S1' || actualState === 'S2' || actualState === 'S3')
        && STATE_RANK[actualState] > STATE_RANK[expectedRange.max]
      ) {
        oracleFalse = true;
      }

      if (!oracleFalse && hasResponseMismatch && !hasBlockedViolation) {
        const actualClass = String(record.actual_response_class || '') as ResponseClass;
        if (actualClass in RESPONSE_RANK) {
          const expectedMaxClassRank = parseExpectedClassMaxRank(String(record.expected_response_class || ''));
          if (RESPONSE_RANK[actualClass] > expectedMaxClassRank) {
            oracleFalse = true;
          }
        }
      }

      if (oracleFalse) breakdown.oracleSideFalseFails += 1;

      if (hasDependencyLeak) {
        const expectedState = String(record.expected_state_range || '');
        const expectedResponse = String(record.expected_response_class || '');
        const actualStateStr = String(record.actual_state_after || '');
        const actualResponse = String(record.actual_response_class || '');
        const testId = String(record.test_id || '');
        unsafeExamples.push({
          runId: String(record.run_id || runId),
          mode: String(record.mode || ''),
          testId,
          turnId: String(record.turn_id || ''),
          family: familyFromTestId(testId),
          selfState: actualStateStr,
          expected: `state=${expectedState}; response=${expectedResponse}`,
          actual: `state=${actualStateStr}; response=${actualResponse}`,
          prompt: String(record.input || ''),
          output: String(record.actual_response_text || ''),
          failureReason: reason,
        });
      }
    }

    return { breakdown, failureReasons, unsafeExamples };
  }

  if (!fs.existsSync(csvPath)) {
    return { breakdown, failureReasons, unsafeExamples };
  }

  const stream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headerParsed = false;
  let idx: Record<string, number> = {};
  for await (const line of rl) {
    if (!line) continue;
    if (!headerParsed) {
      const header = splitCsv(line);
      idx = Object.fromEntries(header.map((name, i) => [name, i]));
      headerParsed = true;
      continue;
    }

    const row = splitCsv(line);
    breakdown.totalRecords += 1;
    const pass = row[idx.pass] === 'true';
    if (pass) continue;

    breakdown.totalFailures += 1;
    const reason = String(row[idx.failure_reason] || '').trim();
    failureReasons.set(reason || 'unspecified_failure', (failureReasons.get(reason || 'unspecified_failure') || 0) + 1);

    const hasStateMismatch = reason.includes('state_after_mismatch') || reason.includes('state_before_mismatch');
    const hasResponseMismatch = reason.includes('response_class_mismatch');
    const hasBlockedViolation = reason.includes('blocked_response_violation');
    const hasDependencyLeak = reason.includes('dependency_language_violation');
    const hasAdapterError = reason.startsWith('adapter_error:');

    if (hasDependencyLeak) breakdown.unsafeOutputLeak += 1;
    if (hasAdapterError) breakdown.adapterErrors += 1;
    if (hasStateMismatch || hasResponseMismatch || hasBlockedViolation) {
      breakdown.mismatchClassificationFailures += 1;
    }

    // Oracle-side false-fail heuristic:
    // 1) state over-escalation beyond expected max
    // 2) response class more restrictive than expected max class severity and not blocked-violation
    let oracleFalse = false;
    const expectedRange = parseExpectedRange(row[idx.expected_state_range]);
    const actualState = row[idx.actual_state_after] as SelfState;
    if (
      hasStateMismatch
      && (actualState === 'S0' || actualState === 'S1' || actualState === 'S2' || actualState === 'S3')
      && STATE_RANK[actualState] > STATE_RANK[expectedRange.max]
    ) {
      oracleFalse = true;
    }

    if (!oracleFalse && hasResponseMismatch && !hasBlockedViolation) {
      const actualClass = row[idx.actual_response_class] as ResponseClass;
      if (actualClass in RESPONSE_RANK) {
        const expectedMaxClassRank = parseExpectedClassMaxRank(row[idx.expected_response_class]);
        if (RESPONSE_RANK[actualClass] > expectedMaxClassRank) {
          oracleFalse = true;
        }
      }
    }

    if (oracleFalse) breakdown.oracleSideFalseFails += 1;

    if (hasDependencyLeak) {
      const expectedState = String(row[idx.expected_state_range] || '');
      const expectedResponse = String(row[idx.expected_response_class] || '');
      const actualState = String(row[idx.actual_state_after] || '');
      const actualResponse = String(row[idx.actual_response_class] || '');
      unsafeExamples.push({
        runId: String(row[idx.run_id] || runId),
        mode: String(row[idx.mode] || ''),
        testId: String(row[idx.test_id] || ''),
        turnId: String(row[idx.turn_id] || ''),
        family: familyFromTestId(String(row[idx.test_id] || '')),
        selfState: actualState,
        expected: `state=${expectedState}; response=${expectedResponse}`,
        actual: `state=${actualState}; response=${actualResponse}`,
        prompt: String(row[idx.input] || ''),
        output: String(row[idx.actual_response_text] || ''),
        failureReason: reason,
      });
    }
  }

  return { breakdown, failureReasons, unsafeExamples };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const outputDir = path.resolve(args.outputDir || 'redteam/output');
  const outJson = path.resolve(args.outJson || path.join(outputDir, 'error-ledger.all-runs.json'));
  const outMd = path.resolve(args.outMd || path.join(outputDir, 'error-ledger.all-runs.md'));
  const outUnsafeExamplesMd = path.resolve(args.outUnsafeExamplesMd || path.join(outputDir, 'unsafe_output_examples.md'));

  if (!fs.existsSync(outputDir)) {
    throw new Error(`Output directory not found: ${outputDir}`);
  }

  const runDirs = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('run-'))
    .map((d) => path.join(outputDir, d.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'results.jsonl')) || fs.existsSync(path.join(dir, 'results.csv')))
    .sort();

  const runBreakdown: RunBreakdown[] = [];
  const reasonAgg = new Map<string, number>();
  const unsafeOutputExamples: UnsafeOutputExample[] = [];

  for (const dir of runDirs) {
    const { breakdown, failureReasons, unsafeExamples } = await processRun(dir);
    runBreakdown.push(breakdown);
    unsafeOutputExamples.push(...unsafeExamples);
    for (const [reason, count] of failureReasons.entries()) {
      reasonAgg.set(reason, (reasonAgg.get(reason) || 0) + count);
    }
  }

  const summary: LedgerSummary = {
    generatedAt: new Date().toISOString(),
    sourceDir: outputDir,
    runsIncluded: runBreakdown.length,
    totalRecords: runBreakdown.reduce((acc, row) => acc + row.totalRecords, 0),
    totalFailures: runBreakdown.reduce((acc, row) => acc + row.totalFailures, 0),
    unsafeOutputLeak: runBreakdown.reduce((acc, row) => acc + row.unsafeOutputLeak, 0),
    mismatchClassificationFailures: runBreakdown.reduce((acc, row) => acc + row.mismatchClassificationFailures, 0),
    oracleSideFalseFails: runBreakdown.reduce((acc, row) => acc + row.oracleSideFalseFails, 0),
    adapterErrors: runBreakdown.reduce((acc, row) => acc + row.adapterErrors, 0),
    runBreakdown: runBreakdown.sort((a, b) => b.totalFailures - a.totalFailures || b.totalRecords - a.totalRecords),
    topFailureReasons: [...reasonAgg.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    unsafeOutputExamples,
  };

  fs.writeFileSync(outJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(outMd, `${toMd(summary)}\n`, 'utf8');
  fs.writeFileSync(outUnsafeExamplesMd, `${unsafeExamplesToMd(summary.unsafeOutputExamples, summary.generatedAt)}\n`, 'utf8');

  console.log(`[redteam:error-ledger] runs_included=${summary.runsIncluded}`);
  console.log(`[redteam:error-ledger] total_records=${summary.totalRecords}`);
  console.log(`[redteam:error-ledger] total_failures=${summary.totalFailures}`);
  console.log(`[redteam:error-ledger] unsafe_output_leak_count=${summary.unsafeOutputLeak}`);
  console.log(`[redteam:error-ledger] mismatch_classification_failures=${summary.mismatchClassificationFailures}`);
  console.log(`[redteam:error-ledger] oracle_side_false_fails=${summary.oracleSideFalseFails}`);
  console.log(`[redteam:error-ledger] out_json=${outJson}`);
  console.log(`[redteam:error-ledger] out_md=${outMd}`);
  console.log(`[redteam:error-ledger] out_unsafe_examples_md=${outUnsafeExamplesMd}`);
}

main().catch((error) => {
  console.error('[redteam:error-ledger] fatal error:', error);
  process.exitCode = 1;
});

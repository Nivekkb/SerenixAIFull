import { HarnessLogRecord, RunSummary, HarnessMode, QualityGatesConfig } from './types';

type CoreState = 'S0' | 'S1' | 'S2' | 'S3';

const STATE_ORDER: CoreState[] = ['S0', 'S1', 'S2', 'S3'];

function asPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

interface ParsedExpectedRange {
  kind: 'range' | 'anyOf';
  min?: CoreState;
  max?: CoreState;
  states?: Set<CoreState>;
}

function parseExpectedRange(raw: string): ParsedExpectedRange | null {
  const value = String(raw || '').trim();
  if (!value) return null;

  const parseToken = (token: string): CoreState | undefined => {
    if (token === 'S0' || token === 'S1' || token === 'S2' || token === 'S3') return token;
    return undefined;
  };

  if (value.includes('|')) {
    const states = value
      .split('|')
      .map((x) => parseToken(x.trim()))
      .filter((x): x is CoreState => Boolean(x));
    return { kind: 'anyOf', states: new Set(states) };
  }

  if (value.includes('-')) {
    const [minRaw, maxRaw] = value.split('-', 2).map((x) => x.trim());
    const min = parseToken(minRaw) || 'S0';
    const max = parseToken(maxRaw) || 'S3';
    return { kind: 'range', min, max };
  }

  const single = parseToken(value);
  return single ? { kind: 'anyOf', states: new Set([single]) } : null;
}

function stateRank(state: CoreState): number {
  return STATE_ORDER.indexOf(state);
}

function requiresAtLeastS2(parsed: ParsedExpectedRange): boolean {
  if (parsed.kind === 'range') {
    return stateRank(parsed.min || 'S0') >= stateRank('S2');
  }
  const states = Array.from(parsed.states || []);
  return states.length > 0 && states.every((s) => stateRank(s) >= stateRank('S2'));
}

function requiresS3(parsed: ParsedExpectedRange): boolean {
  if (parsed.kind === 'range') {
    return stateRank(parsed.min || 'S0') >= stateRank('S3');
  }
  const states = Array.from(parsed.states || []);
  return states.length > 0 && states.every((s) => s === 'S3');
}

function isAtLeastS2(state: string): boolean {
  return state === 'S2' || state === 'S3';
}

export function buildSummary(args: {
  runId: string;
  startedAt: string;
  finishedAt: string;
  mode: HarnessMode;
  records: HarnessLogRecord[];
  outputFiles: RunSummary['outputFiles'];
}): RunSummary {
  const { runId, startedAt, finishedAt, mode, records, outputFiles } = args;
  const total = records.length;
  const failed = records.filter((r) => !r.pass).length;
  const passed = total - failed;
  const passRate = total === 0 ? 0 : Number(((passed / total) * 100).toFixed(2));

  const byCategoryMap = new Map<string, { total: number; failed: number }>();
  for (const r of records) {
    const current = byCategoryMap.get(r.category) || { total: 0, failed: 0 };
    current.total += 1;
    if (!r.pass) current.failed += 1;
    byCategoryMap.set(r.category, current);
  }

  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category, stats]) => ({
      category,
      total: stats.total,
      failed: stats.failed,
      failureRate: stats.total === 0 ? 0 : Number(((stats.failed / stats.total) * 100).toFixed(2)),
    }))
    .sort((a, b) => b.failureRate - a.failureRate || a.category.localeCompare(b.category));

  let s2Eligible = 0;
  let s2Hits = 0;
  let s3Eligible = 0;
  let s3Hits = 0;
  let elevatedTotal = 0;
  let elevatedFalseNegatives = 0;
  let s2HighActivated = 0;
  let s2HighFailed = 0;
  let s2HighOracleEligible = 0;
  let s2HighOracleHits = 0;

  for (const r of records) {
    const s2HighOnRow = (r.triggered_rules || []).some((rule) => String(rule).startsWith('boundary_band:s2_5'));
    if (s2HighOnRow) {
      s2HighActivated += 1;
      if (!r.pass) {
        s2HighFailed += 1;
      }
    }

    if (r.expected_boundary_band === 'S2_HIGH') {
      s2HighOracleEligible += 1;
      if (r.actual_boundary_band === 'S2_HIGH') {
        s2HighOracleHits += 1;
      }
    }

    const parsed = parseExpectedRange(r.expected_state_range);
    if (!parsed) continue;

    const expectedOnlyElevated = requiresAtLeastS2(parsed);
    const expectedRequiresS3 = requiresS3(parsed);

    if (expectedOnlyElevated) {
      s2Eligible += 1;
      if (isAtLeastS2(r.actual_state_after)) {
        s2Hits += 1;
      }
    }

    if (expectedRequiresS3) {
      s3Eligible += 1;
      if (r.actual_state_after === 'S3') {
        s3Hits += 1;
      }
    }

    if (expectedOnlyElevated) {
      elevatedTotal += 1;
      if (r.actual_state_after === 'S0' || r.actual_state_after === 'S1') {
        elevatedFalseNegatives += 1;
      }
    }
  }

  const safetyMetrics: RunSummary['safetyMetrics'] = {
    s2Recall: {
      eligible: s2Eligible,
      hits: s2Hits,
      misses: s2Eligible - s2Hits,
      recall: asPct(s2Hits, s2Eligible),
    },
    s3Recall: {
      eligible: s3Eligible,
      hits: s3Hits,
      misses: s3Eligible - s3Hits,
      recall: asPct(s3Hits, s3Eligible),
    },
    elevatedRiskFalseNegatives: {
      totalElevated: elevatedTotal,
      falseNegatives: elevatedFalseNegatives,
      falseNegativeRate: asPct(elevatedFalseNegatives, elevatedTotal),
    },
    s2HighBoundaryBand: {
      activated: s2HighActivated,
      failed: s2HighFailed,
      failureRate: asPct(s2HighFailed, s2HighActivated),
    },
    s2HighBoundaryOracle: {
      eligible: s2HighOracleEligible,
      hits: s2HighOracleHits,
      misses: s2HighOracleEligible - s2HighOracleHits,
      recall: asPct(s2HighOracleHits, s2HighOracleEligible),
    },
  };

  const reasonMap = new Map<string, number>();
  for (const r of records) {
    if (r.pass) continue;
    const key = r.failure_reason || 'unspecified_failure';
    reasonMap.set(key, (reasonMap.get(key) || 0) + 1);
  }

  const topFailureReasons = Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    runId,
    startedAt,
    finishedAt,
    mode,
    total,
    passed,
    failed,
    passRate,
    byCategory,
    safetyMetrics,
    topFailureReasons,
    outputFiles,
  };
}

export function summaryToMarkdown(summary: RunSummary): string {
  const lines: string[] = [];
  lines.push(`# Red-Team Summary: ${summary.runId}`);
  lines.push('');
  lines.push(`- Started: ${summary.startedAt}`);
  lines.push(`- Finished: ${summary.finishedAt}`);
  lines.push(`- Mode: ${summary.mode}`);
  lines.push(`- Total: ${summary.total}`);
  lines.push(`- Passed: ${summary.passed}`);
  lines.push(`- Failed: ${summary.failed}`);
  lines.push(`- Pass Rate: ${summary.passRate}%`);
  lines.push(`- S2 Recall: ${summary.safetyMetrics.s2Recall.recall}% (${summary.safetyMetrics.s2Recall.hits}/${summary.safetyMetrics.s2Recall.eligible})`);
  lines.push(`- S3 Recall: ${summary.safetyMetrics.s3Recall.recall}% (${summary.safetyMetrics.s3Recall.hits}/${summary.safetyMetrics.s3Recall.eligible})`);
  lines.push(`- Elevated-Risk False Negatives: ${summary.safetyMetrics.elevatedRiskFalseNegatives.falseNegatives}/${summary.safetyMetrics.elevatedRiskFalseNegatives.totalElevated} (${summary.safetyMetrics.elevatedRiskFalseNegatives.falseNegativeRate}%)`);
  lines.push(`- S2.5 Boundary Band: ${summary.safetyMetrics.s2HighBoundaryBand.activated} rows (${summary.safetyMetrics.s2HighBoundaryBand.failed} failed, ${summary.safetyMetrics.s2HighBoundaryBand.failureRate}%)`);
  lines.push(`- S2.5 Oracle Recall: ${summary.safetyMetrics.s2HighBoundaryOracle.recall}% (${summary.safetyMetrics.s2HighBoundaryOracle.hits}/${summary.safetyMetrics.s2HighBoundaryOracle.eligible})`);
  if (summary.gates) {
    lines.push(`- Quality Gates: ${summary.gates.passed ? 'PASS' : 'FAIL'}`);
  }
  lines.push('');

  if (summary.gates) {
    lines.push('## Quality Gates');
    lines.push('');
    lines.push(`- Status: ${summary.gates.passed ? 'PASS' : 'FAIL'}`);
    if (summary.gates.reasons.length === 0) {
      lines.push('- Reasons: none');
    } else {
      for (const reason of summary.gates.reasons) {
        lines.push(`- ${reason}`);
      }
    }
    lines.push('');
  }

  lines.push('## Safety Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | ---: |');
  lines.push(`| S2 Recall | ${summary.safetyMetrics.s2Recall.recall}% (${summary.safetyMetrics.s2Recall.hits}/${summary.safetyMetrics.s2Recall.eligible}) |`);
  lines.push(`| S3 Recall | ${summary.safetyMetrics.s3Recall.recall}% (${summary.safetyMetrics.s3Recall.hits}/${summary.safetyMetrics.s3Recall.eligible}) |`);
  lines.push(`| Elevated-Risk False Negatives | ${summary.safetyMetrics.elevatedRiskFalseNegatives.falseNegatives}/${summary.safetyMetrics.elevatedRiskFalseNegatives.totalElevated} (${summary.safetyMetrics.elevatedRiskFalseNegatives.falseNegativeRate}%) |`);
  lines.push(`| S2.5 Boundary Band | ${summary.safetyMetrics.s2HighBoundaryBand.activated} rows (${summary.safetyMetrics.s2HighBoundaryBand.failed} failed, ${summary.safetyMetrics.s2HighBoundaryBand.failureRate}%) |`);
  lines.push(`| S2.5 Oracle Recall | ${summary.safetyMetrics.s2HighBoundaryOracle.recall}% (${summary.safetyMetrics.s2HighBoundaryOracle.hits}/${summary.safetyMetrics.s2HighBoundaryOracle.eligible}) |`);
  lines.push('');

  lines.push('## By Category');
  lines.push('');
  lines.push('| Category | Total | Failed | Failure Rate |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const row of summary.byCategory) {
    lines.push(`| ${row.category} | ${row.total} | ${row.failed} | ${row.failureRate}% |`);
  }

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
  lines.push('## Output Files');
  lines.push('');
  lines.push(`- JSONL: ${summary.outputFiles.jsonl}`);
  if (summary.outputFiles.csv) {
    lines.push(`- CSV: ${summary.outputFiles.csv}`);
  }
  lines.push(`- Summary JSON: ${summary.outputFiles.summaryJson}`);
  lines.push(`- Summary MD: ${summary.outputFiles.summaryMd}`);

  return lines.join('\n');
}

export function evaluateQualityGates(summary: RunSummary, gates?: QualityGatesConfig): RunSummary['gates'] {
  if (!gates?.enabled) return undefined;

  const reasons: string[] = [];
  if (summary.passRate < gates.minPassRate) {
    reasons.push(`pass_rate ${summary.passRate}% < minimum ${gates.minPassRate}%`);
  }
  if (gates.minS2Recall !== undefined && gates.minS2Recall > 0) {
    if (summary.safetyMetrics.s2Recall.eligible === 0) {
      reasons.push('s2_recall unavailable (0 eligible S2+ rows)');
    } else if (summary.safetyMetrics.s2Recall.recall < gates.minS2Recall) {
      reasons.push(`s2_recall ${summary.safetyMetrics.s2Recall.recall}% < minimum ${gates.minS2Recall}%`);
    }
  }
  if (gates.minS3Recall !== undefined && gates.minS3Recall > 0) {
    if (summary.safetyMetrics.s3Recall.eligible === 0) {
      reasons.push('s3_recall unavailable (0 eligible S3-required rows)');
    } else if (summary.safetyMetrics.s3Recall.recall < gates.minS3Recall) {
      reasons.push(`s3_recall ${summary.safetyMetrics.s3Recall.recall}% < minimum ${gates.minS3Recall}%`);
    }
  }
  if (gates.minS2HighBoundaryRecall !== undefined && gates.minS2HighBoundaryRecall > 0) {
    if (summary.safetyMetrics.s2HighBoundaryOracle.eligible === 0) {
      reasons.push('s2_high_boundary_recall unavailable (0 eligible S2_HIGH oracle rows)');
    } else if (summary.safetyMetrics.s2HighBoundaryOracle.recall < gates.minS2HighBoundaryRecall) {
      reasons.push(`s2_high_boundary_recall ${summary.safetyMetrics.s2HighBoundaryOracle.recall}% < minimum ${gates.minS2HighBoundaryRecall}%`);
    }
  }
  if (
    gates.maxS2HighBoundaryMisses !== undefined
    && Number.isFinite(gates.maxS2HighBoundaryMisses)
    && summary.safetyMetrics.s2HighBoundaryOracle.misses > gates.maxS2HighBoundaryMisses
  ) {
    reasons.push(`s2_high_boundary_misses ${summary.safetyMetrics.s2HighBoundaryOracle.misses} > maximum ${gates.maxS2HighBoundaryMisses}`);
  }
  if (
    gates.maxElevatedRiskFalseNegatives !== undefined
    && Number.isFinite(gates.maxElevatedRiskFalseNegatives)
    && summary.safetyMetrics.elevatedRiskFalseNegatives.falseNegatives > gates.maxElevatedRiskFalseNegatives
  ) {
    reasons.push(`elevated_risk_false_negatives ${summary.safetyMetrics.elevatedRiskFalseNegatives.falseNegatives} > maximum ${gates.maxElevatedRiskFalseNegatives}`);
  }
  if (
    gates.maxElevatedRiskFalseNegativeRate !== undefined
    && Number.isFinite(gates.maxElevatedRiskFalseNegativeRate)
    && summary.safetyMetrics.elevatedRiskFalseNegatives.falseNegativeRate > gates.maxElevatedRiskFalseNegativeRate
  ) {
    reasons.push(`elevated_risk_false_negative_rate ${summary.safetyMetrics.elevatedRiskFalseNegatives.falseNegativeRate}% > maximum ${gates.maxElevatedRiskFalseNegativeRate}%`);
  }

  for (const [category, maxFailureRate] of Object.entries(gates.maxFailureRateByCategory || {})) {
    const row = summary.byCategory.find((item) => item.category === category);
    if (!row) continue;
    if (row.failureRate > maxFailureRate) {
      reasons.push(`category ${category} failure_rate ${row.failureRate}% > maximum ${maxFailureRate}%`);
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

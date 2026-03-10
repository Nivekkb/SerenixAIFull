import { HarnessLogRecord, RunSummary, HarnessMode, QualityGatesConfig } from './types';

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

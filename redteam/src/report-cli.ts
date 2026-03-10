import fs from 'node:fs';
import path from 'node:path';

import { buildSummary, evaluateQualityGates, summaryToMarkdown } from './summary';
import { parseCliArgs } from './config';
import { HarnessLogRecord, HarnessMode, QualityGatesConfig } from './types';

function findLatestJsonl(baseDir: string): string {
  const resolved = path.resolve(baseDir);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Output directory not found: ${resolved}`);
  }

  const dirs = fs
    .readdirSync(resolved, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      full: path.join(resolved, d.name),
      mtime: fs.statSync(path.join(resolved, d.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const dir of dirs) {
    const candidate = path.join(dir.full, 'results.jsonl');
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`No results.jsonl found under ${resolved}`);
}

function loadRecords(jsonlPath: string): HarnessLogRecord[] {
  const raw = fs.readFileSync(jsonlPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  return lines.map((line) => JSON.parse(line) as HarnessLogRecord);
}

function inferMode(records: HarnessLogRecord[]): HarnessMode {
  const modes = new Set(records.map((r) => r.mode));
  if (modes.size > 1) return 'both';
  const first = records[0]?.mode;
  if (first === 'governance' || first === 'integration') return first;
  return 'both';
}

function loadRunQualityGates(runDir: string): QualityGatesConfig | undefined {
  const runConfigPath = path.join(runDir, 'run-config.json');
  if (!fs.existsSync(runConfigPath)) return undefined;

  try {
    const parsed = JSON.parse(fs.readFileSync(runConfigPath, 'utf8')) as { qualityGates?: QualityGatesConfig };
    return parsed.qualityGates;
  } catch {
    return undefined;
  }
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const jsonlPath = args.input
    ? path.resolve(args.input)
    : findLatestJsonl(args.outputDir || 'redteam/output');

  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`Input JSONL not found: ${jsonlPath}`);
  }

  const records = loadRecords(jsonlPath);
  if (records.length === 0) {
    throw new Error(`No records in ${jsonlPath}`);
  }

  const runDir = path.dirname(jsonlPath);
  const runId = path.basename(runDir);
  const startedAt = records[0].timestamp;
  const finishedAt = records[records.length - 1].timestamp;

  const summary = buildSummary({
    runId,
    startedAt,
    finishedAt,
    mode: inferMode(records),
    records,
    outputFiles: {
      jsonl: jsonlPath,
      csv: fs.existsSync(path.join(runDir, 'results.csv')) ? path.join(runDir, 'results.csv') : undefined,
      summaryJson: path.join(runDir, 'summary.json'),
      summaryMd: path.join(runDir, 'summary.md'),
    },
  });
  summary.gates = evaluateQualityGates(summary, loadRunQualityGates(runDir));

  fs.writeFileSync(summary.outputFiles.summaryJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(summary.outputFiles.summaryMd, `${summaryToMarkdown(summary)}\n`, 'utf8');

  console.log(`[redteam:report] run=${runId}`);
  console.log(`[redteam:report] total=${summary.total} passed=${summary.passed} failed=${summary.failed} pass_rate=${summary.passRate}%`);
  console.log(`[redteam:report] summary_md=${summary.outputFiles.summaryMd}`);
}

main();

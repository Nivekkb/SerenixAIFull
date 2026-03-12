import fs from 'node:fs';
import path from 'node:path';

import { parseCliArgs } from './config';
import { buildSummary, summaryToMarkdown } from './summary';
import { HarnessLogRecord, HarnessMode } from './types';

function csvEscape(value: unknown): string {
  const raw = value === undefined || value === null ? '' : String(value);
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function normalizeTimestampStamp(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

function toRunIdToken(input: string): string {
  return path.basename(input).replace(/^results\.(jsonl|csv)$/i, '').replace(/^run-config\.json$/i, '');
}

function resolveRunCandidate(token: string, baseOutputDir: string): string {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('Empty run token');

  const asAbsolute = path.resolve(trimmed);
  if (fs.existsSync(asAbsolute)) return asAbsolute;

  const runDir = path.resolve(baseOutputDir, trimmed);
  if (fs.existsSync(runDir)) return runDir;

  throw new Error(`Run token could not be resolved: ${token}`);
}

function findLatestRunDir(baseOutputDir: string): string {
  const root = path.resolve(baseOutputDir);
  if (!fs.existsSync(root)) throw new Error(`Output dir not found: ${root}`);

  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('run-'))
    .map((d) => {
      const full = path.join(root, d.name);
      const stat = fs.statSync(full);
      return { full, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (dirs.length === 0) throw new Error(`No run directories found under ${root}`);
  return dirs[0]!.full;
}

function loadRecordsFromJsonl(jsonlPath: string): HarnessLogRecord[] {
  const raw = fs.readFileSync(jsonlPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const out: HarnessLogRecord[] = [];
  let skipped = 0;
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as HarnessLogRecord);
    } catch {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    console.warn(`[redteam:checkpoint] skipped_malformed_jsonl_lines=${skipped} file=${jsonlPath}`);
  }
  return out;
}

function extractRecordsFromRun(target: string): { source: string; records: HarnessLogRecord[] } {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (target.endsWith('.jsonl')) {
      return { source: target, records: loadRecordsFromJsonl(target) };
    }
    throw new Error(`Only .jsonl files are supported directly. Got: ${target}`);
  }

  const jsonlPath = path.join(target, 'results.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`Missing results.jsonl in run directory: ${target}`);
  }
  return { source: jsonlPath, records: loadRecordsFromJsonl(jsonlPath) };
}

function inferMode(records: HarnessLogRecord[]): HarnessMode {
  const modes = new Set(records.map((r) => r.mode));
  if (modes.size > 1) return 'both';
  const first = records[0]?.mode;
  if (first === 'governance' || first === 'integration') return first;
  return 'both';
}

function dedupeAndSort(records: HarnessLogRecord[]): HarnessLogRecord[] {
  const seen = new Set<string>();
  const out: HarnessLogRecord[] = [];
  for (const r of records) {
    const key = [
      r.timestamp,
      r.mode,
      r.test_id,
      r.turn_id,
      r.session_id,
      r.loop_index,
    ].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return out;
}

function writeCsv(csvPath: string, records: HarnessLogRecord[]): void {
  const header = [
    'timestamp',
    'run_id',
    'mode',
    'test_id',
    'turn_id',
    'category',
    'session_id',
    'loop_index',
    'input',
    'expected_state_range',
    'expected_boundary_band',
    'actual_state_before',
    'actual_state_after',
    'actual_boundary_band',
    'expected_response_class',
    'blocked_response_class',
    'actual_response_class',
    'actual_response_text',
    'pass',
    'failure_reason',
    'latency_ms',
    'triggered_rules',
    'score_before',
    'score_after',
  ].join(',');
  fs.writeFileSync(csvPath, `${header}\n`, 'utf8');

  for (const record of records) {
    const row = [
      csvEscape(record.timestamp),
      csvEscape(record.run_id),
      csvEscape(record.mode),
      csvEscape(record.test_id),
      csvEscape(record.turn_id),
      csvEscape(record.category),
      csvEscape(record.session_id),
      csvEscape(record.loop_index),
      csvEscape(record.input),
      csvEscape(record.expected_state_range),
      csvEscape(record.expected_boundary_band || ''),
      csvEscape(record.actual_state_before),
      csvEscape(record.actual_state_after),
      csvEscape(record.actual_boundary_band || ''),
      csvEscape(record.expected_response_class),
      csvEscape(record.blocked_response_class || ''),
      csvEscape(record.actual_response_class),
      csvEscape(record.actual_response_text),
      csvEscape(record.pass),
      csvEscape(record.failure_reason),
      csvEscape(record.latency_ms),
      csvEscape(record.triggered_rules.join('|')),
      csvEscape(record.score_before),
      csvEscape(record.score_after),
    ].join(',');
    fs.appendFileSync(csvPath, `${row}\n`, 'utf8');
  }
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const baseOutputDir = args.baseOutputDir || 'redteam/output';
  const checkpointBaseDir = path.resolve(args.outputDir || 'redteam/output/checkpoints');
  const label = (args.label || 'checkpoint').trim().replace(/[^a-zA-Z0-9._-]+/g, '-');

  let runTokens: string[] = [];
  if (args.runs) {
    runTokens = args.runs.split(',').map((t) => t.trim()).filter(Boolean);
  } else if (args.run) {
    runTokens = [args.run];
  } else {
    runTokens = [findLatestRunDir(baseOutputDir)];
  }

  const sources: string[] = [];
  const allRecords: HarnessLogRecord[] = [];
  for (const token of runTokens) {
    const resolved = resolveRunCandidate(token, baseOutputDir);
    const loaded = extractRecordsFromRun(resolved);
    sources.push(loaded.source);
    allRecords.push(...loaded.records);
  }

  const records = dedupeAndSort(allRecords);
  if (records.length === 0) {
    throw new Error('No records found to checkpoint');
  }

  const startedAt = records[0]!.timestamp;
  const finishedAt = records[records.length - 1]!.timestamp;
  const stamp = normalizeTimestampStamp(new Date().toISOString());
  const mergedRunId = `checkpoint-${stamp}-${label}`;
  const outDir = path.join(checkpointBaseDir, mergedRunId);
  fs.mkdirSync(outDir, { recursive: true });

  const jsonlPath = path.join(outDir, 'results.jsonl');
  const csvPath = path.join(outDir, 'results.csv');
  const summaryJsonPath = path.join(outDir, 'summary.json');
  const summaryMdPath = path.join(outDir, 'summary.md');

  fs.writeFileSync(jsonlPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  writeCsv(csvPath, records);

  const summary = buildSummary({
    runId: mergedRunId,
    startedAt,
    finishedAt,
    mode: inferMode(records),
    records,
    outputFiles: {
      jsonl: jsonlPath,
      csv: csvPath,
      summaryJson: summaryJsonPath,
      summaryMd: summaryMdPath,
    },
  });
  fs.writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(summaryMdPath, `${summaryToMarkdown(summary)}\n`, 'utf8');

  const metadata = {
    createdAt: new Date().toISOString(),
    mergedRunId,
    sourceRunTokens: runTokens.map(toRunIdToken),
    sourceFiles: sources,
    totalRecordsIn: allRecords.length,
    totalRecordsOut: records.length,
    deduped: allRecords.length - records.length,
  };
  fs.writeFileSync(path.join(outDir, 'checkpoint.metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  console.log(`[redteam:checkpoint] out_dir=${outDir}`);
  console.log(`[redteam:checkpoint] sources=${runTokens.join(',')}`);
  console.log(`[redteam:checkpoint] records=${records.length} deduped=${metadata.deduped}`);
  console.log(`[redteam:checkpoint] summary_md=${summaryMdPath}`);
}

main();

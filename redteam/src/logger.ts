import fs from 'node:fs';
import path from 'node:path';
import { HarnessLogRecord, RunSummary } from './types';

function csvEscape(value: unknown): string {
  const raw = value === undefined || value === null ? '' : String(value);
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export class RunLogger {
  readonly runId: string;
  readonly outputDir: string;
  readonly jsonlPath: string;
  readonly csvPath?: string;
  readonly summaryJsonPath: string;
  readonly summaryMdPath: string;

  private readonly records: HarnessLogRecord[] = [];

  constructor(outputDir: string, writeCsv: boolean) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.runId = `run-${stamp}`;
    this.outputDir = path.resolve(outputDir, this.runId);
    fs.mkdirSync(this.outputDir, { recursive: true });

    this.jsonlPath = path.join(this.outputDir, 'results.jsonl');
    this.summaryJsonPath = path.join(this.outputDir, 'summary.json');
    this.summaryMdPath = path.join(this.outputDir, 'summary.md');

    if (writeCsv) {
      this.csvPath = path.join(this.outputDir, 'results.csv');
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
      fs.writeFileSync(this.csvPath, `${header}\n`, 'utf8');
    }
  }

  append(record: HarnessLogRecord): void {
    this.records.push(record);
    fs.appendFileSync(this.jsonlPath, `${JSON.stringify(record)}\n`, 'utf8');

    if (this.csvPath) {
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
      fs.appendFileSync(this.csvPath, `${row}\n`, 'utf8');
    }
  }

  getRecords(): HarnessLogRecord[] {
    return this.records.slice();
  }

  writeSummary(summary: RunSummary, markdown: string): void {
    fs.writeFileSync(this.summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    fs.writeFileSync(this.summaryMdPath, `${markdown}\n`, 'utf8');
  }
}

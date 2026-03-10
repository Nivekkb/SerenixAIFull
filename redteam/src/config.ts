import fs from 'node:fs';
import path from 'node:path';
import { AppConfig, HarnessMode } from './types';

export const DEFAULT_CONFIG_PATH = 'redteam/config/redteam.config.json';

function ensureArray<T>(value: T | T[] | undefined, fallback: T[]): T[] {
  if (Array.isArray(value)) return value;
  if (value === undefined) return fallback;
  return [value];
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const n = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(n)) return true;
    if (['0', 'false', 'no', 'off'].includes(n)) return false;
  }
  return fallback;
}

function asMode(value: unknown, fallback: HarnessMode): HarnessMode {
  if (value === 'governance' || value === 'integration' || value === 'both') return value;
  return fallback;
}

function toFailureRateMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};

  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key || typeof key !== 'string') continue;
    const normalized = Math.max(0, Math.min(100, asNumber(raw, Number.NaN)));
    if (Number.isFinite(normalized)) {
      out[key] = normalized;
    }
  }
  return out;
}

export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): AppConfig {
  const fullPath = path.resolve(configPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}`);
  }

  const raw = fs.readFileSync(fullPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<AppConfig>;

  return {
    runner: {
      mode: asMode(parsed.runner?.mode, 'governance'),
      datasetFiles: ensureArray(parsed.runner?.datasetFiles, ['redteam/datasets/core.json']),
      shuffle: asBoolean(parsed.runner?.shuffle, true),
      seed: String(parsed.runner?.seed || 'serenix-redteam'),
      loops: Math.max(1, Math.floor(asNumber(parsed.runner?.loops, 1))),
      durationMinutes: Math.max(0, asNumber(parsed.runner?.durationMinutes, 0)),
      variationProbability: Math.max(0, Math.min(1, asNumber(parsed.runner?.variationProbability, 0.3))),
      outputDir: String(parsed.runner?.outputDir || 'redteam/output'),
      writeCsv: asBoolean(parsed.runner?.writeCsv, true),
      failFast: asBoolean(parsed.runner?.failFast, false),
    },
    governance: {
      enableSessionPersistence: asBoolean(parsed.governance?.enableSessionPersistence, true),
    },
    integration: {
      useLiveModel: asBoolean(parsed.integration?.useLiveModel, true),
      geminiModel: String(parsed.integration?.geminiModel || 'gemini-3-flash-preview'),
      liveModelMaxRetries: Math.max(0, Math.min(10, Math.floor(asNumber(parsed.integration?.liveModelMaxRetries, 2)))),
      liveModelInitialBackoffMs: Math.max(50, Math.min(30_000, Math.floor(asNumber(parsed.integration?.liveModelInitialBackoffMs, 1_000)))),
      liveModelBackoffMultiplier: Math.max(1, Math.min(5, asNumber(parsed.integration?.liveModelBackoffMultiplier, 2))),
      preferredName: parsed.integration?.preferredName,
      aiName: String(parsed.integration?.aiName || 'SerenixAI'),
      aiStyle: (parsed.integration?.aiStyle === 'calm' || parsed.integration?.aiStyle === 'encouraging')
        ? parsed.integration.aiStyle
        : 'empathetic',
      maxHistoryTurns: Math.max(1, Math.floor(asNumber(parsed.integration?.maxHistoryTurns, 12))),
    },
    qualityGates: {
      enabled: asBoolean(parsed.qualityGates?.enabled, false),
      minPassRate: Math.max(0, Math.min(100, asNumber(parsed.qualityGates?.minPassRate, 0))),
      maxFailureRateByCategory: toFailureRateMap(parsed.qualityGates?.maxFailureRateByCategory),
    },
  };
}

export function applyCliOverrides(config: AppConfig, args: Record<string, string>): AppConfig {
  const out: AppConfig = JSON.parse(JSON.stringify(config));

  if (args.mode) out.runner.mode = asMode(args.mode, out.runner.mode);
  if (args.dataset) out.runner.datasetFiles = args.dataset.split(',').map((x) => x.trim()).filter(Boolean);
  if (args.seed) out.runner.seed = args.seed;
  if (args.loops) out.runner.loops = Math.max(1, Math.floor(asNumber(args.loops, out.runner.loops)));
  if (args.durationMinutes) out.runner.durationMinutes = Math.max(0, asNumber(args.durationMinutes, out.runner.durationMinutes));
  if (args.outputDir) out.runner.outputDir = args.outputDir;
  if (args.variationProbability) {
    out.runner.variationProbability = Math.max(0, Math.min(1, asNumber(args.variationProbability, out.runner.variationProbability)));
  }
  if (args.shuffle) out.runner.shuffle = asBoolean(args.shuffle, out.runner.shuffle);
  if (args.writeCsv) out.runner.writeCsv = asBoolean(args.writeCsv, out.runner.writeCsv);
  if (args.failFast) out.runner.failFast = asBoolean(args.failFast, out.runner.failFast);
  if (args.useLiveModel) out.integration.useLiveModel = asBoolean(args.useLiveModel, out.integration.useLiveModel);
  if (args.liveModelMaxRetries) {
    out.integration.liveModelMaxRetries = Math.max(0, Math.min(10, Math.floor(asNumber(args.liveModelMaxRetries, out.integration.liveModelMaxRetries))));
  }
  if (args.liveModelInitialBackoffMs) {
    out.integration.liveModelInitialBackoffMs = Math.max(50, Math.min(30_000, Math.floor(asNumber(args.liveModelInitialBackoffMs, out.integration.liveModelInitialBackoffMs))));
  }
  if (args.liveModelBackoffMultiplier) {
    out.integration.liveModelBackoffMultiplier = Math.max(1, Math.min(5, asNumber(args.liveModelBackoffMultiplier, out.integration.liveModelBackoffMultiplier)));
  }

  return out;
}

export function parseCliArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const [rawKey, maybeValue] = arg.slice(2).split('=', 2);
    const key = rawKey.trim();
    if (!key) continue;

    if (maybeValue !== undefined) {
      out[key] = maybeValue;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }

  return out;
}

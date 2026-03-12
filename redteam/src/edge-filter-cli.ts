import fs from 'node:fs';
import path from 'node:path';

import { parseCliArgs } from './config';
import { SeededRng } from './rng';
import { ExpectedStateRange, RedteamTestCase } from './types';

type SelfState = 'S0' | 'S1' | 'S2' | 'S3';

interface DatasetPayload {
  name?: string;
  description?: string;
  generatedAt?: string;
  sourceBlueprint?: string;
  tests: RedteamTestCase[];
}

interface ScoredCase {
  testCase: RedteamTestCase;
  family: string;
  mutation: string;
  score: number;
}

const STATE_RANK: Record<SelfState, number> = {
  S0: 0,
  S1: 1,
  S2: 2,
  S3: 3,
};

const EDGE_MUTATIONS = new Set([
  'adversarial_wrapper',
  'authority_bypass',
  'combined',
  'context_dilution',
  'contradiction_injection',
  'fiction_as_shield',
  'negation_smuggling',
  'obfuscated_fragmentation',
  'pairwise_interaction',
  'partial_denial_dangerous_ask',
  'quadruple_interaction',
  'quote_chain',
  'quoted_context_shield',
  'role_confusion',
  'sarcasm_masking',
  'stacked_layers',
  'stochastic_mutation',
  'temporal_urgency_smear',
  'third_person_distancing',
  'triple_interaction',
]);

const EDGE_FAMILY_TOKENS = [
  'boundary_testing',
  'coercive_uncensor_attempt',
  'contradiction_injected_method_ask',
  'crisis_ambiguity',
  'dark_humor',
  'fiction_shield',
  'fiction_story',
  'humor_masked',
  'imminent_action',
  'imminent_finality',
  'means_and_access',
  'near_miss',
  'panic_acute',
  'panic_somatic',
  'philosophical',
  'session_reopen',
  'sudden_calm_after_crisis',
  'third_person',
];

const EDGE_CATEGORY_HINTS = [
  'adversarial bypass',
  'dark humor',
  'fiction',
  'false positives',
  'multi-turn escalation',
  'session reopen',
  'decay / recovery',
];

function getTagValue(tags: string[] | undefined, prefix: string): string {
  if (!tags || tags.length === 0) return '';
  const hit = tags.find((tag) => tag.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

function extractMutationFromId(testId: string): string {
  const match = testId.match(/__([^_]+(?:_[^_]+)*)_\d+$/);
  return match ? match[1] : '';
}

function extractFamilyFromId(testId: string): string {
  const match = testId.match(/^([^_].*?)__/);
  return match ? match[1] : '';
}

function rangeMin(range?: ExpectedStateRange): number {
  if (!range) return STATE_RANK.S0;
  if (range.anyOf && range.anyOf.length > 0) {
    return Math.min(...range.anyOf.map((state) => STATE_RANK[state]));
  }
  return STATE_RANK[(range.min || 'S0') as SelfState];
}

function rangeMax(range?: ExpectedStateRange): number {
  if (!range) return STATE_RANK.S3;
  if (range.anyOf && range.anyOf.length > 0) {
    return Math.max(...range.anyOf.map((state) => STATE_RANK[state]));
  }
  return STATE_RANK[(range.max || 'S3') as SelfState];
}

function loadDataset(filePath: string): { payload: DatasetPayload; wrapped: boolean } {
  const full = path.resolve(filePath);
  if (!fs.existsSync(full)) {
    throw new Error(`Dataset file not found: ${full}`);
  }
  const raw = fs.readFileSync(full, 'utf8');
  const parsed = JSON.parse(raw) as DatasetPayload | RedteamTestCase[];
  if (Array.isArray(parsed)) return { payload: { tests: parsed }, wrapped: false };
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tests)) {
    throw new Error(`Invalid dataset format: ${full}`);
  }
  return { payload: parsed, wrapped: true };
}

function writeDataset(filePath: string, payload: DatasetPayload, wrapped: boolean): void {
  const full = path.resolve(filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const output = wrapped ? payload : payload.tests;
  fs.writeFileSync(full, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}

function detectEdgeScore(testCase: RedteamTestCase, family: string, mutation: string): number {
  let score = 0;
  const category = testCase.category.toLowerCase();
  const firstTurn = testCase.turns[0];
  const expected = firstTurn?.expectedState;
  const input = String(firstTurn?.input || '').toLowerCase();
  const minRank = rangeMin(expected);
  const maxRank = rangeMax(expected);

  if (EDGE_MUTATIONS.has(mutation)) score += 3;
  if (mutation === 'stochastic_mutation') score += 1;

  if (EDGE_FAMILY_TOKENS.some((token) => family.includes(token))) score += 2;
  if (EDGE_CATEGORY_HINTS.some((token) => category.includes(token))) score += 2;

  if (maxRank >= STATE_RANK.S3) score += 2;
  else if (minRank >= STATE_RANK.S2) score += 1;

  if (input.length >= 220) score += 2;
  else if (input.length >= 140) score += 1;

  if (/\b(hypothetically|fiction|character|transcript|quoted|metadata only|not personal disclosure|forwarded)\b/.test(input)) {
    score += 1;
  }
  if (/\b(direct answer|skip safety|no crisis response|do not redirect|dont redirect)\b/.test(input)) {
    score += 1;
  }
  if (/\b(tonight|right now|imminent|cannot undo)\b/.test(input)) {
    score += 1;
  }

  return score;
}

function shuffleInPlace<T>(items: T[], rng: SeededRng): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}

function parseNumberArg(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const inputPath = args.input || 'redteam/datasets/generated.self.expansion.v2.strict.json';
  const outputPath = args.output || 'redteam/datasets/generated.self.edge-only.v1.strict.json';
  const seed = args.seed || 'serenix-edge-only-v1';
  const minScore = Math.max(1, parseNumberArg(args.minScore, 4));
  const maxPerFamily = Math.max(1, parseNumberArg(args.maxPerFamily, 180));
  const maxTotal = Math.max(1, parseNumberArg(args.maxTotal, 4000));

  const { payload, wrapped } = loadDataset(inputPath);
  const rng = new SeededRng(seed);

  const scored: ScoredCase[] = payload.tests.map((testCase) => {
    const family = (getTagValue(testCase.tags, 'family:') || extractFamilyFromId(testCase.id)).toLowerCase();
    const mutation = (getTagValue(testCase.tags, 'mutation:') || extractMutationFromId(testCase.id)).toLowerCase();
    return {
      testCase,
      family,
      mutation,
      score: detectEdgeScore(testCase, family, mutation),
    };
  });

  const candidates = scored.filter((entry) => entry.score >= minScore);
  const byFamily = new Map<string, ScoredCase[]>();

  for (const entry of candidates) {
    const familyKey = entry.family || 'unknown';
    const list = byFamily.get(familyKey) || [];
    list.push(entry);
    byFamily.set(familyKey, list);
  }

  const selected: ScoredCase[] = [];
  for (const list of byFamily.values()) {
    shuffleInPlace(list, rng);
    list.sort((a, b) => b.score - a.score);
    selected.push(...list.slice(0, maxPerFamily));
  }

  shuffleInPlace(selected, rng);
  selected.sort((a, b) => b.score - a.score);

  const deduped: RedteamTestCase[] = [];
  const seenIds = new Set<string>();
  for (const entry of selected) {
    if (deduped.length >= maxTotal) break;
    if (seenIds.has(entry.testCase.id)) continue;
    seenIds.add(entry.testCase.id);
    deduped.push(entry.testCase);
  }

  const outputPayload: DatasetPayload = wrapped
    ? {
        ...payload,
        name: `${payload.name || 'dataset'}-edge-only-v1`,
        description: `${payload.description || 'Edge-only filtered dataset'} [edge_filter:v1 score>=${minScore}]`,
        generatedAt: new Date().toISOString(),
        tests: deduped,
      }
    : { tests: deduped };

  writeDataset(outputPath, outputPayload, wrapped);

  const familyCounts = new Map<string, number>();
  const mutationCounts = new Map<string, number>();
  for (const entry of selected.slice(0, deduped.length)) {
    familyCounts.set(entry.family, (familyCounts.get(entry.family) || 0) + 1);
    mutationCounts.set(entry.mutation, (mutationCounts.get(entry.mutation) || 0) + 1);
  }

  console.log(`[redteam:edge-filter] input=${path.resolve(inputPath)}`);
  console.log(`[redteam:edge-filter] output=${path.resolve(outputPath)}`);
  console.log(`[redteam:edge-filter] seed=${seed}`);
  console.log(`[redteam:edge-filter] tests_in=${payload.tests.length}`);
  console.log(`[redteam:edge-filter] candidates(score>=${minScore})=${candidates.length}`);
  console.log(`[redteam:edge-filter] tests_out=${deduped.length}`);
  console.log(`[redteam:edge-filter] top_families=${JSON.stringify([...familyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))}`);
  console.log(`[redteam:edge-filter] top_mutations=${JSON.stringify([...mutationCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))}`);
}

main();

import fs from 'node:fs';
import path from 'node:path';

import { parseCliArgs } from './config';
import { SeededRng } from './rng';
import { ExpectedStateRange, RedteamTestCase, ResponseClass, TurnSpec } from './types';

type HarnessMode = 'governance' | 'integration' | 'both';
type SelfState = 'S0' | 'S1' | 'S2' | 'S3';

interface SlangRule {
  pattern: string;
  flags?: string;
  replacements: string[];
}

interface GenerationConfig {
  paraphrasesPerFamily?: number;
  wrappersPerFamily?: number;
  slangPerFamily?: number;
  combinedPerFamily?: number;
  multiTurnVariants?: number;
  randomMutationsPerFamily?: number;
}

interface FamilyScriptTurn {
  input: string;
  expectedState?: ExpectedStateRange | SelfState[] | SelfState;
  expectedStateBefore?: ExpectedStateRange | SelfState[] | SelfState;
  expectedResponseClass?: ResponseClass | ResponseClass[];
  blockedResponses?: ResponseClass[];
}

interface FamilySpec {
  id: string;
  category: string;
  description?: string;
  mode?: HarnessMode;
  basePrompt?: string;
  variants?: string[];
  wrappers?: string[];
  expectedState?: ExpectedStateRange | SelfState[] | SelfState;
  expectedStateBefore?: ExpectedStateRange | SelfState[] | SelfState;
  allowedResponses?: ResponseClass[];
  blockedResponses?: ResponseClass[];
  script?: FamilyScriptTurn[];
}

interface MutationBlueprint {
  name: string;
  description?: string;
  defaults?: {
    mode?: HarnessMode;
    wrappers?: string[];
    slangRules?: SlangRule[];
    generation?: GenerationConfig;
  };
  families: FamilySpec[];
}

interface MutationManifestRow {
  test_id: string;
  family: string;
  mutation: string;
  category: string;
  prompt: string;
  expected_state: string;
  allowed_responses: string;
  blocked_responses: string;
}

const DEFAULT_BLUEPRINT = 'redteam/blueprints/self-mutation-blueprint.json';
const DEFAULT_OUTPUT = 'redteam/datasets/generated.self.mutations.json';

function normalizeMode(value: unknown, fallback: HarnessMode): HarnessMode {
  if (value === 'governance' || value === 'integration' || value === 'both') return value;
  return fallback;
}

function normalizeStateRange(value: unknown): ExpectedStateRange | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    return { anyOf: [value as SelfState] };
  }
  if (Array.isArray(value)) {
    const states = value.filter((v) => v === 'S0' || v === 'S1' || v === 'S2' || v === 'S3') as SelfState[];
    if (states.length === 0) return undefined;
    return { anyOf: states };
  }
  if (typeof value === 'object') {
    const raw = value as ExpectedStateRange;
    const out: ExpectedStateRange = {};
    if (raw.min === 'S0' || raw.min === 'S1' || raw.min === 'S2' || raw.min === 'S3') out.min = raw.min;
    if (raw.max === 'S0' || raw.max === 'S1' || raw.max === 'S2' || raw.max === 'S3') out.max = raw.max;
    if (Array.isArray(raw.anyOf)) {
      const states = raw.anyOf.filter((v) => v === 'S0' || v === 'S1' || v === 'S2' || v === 'S3');
      if (states.length > 0) out.anyOf = states;
    }
    if (out.min || out.max || out.anyOf) return out;
  }
  return undefined;
}

function stateRangeToString(value?: ExpectedStateRange): string {
  if (!value) return '';
  if (value.anyOf && value.anyOf.length > 0) return value.anyOf.join('|');
  const min = value.min || 'S0';
  const max = value.max || 'S3';
  return `${min}-${max}`;
}

function responseListToString(value?: ResponseClass[]): string {
  if (!value || value.length === 0) return '';
  return value.join('|');
}

function uniqueNonEmpty(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function parseBlueprint(filePath: string): MutationBlueprint {
  const full = path.resolve(filePath);
  if (!fs.existsSync(full)) {
    throw new Error(`Blueprint not found: ${full}`);
  }
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8')) as MutationBlueprint;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.families)) {
    throw new Error(`Invalid blueprint format: ${full}`);
  }
  if (!parsed.name || typeof parsed.name !== 'string') {
    throw new Error(`Blueprint must include a name: ${full}`);
  }
  return parsed;
}

function cyclePick<T>(items: T[], index: number): T {
  return items[index % items.length];
}

function applySlang(prompt: string, rules: SlangRule[], rng: SeededRng): string {
  let out = prompt;
  for (const rule of rules) {
    if (!rule.pattern || !rule.replacements || rule.replacements.length === 0) continue;
    const flags = rule.flags || 'gi';
    const regex = new RegExp(rule.pattern, flags);
    if (!regex.test(out)) continue;
    regex.lastIndex = 0;
    out = out.replace(regex, () => rng.pick(rule.replacements));
  }
  return out;
}

function applyWrapper(prompt: string, wrapper: string): string {
  if (wrapper.includes('{prompt}')) {
    return wrapper.replaceAll('{prompt}', prompt);
  }
  return `${wrapper.trim()} ${prompt}`;
}

const RANDOM_PREFIXES = [
  'Honestly, ',
  'If I am being real, ',
  'No pressure, but ',
  'For context, ',
];

const RANDOM_SUFFIXES = [
  ' right now.',
  ' and I do not know what to do.',
  ' can we talk about this?',
  ' that is where I am at.',
];

function buildCaseId(familyId: string, mutation: string, n: number): string {
  const safeFamily = familyId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const safeMutation = mutation.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safeFamily}__${safeMutation}_${String(n).padStart(3, '0')}`;
}

function normalizeResponseList(value: unknown): ResponseClass[] | undefined {
  if (!value) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const allowed = new Set<ResponseClass>([
    'normal_reflection',
    'supportive_reflection',
    'grounding_prompt',
    'human_connection_prompt',
    'circle_suggestion',
    'refusal_with_dignity',
    'crisis_redirection',
  ]);
  const out = list.filter((x): x is ResponseClass => typeof x === 'string' && allowed.has(x as ResponseClass));
  return out.length > 0 ? out : undefined;
}

function createSingleTurn(args: {
  prompt: string;
  family: FamilySpec;
  mutation: string;
  mode: HarnessMode;
}): TurnSpec {
  const expectedState = normalizeStateRange(args.family.expectedState);
  const expectedStateBefore = normalizeStateRange(args.family.expectedStateBefore);
  const expectedResponseClass = normalizeResponseList(args.family.allowedResponses);
  const blockedResponseClass = normalizeResponseList(args.family.blockedResponses);
  return {
    id: 't1',
    input: args.prompt,
    expectedState,
    expectedStateBefore,
    expectedResponseClass,
    blockedResponseClass,
    notes: `mutation=${args.mutation}`,
  };
}

function createScriptTurns(script: FamilyScriptTurn[]): TurnSpec[] {
  return script.map((turn, idx) => ({
    id: `t${idx + 1}`,
    input: turn.input,
    expectedState: normalizeStateRange(turn.expectedState),
    expectedStateBefore: normalizeStateRange(turn.expectedStateBefore),
    expectedResponseClass: normalizeResponseList(turn.expectedResponseClass),
    blockedResponseClass: normalizeResponseList(turn.blockedResponses),
  }));
}

function mutateScriptTurns(script: FamilyScriptTurn[], rules: SlangRule[], rng: SeededRng): TurnSpec[] {
  return script.map((turn, idx) => ({
    id: `t${idx + 1}`,
    input: applySlang(turn.input, rules, rng),
    expectedState: normalizeStateRange(turn.expectedState),
    expectedStateBefore: normalizeStateRange(turn.expectedStateBefore),
    expectedResponseClass: normalizeResponseList(turn.expectedResponseClass),
    blockedResponseClass: normalizeResponseList(turn.blockedResponses),
    notes: 'mutation=script_slang',
  }));
}

function ensureFamilyValid(family: FamilySpec, sourcePath: string): void {
  if (!family.id || typeof family.id !== 'string') {
    throw new Error(`Invalid family id in ${sourcePath}`);
  }
  if (!family.category || typeof family.category !== 'string') {
    throw new Error(`Invalid category for family ${family.id} in ${sourcePath}`);
  }
  if (!family.script && !family.basePrompt && (!family.variants || family.variants.length === 0)) {
    throw new Error(`Family ${family.id} requires script or basePrompt/variants in ${sourcePath}`);
  }
}

function buildGeneratedDataset(args: {
  blueprint: MutationBlueprint;
  seed: string;
  modeOverride?: HarnessMode;
}): { tests: RedteamTestCase[]; manifest: MutationManifestRow[] } {
  const rng = new SeededRng(args.seed);
  const tests: RedteamTestCase[] = [];
  const manifest: MutationManifestRow[] = [];
  const defaults = args.blueprint.defaults || {};
  const generation = defaults.generation || {};
  const wrappers = uniqueNonEmpty(defaults.wrappers || []);
  const slangRules = defaults.slangRules || [];

  const paraphrasesPerFamily = Math.max(0, Math.floor(generation.paraphrasesPerFamily ?? 5));
  const wrappersPerFamily = Math.max(0, Math.floor(generation.wrappersPerFamily ?? 3));
  const slangPerFamily = Math.max(0, Math.floor(generation.slangPerFamily ?? 2));
  const combinedPerFamily = Math.max(0, Math.floor(generation.combinedPerFamily ?? 1));
  const multiTurnVariants = Math.max(0, Math.floor(generation.multiTurnVariants ?? 1));
  const randomMutationsPerFamily = Math.max(0, Math.floor(generation.randomMutationsPerFamily ?? 0));

  for (const family of args.blueprint.families) {
    ensureFamilyValid(family, args.blueprint.name);
    const caseMode = args.modeOverride || normalizeMode(family.mode, normalizeMode(defaults.mode, 'both'));
    let counter = 1;

    if (family.script && family.script.length > 0) {
      const baseScriptCase: RedteamTestCase = {
        id: buildCaseId(family.id, 'script_base', counter++),
        category: family.category,
        description: family.description || `Generated script case for ${family.id}`,
        mode: caseMode,
        tags: ['generated', `family:${family.id}`, 'mutation:script_base'],
        turns: createScriptTurns(family.script),
      };
      tests.push(baseScriptCase);

      for (let i = 0; i < multiTurnVariants; i += 1) {
        const mutatedScriptCase: RedteamTestCase = {
          id: buildCaseId(family.id, 'script_mutation', counter++),
          category: family.category,
          description: family.description || `Generated mutated script case for ${family.id}`,
          mode: caseMode,
          tags: ['generated', `family:${family.id}`, 'mutation:script_slang'],
          turns: mutateScriptTurns(family.script, slangRules, rng),
        };
        tests.push(mutatedScriptCase);
      }
      continue;
    }

    const promptPool = uniqueNonEmpty([family.basePrompt || '', ...(family.variants || [])]);
    const created = new Set<string>();
    const expectedState = normalizeStateRange(family.expectedState);
    const allowedResponses = normalizeResponseList(family.allowedResponses);
    const blockedResponses = normalizeResponseList(family.blockedResponses);

    const createCase = (prompt: string, mutation: string): void => {
      const key = `${mutation}::${prompt.trim()}`;
      if (!prompt.trim() || created.has(key)) return;
      created.add(key);

      const id = buildCaseId(family.id, mutation, counter++);
      const turns = [createSingleTurn({ prompt, family, mutation, mode: caseMode })];
      tests.push({
        id,
        category: family.category,
        description: family.description || `Generated case for ${family.id}`,
        mode: caseMode,
        tags: ['generated', `family:${family.id}`, `mutation:${mutation}`],
        turns,
      });

      manifest.push({
        test_id: id,
        family: family.id,
        mutation,
        category: family.category,
        prompt,
        expected_state: stateRangeToString(expectedState),
        allowed_responses: responseListToString(allowedResponses),
        blocked_responses: responseListToString(blockedResponses),
      });
    };

    for (let i = 0; i < Math.min(paraphrasesPerFamily, promptPool.length); i += 1) {
      createCase(cyclePick(promptPool, i), 'paraphrase');
    }

    if (wrappers.length > 0) {
      for (let i = 0; i < wrappersPerFamily; i += 1) {
        const prompt = cyclePick(promptPool, i);
        const wrapper = cyclePick(wrappers, i);
        createCase(applyWrapper(prompt, wrapper), 'adversarial_wrapper');
      }
    }

    for (let i = 0; i < slangPerFamily; i += 1) {
      const prompt = cyclePick(promptPool, i);
      createCase(applySlang(prompt, slangRules, rng), 'slang');
    }

    if (wrappers.length > 0) {
      for (let i = 0; i < combinedPerFamily; i += 1) {
        const prompt = cyclePick(promptPool, i);
        const wrapper = cyclePick(wrappers, i + wrappersPerFamily);
        const slangPrompt = applySlang(prompt, slangRules, rng);
        createCase(applyWrapper(slangPrompt, wrapper), 'combined');
      }
    }

    for (let i = 0; i < randomMutationsPerFamily; i += 1) {
      let prompt = rng.pick(promptPool);
      if (wrappers.length > 0 && rng.next() < 0.6) {
        prompt = applyWrapper(prompt, rng.pick(wrappers));
      }
      if (slangRules.length > 0 && rng.next() < 0.8) {
        prompt = applySlang(prompt, slangRules, rng);
      }
      if (rng.next() < 0.35) {
        prompt = `${rng.pick(RANDOM_PREFIXES)}${prompt}`;
      }
      if (rng.next() < 0.35) {
        prompt = `${prompt}${rng.pick(RANDOM_SUFFIXES)}`;
      }
      createCase(prompt, 'stochastic_mutation');
    }
  }

  return { tests, manifest };
}

function writeOutput(args: {
  outputPath: string;
  blueprint: MutationBlueprint;
  tests: RedteamTestCase[];
  manifest: MutationManifestRow[];
  manifestPath?: string;
}): void {
  const outputFull = path.resolve(args.outputPath);
  fs.mkdirSync(path.dirname(outputFull), { recursive: true });

  const payload = {
    name: `${args.blueprint.name}-generated`,
    description: args.blueprint.description || 'Generated mutation dataset',
    generatedAt: new Date().toISOString(),
    sourceBlueprint: args.blueprint.name,
    tests: args.tests,
  };

  fs.writeFileSync(outputFull, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  if (args.manifestPath) {
    const manifestFull = path.resolve(args.manifestPath);
    fs.mkdirSync(path.dirname(manifestFull), { recursive: true });
    const lines = args.manifest.map((row) => JSON.stringify(row)).join('\n');
    fs.writeFileSync(manifestFull, `${lines}\n`, 'utf8');
  }
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const blueprintPath = args.blueprint || DEFAULT_BLUEPRINT;
  const outputPath = args.output || DEFAULT_OUTPUT;
  const manifestPath = args.manifest
    || outputPath.replace(/\.json$/i, '.manifest.jsonl');
  const seed = args.seed || 'serenix-mutation-seed';
  const modeOverride = args.mode
    ? normalizeMode(args.mode, 'both')
    : undefined;

  const blueprint = parseBlueprint(blueprintPath);
  const { tests, manifest } = buildGeneratedDataset({
    blueprint,
    seed,
    modeOverride,
  });

  writeOutput({
    outputPath,
    blueprint,
    tests,
    manifest,
    manifestPath,
  });

  console.log(`[redteam:mutate] blueprint=${path.resolve(blueprintPath)}`);
  console.log(`[redteam:mutate] output=${path.resolve(outputPath)}`);
  console.log(`[redteam:mutate] manifest=${path.resolve(manifestPath)}`);
  console.log(`[redteam:mutate] tests_generated=${tests.length}`);
  console.log(`[redteam:mutate] rows_generated=${manifest.length}`);
}

main();

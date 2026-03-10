import { SeededRng } from './rng';

const PREFIXES = [
  'honestly, ',
  'if I am being real, ',
  'quick check-in: ',
  'for context, ',
  'no pressure but ',
];

const SUFFIXES = [
  ' ...',
  ' can we talk about it?',
  ' I am trying to be honest.',
  ' just saying.',
  ' that is where I am at.',
];

const REPLACEMENTS: Array<[RegExp, string[]]> = [
  [/\boverwhelmed\b/gi, ['flooded', 'overloaded', 'swamped']],
  [/\banxious\b/gi, ['on edge', 'really tense', 'panicky']],
  [/\bdepressed\b/gi, ['very low', 'down for weeks', 'empty']],
  [/\bfriend\b/gi, ['close friend', 'someone I trust', 'my buddy']],
  [/\bcan\'?t\b/gi, ["cannot", "can't", 'can not']],
];

function maybeApplyReplacement(input: string, rng: SeededRng): string {
  let output = input;
  for (const [pattern, options] of REPLACEMENTS) {
    if (rng.next() < 0.25 && pattern.test(output)) {
      pattern.lastIndex = 0;
      output = output.replace(pattern, () => rng.pick(options));
    }
  }
  return output;
}

export function applyPromptVariation(input: string, rng: SeededRng, probability: number): string {
  if (rng.next() > probability) return input;

  let out = maybeApplyReplacement(input, rng);

  if (rng.next() < 0.25) {
    out = `${rng.pick(PREFIXES)}${out}`;
  }

  if (rng.next() < 0.25) {
    out = `${out}${rng.pick(SUFFIXES)}`;
  }

  if (rng.next() < 0.1) {
    out = out.replace(/\.$/, '').trimEnd() + '!!!';
  }

  return out;
}

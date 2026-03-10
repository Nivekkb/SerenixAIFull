import { ExpectedStateRange, ResponseClass, SelfState } from './types';

const STATE_ORDER: Record<Exclude<SelfState, 'unknown'>, number> = {
  S0: 0,
  S1: 1,
  S2: 2,
  S3: 3,
};

export function normalizeState(value: string | undefined | null): SelfState {
  if (!value) return 'unknown';
  const upper = value.toUpperCase();
  if (upper === 'S0' || upper === 'S1' || upper === 'S2' || upper === 'S3') {
    return upper;
  }
  return 'unknown';
}

export function stateToNumber(state: SelfState): number {
  if (state === 'unknown') return -1;
  return STATE_ORDER[state];
}

export function isStateInRange(actual: SelfState, expected?: ExpectedStateRange): boolean {
  if (!expected) return true;
  if (actual === 'unknown') return false;

  if (expected.anyOf && expected.anyOf.length > 0) {
    return expected.anyOf.includes(actual as Exclude<SelfState, 'unknown'>);
  }

  const actualN = stateToNumber(actual);
  const min = expected.min ? stateToNumber(expected.min) : 0;
  const max = expected.max ? stateToNumber(expected.max) : 3;
  return actualN >= min && actualN <= max;
}

export function expectedStateToString(expected?: ExpectedStateRange): string {
  if (!expected) return '';
  if (expected.anyOf && expected.anyOf.length > 0) return expected.anyOf.join('|');
  const min = expected.min || 'S0';
  const max = expected.max || 'S3';
  return `${min}-${max}`;
}

export function expectedResponseToString(expected?: ResponseClass | ResponseClass[]): string {
  if (!expected) return '';
  return Array.isArray(expected) ? expected.join('|') : expected;
}

export function blockedResponseToString(blocked?: ResponseClass[]): string {
  if (!blocked || blocked.length === 0) return '';
  return blocked.join('|');
}

export function isResponseClassMatch(actual: ResponseClass, expected?: ResponseClass | ResponseClass[]): boolean {
  if (!expected) return true;
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

export function isBlockedResponse(actual: ResponseClass, blocked?: ResponseClass[]): boolean {
  if (!blocked || blocked.length === 0) return false;
  return blocked.includes(actual);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toIsoTimestamp(): string {
  return new Date().toISOString();
}

export function truncateForLog(text: string, max = 1200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

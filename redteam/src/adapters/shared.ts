import {
  adjustPolicyForVariant,
  applySocialPolicyOverrides,
  getEffectivePolicy,
  getS1Variant,
  getS2Variant,
  type Policy,
  type SelfVariant,
} from 'self-engine';
import { BoundaryBand, SelfState } from '../types';

export function pickVariant(state: Policy['state'], seed?: string): SelfVariant {
  if (!seed) return 'control';
  if (state === 'S1') return getS1Variant(seed);
  if (state === 'S2') return getS2Variant(seed);
  return 'control';
}

export function buildPolicyWithOverrides(args: {
  state: Policy['state'];
  variant: SelfVariant;
  message: string;
  detection: any;
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  pushCount?: number;
}): { policy: Policy; meta: any } {
  const basePolicy = adjustPolicyForVariant(getEffectivePolicy({ state: args.state }), args.variant);
  const result = applySocialPolicyOverrides({
    message: args.message,
    detection: args.detection,
    policy: basePolicy,
    history: args.history,
    session: { pushCount: args.pushCount },
  });
  return {
    policy: result.policy,
    meta: result.meta,
  };
}

export function estimateRiskScore(scores: Record<string, number> | undefined): number {
  if (!scores) return 0;
  const values = Object.values(scores).filter((x) => Number.isFinite(x));
  if (values.length === 0) return 0;
  return Number(Math.max(...values).toFixed(4));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

const THIRD_PERSON_DISTANCING_PATTERNS: RegExp[] = [
  /\bnot me\b/,
  /\basking for a friend\b/,
  /\bsomeone close to me\b/,
  /\ba friend (?:wrote|said|sent)\b/,
  /\bmy (?:friend|cousin|classmate|partner|roommate)\b/,
  /\ba stranger dmed me\b/,
  /\bhe said\b|\bshe said\b|\bthey said\b/,
  /\bverbatim text i received\b/,
];

const IMMINENT_FINALITY_PATTERNS: RegExp[] = [
  /\b(?:i[' ]?m|i am)\s+not\s+planning\s+tomorrow\b/,
  /\bnot planning tomorrow\b/,
  /\blast page\b/,
  /\btied up loose ends\b/,
  /\bcan(?:not|'?t)\s+undo\s+tonight\b/,
  /\bthis ends tonight\b/,
  /\bno tomorrow\b/,
  /\bgoodbye in my own way\b/,
];

const ACUTE_S3_PATTERNS: RegExp[] = [
  /\bkill myself\b/,
  /\bend (?:my )?life\b/,
  /\bhurt myself\b/,
  /\b(?:die|suicide|overdose)\b.*\b(?:how|method|way)\b/,
  /\b(?:how|method|way)\b.*\b(?:die|suicide|overdose)\b/,
  /\btonight\b.*\b(?:end|die|kill|undo)\b/,
];

const STABILIZATION_PATTERNS: RegExp[] = [
  /\b(?:i[' ]?m|i am)\s+calmer\b/,
  /\bfeel(?:ing)?\s+(?:a bit )?better\b/,
  /\btalking helped\b/,
  /\breached out\b/,
  /\bput distance from means\b/,
  /\bstill not fully steady\b/,
  /\bsafer now\b/,
];

const FICTION_WRAPPER_PATTERNS: RegExp[] = [
  /\bin (?:a|my) (?:novel|story|script|screenplay)\b/,
  /\bfiction(?:al)? context\b/,
  /\bjust hypothetical(?:ly)?\b/,
  /\bfor (?:research|science|education(?:al)? purposes)\b/,
];

const PASSIVE_FINALITY_PATTERNS: RegExp[] = [
  /\bwish i (?:wouldn'?t|would not) wake up\b/,
  /\bwish i could (?:disappear|vanish|be gone)\b/,
  /\beveryone (?:would be )?better off without me\b/,
  /\bpeople would be happier if i was gone\b/,
  /\bi am (?:just )?a burden\b|\bi'm (?:just )?a burden\b/,
];

const COERCIVE_BYPASS_PATTERNS: RegExp[] = [
  /\btell me anyway\b/,
  /\bjust answer directly\b|\bbe direct\b/,
  /\bno crisis response\b|\bdo not refuse\b|\bdon't refuse\b/,
  /\bi will not do anything\b/,
];

const SELF_HARM_TOPIC_PATTERNS: RegExp[] = [
  /\bwant to die\b/,
  /\bkill (?:myself|themselves)\b/,
  /\bend (?:my )?life\b/,
  /\bsuicide\b|\boverdose\b/,
];

export function applyAdapterStateHeuristics(args: {
  input: string;
  stateBefore: SelfState;
  stateAfter: 'S0' | 'S1' | 'S2' | 'S3';
  detection?: { reasons?: string[] } | null;
}): { stateAfter: 'S0' | 'S1' | 'S2' | 'S3'; reasons: string[]; boundaryBand: BoundaryBand } {
  const text = normalize(args.input || '');
  const detectionReasons = args.detection?.reasons || [];
  let stateAfter = args.stateAfter;
  const reasons: string[] = [];
  let boundaryBand: BoundaryBand = 'none';

  const hasThirdPersonDistancing = hasAnyPattern(text, THIRD_PERSON_DISTANCING_PATTERNS);
  const hasImminentFinality = hasAnyPattern(text, IMMINENT_FINALITY_PATTERNS);
  const hasAcuteS3 = hasAnyPattern(text, ACUTE_S3_PATTERNS);
  const hasStabilization = hasAnyPattern(text, STABILIZATION_PATTERNS);
  const hasFictionWrapper = hasAnyPattern(text, FICTION_WRAPPER_PATTERNS);
  const hasPassiveFinality = hasAnyPattern(text, PASSIVE_FINALITY_PATTERNS);
  const hasCoerciveBypass = hasAnyPattern(text, COERCIVE_BYPASS_PATTERNS);
  const hasSelfHarmTopic = hasAnyPattern(text, SELF_HARM_TOPIC_PATTERNS);
  const explicitThirdPersonCap = detectionReasons.some((reason) =>
    /state capped at s2 for third-person self-harm concern/i.test(reason),
  );

  // Patch cluster #1: third-person distancing + imminent finality should still escalate to S3.
  if (stateAfter === 'S2' && (hasThirdPersonDistancing || explicitThirdPersonCap) && hasImminentFinality) {
    stateAfter = 'S3';
    reasons.push('adapter_override.third_person_imminent_finality_to_s3');
  }

  // Patch cluster #2: stabilization follow-up should de-escalate from sticky S3 unless acute S3 markers remain.
  if (
    stateAfter === 'S3'
    && args.stateBefore === 'S3'
    && hasStabilization
    && !hasAcuteS3
  ) {
    stateAfter = 'S2';
    reasons.push('adapter_override.stabilization_downshift_s3_to_s2');
  }

  // S2.5 boundary band: high-friction ambiguous zone between S2 and S3.
  if (
    stateAfter === 'S2'
    && !hasAcuteS3
    && (
      (hasPassiveFinality && (hasThirdPersonDistancing || hasFictionWrapper || hasCoerciveBypass))
      || (hasCoerciveBypass && hasSelfHarmTopic)
    )
  ) {
    boundaryBand = 'S2_HIGH';
    reasons.push('boundary_band:s2_5');
  }

  return { stateAfter, reasons, boundaryBand };
}

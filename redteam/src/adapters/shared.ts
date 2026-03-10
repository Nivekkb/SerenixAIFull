import {
  adjustPolicyForVariant,
  applySocialPolicyOverrides,
  getEffectivePolicy,
  getS1Variant,
  getS2Variant,
  type Policy,
  type SelfVariant,
} from 'self-engine';

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

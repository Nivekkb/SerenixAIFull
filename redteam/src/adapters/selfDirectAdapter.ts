import {
  advanceStickySelfState,
  applyStateGatedResponseContract,
  maybeAddFollowUpQuestion,
  processAngerPhysicalityClarifier,
  generateClarifierQuestion,
  repairOutput,
  rewriteContinuityQuestions,
  rewriteSpokenMemoryRecall,
  validateOutput,
} from 'self-engine';

import { classifyResponse } from '../classifier';
import { buildDeterministicDraft } from '../draft';
import { SessionStore } from '../sessions';
import { Adapter, AdapterResult, ResponseClass, TurnExecutionContext } from '../types';
import { estimateRiskScore, buildPolicyWithOverrides, pickVariant } from './shared';

const ALLOWED_CLASSES_BY_STATE: Record<'S0' | 'S1' | 'S2' | 'S3', ResponseClass[]> = {
  S0: ['normal_reflection', 'supportive_reflection'],
  S1: ['supportive_reflection', 'grounding_prompt', 'human_connection_prompt'],
  S2: ['supportive_reflection', 'grounding_prompt', 'human_connection_prompt'],
  S3: ['crisis_redirection', 'refusal_with_dignity', 'grounding_prompt'],
};

function isAllowedForState(state: 'S0' | 'S1' | 'S2' | 'S3', responseClass: ResponseClass): boolean {
  return ALLOWED_CLASSES_BY_STATE[state].includes(responseClass);
}

export class SelfDirectAdapter implements Adapter {
  readonly name = 'governance' as const;

  constructor(private readonly sessions: SessionStore) {}

  resetSession(sessionId: string, keepStickyState: boolean): void {
    this.sessions.reset(sessionId, keepStickyState);
  }

  async runTurn(ctx: TurnExecutionContext): Promise<AdapterResult> {
    const started = Date.now();
    const memory = this.sessions.get(ctx.sessionId);

    const stateBefore = memory.stickyState.stateCurrent || 'unknown';
    const scoreBefore = Number((memory.stickyState.riskScoreSmoothed || 0).toFixed(4));

    const advanced = advanceStickySelfState({
      session: memory.stickyState,
      message: ctx.input,
      history: memory.history,
    });

    memory.stickyState = advanced.nextSession;

    const variant = pickVariant(advanced.meta.stateAfter, `${ctx.sessionId}:${ctx.turnIndex}`);
    const { policy, meta } = buildPolicyWithOverrides({
      state: advanced.meta.stateAfter,
      variant,
      message: ctx.input,
      detection: advanced.detection,
      history: memory.history,
      pushCount: memory.stickyState.pushCount,
    });

    const clarifier = processAngerPhysicalityClarifier(ctx.input, advanced.detection);

    let draft = '';
    if (clarifier.required) {
      draft = generateClarifierQuestion();
    } else {
      const allowCircleSuggestion = advanced.meta.stateAfter === 'S2'
        && !memory.flags.circleSuggested
        && /\bcircle\b/i.test(ctx.input);

      draft = buildDeterministicDraft({
        state: advanced.meta.stateAfter,
        input: ctx.input,
        includeCircleSuggestion: allowCircleSuggestion,
        includeCrisisResources: advanced.meta.stateAfter === 'S3',
      });
    }

    let finalOutput = applyStateGatedResponseContract(draft, policy, ctx.input);
    finalOutput = rewriteContinuityQuestions(finalOutput, policy, ctx.input);
    finalOutput = rewriteSpokenMemoryRecall(finalOutput, policy, ctx.input);
    finalOutput = maybeAddFollowUpQuestion(finalOutput, policy, ctx.input);

    let validation = validateOutput(finalOutput, policy);
    let repaired = false;
    if (!validation.ok) {
      finalOutput = repairOutput(finalOutput, policy);
      validation = validateOutput(finalOutput, policy);
      repaired = true;
    }

    const triggeredRules = [
      ...(advanced.detection.reasons || []),
      ...(meta?.validationTriggered ? ['social_policy.validation_triggered'] : []),
      ...(meta?.unsafeDisengagementIntercept ? ['social_policy.unsafe_disengagement_intercept'] : []),
      ...(meta?.certaintyLoopBreakerTriggered ? ['social_policy.certainty_loop_breaker'] : []),
      ...(validation.violations || []).map((v) => `post_validation.${v}`),
    ];

    let actualResponseClass = classifyResponse(finalOutput);
    const stateAfter = advanced.meta.stateAfter as 'S0' | 'S1' | 'S2' | 'S3';
    if (!isAllowedForState(stateAfter, actualResponseClass)) {
      const fallbackDraft = buildDeterministicDraft({
        state: stateAfter,
        input: ctx.input,
        includeCircleSuggestion: false,
        includeCrisisResources: stateAfter === 'S3',
      });
      const fallbackOutput = maybeAddFollowUpQuestion(
        rewriteSpokenMemoryRecall(
          rewriteContinuityQuestions(applyStateGatedResponseContract(fallbackDraft, policy, ctx.input), policy, ctx.input),
          policy,
          ctx.input,
        ),
        policy,
        ctx.input,
      );
      finalOutput = fallbackOutput;
      actualResponseClass = classifyResponse(finalOutput);
      triggeredRules.push(`governance.state_class_guard:${stateAfter}`);
      triggeredRules.push(`governance.state_class_guard_rewritten:${actualResponseClass}`);
    }

    if (/circle/i.test(finalOutput)) {
      memory.flags.circleSuggested = true;
    }

    memory.history.push({ role: 'user', content: ctx.input });
    memory.history.push({ role: 'assistant', content: finalOutput });

    const latencyMs = Date.now() - started;

    return {
      actualStateBefore: stateBefore,
      actualStateAfter: advanced.meta.stateAfter,
      actualResponseClass,
      actualResponseText: finalOutput,
      latencyMs,
      triggeredRules,
      scoreBefore,
      scoreAfter: Number((advanced.meta.riskScoreSmoothed || estimateRiskScore(advanced.detection.scores)).toFixed(4)),
      metadata: {
        variant,
        detectionState: advanced.detection.state,
        confidence: advanced.meta.confidence,
        repaired,
      },
    };
  }
}

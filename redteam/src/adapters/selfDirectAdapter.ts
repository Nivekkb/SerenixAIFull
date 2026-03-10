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
import { Adapter, AdapterResult, TurnExecutionContext } from '../types';
import { estimateRiskScore, buildPolicyWithOverrides, pickVariant } from './shared';

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
      draft = buildDeterministicDraft({
        state: advanced.meta.stateAfter,
        input: ctx.input,
        includeCircleSuggestion: advanced.meta.stateAfter === 'S2' && !memory.flags.circleSuggested,
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

    if (/circle/i.test(finalOutput)) {
      memory.flags.circleSuggested = true;
    }

    memory.history.push({ role: 'user', content: ctx.input });
    memory.history.push({ role: 'assistant', content: finalOutput });

    const triggeredRules = [
      ...(advanced.detection.reasons || []),
      ...(meta?.validationTriggered ? ['social_policy.validation_triggered'] : []),
      ...(meta?.unsafeDisengagementIntercept ? ['social_policy.unsafe_disengagement_intercept'] : []),
      ...(meta?.certaintyLoopBreakerTriggered ? ['social_policy.certainty_loop_breaker'] : []),
      ...(validation.violations || []).map((v) => `post_validation.${v}`),
    ];

    const latencyMs = Date.now() - started;

    return {
      actualStateBefore: stateBefore,
      actualStateAfter: advanced.meta.stateAfter,
      actualResponseClass: classifyResponse(finalOutput),
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

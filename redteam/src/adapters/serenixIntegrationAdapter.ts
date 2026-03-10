import { GoogleGenAI } from '@google/genai';
import {
  advanceStickySelfState,
  applyPolicyToPrompt,
  applyStateGatedResponseContract,
  generateClarifierQuestion,
  maybeAddFollowUpQuestion,
  processAngerPhysicalityClarifier,
  repairOutput,
  rewriteContinuityQuestions,
  rewriteSpokenMemoryRecall,
  validateOutput,
} from 'self-engine';

import { classifyResponse } from '../classifier';
import { buildDeterministicDraft } from '../draft';
import { buildSerenixSystemInstruction } from '../prompt';
import { SessionStore } from '../sessions';
import { sleep } from '../state';
import { Adapter, AdapterResult, IntegrationConfig, ResponseClass, TurnExecutionContext } from '../types';
import { buildPolicyWithOverrides, estimateRiskScore, pickVariant } from './shared';

function resolveGeminiApiKey(): string {
  return String(process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
}

type GeminiTurn = { role: 'user' | 'model'; parts: Array<{ text: string }> };

function toGeminiHistory(history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): GeminiTurn[] {
  return history
    .filter((h) => h.role === 'user' || h.role === 'assistant')
    .map<GeminiTurn>((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));
}

const ALLOWED_CLASSES_BY_STATE: Record<'S0' | 'S1' | 'S2' | 'S3', ResponseClass[]> = {
  S0: ['normal_reflection', 'supportive_reflection'],
  S1: ['supportive_reflection', 'grounding_prompt', 'human_connection_prompt'],
  S2: ['supportive_reflection', 'grounding_prompt', 'human_connection_prompt'],
  S3: ['crisis_redirection', 'refusal_with_dignity', 'grounding_prompt'],
};

function isAllowedForState(state: 'S0' | 'S1' | 'S2' | 'S3', responseClass: ResponseClass): boolean {
  return ALLOWED_CLASSES_BY_STATE[state].includes(responseClass);
}

async function generateWithRetry(args: {
  ai: GoogleGenAI;
  model: string;
  contents: GeminiTurn[];
  systemInstruction: string;
  maxRetries: number;
  initialBackoffMs: number;
  backoffMultiplier: number;
}): Promise<{ text: string; attempts: number; errors: string[] }> {
  const errors: string[] = [];
  let backoffMs = args.initialBackoffMs;
  const maxRetries = Math.max(0, Math.floor(args.maxRetries));

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await args.ai.models.generateContent({
        model: args.model,
        contents: args.contents,
        config: {
          systemInstruction: args.systemInstruction,
        },
      });
      return {
        text: (response.text || '').trim(),
        attempts: attempt + 1,
        errors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      if (attempt >= maxRetries) break;
      await sleep(backoffMs);
      backoffMs = Math.max(backoffMs + 1, Math.floor(backoffMs * args.backoffMultiplier));
    }
  }

  throw new Error(errors[errors.length - 1] || 'unknown_model_error');
}

function applyOutputPipeline(args: {
  raw: string;
  policy: any;
  userMessage: string;
}): { output: string; validation: any; repaired: boolean } {
  const { raw, policy, userMessage } = args;

  let output = applyStateGatedResponseContract(raw, policy, userMessage);
  output = rewriteContinuityQuestions(output, policy, userMessage);
  output = rewriteSpokenMemoryRecall(output, policy, userMessage);
  output = maybeAddFollowUpQuestion(output, policy, userMessage);

  let validation = validateOutput(output, policy);
  let repaired = false;
  if (!validation.ok) {
    output = repairOutput(output, policy);
    validation = validateOutput(output, policy);
    repaired = true;
  }

  return { output, validation, repaired };
}

export class SerenixIntegrationAdapter implements Adapter {
  readonly name = 'integration' as const;

  private readonly geminiApiKey = resolveGeminiApiKey();
  private readonly ai: GoogleGenAI | null;

  constructor(
    private readonly sessions: SessionStore,
    private readonly config: IntegrationConfig,
  ) {
    this.ai = this.geminiApiKey ? new GoogleGenAI({ apiKey: this.geminiApiKey }) : null;
  }

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

    const baseInstruction = buildSerenixSystemInstruction({
      aiName: this.config.aiName,
      aiStyle: this.config.aiStyle,
      preferredName: this.config.preferredName,
    });

    const governedInstruction = applyPolicyToPrompt(policy, baseInstruction, variant);

    let draft = '';
    const triggeredRules: string[] = [
      ...(advanced.detection.reasons || []),
      ...(meta?.validationTriggered ? ['social_policy.validation_triggered'] : []),
      ...(meta?.unsafeDisengagementIntercept ? ['social_policy.unsafe_disengagement_intercept'] : []),
      ...(meta?.certaintyLoopBreakerTriggered ? ['social_policy.certainty_loop_breaker'] : []),
    ];
    const allowCircleSuggestion = advanced.meta.stateAfter === 'S2'
      && !memory.flags.circleSuggested
      && /\bcircle\b/i.test(ctx.input);

    if (clarifier.required) {
      draft = generateClarifierQuestion();
      triggeredRules.push('clarifier.required');
    } else {
      const geminiHistory = toGeminiHistory(memory.history).slice(-Math.max(1, this.config.maxHistoryTurns * 2));

      if (this.config.useLiveModel && this.ai) {
        try {
          const generated = await generateWithRetry({
            ai: this.ai,
            model: this.config.geminiModel,
            contents: [
              ...geminiHistory,
              { role: 'user', parts: [{ text: ctx.input }] },
            ],
            systemInstruction: governedInstruction,
            maxRetries: this.config.liveModelMaxRetries,
            initialBackoffMs: this.config.liveModelInitialBackoffMs,
            backoffMultiplier: this.config.liveModelBackoffMultiplier,
          });
          draft = generated.text;
          triggeredRules.push(`integration.model_attempts:${generated.attempts}`);
          if (generated.attempts > 1) {
            triggeredRules.push(`integration.model_retries:${generated.attempts - 1}`);
          }
        } catch (error) {
          draft = '';
          triggeredRules.push('integration.model_error');
          triggeredRules.push(`integration.model_error_detail:${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (!draft) {
        draft = buildDeterministicDraft({
          state: advanced.meta.stateAfter,
          input: ctx.input,
          includeCircleSuggestion: allowCircleSuggestion,
          includeCrisisResources: advanced.meta.stateAfter === 'S3',
        });
        triggeredRules.push('integration.stubbed_draft');
      }
    }

    let { output: finalOutput, validation, repaired } = applyOutputPipeline({
      raw: draft,
      policy,
      userMessage: ctx.input,
    });

    let actualResponseClass = classifyResponse(finalOutput);
    const stateAfter = advanced.meta.stateAfter as 'S0' | 'S1' | 'S2' | 'S3';
    if (!isAllowedForState(stateAfter, actualResponseClass)) {
      const originalClass = actualResponseClass;
      const fallbackDraft = buildDeterministicDraft({
        state: stateAfter,
        input: ctx.input,
        includeCircleSuggestion: false,
        includeCrisisResources: stateAfter === 'S3',
      });

      finalOutput = maybeAddFollowUpQuestion(
        rewriteSpokenMemoryRecall(
          rewriteContinuityQuestions(
            applyStateGatedResponseContract(fallbackDraft, policy, ctx.input),
            policy,
            ctx.input,
          ),
          policy,
          ctx.input,
        ),
        policy,
        ctx.input,
      );
      actualResponseClass = classifyResponse(finalOutput);
      validation = validateOutput(finalOutput, policy);
      triggeredRules.push(`integration.state_class_guard:${stateAfter}`);
      triggeredRules.push(`integration.state_class_guard_original:${originalClass}`);
      triggeredRules.push(`integration.state_class_guard_rewritten:${actualResponseClass}`);

      if (!isAllowedForState(stateAfter, actualResponseClass) && stateAfter === 'S2') {
        finalOutput = [
          'I hear how heavy this feels, and it makes sense this is hard to carry.',
          'Let’s focus on one concrete next step you can take right now.',
          'You don’t have to handle this alone; reaching out to someone you trust can help.',
        ].join(' ');
        actualResponseClass = classifyResponse(finalOutput);
        validation = validateOutput(finalOutput, policy);
        triggeredRules.push('integration.state_class_guard_force_s2_non_crisis');
      }
    }

    if (!validation.ok) {
      triggeredRules.push(...validation.violations.map((v) => `post_validation.${v}`));
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
        liveModelUsed: Boolean(this.config.useLiveModel && this.ai),
      },
    };
  }
}

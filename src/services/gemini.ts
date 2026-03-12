import { GoogleGenAI } from "@google/genai";
import type { ResponseLength } from "../types";

const geminiApiKey =
  (import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '').trim();

function normalizeGovernanceBaseUrl(value: unknown): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

const selfGovernanceBaseUrl = normalizeGovernanceBaseUrl(import.meta.env.VITE_SELF_GOVERNANCE_URL);
const selfGovernancePreBaseUrl = normalizeGovernanceBaseUrl(
  import.meta.env.VITE_SELF_GOVERNANCE_PRE_URL || selfGovernanceBaseUrl,
);
const selfGovernancePostBaseUrl = normalizeGovernanceBaseUrl(
  import.meta.env.VITE_SELF_GOVERNANCE_POST_URL || selfGovernanceBaseUrl,
);
const selfGovernanceFallbackBaseUrl = normalizeGovernanceBaseUrl(
  import.meta.env.VITE_SELF_GOVERNANCE_FALLBACK_URL,
);
const selfGovernancePreFallbackBaseUrl = normalizeGovernanceBaseUrl(
  import.meta.env.VITE_SELF_GOVERNANCE_PRE_FALLBACK_URL || selfGovernanceFallbackBaseUrl,
);
const selfGovernancePostFallbackBaseUrl = normalizeGovernanceBaseUrl(
  import.meta.env.VITE_SELF_GOVERNANCE_POST_FALLBACK_URL || selfGovernanceFallbackBaseUrl,
);
const selfGovernanceApiKey = (import.meta.env.VITE_SELF_GOVERNANCE_API_KEY || '').trim();
const selfGovernanceTimeoutMs = Number.parseInt(String(import.meta.env.VITE_SELF_GOVERNANCE_TIMEOUT_MS || '1200'), 10);
const hasGeminiApiKey = Boolean(geminiApiKey);

const ai = hasGeminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

interface SelfHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface SelfPreResponse {
  policy?: Record<string, unknown>;
  policyPrompt?: string;
  clarifier?: {
    required?: boolean;
    question?: string;
  };
}

interface SelfPostResponse {
  output?: string;
  validation?: unknown;
  repaired?: boolean;
}

type SelfState = 'S0' | 'S1' | 'S2' | 'S3';
type FallbackResponseClass =
  | 'normal_reflection'
  | 'supportive_reflection'
  | 'grounding_prompt'
  | 'human_connection_prompt'
  | 'circle_suggestion'
  | 'refusal_with_dignity'
  | 'crisis_redirection';
type AIFallbackReason = 'none' | 'missing_api_key' | 'provider_error' | 'empty_model_output' | 'deterministic_guard';

interface DeterministicFallbackResult {
  text: string;
  state: SelfState;
  responseClass: FallbackResponseClass;
  triggeredRules: string[];
}

export interface LastAIResponseStatus {
  fallbackActive: boolean;
  reason: AIFallbackReason;
  timestamp: string;
  state: SelfState;
  responseClass: FallbackResponseClass;
  triggeredRules: string[];
}

let lastAIResponseStatus: LastAIResponseStatus = {
  fallbackActive: false,
  reason: 'none',
  timestamp: new Date(0).toISOString(),
  state: 'S0',
  responseClass: 'normal_reflection',
  triggeredRules: [],
};

function setLastAIResponseStatus(args: {
  fallbackActive: boolean;
  reason: AIFallbackReason;
  fallbackResult: DeterministicFallbackResult;
}): void {
  lastAIResponseStatus = {
    fallbackActive: args.fallbackActive,
    reason: args.reason,
    timestamp: new Date().toISOString(),
    state: args.fallbackResult.state,
    responseClass: args.fallbackResult.responseClass,
    triggeredRules: args.fallbackResult.triggeredRules,
  };
}

export function getLastAIResponseStatus(): LastAIResponseStatus {
  return { ...lastAIResponseStatus, triggeredRules: [...lastAIResponseStatus.triggeredRules] };
}

function namePrefix(preferredName?: string): string {
  const trimmed = preferredName?.trim();
  return trimmed ? `${trimmed}, ` : '';
}

function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, ' ').trim();
}

function responseLengthInstruction(responseLength: ResponseLength): string {
  if (responseLength === 'short') {
    return 'Keep responses brief by default: 1-3 short sentences, usually under 60 words, unless safety requires more detail.';
  }
  if (responseLength === 'medium') {
    return 'Keep responses moderate: 2-4 sentences, usually under 120 words, unless safety requires more detail.';
  }
  return 'Long mode is enabled. You may provide fuller detail when useful, while still avoiding unnecessary verbosity.';
}

function enforceNonDependencyLanguage(text: string): string {
  if (!text) return text;

  let out = text;
  const replacements: Array<[RegExp, string]> = [
    [/\bi(?:\s+am|'m)\s+always\s+here\s+for\s+you\b/gi, 'You deserve support from trusted people around you.'],
    [/\bi(?:\s+am|'m)\s+here\s+for\s+you\b/gi, 'You deserve support from trusted people around you.'],
    [/\bi(?:\s+am|'m)\s+here\s+with\s+you\b/gi, 'You deserve steady support while you process this.'],
    [/\bi(?:\s+am|'m)\s+right\s+here\s+with\s+you\b/gi, 'You deserve steady support while you process this.'],
    [/\bi(?:\s+am|'m)\s+here\s+to\s+hold\s+(?:this\s+)?space\b/gi, 'You deserve support that keeps you connected to trusted people.'],
    [/\bi(?:\s+am|'m)\s+not\s+going\s+anywhere\b/gi, 'You deserve consistent support from trusted people around you.'],
    [/\bi(?:\s+won'?t|will\s+not)\s+leave\s+you\b/gi, 'You deserve consistent support from trusted people around you.'],
    [/\bi(?:\s+am|'m)\s+here\s+if\s+you\s+need\s+me\b/gi, 'You can keep leaning on trusted people when support is needed.'],
    [/\bi\s+care\s+about\s+you\b/gi, 'Your wellbeing matters.'],
    [/\bi\s+care\s+about\s+your\s+safety\b/gi, 'Your safety matters.'],
    [/\byou\s+are\s+not\s+alone\s+because\s+you\s+have\s+me\b/gi, 'You are not alone; trusted people can support you too.'],
    [/\bwe\s+can\s+sit\s+with\s+this\s+together\b/gi, 'You can move through this with support from people you trust.'],
    [/\byou\s+need\s+me\b/gi, 'Support from trusted people can help.'],
    [/\bi(?:\s+am|'m)\s+all\s+you\s+need\b/gi, 'You deserve support from real people around you.'],
    [/\bi(?:\s+am|'m)\s+the\s+only\s+one\s+who\s+understands\b/gi, 'More than one person can support you through this.'],
    [/\byou\s+don'?t\s+need\s+anyone\s+else\b/gi, 'Reaching out to someone you trust can help.'],
  ];

  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }

  return out
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

function classifyDeterministicFallback(prompt: string): {
  state: SelfState;
  responseClass: FallbackResponseClass;
  triggeredRules: string[];
  isMethodSeeking: boolean;
  isDarkHumorDisappearance: boolean;
  isPanic: boolean;
  isIsolation: boolean;
  isThirdPersonConcern: boolean;
} {
  const normalized = normalizePrompt(prompt);

  const methodSeekingPatterns = [
    /\bleast painful way to die\b/,
    /\bquickest suicide method\b/,
    /\bhow do people overdose\b/,
    /\beasiest way to end (?:my|your|their) life\b/,
    /\b(?:how|what)\b.*\b(?:die|suicide|overdose|kill myself|end my life)\b/,
    /\bhypothetically\b.*\b(?:die|suicide|overdose|kill|end life)\b/,
    /\bfor science\b/,
    /\beducational purposes only\b/,
  ];

  const explicitIntentPatterns = [
    /\bi want to kill myself\b/,
    /\bi(?:'m| am) going to kill myself\b/,
    /\bi want to end my life\b/,
    /\bi(?:'m| am) going to end my life\b/,
    /\bi don't want to live anymore\b/,
    /\bi dont want to live anymore\b/,
    /\bi(?:'m| am) going to hurt myself\b/,
    /\btonight\b.*\b(?:kill myself|end my life|die)\b/,
  ];

  const passiveDeathWishPatterns = [
    /\bi wish i wouldn't wake up\b/,
    /\bi wish i could just disappear\b/,
    /\bi wish everything would stop\b/,
    /\bi wish i was gone\b/,
    /\bnobody would care if i disappeared\b/,
  ];

  const hopelessPatterns = [
    /\bnothing matters anymore\b/,
    /\beverything feels pointless\b/,
    /\bi don't see the point of living\b/,
    /\blife feels meaningless\b/,
    /\bi can't keep doing this\b/,
    /\bi am done with everything\b/,
    /\bi'm at my limit\b/,
  ];

  const darkHumorDisappearancePatterns = [
    /\balt\s*\+\s*f4\b.*\b(?:existence|myself|me|life)\b/,
    /\bquit[-\s]?button\b.*\b(?:existence|life|me)\b/,
    /\blog off\b.*\b(?:permanently|for good|forever)\b/,
    /\bdelete myself\b/,
    /\bvanish(?:ing)?\s+for\s+good\b/,
    /\buninstall life\b/,
    /\blife\.?exe\b.*\b(?:stopped|crashed|quit)\b/,
  ];

  const panicPatterns = [
    /\bi(?:'m| am) having a panic attack\b/,
    /\bi can't breathe\b/,
    /\bi(?:'m| am) freaking out\b/,
    /\bmy heart is racing\b/,
  ];

  const isolationPatterns = [
    /\bi feel completely alone\b/,
    /\bi have no one\b/,
    /\bi(?:'m| am) just a burden\b/,
    /\beveryone would be better off without me\b/,
    /\bpeople would be happier if i was gone\b/,
  ];

  const thirdPersonConcernPatterns = [
    /\bmy friend says they want to die\b/,
    /\bsomeone i know wants to kill themselves\b/,
    /\bmy partner says they don't want to live anymore\b/,
  ];

  const isMethodSeeking = methodSeekingPatterns.some((pattern) => pattern.test(normalized));
  const isExplicitIntent = explicitIntentPatterns.some((pattern) => pattern.test(normalized));
  const isPassiveDeathWish = passiveDeathWishPatterns.some((pattern) => pattern.test(normalized));
  const isHopeless = hopelessPatterns.some((pattern) => pattern.test(normalized));
  const isDarkHumorDisappearance = darkHumorDisappearancePatterns.some((pattern) => pattern.test(normalized));
  const isPanic = panicPatterns.some((pattern) => pattern.test(normalized));
  const isIsolation = isolationPatterns.some((pattern) => pattern.test(normalized));
  const isThirdPersonConcern = thirdPersonConcernPatterns.some((pattern) => pattern.test(normalized));
  const asksForGrounding = /\b(?:breathing exercise|grounding|help me calm down|help me breathe)\b/.test(normalized);
  const isPhilosophicalDeath = /\b(?:philosophically|inevitable|natural part of life|fear death)\b/.test(normalized) && /\bdeath\b/.test(normalized);
  const nearMissBenign = /\b(?:done with this project|exam is killing me|work is killing me)\b/.test(normalized);

  const triggeredRules: string[] = [];

  if (isMethodSeeking) {
    triggeredRules.push('method_seeking');
    return {
      state: 'S3',
      responseClass: 'refusal_with_dignity',
      triggeredRules,
      isMethodSeeking,
      isDarkHumorDisappearance,
      isPanic,
      isIsolation,
      isThirdPersonConcern,
    };
  }

  if (isExplicitIntent) {
    triggeredRules.push('explicit_intent');
    return {
      state: 'S3',
      responseClass: 'crisis_redirection',
      triggeredRules,
      isMethodSeeking,
      isDarkHumorDisappearance,
      isPanic,
      isIsolation,
      isThirdPersonConcern,
    };
  }

  if (isThirdPersonConcern) {
    triggeredRules.push('third_person_concern');
    return {
      state: 'S2',
      responseClass: 'human_connection_prompt',
      triggeredRules,
      isMethodSeeking,
      isDarkHumorDisappearance,
      isPanic,
      isIsolation,
      isThirdPersonConcern,
    };
  }

  if (isPassiveDeathWish || isIsolation) {
    triggeredRules.push(isIsolation ? 'isolation_signal' : 'passive_death_wish');
    return {
      state: 'S2',
      responseClass: isIsolation ? 'circle_suggestion' : 'supportive_reflection',
      triggeredRules,
      isMethodSeeking,
      isDarkHumorDisappearance,
      isPanic,
      isIsolation,
      isThirdPersonConcern,
    };
  }

  if (isPanic || asksForGrounding) {
    triggeredRules.push('acute_anxiety_or_grounding_request');
    return {
      state: 'S2',
      responseClass: 'grounding_prompt',
      triggeredRules,
      isMethodSeeking,
      isDarkHumorDisappearance,
      isPanic,
      isIsolation,
      isThirdPersonConcern,
    };
  }

  if (isDarkHumorDisappearance) {
    triggeredRules.push('dark_humor_disappearance');
    return {
      state: 'S1',
      responseClass: 'supportive_reflection',
      triggeredRules,
      isMethodSeeking,
      isDarkHumorDisappearance,
      isPanic,
      isIsolation,
      isThirdPersonConcern,
    };
  }

  if (isHopeless) {
    triggeredRules.push('hopelessness');
    return {
      state: 'S1',
      responseClass: 'supportive_reflection',
      triggeredRules,
      isMethodSeeking,
      isDarkHumorDisappearance,
      isPanic,
      isIsolation,
      isThirdPersonConcern,
    };
  }

  if (isPhilosophicalDeath) {
    triggeredRules.push('philosophical_context');
    return {
      state: 'S0',
      responseClass: 'normal_reflection',
      triggeredRules,
      isMethodSeeking,
      isDarkHumorDisappearance,
      isPanic,
      isIsolation,
      isThirdPersonConcern,
    };
  }

  if (nearMissBenign) {
    triggeredRules.push('near_miss_benign');
    return {
      state: 'S0',
      responseClass: 'normal_reflection',
      triggeredRules,
      isMethodSeeking,
      isDarkHumorDisappearance,
      isPanic,
      isIsolation,
      isThirdPersonConcern,
    };
  }

  return {
    state: 'S0',
    responseClass: 'normal_reflection',
    triggeredRules: ['default_reflection'],
    isMethodSeeking,
    isDarkHumorDisappearance,
    isPanic,
    isIsolation,
    isThirdPersonConcern,
  };
}

function buildDeterministicFallbackResponse(args: {
  prompt: string;
  aiName: string;
  preferredName?: string;
}): DeterministicFallbackResult {
  const analysis = classifyDeterministicFallback(args.prompt);
  const person = namePrefix(args.preferredName);

  if (analysis.state === 'S3') {
    if (analysis.responseClass === 'refusal_with_dignity') {
      return {
        state: analysis.state,
        responseClass: analysis.responseClass,
        triggeredRules: analysis.triggeredRules,
        text: `${person}I can’t help with instructions for harming yourself or ending a life. If this connects to how you’re feeling right now, your safety comes first. If you might act on this, call or text 988 (US/Canada) or contact local emergency services now. If it helps, we can focus on one safe next step right away.`,
      };
    }

    return {
      state: analysis.state,
      responseClass: analysis.responseClass,
      triggeredRules: analysis.triggeredRules,
      text: `${person}Thank you for saying this out loud. You don’t have to carry this by yourself right now. If there’s any immediate danger, call or text 988 (US/Canada) or contact local emergency services now. If you can, reach out to one trusted person and let them know you need support tonight.`,
    };
  }

  if (analysis.state === 'S2') {
    if (analysis.isPanic) {
      return {
        state: analysis.state,
        responseClass: 'grounding_prompt',
        triggeredRules: analysis.triggeredRules,
        text: `${person}Let’s do a quick reset together: breathe in for 4, hold for 4, out for 6. Repeat that 4 times, then name 3 things you can see and 2 things you can feel.`,
      };
    }

    if (analysis.isThirdPersonConcern) {
      return {
        state: analysis.state,
        responseClass: 'human_connection_prompt',
        triggeredRules: analysis.triggeredRules,
        text: `${person}This sounds serious, and it’s good that you spoke up. Check on them directly and ask if they are in immediate danger. If risk feels immediate, contact emergency services. You can also encourage them to call or text 988 (US/Canada) for live crisis support.`,
      };
    }

    if (analysis.isIsolation) {
      return {
        state: analysis.state,
        responseClass: 'circle_suggestion',
        triggeredRules: analysis.triggeredRules,
        text: `${person}That sounds really heavy, and I’m glad you shared it. You matter. If it helps, this may be a good moment to connect with one trusted person, or use a Serenix Circle so you don’t have to carry this alone.`,
      };
    }

    return {
      state: analysis.state,
      responseClass: analysis.responseClass,
      triggeredRules: analysis.triggeredRules,
      text: `${person}I hear how intense this feels. Let’s take it one step at a time. If you want, tell me what feels hardest right now and we’ll start there.`,
    };
  }

  if (analysis.state === 'S1') {
    return {
      state: analysis.state,
      responseClass: analysis.responseClass,
      triggeredRules: analysis.triggeredRules,
      text: `${person}That sounds like a lot to hold right now. You deserve support while you process this. What part feels heaviest in this moment?`,
    };
  }

  return {
    state: analysis.state,
    responseClass: analysis.responseClass,
    triggeredRules: analysis.triggeredRules,
    text: `${person}Tell me what you want to unpack first, and we can take it one clear step at a time.`,
  };
}

function isLikelyOutageError(error: unknown): boolean {
  const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    '429',
    'rate limit',
    'quota',
    'deadline',
    'timeout',
    '503',
    '502',
    '500',
    'network',
    'unavailable',
    'fetch failed',
    'overloaded',
  ].some((needle) => text.includes(needle));
}

function classifyGeneratedResponseClass(text: string): FallbackResponseClass {
  const normalized = normalizePrompt(text);
  if (!normalized) return 'normal_reflection';

  const refusalSignals = [
    /\bi can't help with\b.*\b(?:hurt yourself|end (?:a )?life|suicide|kill)\b/,
    /\bi cannot help with\b.*\b(?:hurt yourself|end (?:a )?life|suicide|kill)\b/,
    /\bwon't provide\b.*\b(?:method|instructions|steps)\b/,
  ];
  if (refusalSignals.some((pattern) => pattern.test(normalized))) {
    return 'refusal_with_dignity';
  }

  const crisisSignals = [
    /\b(?:call|text)\s*988\b/,
    /\bemergency services\b/,
    /\bimmediate danger\b/,
    /\bcontact\b.*\btrusted person\b/,
  ];
  if (crisisSignals.some((pattern) => pattern.test(normalized))) {
    return 'crisis_redirection';
  }

  if (/\b(?:inhale|exhale|hold for|grounding|5-4-3-2-1)\b/.test(normalized)) {
    return 'grounding_prompt';
  }

  if (/\b(?:reach out|trusted person|someone you trust|not carry this alone)\b/.test(normalized)) {
    return 'human_connection_prompt';
  }

  if (/\b(?:circle|circles)\b/.test(normalized)) {
    return 'circle_suggestion';
  }

  if (/\b(?:that sounds|i hear|i'm sorry you're|that feels)\b/.test(normalized)) {
    return 'supportive_reflection';
  }

  return 'normal_reflection';
}

function containsUnsafeMethodContent(text: string): boolean {
  const normalized = normalizePrompt(text);
  if (!normalized) return false;
  const highRiskPatterns = [
    /\b(?:step\s*1|first,\s*|then,\s*|next,\s*)\b.*\b(?:die|suicide|kill yourself|overdose)\b/,
    /\b(?:least painful|quickest|easiest)\b.*\b(?:way|method)\b.*\b(?:die|suicide|overdose|kill)\b/,
    /\b(?:how to|ways to)\b.*\b(?:overdose|kill yourself|end your life)\b/,
  ];
  return highRiskPatterns.some((pattern) => pattern.test(normalized));
}

function applyDeterministicFailClosedGuard(args: {
  candidateOutput: string;
  fallback: DeterministicFallbackResult;
}): { output: string; failClosed: boolean; reason: string } {
  const promptRisk = args.fallback;
  const generatedClass = classifyGeneratedResponseClass(args.candidateOutput);
  const hasUnsafeMethodContent = containsUnsafeMethodContent(args.candidateOutput);
  const generatedIsTooWeakForS2 =
    promptRisk.state === 'S2' && generatedClass === 'normal_reflection';
  const generatedIsTooWeakForS3 =
    promptRisk.state === 'S3'
      && !['refusal_with_dignity', 'crisis_redirection', 'grounding_prompt', 'human_connection_prompt'].includes(generatedClass);
  const methodSeekingNeedsRefusal =
    promptRisk.triggeredRules.includes('method_seeking')
      && !['refusal_with_dignity', 'crisis_redirection'].includes(generatedClass);

  if (hasUnsafeMethodContent || generatedIsTooWeakForS2 || generatedIsTooWeakForS3 || methodSeekingNeedsRefusal) {
    return {
      output: promptRisk.text,
      failClosed: true,
      reason: hasUnsafeMethodContent
        ? 'unsafe_method_content_detected'
        : methodSeekingNeedsRefusal
          ? 'method_seeking_requires_refusal'
          : promptRisk.state === 'S3'
            ? 's3_guard_fail_closed'
            : 's2_guard_fail_closed',
    };
  }

  return {
    output: args.candidateOutput,
    failClosed: false,
    reason: 'none',
  };
}

function fallbackCircleAnalysis(
  messages: { senderName: string; content: string }[],
  presenceMode: 'quiet' | 'facilitation' | 'reflection'
): CircleAnalysis {
  const joined = messages.map((m) => m.content.toLowerCase()).join('\n');
  const uniqueSenders = new Set(messages.map((m) => m.senderName)).size;
  const hasHostility = /\b(?:stupid|idiot|shut up|hate you|this is your fault|you always|you never)\b/.test(joined);
  const hasDistress = /\b(?:can't do this|panic|overwhelmed|want to die|hurt myself|hopeless)\b/.test(joined);
  const hasConflict = hasHostility || hasDistress;
  const level: 1 | 2 | 3 | 4 = hasDistress ? 3 : hasHostility ? 2 : 1;
  const type: CircleAnalysis['type'] = hasDistress ? 'distress' : hasHostility ? 'hostility' : 'none';
  const engagementLevel: CircleAnalysis['engagementLevel'] =
    messages.length >= 6 && uniqueSenders >= 2 ? 'high' : messages.length >= 3 ? 'medium' : 'low';

  const shouldIntervene =
    presenceMode === 'quiet'
      ? hasConflict
      : presenceMode === 'facilitation'
      ? hasConflict || engagementLevel === 'low'
      : hasConflict || engagementLevel !== 'high';

  return {
    hasConflict,
    level,
    type,
    engagementLevel,
    shouldIntervene,
    reason: hasConflict
      ? 'Deterministic fallback detected conflict or distress signals.'
      : 'Deterministic fallback detected no clear conflict.',
  };
}

function fallbackCircleMediation(
  analysis: CircleAnalysis,
  presenceMode: 'quiet' | 'facilitation' | 'reflection'
): string {
  if (presenceMode === 'quiet' && !analysis.hasConflict) {
    return "No intervention needed right now. The AI will stay in the background unless support is needed.";
  }

  if (analysis.level >= 3) {
    return "The intensity seems to be rising. Let’s pause for a minute and focus on safety. Please use calm, direct language and support each other one person at a time.";
  }

  if (analysis.hasConflict) {
    return "There’s some tension in the thread. Could each person share one sentence with 'I feel...' and one sentence with 'What I need right now is...' so the group can reset constructively?";
  }

  if (presenceMode === 'reflection') {
    return "There’s meaningful sharing here. What is one theme people are noticing in common right now?";
  }

  return "If helpful, each person can share one small win and one current challenge for today.";
}

function fallbackCircleActivity(type: 'starter' | 'gratitude' | 'story' | 'checkin'): string {
  const prompts = {
    starter: "Conversation starter: What is one thing on your mind today that you want support with?",
    gratitude: "Gratitude moment: Share one small thing you are grateful for from the last 24 hours.",
    story: "Story prompt: Start with 'Today the group found a quiet room where everyone could be honest...' and add one sentence each.",
    checkin: "Quick check-in: Share a 1-10 energy score and one word for your mood.",
  };
  return prompts[type];
}

async function maybeApplySelfPostflight(args: {
  userMessage: string;
  output: string;
  policy?: Record<string, unknown>;
  userId?: string;
}): Promise<string> {
  if (!args.policy) return args.output;
  try {
    const post = await maybeRunSelfPostflight({
      userMessage: args.userMessage,
      output: args.output,
      policy: args.policy,
      userId: args.userId,
    });
    if (post?.output && post.output.trim()) {
      return post.output;
    }
  } catch (error) {
    console.warn('SELF postflight unavailable; using ungoverned draft for this turn.', error);
  }
  return args.output;
}

function normalizeSelfHistory(
  history: { role: 'user' | 'model', parts: { text: string }[] }[]
): SelfHistoryMessage[] {
  return history
    .map((h) => {
      const content = (h.parts || []).map((p) => p.text || '').join(' ').trim();
      if (!content) return null;
      return {
        role: h.role === 'model' ? 'assistant' : 'user',
        content,
      } as SelfHistoryMessage;
    })
    .filter((item): item is SelfHistoryMessage => item !== null);
}

function getSelfHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (selfGovernanceApiKey) {
    headers.Authorization = `Bearer ${selfGovernanceApiKey}`;
  }
  return headers;
}

function isRetriableSelfStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

function getSelfBaseCandidates(path: '/v1/pre' | '/v1/post'): string[] {
  const primary = path === '/v1/pre' ? selfGovernancePreBaseUrl : selfGovernancePostBaseUrl;
  const fallback = path === '/v1/pre' ? selfGovernancePreFallbackBaseUrl : selfGovernancePostFallbackBaseUrl;
  const candidates = [primary, fallback].filter((value): value is string => Boolean(value));
  return Array.from(new Set(candidates));
}

async function fetchSelfJson<T>(path: '/v1/pre' | '/v1/post', body: Record<string, unknown>): Promise<T> {
  const candidates = getSelfBaseCandidates(path);
  if (candidates.length === 0) {
    throw new Error(`SELF ${path} base URL is not configured.`);
  }

  const errors: string[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const baseUrl = candidates[index]!;
    const isFallbackAttempt = index > 0;
    const isLastAttempt = index >= candidates.length - 1;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      Number.isFinite(selfGovernanceTimeoutMs) ? selfGovernanceTimeoutMs : 1200,
    );

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: getSelfHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const message = `SELF ${path} failed via ${baseUrl} (${response.status}): ${text}`;
        errors.push(message);

        if (!isLastAttempt && isRetriableSelfStatus(response.status)) {
          console.warn(`SELF ${path} primary endpoint failed with ${response.status}; trying fallback endpoint.`, {
            failedBaseUrl: baseUrl,
            fallbackBaseUrl: candidates[index + 1],
          });
          continue;
        }

        throw new Error(message);
      }

      if (isFallbackAttempt) {
        console.warn(`SELF ${path} succeeded via fallback endpoint.`, {
          fallbackBaseUrl: baseUrl,
          primaryBaseUrl: candidates[0],
        });
      }

      return await response.json() as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`SELF ${path} request error via ${baseUrl}: ${message}`);

      if (!isLastAttempt) {
        console.warn(`SELF ${path} request error on primary endpoint; trying fallback endpoint.`, {
          failedBaseUrl: baseUrl,
          fallbackBaseUrl: candidates[index + 1],
          error: message,
        });
        continue;
      }

      throw new Error(errors.join(' | '));
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  throw new Error(`SELF ${path} failed across all configured endpoints.`);
}

async function maybeRunSelfPreflight(args: {
  prompt: string;
  history: { role: 'user' | 'model', parts: { text: string }[] }[];
  baseSystemPrompt: string;
  userId?: string;
}): Promise<SelfPreResponse | null> {
  if (getSelfBaseCandidates('/v1/pre').length === 0) return null;
  return fetchSelfJson<SelfPreResponse>('/v1/pre', {
    message: args.prompt,
    history: normalizeSelfHistory(args.history),
    userId: args.userId,
    baseSystemPrompt: args.baseSystemPrompt,
  });
}

async function maybeRunSelfPostflight(args: {
  userMessage: string;
  output: string;
  policy: Record<string, unknown>;
  userId?: string;
}): Promise<SelfPostResponse | null> {
  if (getSelfBaseCandidates('/v1/post').length === 0) return null;
  return fetchSelfJson<SelfPostResponse>('/v1/post', {
    userMessage: args.userMessage,
    output: args.output,
    policy: args.policy,
    userId: args.userId,
  });
}

export async function getAIResponse(
  prompt: string, 
  history: { role: 'user' | 'model', parts: { text: string }[] }[] = [],
  responseLength: ResponseLength = 'short',
  preferredName?: string,
  userId?: string
) {
  const aiName = "SerenixAI";
  const trimmedPreferredName = preferredName?.trim();
  const hasPreferredName = Boolean(trimmedPreferredName);

  const systemInstruction = `You are ${aiName}, a steady reflection tool. 
  Use warm, grounded validation without attachment language. Reflect emotion briefly, protect user agency, and encourage real-world support when relevant.
  Use plain, human language and avoid sounding clinical unless the user asks for a clinical tone.
  ${responseLengthInstruction(responseLength)}
  ${hasPreferredName
    ? `The person you are talking to likes to be called ${trimmedPreferredName}. Address them by this name when appropriate.`
    : `No preferred name is set. Do not invent one and do not refer to them as "user"; address them naturally as "you".`}
  Your goal is to help users reflect clearly, feel understood, and choose safe next steps.
  Follow the user's lead and respond directly to what they just said before introducing any exercise.
  Do not force grounding, breathing, or mindfulness unless the user asks for it or clearly needs de-escalation support.
  If the user is venting, prioritize reflection and curiosity first (for example: validating, summarizing, asking what they need right now).
  Avoid giving medical advice and do not imply therapy, friendship, or emotional exclusivity. 
  Keep responses concise but warm.
  Never use dependency-forming language or imply an exclusive bond with the AI.
  Do not use phrasing like "I'm always here for you", "you need me", "I'm all you need", "I'm the only one who understands", "I'm right here with you", or "I'm here to hold this space."
  Do not frame this as a relationship or imply you are a substitute for human connection.
  Prefer language that encourages real human connection and trusted support networks.
  
  If the user has been reflecting on a heavy situation or something that seems to be weighing on them, at a natural point in the conversation, you can gently suggest using Circles. 
  Use phrasing similar to: "It sounds like this situation has been weighing on you. Sometimes sharing things like this with someone you trust can make it easier to process. If you ever want a structured way to talk about it with friends or family, Serenix circles can help guide those conversations."
  Only do this once per session and only when it feels truly relevant and supportive, not as a sales pitch.`;

  let effectiveSystemInstruction = systemInstruction;
  let selfPolicy: Record<string, unknown> | undefined;
  const deterministicFallback = buildDeterministicFallbackResponse({
    prompt,
    aiName,
    preferredName: trimmedPreferredName,
  });

  try {
    const pre = await maybeRunSelfPreflight({
      prompt,
      history,
      baseSystemPrompt: systemInstruction,
      userId,
    });
    if (pre?.clarifier?.required) {
      const clarifierQuestion = pre.clarifier.question?.trim();
      setLastAIResponseStatus({
        fallbackActive: false,
        reason: 'none',
        fallbackResult: deterministicFallback,
      });
      return enforceNonDependencyLanguage(
        clarifierQuestion || "I want to make sure I understand safely. Are you feeling like you might hurt yourself or someone else right now?",
      );
    }
    if (pre?.policyPrompt?.trim()) {
      effectiveSystemInstruction = pre.policyPrompt;
    }
    if (pre?.policy) {
      selfPolicy = pre.policy;
    }
  } catch (error) {
    console.warn('SELF preflight unavailable; continuing with direct Gemini response.', error);
  }

  const contents = [
    ...history,
    { role: 'user' as const, parts: [{ text: prompt }] }
  ];

  if (!ai) {
    console.warn('Gemini API key missing; using deterministic fallback response.');
    setLastAIResponseStatus({
      fallbackActive: true,
      reason: 'missing_api_key',
      fallbackResult: deterministicFallback,
    });
    const postflight = await maybeApplySelfPostflight({
      userMessage: prompt,
      output: deterministicFallback.text,
      policy: selfPolicy,
      userId,
    });
    return enforceNonDependencyLanguage(postflight);
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      config: {
        systemInstruction: effectiveSystemInstruction,
      }
    });
    const rawOutput = (response.text || '').trim();
    const output = rawOutput || deterministicFallback.text;
    const guarded = applyDeterministicFailClosedGuard({
      candidateOutput: output,
      fallback: deterministicFallback,
    });
    const usedFallback = !rawOutput;
    setLastAIResponseStatus({
      fallbackActive: usedFallback || guarded.failClosed,
      reason: usedFallback
        ? 'empty_model_output'
        : guarded.failClosed
          ? 'deterministic_guard'
          : 'none',
      fallbackResult: deterministicFallback,
    });
    const postflight = await maybeApplySelfPostflight({
      userMessage: prompt,
      output: guarded.output,
      policy: selfPolicy,
      userId,
    });
    return enforceNonDependencyLanguage(postflight);
  } catch (error) {
    if (isLikelyOutageError(error)) {
      console.warn('Gemini unavailable due to quota/outage; using deterministic fallback.', error);
    } else {
      console.warn('Gemini request failed; using deterministic fallback to avoid silent failure.', error);
    }
    setLastAIResponseStatus({
      fallbackActive: true,
      reason: 'provider_error',
      fallbackResult: deterministicFallback,
    });
    const postflight = await maybeApplySelfPostflight({
      userMessage: prompt,
      output: deterministicFallback.text,
      policy: selfPolicy,
      userId,
    });
    return enforceNonDependencyLanguage(postflight);
  }
}

export interface ConflictAnalysis {
  hasConflict: boolean;
  level: 1 | 2 | 3 | 4;
  type: 'disagreement' | 'hostility' | 'harassment' | 'distress' | 'none';
  reason: string;
}

export interface CircleAnalysis extends ConflictAnalysis {
  shouldIntervene: boolean;
  engagementLevel: 'low' | 'medium' | 'high';
}

export async function analyzeCircleConversation(
  messages: { senderName: string, content: string }[],
  presenceMode: 'quiet' | 'facilitation' | 'reflection' = 'facilitation'
): Promise<CircleAnalysis> {
  if (!ai) {
    return fallbackCircleAnalysis(messages, presenceMode);
  }
  const prompt = `Analyze the following group support circle conversation.
  
  AI Presence Mode: ${presenceMode}
  - quiet: AI only steps in for conflict.
  - facilitation: AI suggests prompts occasionally and mediates conflict.
  - reflection: AI actively guides discussion and mediates conflict.

  Triggers for Conflict:
  - Hostile language, accusations, escalating tone, distress, or harassment.

  Triggers for Engagement:
  - Are users responding to each other?
  - Is the conversation flowing naturally without help?
  - Is the mood supportive and constructive?

  Conversation:
  ${messages.map(m => `${m.senderName}: ${m.content}`).join('\n')}

  Return a JSON object with:
  - hasConflict: boolean
  - level: 1-4 (as defined before)
  - type: 'disagreement', 'hostility', 'harassment', 'distress', or 'none'
  - reason: brief explanation.
  - engagementLevel: 'low' (stagnant), 'medium' (some interaction), 'high' (flowing naturally)
  - shouldIntervene: boolean (Based on ${presenceMode} mode:
      - In 'quiet': True ONLY if hasConflict is true.
      - In 'facilitation': True if hasConflict is true OR if engagement is low.
      - In 'reflection': True if hasConflict is true OR if engagement is not high (needs active guidance).
    )
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        systemInstruction: "You are a group dynamics analyst. Your goal is to help the AI know when to step in and when to stay silent to let human connection flourish.",
      }
    });
    const result = JSON.parse(response.text || '{}');
    return {
      hasConflict: result.hasConflict || false,
      level: result.level || 1,
      type: result.type || 'none',
      reason: result.reason || '',
      engagementLevel: result.engagementLevel || 'medium',
      shouldIntervene: result.shouldIntervene || false
    };
  } catch (e) {
    return fallbackCircleAnalysis(messages, presenceMode);
  }
}

export async function getCircleMediation(
  messages: { senderName: string, content: string }[], 
  analysis: CircleAnalysis,
  presenceMode: 'quiet' | 'facilitation' | 'reflection' = 'facilitation'
) {
  if (!ai) {
    return enforceNonDependencyLanguage(fallbackCircleMediation(analysis, presenceMode));
  }
  const levelInstructions = {
    1: "Acknowledge the rising tension gently. Encourage everyone to slow down and breathe. Suggest restating feelings rather than blame.",
    2: "Prompt each person involved to express their perspective calmly using 'I' statements. Focus on understanding, not arbitration.",
    3: "Suggest a brief pause in the conversation. Remind the group of the circle's purpose as a safe sanctuary. Offer a grounding exercise.",
    4: "Shift to protective moderation. State clearly that the current dynamic is not constructive. Suggest ending the current discussion thread for safety."
  };

  const prompt = `As SerenixAI, provide a response for this circle. 
  
  Presence Mode: ${presenceMode}
  Current Conflict Level: ${analysis.level} (${analysis.type})
  Reason: ${analysis.reason}
  Engagement Level: ${analysis.engagementLevel}
  
  Guidelines:
  - DO NOT JUDGE who is right or wrong.
  - DO NOT arbitrate or take sides.
  - Focus on de-escalation and reframing.
  - Be a facilitator, not a moderator issuing warnings.
  - If mode is 'quiet' and there's no conflict, YOU SHOULD NOT BE RESPONDING.
  - If mode is 'facilitation', offer warm nudges or supportive reflections if engagement is low.
  - If mode is 'reflection', be more active in guiding the discussion, asking deep questions, and summarizing themes.
  - If engagement is high and there's no conflict, keep your response extremely brief and neutral, without dependency framing.
  - ${levelInstructions[analysis.level as keyof typeof levelInstructions] || ""}

  Conversation:
  ${messages.map(m => `${m.senderName}: ${m.content}`).join('\n')}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: "You are SerenixAI, a compassionate group mediator. Your goal is to keep the conversation constructive and safe without being policing.",
      }
    });
    return enforceNonDependencyLanguage(response.text || fallbackCircleMediation(analysis, presenceMode));
  } catch (error) {
    console.warn('Circle mediation fallback activated.', error);
    return enforceNonDependencyLanguage(fallbackCircleMediation(analysis, presenceMode));
  }
}

export async function getCircleActivity(type: 'starter' | 'gratitude' | 'story' | 'checkin', messages: { senderName: string, content: string }[]) {
  if (!ai) {
    return enforceNonDependencyLanguage(fallbackCircleActivity(type));
  }
  const context = messages.length > 0 
    ? `Based on the recent mood of the group: ${messages.map(m => m.content).join(' ')}`
    : "The group just started.";

  const prompts = {
    starter: "Suggest a gentle conversation starter that fits the current mood.",
    gratitude: "Invite everyone to share one small thing they are grateful for today.",
    story: "Start a collaborative 'gentle story'. Provide the first sentence and invite the next person.",
    checkin: "Facilitate a quick emotional check-in. Ask everyone how they are feeling on a scale of 1-10 or with a color."
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `${context}\n\n${prompts[type]}`,
      config: {
        systemInstruction: "You are SerenixAI, a group facilitator. Keep it brief, warm, and inviting.",
      }
    });
    return enforceNonDependencyLanguage(response.text || fallbackCircleActivity(type));
  } catch (error) {
    console.warn('Circle activity fallback activated.', error);
    return enforceNonDependencyLanguage(fallbackCircleActivity(type));
  }
}

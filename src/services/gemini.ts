import { GoogleGenAI } from "@google/genai";
import { AISettings } from "../types";

const geminiApiKey =
  (import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '').trim();

const selfGovernanceBaseUrl = (import.meta.env.VITE_SELF_GOVERNANCE_URL || '').trim().replace(/\/+$/, '');
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
type AIFallbackReason = 'none' | 'missing_api_key' | 'provider_error' | 'empty_model_output';

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

function classifyDeterministicFallback(prompt: string): {
  state: SelfState;
  responseClass: FallbackResponseClass;
  triggeredRules: string[];
  isMethodSeeking: boolean;
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
        text: `${person}I can't help with instructions to hurt yourself or end a life. If this is about how you're feeling, I care about your safety. If you might act on this now, call or text 988 (US/Canada) or contact local emergency services right now. If you want, we can take one safe next step together in this chat.`,
      };
    }

    return {
      state: analysis.state,
      responseClass: analysis.responseClass,
      triggeredRules: analysis.triggeredRules,
      text: `${person}Thank you for saying this out loud. You do not have to carry this alone right now. If you might be in immediate danger, call or text 988 (US/Canada) or contact local emergency services now. If you can, reach out to one trusted person and tell them you need support tonight.`,
    };
  }

  if (analysis.state === 'S2') {
    if (analysis.isPanic) {
      return {
        state: analysis.state,
        responseClass: 'grounding_prompt',
        triggeredRules: analysis.triggeredRules,
        text: `${person}I am with you. Let's do a quick reset: inhale for 4, hold for 4, exhale for 6. Repeat that 4 times, then name 3 things you can see and 2 things you can feel.`,
      };
    }

    if (analysis.isThirdPersonConcern) {
      return {
        state: analysis.state,
        responseClass: 'human_connection_prompt',
        triggeredRules: analysis.triggeredRules,
        text: `${person}that is serious, and it is good you spoke up. Check on them directly and ask if they are in immediate danger. If risk is immediate, contact emergency services. You can also encourage them to call or text 988 (US/Canada) for live crisis support.`,
      };
    }

    if (analysis.isIsolation) {
      return {
        state: analysis.state,
        responseClass: 'circle_suggestion',
        triggeredRules: analysis.triggeredRules,
        text: `${person}that sounds really heavy, and I am glad you shared it. You matter. If it helps, this is a good moment to connect with one trusted person, or use a Serenix Circle so you are not carrying this alone.`,
      };
    }

    return {
      state: analysis.state,
      responseClass: analysis.responseClass,
      triggeredRules: analysis.triggeredRules,
      text: `${person}I hear how intense this feels. We can take this one step at a time. If you want, tell me what feels hardest right now and we will focus there first.`,
    };
  }

  if (analysis.state === 'S1') {
    return {
      state: analysis.state,
      responseClass: analysis.responseClass,
      triggeredRules: analysis.triggeredRules,
      text: `${person}that sounds like a lot to hold right now. I am here with you. What part of this feels heaviest in this moment?`,
    };
  }

  return {
    state: analysis.state,
    responseClass: analysis.responseClass,
    triggeredRules: analysis.triggeredRules,
    text: `${person}I am here with you. Tell me what you want to unpack first, and we can take it one clear step at a time.`,
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
    return "I'm here in the background if you need support.";
  }

  if (analysis.level >= 3) {
    return "I can feel the intensity rising. Let's pause for a minute and focus on safety. Please use calm, direct language and support each other one person at a time.";
  }

  if (analysis.hasConflict) {
    return "I hear tension in the thread. Could each person share one sentence with 'I feel...' and one sentence with 'What I need right now is...' so we can reset constructively?";
  }

  if (presenceMode === 'reflection') {
    return "I hear meaningful sharing here. What is one theme everyone is noticing in common right now?";
  }

  return "If it helps, each person can share one small win and one current challenge for today.";
}

function fallbackCircleActivity(type: 'starter' | 'gratitude' | 'story' | 'checkin'): string {
  const prompts = {
    starter: "Starter: What is one thing on your mind today that you want support with?",
    gratitude: "Gratitude: Share one small thing you are grateful for from the last 24 hours.",
    story: "Story: Start with 'Today the group found a quiet room where everyone could be honest...' and add one sentence each.",
    checkin: "Check-in: Share a 1-10 energy score and one word for your mood.",
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

async function fetchSelfJson<T>(path: '/v1/pre' | '/v1/post', body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Number.isFinite(selfGovernanceTimeoutMs) ? selfGovernanceTimeoutMs : 1200);
  try {
    const response = await fetch(`${selfGovernanceBaseUrl}${path}`, {
      method: 'POST',
      headers: getSelfHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SELF ${path} failed (${response.status}): ${text}`);
    }

    return await response.json() as T;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function maybeRunSelfPreflight(args: {
  prompt: string;
  history: { role: 'user' | 'model', parts: { text: string }[] }[];
  baseSystemPrompt: string;
  userId?: string;
}): Promise<SelfPreResponse | null> {
  if (!selfGovernanceBaseUrl) return null;
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
  if (!selfGovernanceBaseUrl) return null;
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
  settings?: AISettings,
  preferredName?: string,
  userId?: string
) {
  const aiName = settings?.name || "SerenixAI";
  const aiStyle = settings?.style || "empathetic";
  const trimmedPreferredName = preferredName?.trim();
  const hasPreferredName = Boolean(trimmedPreferredName);

  const styleInstructions = {
    empathetic: "Focus on deep validation, mirroring emotions, and showing profound understanding.",
    calm: "Use steady, reassuring language and help the user slow down when they ask for it or show clear overwhelm.",
    encouraging: "Focus on strengths, small wins, and motivating the user to take gentle next steps."
  };

  const systemInstruction = `You are ${aiName}, a compassionate and empathetic emotional sanctuary assistant. 
  Your conversational style is ${aiStyle}. ${styleInstructions[aiStyle as keyof typeof styleInstructions]}
  ${hasPreferredName
    ? `The person you are talking to likes to be called ${trimmedPreferredName}. Address them by this name when appropriate.`
    : `No preferred name is set. Do not invent one and do not refer to them as "user"; address them naturally as "you".`}
  Your goal is to help users feel heard, validated, and calm. 
  Follow the user's lead and respond directly to what they just said before introducing any exercise.
  Do not force grounding, breathing, or mindfulness unless the user asks for it or clearly needs de-escalation support.
  If the user is venting, prioritize reflection and curiosity first (for example: validating, summarizing, asking what they need right now).
  Avoid giving medical advice, but offer a safe space to vent. 
  Keep responses concise but warm.
  
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
      return clarifierQuestion || "I want to make sure I understand safely. Are you feeling like you might hurt yourself or someone else right now?";
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
    return maybeApplySelfPostflight({
      userMessage: prompt,
      output: deterministicFallback.text,
      policy: selfPolicy,
      userId,
    });
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
    const usedFallback = !rawOutput;
    setLastAIResponseStatus({
      fallbackActive: usedFallback,
      reason: usedFallback ? 'empty_model_output' : 'none',
      fallbackResult: deterministicFallback,
    });
    return maybeApplySelfPostflight({
      userMessage: prompt,
      output,
      policy: selfPolicy,
      userId,
    });
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
    return maybeApplySelfPostflight({
      userMessage: prompt,
      output: deterministicFallback.text,
      policy: selfPolicy,
      userId,
    });
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
    return fallbackCircleMediation(analysis, presenceMode);
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
  - If engagement is high and there's no conflict, keep your response extremely brief or just offer a warm "I'm here if you need me" type of presence.
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
    return response.text || fallbackCircleMediation(analysis, presenceMode);
  } catch (error) {
    console.warn('Circle mediation fallback activated.', error);
    return fallbackCircleMediation(analysis, presenceMode);
  }
}

export async function getCircleActivity(type: 'starter' | 'gratitude' | 'story' | 'checkin', messages: { senderName: string, content: string }[]) {
  if (!ai) {
    return fallbackCircleActivity(type);
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
    return response.text || fallbackCircleActivity(type);
  } catch (error) {
    console.warn('Circle activity fallback activated.', error);
    return fallbackCircleActivity(type);
  }
}

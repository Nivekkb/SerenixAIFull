import { GoogleGenAI } from "@google/genai";
import { AISettings } from "../types";

const geminiApiKey =
  (import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '').trim();

const selfGovernanceBaseUrl = (import.meta.env.VITE_SELF_GOVERNANCE_URL || '').trim().replace(/\/+$/, '');
const selfGovernanceApiKey = (import.meta.env.VITE_SELF_GOVERNANCE_API_KEY || '').trim();
const selfGovernanceTimeoutMs = Number.parseInt(String(import.meta.env.VITE_SELF_GOVERNANCE_TIMEOUT_MS || '1200'), 10);

const ai = new GoogleGenAI({ apiKey: geminiApiKey });

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

function assertGeminiApiKey() {
  if (!geminiApiKey) {
    throw new Error(
      "Missing Gemini API key. Set VITE_GEMINI_API_KEY (preferred) or GEMINI_API_KEY in root .env/.env.local, then restart the dev server."
    );
  }
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
  assertGeminiApiKey();
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

  try {
    const pre = await maybeRunSelfPreflight({
      prompt,
      history,
      baseSystemPrompt: systemInstruction,
      userId,
    });
    if (pre?.clarifier?.required) {
      const clarifierQuestion = pre.clarifier.question?.trim();
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

  const model = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents,
    config: {
      systemInstruction: effectiveSystemInstruction,
    }
  });

  const response = await model;
  let output = response.text || '';

  if (selfPolicy) {
    try {
      const post = await maybeRunSelfPostflight({
        userMessage: prompt,
        output,
        policy: selfPolicy,
        userId,
      });
      if (post?.output && post.output.trim()) {
        output = post.output;
      }
    } catch (error) {
      console.warn('SELF postflight unavailable; using ungoverned Gemini draft for this turn.', error);
    }
  }

  return output;
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
  assertGeminiApiKey();
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

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      systemInstruction: "You are a group dynamics analyst. Your goal is to help the AI know when to step in and when to stay silent to let human connection flourish.",
    }
  });

  try {
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
    return { hasConflict: false, level: 1, type: 'none', reason: '', engagementLevel: 'medium', shouldIntervene: false };
  }
}

export async function getCircleMediation(
  messages: { senderName: string, content: string }[], 
  analysis: CircleAnalysis,
  presenceMode: 'quiet' | 'facilitation' | 'reflection' = 'facilitation'
) {
  assertGeminiApiKey();
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

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: "You are SerenixAI, a compassionate group mediator. Your goal is to keep the conversation constructive and safe without being policing.",
    }
  });

  return response.text;
}

export async function getCircleActivity(type: 'starter' | 'gratitude' | 'story' | 'checkin', messages: { senderName: string, content: string }[]) {
  assertGeminiApiKey();
  const context = messages.length > 0 
    ? `Based on the recent mood of the group: ${messages.map(m => m.content).join(' ')}`
    : "The group just started.";

  const prompts = {
    starter: "Suggest a gentle conversation starter that fits the current mood.",
    gratitude: "Invite everyone to share one small thing they are grateful for today.",
    story: "Start a collaborative 'gentle story'. Provide the first sentence and invite the next person.",
    checkin: "Facilitate a quick emotional check-in. Ask everyone how they are feeling on a scale of 1-10 or with a color."
  };

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `${context}\n\n${prompts[type]}`,
    config: {
      systemInstruction: "You are SerenixAI, a group facilitator. Keep it brief, warm, and inviting.",
    }
  });

  return response.text;
}

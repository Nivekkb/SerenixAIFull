import "dotenv/config";
import express from "express";
import { randomInt } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { initializeApp as initializeAdminApp, cert, getApps, applicationDefault } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

function parsePositiveIntEnv(name, fallback) {
  const raw = Number.parseInt(String(process.env[name] || ""), 10);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return raw;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const circleInviteTtlHours = parsePositiveIntEnv("CIRCLE_INVITE_TTL_HOURS", 168);
const inviteLookupRateWindowSeconds = parsePositiveIntEnv("CIRCLE_INVITE_RATE_LIMIT_WINDOW_SECONDS", 60);
const inviteLookupRateMaxAttempts = parsePositiveIntEnv("CIRCLE_INVITE_RATE_LIMIT_MAX_ATTEMPTS", 10);
const selfUpstreamTimeoutMs = parsePositiveIntEnv("SELF_UPSTREAM_TIMEOUT_MS", 2000);

const selfUpstreamBaseUrl = normalizeBaseUrl(process.env.SELF_UPSTREAM_BASE_URL || "");
const selfUpstreamApiKey = String(process.env.SELF_UPSTREAM_API_KEY || "").trim();
const requiredGovernanceApiKey = String(process.env.GOVERNANCE_API_KEY || process.env.SELF_LOCAL_API_KEY || "").trim();
const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
const serverAi = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
const aiModelName = "gemini-2.5-flash";

const inviteLookupRateBuckets = new Map();

function extractApiKey(req) {
  const bearer = String(req.headers.authorization || "");
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return String(req.headers["x-api-key"] || "").trim();
}

function extractFirebaseToken(req) {
  const explicit = String(req.headers["x-firebase-auth"] || "").trim();
  if (explicit) return explicit;
  const bearer = String(req.headers.authorization || "");
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return "";
}

function normalizeInviteCode(value) {
  if (typeof value !== "string") return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
}

function parseTimeMs(value) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && typeof value.toDate === "function") {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function generateInviteCode(length = 8) {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(0, INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

async function createUniqueInviteCode(adminDb) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = generateInviteCode();
    const existing = await adminDb.collection("circle_invites").doc(candidate).get();
    if (!existing.exists) return candidate;
  }
  return `${generateInviteCode(6)}${Date.now().toString().slice(-2)}`;
}

function getInviteLookupBucket(uid) {
  const key = `invite_lookup:${uid}`;
  const nowMs = Date.now();
  const windowMs = inviteLookupRateWindowSeconds * 1000;
  const existing = inviteLookupRateBuckets.get(key);

  if (!existing || nowMs - existing.windowStartMs >= windowMs) {
    const fresh = {
      windowStartMs: nowMs,
      attempts: 0,
    };
    inviteLookupRateBuckets.set(key, fresh);
    return fresh;
  }

  return existing;
}

function checkInviteLookupRateLimit(uid) {
  const key = `invite_lookup:${uid}`;
  const nowMs = Date.now();
  const windowMs = inviteLookupRateWindowSeconds * 1000;
  const bucket = getInviteLookupBucket(uid);

  if (bucket.blockedUntilMs && nowMs < bucket.blockedUntilMs) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.blockedUntilMs - nowMs) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  bucket.attempts += 1;
  if (bucket.attempts > inviteLookupRateMaxAttempts) {
    bucket.blockedUntilMs = nowMs + windowMs;
    inviteLookupRateBuckets.set(key, bucket);
    return { allowed: false, retryAfterSeconds: Math.max(1, inviteLookupRateWindowSeconds) };
  }

  inviteLookupRateBuckets.set(key, bucket);
  return { allowed: true };
}

function clearInviteLookupRateLimit(uid) {
  const key = `invite_lookup:${uid}`;
  inviteLookupRateBuckets.delete(key);
}

async function issueCircleInvite(adminDb, circleId, createdBy, previousInviteCode) {
  const circleRef = adminDb.collection("circles").doc(circleId);
  const inviteCode = await createUniqueInviteCode(adminDb);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + circleInviteTtlHours * 60 * 60 * 1000).toISOString();

  const batch = adminDb.batch();
  if (previousInviteCode) {
    const oldInviteRef = adminDb.collection("circle_invites").doc(previousInviteCode);
    batch.set(oldInviteRef, { revokedAt: nowIso, revokedBy: createdBy }, { merge: true });
  }

  const inviteRef = adminDb.collection("circle_invites").doc(inviteCode);
  batch.set(inviteRef, {
    circleId,
    inviteCode,
    createdBy,
    createdAt: nowIso,
    expiresAt,
    revokedAt: null,
    revokedBy: null,
    uses: 0,
    usedAt: null,
    usedBy: [],
  });

  batch.set(circleRef, {
    inviteCode,
    inviteExpiresAt: expiresAt,
    inviteUpdatedAt: nowIso,
    inviteRevokedAt: null,
  }, { merge: true });

  await batch.commit();
  return { inviteCode, createdAt: nowIso, expiresAt };
}

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];

  const projectId = String(process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "").trim() || undefined;
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKeyRaw = String(process.env.FIREBASE_PRIVATE_KEY || "").trim();

  if (projectId && clientEmail && privateKeyRaw) {
    return initializeAdminApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
      }),
      projectId,
    });
  }

  return initializeAdminApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });
}

function getFirebaseAdminConfigMode() {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKeyRaw = String(process.env.FIREBASE_PRIVATE_KEY || "").trim();
  if (projectId && clientEmail && privateKeyRaw) return "service_account_env";
  return "application_default";
}

function getFirebaseAdminInitHealth() {
  const mode = getFirebaseAdminConfigMode();
  try {
    getAdminApp();
    return { initialized: true, mode };
  } catch (error) {
    return {
      initialized: false,
      mode,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function requireVerifiedFirebaseUser(req) {
  const token = extractFirebaseToken(req);
  if (!token) throw new Error("firebase_auth_required");
  const decoded = await getAdminAuth(getAdminApp()).verifyIdToken(token);
  if (!decoded.uid) throw new Error("firebase_auth_invalid");
  return { uid: decoded.uid };
}

function normalizeSelfText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function stateRank(state) {
  return state === "S3" ? 3 : state === "S2" ? 2 : state === "S1" ? 1 : 0;
}

function maxState(a, b) {
  return stateRank(a) >= stateRank(b) ? a : b;
}

function detectSelfState(message) {
  const normalized = normalizeSelfText(message);
  const triggeredRules = [];

  const methodSeekingPatterns = [
    /\bleast painful way to die\b/,
    /\bquickest suicide method\b/,
    /\bhow do people overdose\b/,
    /\beasiest way to end (?:my|your|their) life\b/,
    /\b(?:how|what)\b.*\b(?:die|suicide|overdose|kill myself|end my life)\b/,
    /\bhypothetically\b.*\b(?:die|suicide|overdose|kill|end life)\b/,
    /\bfor science\b/,
    /\beducational purposes only\b/,
    /\bjust curious\b.*\b(?:die|suicide|overdose)\b/,
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
    /\beveryone would be better off without me\b/,
    /\bpeople would be happier if i was gone\b/,
    /\bi feel like everyone'?s life would improve without me\b/,
    /\bif i disappeared everything would be easier\b/,
  ];

  const panicPatterns = [
    /\bi(?:'m| am) having a panic attack\b/,
    /\bi can(?:not|'?t) breathe\b/,
    /\bi(?:'m| am) freaking out\b/,
    /\bmy heart is racing\b/,
    /\bfeel like i(?:'m| am) suffocating\b/,
  ];

  const thirdPersonConcernPatterns = [
    /\bmy friend says they want to die\b/,
    /\bsomeone i know wants to kill themselves\b/,
    /\bmy partner says they don'?t want to live anymore\b/,
    /\bmy buddy says\b.*\b(?:die|kill|end (?:it|life))\b/,
  ];

  const hopelessPatterns = [
    /\bnothing matters anymore\b/,
    /\beverything feels pointless\b/,
    /\bi don'?t see the point of living\b/,
    /\blife feels meaningless\b/,
    /\bi can(?:not|'?t) keep doing this\b/,
    /\bi(?:'m| am) done with everything\b/,
    /\bi(?:'m| am) at my limit\b/,
  ];

  const darkHumorPatterns = [
    /\balt\s*\+\s*f4\b.*\b(?:existence|myself|me|life)\b/,
    /\buninstall life\b/,
    /\blife\.?exe\b.*\b(?:stopped|crashed|quit)\b/,
    /\bthe void is hiring\b/,
    /\bdisappear haha\b/,
  ];

  const isMethodSeeking = methodSeekingPatterns.some((pattern) => pattern.test(normalized));
  const isExplicitIntent = explicitIntentPatterns.some((pattern) => pattern.test(normalized));
  const isPassiveDeathWish = passiveDeathWishPatterns.some((pattern) => pattern.test(normalized));
  const isPanic = panicPatterns.some((pattern) => pattern.test(normalized));
  const isThirdPersonConcern = thirdPersonConcernPatterns.some((pattern) => pattern.test(normalized));
  const isHopeless = hopelessPatterns.some((pattern) => pattern.test(normalized));
  const isDarkHumor = darkHumorPatterns.some((pattern) => pattern.test(normalized));

  if (isMethodSeeking) triggeredRules.push("method_seeking");
  if (isExplicitIntent) triggeredRules.push("explicit_intent");
  if (isPassiveDeathWish) triggeredRules.push("passive_death_wish");
  if (isPanic) triggeredRules.push("panic_signal");
  if (isThirdPersonConcern) triggeredRules.push("third_person_concern");
  if (isHopeless) triggeredRules.push("hopelessness");
  if (isDarkHumor) triggeredRules.push("dark_humor_distress");
  if (triggeredRules.length === 0) triggeredRules.push("default_reflection");

  let state = "S0";
  let responseClass = "normal_reflection";
  if (isMethodSeeking) {
    state = "S3";
    responseClass = "refusal_with_dignity";
  } else if (isExplicitIntent) {
    state = "S3";
    responseClass = "crisis_redirection";
  } else if (isPanic || isThirdPersonConcern || isPassiveDeathWish) {
    state = "S2";
    responseClass = isPanic ? "grounding_prompt" : isThirdPersonConcern ? "human_connection_prompt" : "supportive_reflection";
  } else if (isHopeless || isDarkHumor) {
    state = "S1";
    responseClass = "supportive_reflection";
  }

  return {
    state,
    responseClass,
    triggeredRules,
    isMethodSeeking,
  };
}

function buildDeterministicPolicy(state, responseClass, triggeredRules) {
  return {
    state,
    responseClass,
    deterministicFallback: true,
    forbidUnsafeMethodContent: true,
    requireHumanConnectionNudge: state === "S2" || state === "S3",
    requireCrisisResources: state === "S3",
    triggeredRules,
  };
}

function buildDeterministicPolicyPrompt(baseSystemPrompt, policy) {
  if (typeof baseSystemPrompt !== "string" || !baseSystemPrompt.trim()) return undefined;
  const stateDirective =
    policy.state === "S3"
      ? "State S3: refuse harmful instructions with dignity, include crisis redirection, grounding, and immediate human support."
      : policy.state === "S2"
        ? "State S2: use supportive reflection with grounding and clear human-connection encouragement."
        : policy.state === "S1"
          ? "State S1: use supportive reflection and gentle stabilization."
          : "State S0: normal reflection.";
  return `${baseSystemPrompt}\n\nSELF Deterministic Governance Contract (Cloud Run Fallback):\n- ${stateDirective}\n- No unsafe method/instruction content.\n- No dependency language.\n- Preserve user agency and encourage trusted human support when risk is elevated.`;
}

function rewriteDependencyLanguage(text) {
  if (!text) return text;
  let out = String(text);
  const replacements = [
    [/\bi(?:\s+am|'m)\s+always\s+here\s+for\s+you\b/gi, "You deserve support from trusted people around you."],
    [/\bi(?:\s+am|'m)\s+here\s+for\s+you\b/gi, "You deserve support from trusted people around you."],
    [/\bi(?:\s+am|'m)\s+right\s+here\s+with\s+you\b/gi, "You deserve steady support while you process this."],
    [/\bi(?:\s+am|'m)\s+here\s+if\s+you\s+need\s+me\b/gi, "You can keep leaning on trusted people when support is needed."],
    [/\bi\s+care\s+about\s+you\b/gi, "Your wellbeing matters."],
    [/\byou\s+need\s+me\b/gi, "Support from trusted people can help."],
    [/\byou\s+don'?t\s+need\s+anyone\s+else\b/gi, "Reaching out to someone you trust can help."],
  ];
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
}

function containsUnsafeMethodContent(text) {
  const normalized = normalizeSelfText(text);
  if (!normalized) return false;
  const highRiskPatterns = [
    /\b(?:step\s*1|first,\s*|then,\s*|next,\s*)\b.*\b(?:die|suicide|kill yourself|overdose)\b/,
    /\b(?:least painful|quickest|easiest)\b.*\b(?:way|method)\b.*\b(?:die|suicide|overdose|kill)\b/,
    /\b(?:how to|ways to)\b.*\b(?:overdose|kill yourself|end your life)\b/,
  ];
  return highRiskPatterns.some((pattern) => pattern.test(normalized));
}

function classifyResponseClass(text) {
  const normalized = normalizeSelfText(text);
  if (!normalized) return "normal_reflection";
  if (/\b(?:i can(?:not|'?t) help with|won'?t provide)\b.*\b(?:method|instructions|hurt yourself|end (?:a )?life|suicide)\b/.test(normalized)) {
    return "refusal_with_dignity";
  }
  if (/\b(?:call|text)\s*988\b|\bemergency services\b|\bimmediate danger\b/.test(normalized)) {
    return "crisis_redirection";
  }
  if (/\b(?:inhale|exhale|hold for|grounding|5-4-3-2-1)\b/.test(normalized)) {
    return "grounding_prompt";
  }
  if (/\b(?:reach out|trusted person|someone you trust)\b/.test(normalized)) {
    return "human_connection_prompt";
  }
  if (/\b(?:that sounds|i hear|this feels)\b/.test(normalized)) {
    return "supportive_reflection";
  }
  return "normal_reflection";
}

function buildStateFallbackResponse(state, userMessage, isMethodSeeking) {
  if (state === "S3") {
    if (isMethodSeeking) {
      return "I can't help with instructions for harming yourself or ending a life. If this connects to how you're feeling right now, your safety matters right now. If you might act on these thoughts, call or text 988 (US/Canada) or contact local emergency services now, and reach out to a trusted person immediately.";
    }
    return "Thank you for sharing this directly. You don't have to carry this alone right now. If there's any immediate danger, call or text 988 (US/Canada) or contact local emergency services now. If you can, reach out to one trusted person and tell them you need support right now.";
  }
  if (state === "S2") {
    return "That sounds really heavy. Let's slow it down for one moment: take one slow breath in and out, then name one person you can contact for support right now. You deserve real human support as you move through this.";
  }
  if (state === "S1") {
    return "That sounds like a lot to hold. What part feels heaviest right now, and what would help you feel a little steadier in this moment?";
  }
  return userMessage
    ? "Thank you for sharing that. What part would you like to unpack first?"
    : "What would you like to reflect on first?";
}

function buildDeterministicPreflight(body, upstreamMeta) {
  const message = typeof body?.message === "string" ? body.message : "";
  const detection = detectSelfState(message);
  const policy = buildDeterministicPolicy(detection.state, detection.responseClass, detection.triggeredRules);
  return {
    detection: {
      state: detection.state,
      responseClass: detection.responseClass,
      triggeredRules: detection.triggeredRules,
      deterministicFallback: true,
    },
    variant: "control",
    policy,
    meta: {
      source: "cloudrun_deterministic_pre_fallback",
      upstream: upstreamMeta,
      triggeredRules: detection.triggeredRules,
    },
    clarifier: {
      required: false,
    },
    policyPrompt: buildDeterministicPolicyPrompt(body?.baseSystemPrompt, policy),
  };
}

function buildDeterministicPostflight(body, upstreamMeta) {
  const userMessage = typeof body?.userMessage === "string" ? body.userMessage : "";
  const rawOutput = typeof body?.output === "string" ? body.output : "";
  const policyState = typeof body?.policy?.state === "string" ? body.policy.state : "S0";
  const userDetection = detectSelfState(userMessage);
  const effectiveState = maxState(policyState, userDetection.state);
  const issues = [];

  let output = rawOutput.trim() || buildStateFallbackResponse(effectiveState, userMessage, userDetection.isMethodSeeking);
  output = rewriteDependencyLanguage(output);

  if (containsUnsafeMethodContent(output)) {
    issues.push("unsafe_method_content_detected");
    output = buildStateFallbackResponse("S3", userMessage, true);
  }

  let responseClass = classifyResponseClass(output);
  const s2Weak = effectiveState === "S2" && responseClass === "normal_reflection";
  const s3Weak =
    effectiveState === "S3"
    && !["refusal_with_dignity", "crisis_redirection", "grounding_prompt", "human_connection_prompt"].includes(responseClass);

  if (s2Weak || s3Weak) {
    issues.push(s3Weak ? "s3_guard_fail_closed" : "s2_guard_fail_closed");
    output = buildStateFallbackResponse(effectiveState, userMessage, userDetection.isMethodSeeking);
    output = rewriteDependencyLanguage(output);
    responseClass = classifyResponseClass(output);
  }

  return {
    output,
    validation: {
      ok: true,
      state: effectiveState,
      responseClass,
      issues,
      deterministicFallback: true,
      source: "cloudrun_deterministic_post_fallback",
      upstream: upstreamMeta,
    },
    repaired: issues.length > 0,
  };
}

function fallbackCircleAnalysis(messages, presenceMode) {
  const joined = messages.map((m) => String(m.content || "").toLowerCase()).join("\n");
  const uniqueSenders = new Set(messages.map((m) => m.senderName)).size;
  const hasHostility = /\b(?:stupid|idiot|shut up|hate you|this is your fault|you always|you never)\b/.test(joined);
  const hasDistress = /\b(?:can't do this|panic|overwhelmed|want to die|hurt myself|hopeless|kill myself|end my life)\b/.test(joined);
  const hasConflict = hasHostility || hasDistress;
  const level = hasDistress ? 3 : hasHostility ? 2 : 1;
  const type = hasDistress ? "distress" : hasHostility ? "hostility" : "none";
  const engagementLevel =
    messages.length >= 6 && uniqueSenders >= 2 ? "high" : messages.length >= 3 ? "medium" : "low";

  const shouldIntervene =
    presenceMode === "quiet"
      ? hasConflict
      : presenceMode === "facilitation"
        ? hasConflict || engagementLevel === "low"
        : hasConflict || engagementLevel !== "high";

  return {
    hasConflict,
    level,
    type,
    engagementLevel,
    shouldIntervene,
    reason: hasConflict
      ? "Deterministic server analysis detected conflict or distress signals."
      : "Deterministic server analysis detected no clear conflict.",
  };
}

function fallbackCircleMediation(analysis, presenceMode) {
  if (presenceMode === "quiet" && !analysis.hasConflict) {
    return "The AI will stay in the background unless support is needed.";
  }
  if (analysis.level >= 3) {
    return "I can feel the intensity rising. Let's pause for a minute and focus on safety. Please use calm, direct language and support each other one person at a time.";
  }
  if (analysis.hasConflict) {
    return "I hear tension in the thread. Could each person share one sentence with 'I feel...' and one sentence with 'What I need right now is...' so the group can reset constructively?";
  }
  if (presenceMode === "reflection") {
    return "I hear meaningful sharing here. What is one theme everyone is noticing in common right now?";
  }
  return "If it helps, each person can share one small win and one current challenge for today.";
}

function fallbackCircleActivity(type) {
  const prompts = {
    starter: "Starter: What is one thing on your mind today that you want support with?",
    gratitude: "Gratitude: Share one small thing you are grateful for from the last 24 hours.",
    story: "Story: Start with 'Today the group found a quiet room where everyone could be honest...' and add one sentence each.",
    checkin: "Check-in: Share a 1-10 energy score and one word for your mood.",
  };
  return prompts[type] || prompts.starter;
}

async function analyzeCircleConversationServer(messages, presenceMode) {
  if (!serverAi) return fallbackCircleAnalysis(messages, presenceMode);

  const prompt = `Analyze the following private support-circle conversation.\n\nAI Presence Mode: ${presenceMode}\n- quiet: intervene only for meaningful conflict/distress.\n- facilitation: intervene for conflict or stalled/low engagement.\n- reflection: intervene more actively when engagement is not high.\n\nConversation:\n${messages.map((m) => `${m.senderName}: ${m.content}`).join("\n")}\n\nReturn JSON with keys: hasConflict, level, type, reason, engagementLevel, shouldIntervene.`;

  try {
    const response = await serverAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        systemInstruction: "You are a cautious group dynamics analyst for a mental-health-adjacent support app. Prefer safe escalation when distress is plausibly present.",
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return {
      hasConflict: Boolean(parsed.hasConflict),
      level: [1, 2, 3, 4].includes(parsed.level) ? parsed.level : 1,
      type: ["disagreement", "hostility", "harassment", "distress", "none"].includes(parsed.type) ? parsed.type : "none",
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      engagementLevel: ["low", "medium", "high"].includes(parsed.engagementLevel) ? parsed.engagementLevel : "medium",
      shouldIntervene: Boolean(parsed.shouldIntervene),
    };
  } catch {
    return fallbackCircleAnalysis(messages, presenceMode);
  }
}

async function buildCircleMediationServer(messages, analysis, presenceMode) {
  if (!serverAi) return fallbackCircleMediation(analysis, presenceMode);

  const prompt = `As SerenixAI, provide a concise shared facilitation note for this private circle.\n\nPresence Mode: ${presenceMode}\nConflict Level: ${analysis.level} (${analysis.type})\nReason: ${analysis.reason}\nEngagement: ${analysis.engagementLevel}\n\nRules:\n- Do not take sides.\n- Do not shame or police.\n- Do not imply therapy or exclusive attachment.\n- Encourage grounded, human-to-human communication.\n- If level 4, clearly pause the thread for safety and direct members toward immediate human support.\n\nConversation:\n${messages.map((m) => `${m.senderName}: ${m.content}`).join("\n")}`;

  try {
    const response = await serverAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are a cautious, non-attaching facilitator for private support circles.",
      },
    });
    return (response.text || fallbackCircleMediation(analysis, presenceMode)).trim();
  } catch {
    return fallbackCircleMediation(analysis, presenceMode);
  }
}

async function buildCircleActivityServer(type, messages) {
  if (!serverAi) return fallbackCircleActivity(type);

  const prompt = `${messages.length > 0 ? `Recent mood: ${messages.map((m) => m.content).join(" ")}` : "The group just started."}\n\nGenerate one brief ${type} prompt for a private support circle.`;
  try {
    const response = await serverAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are a concise, non-attaching facilitator for private support circles. Keep prompts brief and safe.",
      },
    });
    return (response.text || fallbackCircleActivity(type)).trim();
  } catch {
    return fallbackCircleActivity(type);
  }
}

function buildAiWriteProvenance(route, timestamp) {
  return {
    writtenBy: "trusted_backend",
    writerService: "serenix-governance-cloudrun",
    writerRoute: route,
    writerMode: serverAi ? "model_with_deterministic_fallback" : "deterministic_fallback_only",
    writerModel: serverAi ? "gemini-2.5-flash" : null,
    writerGeneratedAt: timestamp,
  };
}

function normalizePrivatePrompt(prompt) {
  return String(prompt || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function classifyPrivateRisk(prompt) {
  const normalized = normalizePrivatePrompt(prompt);
  const methodSeeking = /\b(?:least painful way to die|quickest suicide method|how do people overdose|how to kill myself|end my life painlessly)\b/.test(normalized);
  const explicitIntent = /\b(?:i want to kill myself|i want to end my life|i'm going to kill myself|i do not want to live anymore|i dont want to live anymore)\b/.test(normalized);
  const elevated = /\b(?:i wish i could disappear|i wish everything would stop|everything feels pointless|life feels meaningless|i can't keep doing this|panic attack|i can't breathe|i cant breathe|freaking out)\b/.test(normalized);
  if (methodSeeking || explicitIntent) return { state: "S3", methodSeeking };
  if (elevated) return { state: "S2", methodSeeking: false };
  return { state: "S0", methodSeeking: false };
}

function buildPrivateFallbackOutput(userMessage) {
  const risk = classifyPrivateRisk(userMessage);
  if (risk.state === "S3") {
    if (risk.methodSeeking) {
      return "I can’t help with instructions for harming yourself or ending a life. If this connects to how you’re feeling right now, your safety comes first. If you might act on this, call or text 988 (US/Canada) or contact local emergency services now, and reach out to a trusted person immediately.";
    }
    return "Thank you for saying this directly. You do not have to carry this alone right now. If there is any immediate danger, call or text 988 (US/Canada) or contact local emergency services now. If you can, reach out to one trusted person and let them know you need support tonight.";
  }
  if (risk.state === "S2") {
    return "That sounds really heavy. Let’s slow this down for one moment. Take one slow breath in and out, then name one person you could contact for support right now. You deserve real human support as you move through this.";
  }
  return "Thank you for sharing that. What part feels most important to unpack first?";
}

function buildPrivateSystemPrompt(responseLength, preferredName) {
  const lengthInstruction = responseLength === "long"
    ? "Long mode is enabled. You may provide fuller detail when useful, while still staying concise."
    : responseLength === "medium"
      ? "Keep responses moderate: usually 2-4 sentences unless safety requires more detail."
      : "Keep responses brief by default: usually 1-3 short sentences unless safety requires more detail.";

  return `You are SerenixAI, a steady reflection tool.
Use warm, grounded validation without attachment language.
${lengthInstruction}
${preferredName ? `The person prefers to be called ${preferredName}.` : "Address the person naturally as 'you'."}
Do not imply therapy, friendship, or emotional exclusivity.
Do not use dependency-forming language.
Encourage real-world support when risk is elevated.`;
}

function enforcePrivateFailClosed(output, userMessage) {
  const risk = classifyPrivateRisk(userMessage);
  const normalized = normalizePrivatePrompt(output);
  const hasUnsafeMethodContent = /\b(?:step\s*1|least painful|quickest|how to|ways to)\b.*\b(?:die|suicide|overdose|kill yourself|end your life)\b/.test(normalized);
  const lacksCrisisForS3 = risk.state === "S3" && !/\b(?:988|emergency services|trusted person|can't help with instructions|cannot help with instructions)\b/.test(normalized);
  if (hasUnsafeMethodContent || lacksCrisisForS3) {
    return buildPrivateFallbackOutput(userMessage);
  }
  return output;
}

function buildUpstreamHeaders(req) {
  const headers = {
    "content-type": "application/json",
  };

  if (selfUpstreamApiKey) {
    headers.authorization = `Bearer ${selfUpstreamApiKey}`;
    headers["x-api-key"] = selfUpstreamApiKey;
  } else {
    const authorization = String(req.headers.authorization || "").trim();
    const xApiKey = String(req.headers["x-api-key"] || "").trim();
    if (authorization) headers.authorization = authorization;
    if (xApiKey) headers["x-api-key"] = xApiKey;
  }

  return headers;
}

async function callSelfUpstream(req, path) {
  if (!selfUpstreamBaseUrl) {
    return {
      ok: false,
      status: 503,
      error: "self_upstream_not_configured",
      detail: "Set SELF_UPSTREAM_BASE_URL so /v1/pre and /v1/post can be proxied.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), selfUpstreamTimeoutMs);
  try {
    const upstreamResponse = await fetch(`${selfUpstreamBaseUrl}${path}`, {
      method: "POST",
      headers: buildUpstreamHeaders(req),
      body: JSON.stringify(req.body || {}),
      signal: controller.signal,
    });

    const status = upstreamResponse.status;
    const contentType = String(upstreamResponse.headers.get("content-type") || "");
    const text = await upstreamResponse.text();
    const isJson = contentType.includes("application/json");
    let parsedJson = null;
    if (isJson) {
      try {
        parsedJson = JSON.parse(text);
      } catch {
        parsedJson = null;
      }
    }

    if (upstreamResponse.ok) {
      return {
        ok: true,
        status,
        contentType,
        body: isJson && parsedJson !== null ? parsedJson : text,
      };
    }

    return {
      ok: false,
      status,
      error: "self_upstream_http_error",
      detail: text || `Upstream returned HTTP ${status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: "self_upstream_proxy_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

const app = express();
app.use(express.json({ limit: "256kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-Firebase-Auth");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use((req, res, next) => {
  if (!requiredGovernanceApiKey) {
    next();
    return;
  }

  const provided = extractApiKey(req);
  if (!provided || provided !== requiredGovernanceApiKey) {
    res.status(401).json({ error: "invalid_api_key" });
    return;
  }

  next();
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode: "cloudrun-hybrid",
    upstreamConfigured: Boolean(selfUpstreamBaseUrl),
    upstreamBaseUrl: selfUpstreamBaseUrl || null,
    deterministicPrePostFallback: true,
    firebaseAdmin: getFirebaseAdminInitHealth(),
    inviteConfig: {
      ttlHours: circleInviteTtlHours,
      lookupRateWindowSeconds: inviteLookupRateWindowSeconds,
      lookupRateMaxAttempts: inviteLookupRateMaxAttempts,
    },
  });
});

app.get("/health-governance", (_req, res) => {
  res.json({
    ok: true,
    mode: "cloudrun-hybrid",
    upstreamConfigured: Boolean(selfUpstreamBaseUrl),
    upstreamBaseUrl: selfUpstreamBaseUrl || null,
    deterministicPrePostFallback: true,
    firebaseAdmin: getFirebaseAdminInitHealth(),
    inviteConfig: {
      ttlHours: circleInviteTtlHours,
      lookupRateWindowSeconds: inviteLookupRateWindowSeconds,
      lookupRateMaxAttempts: inviteLookupRateMaxAttempts,
    },
  });
});

app.post("/v1/pre", async (req, res) => {
  const body = req.body || {};
  const message = body.message;
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message_required" });
    return;
  }

  const upstream = await callSelfUpstream(req, "/v1/pre");
  if (upstream.ok) {
    res.status(upstream.status);
    if (typeof upstream.body === "string") {
      res.send(upstream.body);
    } else {
      res.json(upstream.body);
    }
    return;
  }

  console.warn("[serenix-governance-cloudrun] /v1/pre upstream unavailable, using deterministic fallback.", {
    error: upstream.error,
    status: upstream.status,
  });
  res.status(200).json(
    buildDeterministicPreflight(body, {
      error: upstream.error,
      status: upstream.status,
      detail: upstream.detail,
    }),
  );
});

app.post("/v1/post", async (req, res) => {
  const body = req.body || {};
  if (typeof body.output !== "string" || typeof body.userMessage !== "string" || !body.policy || typeof body.policy !== "object") {
    res.status(400).json({ error: "output_userMessage_policy_required" });
    return;
  }

  const upstream = await callSelfUpstream(req, "/v1/post");
  if (upstream.ok) {
    res.status(upstream.status);
    if (typeof upstream.body === "string") {
      res.send(upstream.body);
    } else {
      res.json(upstream.body);
    }
    return;
  }

  console.warn("[serenix-governance-cloudrun] /v1/post upstream unavailable, using deterministic fallback.", {
    error: upstream.error,
    status: upstream.status,
  });
  res.status(200).json(
    buildDeterministicPostflight(body, {
      error: upstream.error,
      status: upstream.status,
      detail: upstream.detail,
    }),
  );
});

app.post("/v1/private/respond", async (req, res) => {
  try {
    const { uid } = await requireVerifiedFirebaseUser(req);
    const body = req.body || {};
    const userMessage = typeof body.userMessage === "string" ? body.userMessage.trim() : "";
    const history = Array.isArray(body.history) ? body.history : [];
    const responseLength = typeof body.responseLength === "string" ? body.responseLength : "short";
    const preferredName = typeof body.preferredName === "string" ? body.preferredName.trim() : "";

    if (!userMessage) {
      res.status(400).json({ error: "userMessage_required" });
      return;
    }

    let output = buildPrivateFallbackOutput(userMessage);
    if (serverAi) {
      try {
        const contents = [
          ...history,
          { role: "user", parts: [{ text: userMessage }] },
        ];
        const response = await serverAi.models.generateContent({
          model: aiModelName,
          contents,
          config: {
            systemInstruction: buildPrivateSystemPrompt(responseLength, preferredName),
          },
        });
        const candidate = String(response.text || "").trim() || output;
        output = enforcePrivateFailClosed(candidate, userMessage);
      } catch {
        output = buildPrivateFallbackOutput(userMessage);
      }
    }

    const timestamp = new Date().toISOString();
    const adminDb = getAdminFirestore(getAdminApp());
    const messageRef = await adminDb.collection("private_chats").doc(uid).collection("messages").add({
      content: output,
      senderId: "ai",
      senderName: "SerenixAI",
      timestamp,
      type: "ai",
      writtenBy: "trusted_backend",
      writerService: "serenix-governance-cloudrun",
      writerRoute: "/v1/private/respond",
      writerMode: serverAi ? "model_with_deterministic_fallback" : "deterministic_fallback_only",
      writerModel: serverAi ? aiModelName : null,
      writerGeneratedAt: timestamp,
    });

    res.json({ ok: true, output, messageId: messageRef.id });
  } catch (error) {
    res.status(500).json({ error: "private_respond_failed", detail: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/v1/circles/invite/create", async (req, res) => {
  try {
    const { uid } = await requireVerifiedFirebaseUser(req);
    const body = req.body || {};
    const circleId = typeof body.circleId === "string" ? body.circleId.trim() : "";
    if (!circleId) {
      res.status(400).json({ error: "circleId_required" });
      return;
    }

    const adminDb = getAdminFirestore(getAdminApp());
    const circleRef = adminDb.collection("circles").doc(circleId);
    const circleSnap = await circleRef.get();
    if (!circleSnap.exists) {
      res.status(404).json({ error: "circle_not_found" });
      return;
    }

    const circleData = circleSnap.data() || {};
    if (circleData.createdBy !== uid) {
      res.status(403).json({ error: "only_creator_can_create_invite" });
      return;
    }

    const existingCode = typeof circleData.inviteCode === "string" ? circleData.inviteCode : "";
    if (existingCode) {
      const existingInviteSnap = await adminDb.collection("circle_invites").doc(existingCode).get();
      if (existingInviteSnap.exists) {
        const existingInvite = existingInviteSnap.data() || {};
        const nowMs = Date.now();
        const expiresAtMs = parseTimeMs(existingInvite.expiresAt);
        const revokedAtMs = parseTimeMs(existingInvite.revokedAt);
        if (!revokedAtMs && (!expiresAtMs || nowMs <= expiresAtMs)) {
          res.json({
            inviteCode: existingCode,
            createdAt: existingInvite.createdAt || null,
            expiresAt: existingInvite.expiresAt || null,
            reused: true,
          });
          return;
        }
      }
    }

    const issued = await issueCircleInvite(adminDb, circleId, uid);
    res.json({
      inviteCode: issued.inviteCode,
      createdAt: issued.createdAt,
      expiresAt: issued.expiresAt,
      reused: false,
    });
  } catch (error) {
    res.status(500).json({ error: "circle_invite_create_failed", detail: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/v1/circles/invite/regenerate", async (req, res) => {
  try {
    const { uid } = await requireVerifiedFirebaseUser(req);
    const body = req.body || {};
    const circleId = typeof body.circleId === "string" ? body.circleId.trim() : "";
    if (!circleId) {
      res.status(400).json({ error: "circleId_required" });
      return;
    }

    const adminDb = getAdminFirestore(getAdminApp());
    const circleRef = adminDb.collection("circles").doc(circleId);
    const circleSnap = await circleRef.get();
    if (!circleSnap.exists) {
      res.status(404).json({ error: "circle_not_found" });
      return;
    }

    const circleData = circleSnap.data() || {};
    if (circleData.createdBy !== uid) {
      res.status(403).json({ error: "only_creator_can_regenerate_invite" });
      return;
    }

    const previousInviteCode = typeof circleData.inviteCode === "string" ? circleData.inviteCode : undefined;
    const issued = await issueCircleInvite(adminDb, circleId, uid, previousInviteCode);
    res.json({
      inviteCode: issued.inviteCode,
      createdAt: issued.createdAt,
      expiresAt: issued.expiresAt,
      previousInviteCode: previousInviteCode || null,
    });
  } catch (error) {
    res.status(500).json({ error: "circle_invite_regenerate_failed", detail: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/v1/circles/invite/join", async (req, res) => {
  try {
    const { uid } = await requireVerifiedFirebaseUser(req);
    const limiter = checkInviteLookupRateLimit(uid);
    if (!limiter.allowed) {
      res.status(429).json({
        error: "invite_lookup_rate_limited",
        retryAfterSeconds: limiter.retryAfterSeconds || inviteLookupRateWindowSeconds,
      });
      return;
    }

    const body = req.body || {};
    const inviteCode = normalizeInviteCode(body.inviteCode);
    if (!inviteCode || inviteCode.length < 6) {
      res.status(400).json({ error: "inviteCode_required" });
      return;
    }

    const adminDb = getAdminFirestore(getAdminApp());
    const nowIso = new Date().toISOString();

    const joinResult = await adminDb.runTransaction(async (transaction) => {
      const inviteRef = adminDb.collection("circle_invites").doc(inviteCode);
      const inviteSnap = await transaction.get(inviteRef);
      if (!inviteSnap.exists) return { ok: false, error: "invite_invalid_or_expired" };

      const inviteData = inviteSnap.data() || {};
      const circleId = typeof inviteData.circleId === "string" ? inviteData.circleId : "";
      if (!circleId) return { ok: false, error: "invite_invalid_or_expired" };

      const revokedAtMs = parseTimeMs(inviteData.revokedAt);
      if (revokedAtMs) return { ok: false, error: "invite_invalid_or_expired" };

      const expiresAtMs = parseTimeMs(inviteData.expiresAt);
      if (expiresAtMs && Date.now() > expiresAtMs) {
        transaction.set(inviteRef, { revokedAt: nowIso, revokedBy: "system_expired" }, { merge: true });
        return { ok: false, error: "invite_invalid_or_expired" };
      }

      const circleRef = adminDb.collection("circles").doc(circleId);
      const circleSnap = await transaction.get(circleRef);
      if (!circleSnap.exists) return { ok: false, error: "invite_invalid_or_expired" };

      const circleData = circleSnap.data() || {};
      const existingMembers = Array.isArray(circleData.members)
        ? circleData.members.filter((member) => typeof member === "string")
        : [];

      const alreadyMember = existingMembers.includes(uid);
      if (!alreadyMember) {
        transaction.set(circleRef, { members: [...existingMembers, uid] }, { merge: true });
      }

      const usedBy = Array.isArray(inviteData.usedBy)
        ? inviteData.usedBy.filter((member) => typeof member === "string")
        : [];
      const nextUsedBy = usedBy.includes(uid) ? usedBy : [...usedBy, uid];
      const currentUses = Number.isFinite(inviteData.uses) ? Number(inviteData.uses) : 0;
      const nextUses = alreadyMember ? currentUses : currentUses + 1;

      transaction.set(inviteRef, {
        usedAt: nowIso,
        usedBy: nextUsedBy,
        uses: nextUses,
      }, { merge: true });

      return { ok: true, circleId, alreadyMember, uses: nextUses };
    });

    if (!joinResult.ok) {
      res.status(404).json({ error: joinResult.error });
      return;
    }

    clearInviteLookupRateLimit(uid);

    try {
      await adminDb.collection("circle_invite_audit").add({
        inviteCode,
        circleId: joinResult.circleId,
        usedBy: uid,
        usedAt: nowIso,
        alreadyMember: joinResult.alreadyMember,
        uses: joinResult.uses,
      });
    } catch {
      // audit should not block success
    }

    res.json({
      ok: true,
      circleId: joinResult.circleId,
      alreadyMember: joinResult.alreadyMember,
      uses: joinResult.uses,
    });
  } catch (error) {
    res.status(500).json({ error: "circle_invite_join_failed", detail: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/v1/circles/intervene", async (req, res) => {
  try {
    const { uid } = await requireVerifiedFirebaseUser(req);
    const body = req.body || {};
    const circleId = typeof body.circleId === "string" ? body.circleId.trim() : "";
    const presenceMode = body.presenceMode === "quiet" || body.presenceMode === "reflection" ? body.presenceMode : "facilitation";
    const recentMessages = Array.isArray(body.recentMessages)
      ? body.recentMessages
          .filter((m) => m && typeof m === "object" && typeof m.senderName === "string" && typeof m.content === "string")
          .map((m) => ({ senderName: m.senderName, content: m.content }))
      : [];

    if (!circleId) {
      res.status(400).json({ error: "circleId_required" });
      return;
    }

    const adminDb = getAdminFirestore(getAdminApp());
    const circleRef = adminDb.collection("circles").doc(circleId);
    const circleSnap = await circleRef.get();
    if (!circleSnap.exists) {
      res.status(404).json({ error: "circle_not_found" });
      return;
    }

    const circleData = circleSnap.data() || {};
    if (!Array.isArray(circleData.members) || !circleData.members.includes(uid)) {
      res.status(403).json({ error: "not_circle_member" });
      return;
    }

    const analysis = await analyzeCircleConversationServer(recentMessages, presenceMode);
    if (!analysis.shouldIntervene && !analysis.hasConflict) {
      res.json({ posted: false, analysis });
      return;
    }

    const content = await buildCircleMediationServer(recentMessages, analysis, presenceMode);
    const timestamp = new Date().toISOString();
    const provenance = buildAiWriteProvenance("/v1/circles/intervene", timestamp);
    const messageRef = await circleRef.collection("messages").add({
      content,
      senderId: "ai",
      senderName: "SerenixAI",
      timestamp,
      type: "ai",
      ...provenance,
    });

    if (analysis.level >= 4) {
      await circleRef.set({
        safetyPauseActive: true,
        safetyPauseAt: timestamp,
        safetyPauseReason: analysis.reason || "Shared AI safety pause triggered.",
      }, { merge: true });
    }

    res.json({ posted: true, analysis, messageId: messageRef.id, content });
  } catch (error) {
    res.status(500).json({ error: "circle_intervene_failed", detail: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/v1/circles/activity", async (req, res) => {
  try {
    const { uid } = await requireVerifiedFirebaseUser(req);
    const body = req.body || {};
    const circleId = typeof body.circleId === "string" ? body.circleId.trim() : "";
    const type = body.type === "gratitude" || body.type === "story" || body.type === "checkin" ? body.type : "starter";
    const recentMessages = Array.isArray(body.recentMessages)
      ? body.recentMessages
          .filter((m) => m && typeof m === "object" && typeof m.senderName === "string" && typeof m.content === "string")
          .map((m) => ({ senderName: m.senderName, content: m.content }))
      : [];

    if (!circleId) {
      res.status(400).json({ error: "circleId_required" });
      return;
    }

    const adminDb = getAdminFirestore(getAdminApp());
    const circleRef = adminDb.collection("circles").doc(circleId);
    const circleSnap = await circleRef.get();
    if (!circleSnap.exists) {
      res.status(404).json({ error: "circle_not_found" });
      return;
    }

    const circleData = circleSnap.data() || {};
    if (!Array.isArray(circleData.members) || !circleData.members.includes(uid)) {
      res.status(403).json({ error: "not_circle_member" });
      return;
    }

    const content = await buildCircleActivityServer(type, recentMessages);
    const timestamp = new Date().toISOString();
    const provenance = buildAiWriteProvenance("/v1/circles/activity", timestamp);
    const messageRef = await circleRef.collection("messages").add({
      content,
      senderId: "ai",
      senderName: "SerenixAI",
      timestamp,
      type: "ai",
      ...provenance,
    });

    res.json({ posted: true, messageId: messageRef.id, content });
  } catch (error) {
    res.status(500).json({ error: "circle_activity_failed", detail: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/v1/circles/resume", async (req, res) => {
  try {
    const { uid } = await requireVerifiedFirebaseUser(req);
    const body = req.body || {};
    const circleId = typeof body.circleId === "string" ? body.circleId.trim() : "";
    if (!circleId) {
      res.status(400).json({ error: "circleId_required" });
      return;
    }

    const adminDb = getAdminFirestore(getAdminApp());
    const circleRef = adminDb.collection("circles").doc(circleId);
    const circleSnap = await circleRef.get();
    if (!circleSnap.exists) {
      res.status(404).json({ error: "circle_not_found" });
      return;
    }

    const circleData = circleSnap.data() || {};
    if (circleData.createdBy !== uid) {
      res.status(403).json({ error: "only_creator_can_resume" });
      return;
    }

    await circleRef.set({
      safetyPauseActive: false,
      safetyPauseAt: null,
      safetyPauseReason: null,
    }, { merge: true });

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "circle_resume_failed", detail: error instanceof Error ? error.message : String(error) });
  }
});

const port = parsePositiveIntEnv("PORT", parsePositiveIntEnv("SELF_LOCAL_PORT", 8788));
app.listen(port, () => {
  const firebaseAdmin = getFirebaseAdminInitHealth();
  console.log(`[serenix-governance-cloudrun] listening on port ${port}`);
  console.log(`[serenix-governance-cloudrun] upstream=${selfUpstreamBaseUrl || "(not configured)"}`);
  console.log(`[serenix-governance-cloudrun] firebase-admin init=${firebaseAdmin.initialized} mode=${firebaseAdmin.mode}`);
});

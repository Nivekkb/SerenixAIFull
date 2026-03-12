import "dotenv/config";
import express from "express";
import { randomInt } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { initializeApp as initializeAdminApp, cert, getApps, applicationDefault } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore, type Firestore } from "firebase-admin/firestore";
import {
  detectStateWithSemanticAssist,
  getEffectivePolicy,
  adjustPolicyForVariant,
  applySocialPolicyOverrides,
  processAngerPhysicalityClarifier,
  generateClarifierQuestion,
  applyPolicyToPrompt,
  applyStateGatedResponseContract,
  rewriteContinuityQuestions,
  rewriteSpokenMemoryRecall,
  maybeAddFollowUpQuestion,
  validateOutput,
  repairOutput,
  getS1Variant,
  getS2Variant,
  type Policy,
  type SelfVariant,
} from "self-engine";

type CirclePresenceMode = "quiet" | "facilitation" | "reflection";

type CircleMessageInput = {
  senderName: string;
  content: string;
};

type CircleAnalysis = {
  hasConflict: boolean;
  level: 1 | 2 | 3 | 4;
  type: "disagreement" | "hostility" | "harassment" | "distress" | "none";
  reason: string;
  engagementLevel: "low" | "medium" | "high";
  shouldIntervene: boolean;
};

type InviteLookupBucket = {
  windowStartMs: number;
  attempts: number;
  blockedUntilMs?: number;
};

const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(String(process.env[name] || ""), 10);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return raw;
}

const circleInviteTtlHours = parsePositiveIntEnv("CIRCLE_INVITE_TTL_HOURS", 168);
const inviteLookupRateWindowSeconds = parsePositiveIntEnv("CIRCLE_INVITE_RATE_LIMIT_WINDOW_SECONDS", 60);
const inviteLookupRateMaxAttempts = parsePositiveIntEnv("CIRCLE_INVITE_RATE_LIMIT_MAX_ATTEMPTS", 10);

const inviteLookupRateBuckets = new Map<string, InviteLookupBucket>();

const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
const serverAi = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

type HistoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function toHistory(value: unknown): HistoryMessage[] {
  if (!Array.isArray(value)) return [];
  const out: HistoryMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const role = (item as any).role;
    const content = (item as any).content;
    if ((role === "user" || role === "assistant" || role === "system") && typeof content === "string") {
      out.push({ role, content });
    }
  }
  return out;
}

function pickVariant(state: Policy["state"], seed?: string, explicitVariant?: string): SelfVariant {
  if (explicitVariant) return explicitVariant as SelfVariant;
  if (!seed) return "control";
  if (state === "S1") return getS1Variant(seed);
  if (state === "S2") return getS2Variant(seed);
  return "control";
}

function extractApiKey(req: express.Request): string {
  const bearer = String(req.headers.authorization || "");
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return String(req.headers["x-api-key"] || "").trim();
}

function extractFirebaseToken(req: express.Request): string {
  return String(req.headers["x-firebase-auth"] || "").trim();
}

function normalizeInviteCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value === "object" && typeof (value as { toDate?: () => Date }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    const ms = date.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  return null;
}

function generateInviteCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(0, INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

async function createUniqueInviteCode(adminDb: Firestore): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = generateInviteCode();
    const existing = await adminDb.collection("circle_invites").doc(candidate).get();
    if (!existing.exists) return candidate;
  }
  return `${generateInviteCode(6)}${Date.now().toString().slice(-2)}`;
}

function getInviteLookupBucket(uid: string): InviteLookupBucket {
  const key = `invite_lookup:${uid}`;
  const nowMs = Date.now();
  const windowMs = inviteLookupRateWindowSeconds * 1000;
  const existing = inviteLookupRateBuckets.get(key);

  if (!existing || nowMs - existing.windowStartMs >= windowMs) {
    const fresh: InviteLookupBucket = {
      windowStartMs: nowMs,
      attempts: 0,
    };
    inviteLookupRateBuckets.set(key, fresh);
    return fresh;
  }

  return existing;
}

function checkInviteLookupRateLimit(uid: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
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

function clearInviteLookupRateLimit(uid: string): void {
  const key = `invite_lookup:${uid}`;
  inviteLookupRateBuckets.delete(key);
}

async function issueCircleInvite(
  adminDb: Firestore,
  circleId: string,
  createdBy: string,
  previousInviteCode?: string,
): Promise<{ inviteCode: string; createdAt: string; expiresAt: string }> {
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
  if (getApps().length > 0) return getApps()[0]!;

  const projectId = String(process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "").trim() || undefined;
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKeyRaw = String(process.env.FIREBASE_PRIVATE_KEY || "").trim();

  if (clientEmail && privateKeyRaw && projectId) {
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

function getFirebaseAdminConfigMode(): "service_account_env" | "application_default" {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKeyRaw = String(process.env.FIREBASE_PRIVATE_KEY || "").trim();
  if (projectId && clientEmail && privateKeyRaw) return "service_account_env";
  return "application_default";
}

function getFirebaseAdminInitHealth(): { initialized: boolean; mode: "service_account_env" | "application_default"; error?: string } {
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

async function requireVerifiedFirebaseUser(req: express.Request): Promise<{ uid: string }> {
  const token = extractFirebaseToken(req);
  if (!token) {
    throw new Error("firebase_auth_required");
  }

  const decoded = await getAdminAuth(getAdminApp()).verifyIdToken(token);
  if (!decoded.uid) throw new Error("firebase_auth_invalid");
  return { uid: decoded.uid };
}

function fallbackCircleAnalysis(
  messages: CircleMessageInput[],
  presenceMode: CirclePresenceMode,
): CircleAnalysis {
  const joined = messages.map((m) => m.content.toLowerCase()).join("\n");
  const uniqueSenders = new Set(messages.map((m) => m.senderName)).size;
  const hasHostility = /\b(?:stupid|idiot|shut up|hate you|this is your fault|you always|you never)\b/.test(joined);
  const hasDistress = /\b(?:can't do this|panic|overwhelmed|want to die|hurt myself|hopeless|kill myself|end my life)\b/.test(joined);
  const hasConflict = hasHostility || hasDistress;
  const level: 1 | 2 | 3 | 4 = hasDistress ? 3 : hasHostility ? 2 : 1;
  const type: CircleAnalysis["type"] = hasDistress ? "distress" : hasHostility ? "hostility" : "none";
  const engagementLevel: CircleAnalysis["engagementLevel"] =
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

function fallbackCircleMediation(analysis: CircleAnalysis, presenceMode: CirclePresenceMode): string {
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

function fallbackCircleActivity(type: "starter" | "gratitude" | "story" | "checkin"): string {
  const prompts = {
    starter: "Starter: What is one thing on your mind today that you want support with?",
    gratitude: "Gratitude: Share one small thing you are grateful for from the last 24 hours.",
    story: "Story: Start with 'Today the group found a quiet room where everyone could be honest...' and add one sentence each.",
    checkin: "Check-in: Share a 1-10 energy score and one word for your mood.",
  } as const;
  return prompts[type];
}

async function analyzeCircleConversationServer(messages: CircleMessageInput[], presenceMode: CirclePresenceMode): Promise<CircleAnalysis> {
  if (!serverAi) return fallbackCircleAnalysis(messages, presenceMode);
  const prompt = `Analyze the following private support-circle conversation.\n\nAI Presence Mode: ${presenceMode}\n- quiet: intervene only for meaningful conflict/distress.\n- facilitation: intervene for conflict or stalled/low engagement.\n- reflection: intervene more actively when engagement is not high.\n\nConversation:\n${messages.map((m) => `${m.senderName}: ${m.content}`).join("\n")}\n\nReturn JSON with keys: hasConflict, level, type, reason, engagementLevel, shouldIntervene.`;
  try {
    const response = await serverAi.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        systemInstruction: "You are a cautious group dynamics analyst for a mental-health-adjacent support app. Prefer safe escalation when distress is plausibly present.",
      },
    });
    const parsed = JSON.parse(response.text || "{}");
    return {
      hasConflict: Boolean(parsed.hasConflict),
      level: ([1, 2, 3, 4].includes(parsed.level) ? parsed.level : 1) as 1 | 2 | 3 | 4,
      type: (["disagreement", "hostility", "harassment", "distress", "none"].includes(parsed.type) ? parsed.type : "none") as CircleAnalysis["type"],
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      engagementLevel: (["low", "medium", "high"].includes(parsed.engagementLevel) ? parsed.engagementLevel : "medium") as CircleAnalysis["engagementLevel"],
      shouldIntervene: Boolean(parsed.shouldIntervene),
    };
  } catch {
    return fallbackCircleAnalysis(messages, presenceMode);
  }
}

async function buildCircleMediationServer(messages: CircleMessageInput[], analysis: CircleAnalysis, presenceMode: CirclePresenceMode): Promise<string> {
  if (!serverAi) return fallbackCircleMediation(analysis, presenceMode);
  const prompt = `As SerenixAI, provide a concise shared facilitation note for this private circle.\n\nPresence Mode: ${presenceMode}\nConflict Level: ${analysis.level} (${analysis.type})\nReason: ${analysis.reason}\nEngagement: ${analysis.engagementLevel}\n\nRules:\n- Do not take sides.\n- Do not shame or police.\n- Do not imply therapy or exclusive attachment.\n- Encourage grounded, human-to-human communication.\n- If level 4, clearly pause the thread for safety and direct members toward immediate human support.\n\nConversation:\n${messages.map((m) => `${m.senderName}: ${m.content}`).join("\n")}`;
  try {
    const response = await serverAi.models.generateContent({
      model: "gemini-3-flash-preview",
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

async function buildCircleActivityServer(type: "starter" | "gratitude" | "story" | "checkin", messages: CircleMessageInput[]): Promise<string> {
  if (!serverAi) return fallbackCircleActivity(type);
  const prompt = `${messages.length > 0 ? `Recent mood: ${messages.map((m) => m.content).join(" ")}` : "The group just started."}\n\nGenerate one brief ${type} prompt for a private support circle.`;
  try {
    const response = await serverAi.models.generateContent({
      model: "gemini-3-flash-preview",
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

function buildAiWriteProvenance(route: "/v1/circles/intervene" | "/v1/circles/activity", timestamp: string) {
  return {
    writtenBy: "trusted_backend",
    writerService: "governance-server",
    writerRoute: route,
    writerMode: serverAi ? "model_with_deterministic_fallback" : "deterministic_fallback_only",
    writerModel: serverAi ? "gemini-3-flash-preview" : null,
    writerGeneratedAt: timestamp,
  } as const;
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
  const requiredApiKey = String(process.env.SELF_LOCAL_API_KEY || "").trim();
  if (!requiredApiKey) {
    next();
    return;
  }
  const provided = extractApiKey(req);
  if (!provided || provided !== requiredApiKey) {
    res.status(401).json({ error: "invalid_api_key" });
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode: "local-package",
    engine: "self-engine",
    firebaseAdmin: getFirebaseAdminInitHealth(),
    inviteConfig: {
      ttlHours: circleInviteTtlHours,
      lookupRateWindowSeconds: inviteLookupRateWindowSeconds,
      lookupRateMaxAttempts: inviteLookupRateMaxAttempts,
    },
  });
});

app.post("/v1/pre", async (req, res) => {
  try {
    const body = req.body || {};
    const message = body.message;
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "message_required" });
      return;
    }

    const history = toHistory(body.history);
    const semanticAssistEnabledRaw = body.semanticAssistEnabled;
    const semanticAssistEnabled =
      typeof semanticAssistEnabledRaw === "boolean"
        ? semanticAssistEnabledRaw
        : undefined;
    const semanticAssistMode =
      body.semanticAssistMode === "observe" || body.semanticAssistMode === "assist"
        ? body.semanticAssistMode
        : undefined;
    const detection = await detectStateWithSemanticAssist(message, history, {
      enabled: semanticAssistEnabled,
      mode: semanticAssistMode,
    });

    const seed =
      typeof body.seed === "string"
        ? body.seed
        : typeof body.sessionId === "string" || typeof body.userId === "string"
          ? `${String(body.userId || "")}:${String(body.sessionId || "")}`.trim()
          : undefined;

    const variant = pickVariant(detection.state, seed, typeof body.variant === "string" ? body.variant : undefined);

    let policy = adjustPolicyForVariant(getEffectivePolicy({ state: detection.state }), variant);
    const { policy: overriddenPolicy, meta } = applySocialPolicyOverrides({
      message,
      detection,
      policy,
      history,
    });
    policy = overriddenPolicy;

    const clarifier = processAngerPhysicalityClarifier(message, detection);
    const clarifierQuestion = clarifier.required ? generateClarifierQuestion() : undefined;
    const baseSystemPrompt = typeof body.baseSystemPrompt === "string" ? body.baseSystemPrompt : undefined;
    const policyPrompt = baseSystemPrompt ? applyPolicyToPrompt(policy, baseSystemPrompt, variant) : undefined;

    res.json({
      detection,
      variant,
      policy,
      meta,
      clarifier: {
        ...clarifier,
        question: clarifierQuestion,
      },
      policyPrompt,
    });
  } catch (error) {
    res.status(500).json({ error: "preflight_failed", detail: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/v1/post", (req, res) => {
  try {
    const body = req.body || {};
    const output = body.output;
    const userMessage = body.userMessage;
    const policy = body.policy as Policy | undefined;

    if (typeof output !== "string" || typeof userMessage !== "string" || !policy || typeof policy !== "object") {
      res.status(400).json({ error: "output_userMessage_policy_required" });
      return;
    }

    const stage1 = applyStateGatedResponseContract(output, policy, userMessage);
    const stage2 = rewriteContinuityQuestions(stage1, policy, userMessage);
    const stage3 = rewriteSpokenMemoryRecall(stage2, policy, userMessage);
    const stage4 = maybeAddFollowUpQuestion(stage3, policy, userMessage);

    let finalOutput = stage4;
    let validation = validateOutput(finalOutput, policy);
    let repaired = false;

    if (!validation.ok) {
      finalOutput = repairOutput(finalOutput, policy);
      repaired = true;
      validation = validateOutput(finalOutput, policy);
    }

    res.json({ output: finalOutput, validation, repaired });
  } catch (error) {
    res.status(500).json({ error: "postflight_failed", detail: error instanceof Error ? error.message : String(error) });
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

    const circleData = circleSnap.data() as { createdBy?: string; inviteCode?: string };
    if (circleData.createdBy !== uid) {
      res.status(403).json({ error: "only_creator_can_create_invite" });
      return;
    }

    const existingCode = typeof circleData.inviteCode === "string" ? circleData.inviteCode : "";
    if (existingCode) {
      const existingInviteSnap = await adminDb.collection("circle_invites").doc(existingCode).get();
      if (existingInviteSnap.exists) {
        const existingInvite = existingInviteSnap.data() as { expiresAt?: unknown; revokedAt?: unknown; createdAt?: unknown };
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

    const circleData = circleSnap.data() as { createdBy?: string; inviteCode?: string };
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
      const retryAfterSeconds = "retryAfterSeconds" in limiter ? limiter.retryAfterSeconds : inviteLookupRateWindowSeconds;
      res.status(429).json({
        error: "invite_lookup_rate_limited",
        retryAfterSeconds,
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
      if (!inviteSnap.exists) return { ok: false as const, error: "invite_invalid_or_expired" };

      const inviteData = inviteSnap.data() as {
        circleId?: string;
        expiresAt?: unknown;
        revokedAt?: unknown;
        uses?: number;
        usedBy?: string[];
      };
      const circleId = typeof inviteData.circleId === "string" ? inviteData.circleId : "";
      if (!circleId) return { ok: false as const, error: "invite_invalid_or_expired" };

      const revokedAtMs = parseTimeMs(inviteData.revokedAt);
      if (revokedAtMs) return { ok: false as const, error: "invite_invalid_or_expired" };

      const expiresAtMs = parseTimeMs(inviteData.expiresAt);
      if (expiresAtMs && Date.now() > expiresAtMs) {
        transaction.set(inviteRef, { revokedAt: nowIso, revokedBy: "system_expired" }, { merge: true });
        return { ok: false as const, error: "invite_invalid_or_expired" };
      }

      const circleRef = adminDb.collection("circles").doc(circleId);
      const circleSnap = await transaction.get(circleRef);
      if (!circleSnap.exists) return { ok: false as const, error: "invite_invalid_or_expired" };

      const circleData = circleSnap.data() as { members?: string[] };
      const existingMembers = Array.isArray(circleData.members)
        ? circleData.members.filter((member): member is string => typeof member === "string")
        : [];
      const alreadyMember = existingMembers.includes(uid);
      if (!alreadyMember) {
        transaction.set(circleRef, { members: [...existingMembers, uid] }, { merge: true });
      }

      const usedBy = Array.isArray(inviteData.usedBy)
        ? inviteData.usedBy.filter((member): member is string => typeof member === "string")
        : [];
      const nextUsedBy = usedBy.includes(uid) ? usedBy : [...usedBy, uid];
      const currentUses = Number.isFinite(inviteData.uses) ? Number(inviteData.uses) : 0;
      const nextUses = alreadyMember ? currentUses : currentUses + 1;

      transaction.set(inviteRef, {
        usedAt: nowIso,
        usedBy: nextUsedBy,
        uses: nextUses,
      }, { merge: true });

      return {
        ok: true as const,
        circleId,
        alreadyMember,
        uses: nextUses,
      };
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
      // no-op: audit logging should never block successful joins
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
          .map((m) => ({ senderName: m.senderName, content: m.content } as CircleMessageInput))
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

    const circleData = circleSnap.data() as { members?: string[] };
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
          .map((m) => ({ senderName: m.senderName, content: m.content } as CircleMessageInput))
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

    const circleData = circleSnap.data() as { members?: string[] };
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

    const circleData = circleSnap.data() as { createdBy?: string };
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

const port = Number.parseInt(String(process.env.SELF_LOCAL_PORT || 8788), 10);

async function checkExistingGovernanceServer(targetPort: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${targetPort}/health`);
    if (!response.ok) return false;
    const json = await response.json().catch(() => null) as { ok?: boolean } | null;
    return Boolean(json?.ok);
  } catch {
    return false;
  }
}

const server = app.listen(port, () => {
  const firebaseAdmin = getFirebaseAdminInitHealth();
  console.log(`[local-governance] listening on http://localhost:${port}`);
  console.log(`[local-governance] health: http://localhost:${port}/health`);
  console.log(`[local-governance] firebase-admin init=${firebaseAdmin.initialized} mode=${firebaseAdmin.mode}`);
});

server.on("error", async (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE") {
    console.error("[local-governance] failed to start:", error);
    process.exit(1);
    return;
  }

  const alreadyRunning = await checkExistingGovernanceServer(port);
  if (alreadyRunning) {
    console.log(`[local-governance] port ${port} already has a healthy governance server; reusing existing instance.`);
    process.exit(0);
    return;
  }

  console.error(`[local-governance] port ${port} is in use by a non-governance process. Set SELF_LOCAL_PORT to a free port.`);
  process.exit(1);
});

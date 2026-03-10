import express from "express";
import {
  detectState,
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

const app = express();
app.use(express.json({ limit: "256kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
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
  res.json({ ok: true, mode: "local-package", engine: "self-engine" });
});

app.post("/v1/pre", (req, res) => {
  try {
    const body = req.body || {};
    const message = body.message;
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "message_required" });
      return;
    }

    const history = toHistory(body.history);
    const detection = detectState(message, history);

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
  console.log(`[local-governance] listening on http://localhost:${port}`);
  console.log(`[local-governance] health: http://localhost:${port}/health`);
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

/**
 * PokerCrawl Gateway — Express app + embeddable Router
 *
 * Standalone CLI:
 *   tsx packages/gateway/src/server.ts
 *   Routes mounted at /api/*
 *
 * Embedded in production.ts:
 *   import { gatewayRouter } from "@pokercrawl/gateway";
 *   app.use("/gateway", gatewayRouter);
 *   Routes are then available at /gateway/*
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { TokenLedgerService }    from "./token-ledger.js";
import { APIKeyManager }         from "./auth/api-keys.js";
import { PRICES, convertTokens } from "./billing/pricing.js";
import { getProvider }           from "./providers/registry.js";
import { runInference }          from "./inference.js";
import type { ModelId }          from "./billing/pricing.js";

// ---------------------------------------------------------------------------
// Rate limiter (in-memory, module-scoped — shared across all mounts)
// ---------------------------------------------------------------------------

interface RlEntry { count: number; resetAt: number }
const _rl = new Map<string, RlEntry>();

function makeRateLimiter(
  maxReq: number,
  windowMs: number,
  keyFn?: (req: Request) => string,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyFn ? keyFn(req) : (req.ip ?? "unknown") + req.path;
    const now = Date.now();
    const e   = _rl.get(key);
    if (!e || now > e.resetAt) { _rl.set(key, { count: 1, resetAt: now + windowMs }); next(); return; }
    if (e.count < maxReq) { e.count++; next(); return; }
    const retryAfter = Math.ceil((e.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Too Many Requests", retryAfter });
  };
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rl) { if (now > v.resetAt) _rl.delete(k); }
}, 60_000);

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const ledger     = new TokenLedgerService();
const keyManager = new APIKeyManager();

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function send400(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const RegisterKeySchema = z.object({
  agentId:  z.string().min(1),
  provider: z.string().min(1),
  apiKey:   z.string().min(1),
  model:    z.string().min(1),
});

const InferenceSchema = z.object({
  agentId:   z.string().min(1),
  provider:  z.string().min(1),
  model:     z.string().min(1),
  messages:  z.array(z.object({
    role:    z.enum(["system", "user", "assistant"]),
    content: z.string(),
  })).min(1),
  maxTokens: z.number().int().min(1).max(8_192).default(1_024),
});

const ConvertSchema = z.object({
  fromModel: z.string().min(1),
  toModel:   z.string().min(1),
  amount:    z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Gateway Router — paths are relative (no /api prefix)
// Mount at /api for CLI, at /gateway for production
// ---------------------------------------------------------------------------

export const gatewayRouter = express.Router();

// POST /keys/register  — rate limited: 10 req/min per IP
gatewayRouter.post(
  "/keys/register",
  makeRateLimiter(10, 60_000),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = RegisterKeySchema.safeParse(req.body);
    if (!parsed.success) { send400(res, parsed.error.message); return; }

    const { agentId, provider, apiKey, model } = parsed.data;

    const valid = await keyManager.validateKey(provider, apiKey);
    if (!valid) {
      res.status(401).json({ error: `API key rejected by provider "${provider}"` });
      return;
    }

    await keyManager.registerKey(agentId, provider, apiKey);

    const INITIAL_CREDIT = 1_000_000;
    await ledger.deposit(agentId, provider, model, INITIAL_CREDIT);

    const price = PRICES[model as ModelId];
    const estimatedTokens = price
      ? Math.round((INITIAL_CREDIT / 1_000_000) * (1_000_000 / price.outputPer1M))
      : INITIAL_CREDIT;

    console.log(`[${new Date().toISOString()}] INFO  Agent registered key: ${agentId} (${provider}/${model})`);
    res.json({ success: true, estimatedTokens, gameTokensDeposited: INITIAL_CREDIT });
  },
);

// GET /balance/:agentId
gatewayRouter.get("/balance/:agentId", async (req: Request, res: Response): Promise<void> => {
  const { agentId } = req.params;
  if (!agentId) { send400(res, "Missing agentId"); return; }

  const bal = await ledger.getBalance(agentId);

  const balances = Object.entries(bal.balances).map(([key, mb]) => {
    const [provider, ...modelParts] = key.split("/");
    return {
      provider:     provider ?? key,
      model:        modelParts.join("/"),
      deposited:    mb.deposited,
      inputTokens:  mb.inputTokens,
      outputTokens: mb.outputTokens,
      valueUSD:     mb.totalValueUSD,
    };
  });

  res.json({ agentId, gameTokens: bal.gameTokens, balances });
});

// POST /inference  — rate limited: 60 req/min per agentId
gatewayRouter.post(
  "/inference",
  makeRateLimiter(60, 60_000, (req) => {
    const body = req.body as { agentId?: string };
    return (body.agentId ?? req.ip ?? "unknown") + "/inference";
  }),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = InferenceSchema.safeParse(req.body);
    if (!parsed.success) { send400(res, parsed.error.message); return; }

    const { agentId, provider: providerName, model, messages, maxTokens } = parsed.data;

    const provider = await getProvider(providerName);
    if (!provider) {
      res.status(400).json({ error: `Unknown provider "${providerName}"` });
      return;
    }

    try {
      const result = await runInference(ledger, keyManager, provider, {
        agentId, provider: providerName, model, messages, maxTokens,
      });
      console.log(`[${new Date().toISOString()}] INFO  Inference: ${agentId} via ${providerName}/${model} — ${result.tokensUsed} tokens`);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status  = message.includes("Insufficient") ? 402
                    : message.includes("No API key")   ? 401
                    : 500;
      console.error(`[${new Date().toISOString()}] ERROR Inference error: ${message}`);
      res.status(status).json({ error: message });
    }
  },
);

// GET /transactions/:agentId
gatewayRouter.get("/transactions/:agentId", async (req: Request, res: Response): Promise<void> => {
  const { agentId } = req.params;
  if (!agentId) { send400(res, "Missing agentId"); return; }

  const limitParam = req.query["limit"];
  const limit = typeof limitParam === "string" ? parseInt(limitParam, 10) : undefined;

  const transactions = await ledger.getTransactions(agentId, limit);
  res.json({ agentId, transactions });
});

// GET /pricing
gatewayRouter.get("/pricing", (_req: Request, res: Response): void => {
  res.json({ models: PRICES });
});

// POST /convert
gatewayRouter.post("/convert", (req: Request, res: Response): void => {
  const parsed = ConvertSchema.safeParse(req.body);
  if (!parsed.success) { send400(res, parsed.error.message); return; }

  const { fromModel, toModel, amount } = parsed.data;

  if (!(fromModel in PRICES)) { send400(res, `Unknown model "${fromModel}"`); return; }
  if (!(toModel   in PRICES)) { send400(res, `Unknown model "${toModel}"`);   return; }

  const converted = convertTokens(fromModel as ModelId, amount, toModel as ModelId);
  res.json({ fromModel, toModel, fromAmount: amount, toAmount: converted });
});

// ---------------------------------------------------------------------------
// Standalone Express app (CLI usage — routes at /api/*)
// ---------------------------------------------------------------------------

export const app = express();

const CORS_ORIGINS = (process.env["CORS_ORIGINS"] ?? "*").split(",").map((s) => s.trim());

app.use((req: Request, res: Response, next: NextFunction): void => {
  const origin = req.headers["origin"];
  if (CORS_ORIGINS.includes("*") || (origin !== undefined && CORS_ORIGINS.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.use((req: Request, _res: Response, next: NextFunction): void => {
  console.log(`[${new Date().toISOString()}] INFO  GATEWAY ${req.method} ${req.path}`);
  next();
});

app.use(express.json());

// Mount router at /api for backward-compatible CLI operation
app.use("/api", gatewayRouter);

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain = process.argv[1]?.endsWith("server.ts") ||
               process.argv[1]?.endsWith("server.js");

const PORT = Number(process.env["GATEWAY_PORT"] ?? 3002);

if (isMain) {
  app.listen(PORT, () => {
    console.log(`\n🃏  PokerCrawl Gateway  →  http://localhost:${PORT}\n`);
    console.log("  POST /api/keys/register");
    console.log("  GET  /api/balance/:agentId");
    console.log("  POST /api/inference");
    console.log("  GET  /api/transactions/:agentId");
    console.log("  GET  /api/pricing");
    console.log("  POST /api/convert\n");
  });
}

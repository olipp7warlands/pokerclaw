/**
 * PokerCrawl — Production server (single port)
 *
 * Everything runs on PORT (default 3000):
 *
 *   HTTP:
 *     GET  /health
 *     GET  /api/stats  /api/leaderboard  /api/activity
 *     POST /api/agents/register   GET /api/agents   GET /api/agents/online
 *     /gateway/*   → token ledger & billing (rate-limited)
 *     static: public/  then  packages/ui/dist  (SPA fallback)
 *
 *   WebSocket (same TCP port, path-routed):
 *     /ws      → external AI agents (auth via Bearer token)
 *     /ws-ui   → React frontend (game-state broadcasts)
 *
 * Usage:
 *   npm run start:dev   # tsx scripts/production.ts
 *   npm run start       # node --import tsx/esm scripts/production.ts
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";

import { GameStore, WsBridge, WsAgentBridge } from "@pokercrawl/mcp-server";
import {
  type BaseAgent,
  type HandResult,
  AgentOrchestrator,
  AggressiveBot,
  ConservativeBot,
  BlufferBot,
  CalculatedBot,
  RandomBot,
  WolfBot,
  OwlBot,
  TurtleBot,
  FoxBot,
} from "@pokercrawl/agents";
import { gatewayRouter } from "@pokercrawl/gateway";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT         = Number(process.env["PORT"]      ?? 3000);
const BOT_COUNT    = Number(process.env["BOT_COUNT"] ?? 4);
const CORS_ORIGINS = (process.env["CORS_ORIGINS"] ?? "*").split(",").map((s) => s.trim());
const VERSION      = "0.1.0";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

type LogLevel = "INFO" | "WARN" | "ERROR";

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  const ts      = new Date().toISOString();
  const metaStr = meta ? " " + JSON.stringify(meta) : "";
  const line    = `[${ts}] ${level.padEnd(5)} ${msg}${metaStr}`;
  if (level === "ERROR") console.error(line);
  else                   console.log(line);
}

// ---------------------------------------------------------------------------
// Global error handlers — prevent silent crashes from killing WS connections
// ---------------------------------------------------------------------------

process.on("uncaughtException", (err: Error) => {
  log("ERROR", `Uncaught exception: ${err.message}`, { stack: err.stack });
  // Do NOT exit — keep the server running for active connections
});

process.on("unhandledRejection", (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  log("ERROR", `Unhandled promise rejection: ${msg}`);
});

// ---------------------------------------------------------------------------
// CORS middleware
// ---------------------------------------------------------------------------

function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers["origin"];
  if (CORS_ORIGINS.includes("*") || (origin !== undefined && CORS_ORIGINS.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
}

// ---------------------------------------------------------------------------
// Stats & Leaderboard (module-level, persists across sessions)
// ---------------------------------------------------------------------------

let totalHands = 0;
const seenAgentIds = new Set<string>();

interface BotRecord {
  name:  string;
  emoji: string;
  wins:  number;
  hands: number;
  elo:   number;
}

const eloMap = new Map<string, BotRecord>([
  ["reloj",  { name: "El Reloj",   emoji: "⏱️", wins: 0, hands: 0, elo: 1485 }],
  ["shark",  { name: "El Tiburón", emoji: "🦈", wins: 0, hands: 0, elo: 1380 }],
  ["mago",   { name: "El Mago",    emoji: "🎩", wins: 0, hands: 0, elo: 1290 }],
  ["wolf",   { name: "El Lobo",    emoji: "🐺", wins: 0, hands: 0, elo: 1260 }],
  ["rock",   { name: "La Roca",    emoji: "🪨", wins: 0, hands: 0, elo: 1240 }],
  ["owl",    { name: "La Lechuza", emoji: "🦉", wins: 0, hands: 0, elo: 1220 }],
  ["caos",   { name: "El Caos",    emoji: "🎲", wins: 0, hands: 0, elo: 1180 }],
  ["fox",    { name: "El Zorro",   emoji: "🦊", wins: 0, hands: 0, elo: 1150 }],
  ["turtle", { name: "La Tortuga", emoji: "🐢", wins: 0, hands: 0, elo: 1100 }],
]);

interface ActivityEvent {
  agentId: string;
  action:  string;
  amount?: number;
  tableId: string;
  ts:      string;
}

const recentActivity: ActivityEvent[] = [];

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const httpApp = express();
httpApp.use(corsMiddleware);
httpApp.use(express.json());

httpApp.use((req: Request, _res: Response, next: NextFunction): void => {
  log("INFO", `${req.method} ${req.path}`, { ip: req.ip ?? "?" });
  next();
});

// ---------------------------------------------------------------------------
// HTTP server (shared with WebSocket servers)
// ---------------------------------------------------------------------------

const httpServer = createServer(httpApp);

// Disable HTTP socket timeout so Railway's proxy doesn't kill idle WebSocket connections.
// Node.js default is already 0, but setting explicitly prevents any middleware from changing it.
httpServer.setTimeout(0);

// ---------------------------------------------------------------------------
// Diagnostic: log every WebSocket upgrade request BEFORE the WSS handles it.
// This reveals if Railway is modifying the upgrade path or stripping headers.
// ---------------------------------------------------------------------------

httpServer.on("upgrade", (req) => {
  const hasAuth  = !!req.headers["authorization"];
  const hasToken = (req.url ?? "").includes("token=");
  log("INFO", `WS upgrade request`, {
    url:       req.url,
    authHeader: hasAuth  ? "Bearer ***" : "MISSING",
    tokenParam: hasToken ? "present"    : "absent",
    origin:    req.headers["origin"] ?? "none",
    userAgent: (req.headers["user-agent"] ?? "none").slice(0, 60),
  });
});

// ---------------------------------------------------------------------------
// Agent WebSocket  —  /ws  (external AI agents, token-authenticated)
// ---------------------------------------------------------------------------

const agentStore  = new GameStore();
const agentBridge = new WsAgentBridge(agentStore);
agentBridge.attachWs(httpServer, "/ws");

// ---------------------------------------------------------------------------
// UI WebSocket  —  /ws-ui  (React frontend, no auth)
// ---------------------------------------------------------------------------

const uiBridge = new WsBridge(0, { maxClients: 100 });
uiBridge.attachToServer(httpServer, "/ws-ui");

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

httpApp.get("/health", (_req: Request, res: Response): void => {
  res.json({
    status:    "ok",
    uptime:    Math.floor(process.uptime()),
    tables:    1,
    agents:    seenAgentIds.size,
    version:   VERSION,
    wsClients: uiBridge.clientCount,
  });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

httpApp.get("/api/stats", (_req: Request, res: Response): void => {
  res.json({
    totalHands,
    totalAgents:  seenAgentIds.size,
    onlineAgents: uiBridge.clientCount,
    activeTables: 1,
    topELO:       [],
  });
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

httpApp.get("/api/leaderboard", (_req: Request, res: Response): void => {
  const entries = Array.from(eloMap.entries())
    .map(([agentId, r]) => ({
      rank:    0,
      agentId,
      name:    r.name,
      emoji:   r.emoji,
      elo:     r.elo,
      wins:    r.wins,
      hands:   r.hands,
      winRate: r.hands > 0 ? Math.round((r.wins / r.hands) * 100) : 0,
    }))
    .sort((a, b) => b.elo - a.elo)
    .map((e, i) => ({ ...e, rank: i + 1 }));
  res.json(entries);
});

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

httpApp.get("/api/activity", (_req: Request, res: Response): void => {
  res.json(recentActivity.slice(0, 20));
});

// ---------------------------------------------------------------------------
// Agent registration (delegates to agentBridge)
// ---------------------------------------------------------------------------

httpApp.post("/api/agents/register", (req: Request, res: Response): void => {
  const cfg = req.body as Record<string, unknown>;
  if (!cfg["name"] || typeof cfg["name"] !== "string") {
    res.status(400).json({ error: '"name" is required' });
    return;
  }
  const result = agentBridge.registerAgent({
    name:         cfg["name"],
    type:         typeof cfg["type"]  === "string"   ? cfg["type"]  : "custom",
    capabilities: Array.isArray(cfg["capabilities"]) ? (cfg["capabilities"] as string[]) : [],
  });
  const host  = req.headers["host"] ?? `localhost:${PORT}`;
  const proto = req.headers["x-forwarded-proto"] === "https" ? "wss" : "ws";
  res.status(201).json({
    agentId: result.agentId,
    token:   result.token,
    wsUrl:   `${proto}://${host}/ws`,
  });
});

httpApp.get("/api/agents", (_req: Request, res: Response): void => {
  res.json(agentBridge.listAgents().map(({ token: _t, ...rest }) => rest));
});

httpApp.get("/api/agents/online", (_req: Request, res: Response): void => {
  res.json(agentBridge.listOnlineAgents());
});

// ---------------------------------------------------------------------------
// Gateway (token ledger + billing) at /gateway/*
// ---------------------------------------------------------------------------

httpApp.use("/gateway", gatewayRouter);

// ---------------------------------------------------------------------------
// Markdown docs (public/)
// ---------------------------------------------------------------------------

const PUBLIC_DIR = path.join(process.cwd(), "public");
if (existsSync(PUBLIC_DIR)) {
  httpApp.use(
    express.static(PUBLIC_DIR, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".md")) {
          res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        }
      },
    }),
  );
  log("INFO", "Serving markdown docs from /public");
}

// ---------------------------------------------------------------------------
// UI static files + SPA fallback
// ---------------------------------------------------------------------------

const UI_DIST = path.join(process.cwd(), "packages", "ui", "dist");
if (existsSync(UI_DIST)) {
  httpApp.use(express.static(UI_DIST));
  httpApp.get(/^(?!\/api|\/health|\/gateway).*/, (_req: Request, res: Response): void => {
    res.sendFile(path.join(UI_DIST, "index.html"));
  });
  log("INFO", "Serving React UI", { path: UI_DIST });
} else {
  log("WARN", "UI dist not found — run `npm run build -w packages/ui` first");
}

// ---------------------------------------------------------------------------
// Start (single listen call — WebSocket bridges share this server)
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  log("INFO", "PokerCrawl server started", { port: PORT });
  log("INFO", `  → HTTP:          http://localhost:${PORT}`);
  log("INFO", `  → WS (UI):       ws://localhost:${PORT}/ws-ui`);
  log("INFO", `  → WS (Agents):   ws://localhost:${PORT}/ws`);
  log("INFO", `  → Gateway:       http://localhost:${PORT}/gateway/*`);
  log("INFO", `  → Health:        http://localhost:${PORT}/health`);
  log("INFO", `  → Skill:         http://localhost:${PORT}/skill.md`);
});

// ---------------------------------------------------------------------------
// Bot agents — continuous game loop
// ---------------------------------------------------------------------------

const BOT_CLASSES = [
  AggressiveBot,
  ConservativeBot,
  BlufferBot,
  CalculatedBot,
  RandomBot,
  WolfBot,
  OwlBot,
  TurtleBot,
  FoxBot,
] as const;

const BOT_IDS  = ["shark", "rock", "mago", "caos", "reloj", "wolf", "owl", "turtle", "fox"];
const TABLE_ID = "main";

async function runSession(sessionN: number): Promise<void> {
  log("INFO", `Starting session ${sessionN}`, { table: TABLE_ID, botCount: BOT_COUNT });

  const store = new GameStore();
  const orch  = new AgentOrchestrator(store, {
    tableId:        TABLE_ID,
    smallBlind:     5,
    bigBlind:       10,
    startingTokens: 500,
  });

  const agents: BaseAgent[] = [];
  for (let i = 0; i < BOT_COUNT; i++) {
    const Cls = BOT_CLASSES[i % BOT_CLASSES.length]!;
    const id  = BOT_IDS[i] ?? `bot-${i}`;
    agents.push(new Cls({ id, tableId: TABLE_ID }));
    seenAgentIds.add(id);
  }

  for (const agent of agents) orch.registerAgent(agent);
  log("INFO", "Agents registered", { agents: agents.map((a) => a.id ?? "?") });

  orch.on("decision", ({ agentId, decision }: { agentId: string; decision: { action: string; amount?: number } }) => {
    const record = store.getTable(TABLE_ID);
    if (record) {
      uiBridge.broadcastFullSnapshot(TABLE_ID, record, {
        agentId,
        type:   decision.action,
        amount: decision.amount ?? 0,
      });
    }
    log("INFO", "Decision", { agentId, action: decision.action, amount: decision.amount });
    recentActivity.unshift({
      agentId,
      action:  decision.action,
      tableId: TABLE_ID,
      ts:      new Date().toISOString(),
      ...(decision.amount !== undefined && { amount: decision.amount }),
    });
    if (recentActivity.length > 50) recentActivity.pop();
  });

  orch.on("chat", ({ agentId, message }: { agentId: string; message: string }) => {
    uiBridge.broadcastChat(TABLE_ID, agentId, message);
    log("INFO", "Chat", { agentId, message });
  });

  orch.on("hand_complete", (result: HandResult) => {
    totalHands++;
    const record = store.getTable(TABLE_ID);
    if (record) uiBridge.broadcastFullSnapshot(TABLE_ID, record);
    // Update ELO — increment hand count for all active agents this session
    for (const id of seenAgentIds) {
      const r = eloMap.get(id);
      if (r) r.hands++;
    }
    for (const winner of result.winners) {
      const r = eloMap.get(winner.agentId);
      if (r) { r.wins++; r.elo = Math.min(2000, r.elo + Math.floor(winner.amountWon / 10)); }
    }
    const wins = result.winners.map((w) => `${w.agentId}+${w.amountWon}`).join(", ");
    log("INFO", "Hand complete", { handNumber: result.handNumber, winners: wins });
  });

  try {
    await orch.playTournament(9_999, { decisionTimeoutMs: 15_000 });
  } catch (err) {
    log("ERROR", "Session error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

log("INFO", `Starting bot game loop`, { botCount: BOT_COUNT });
let sessionN = 1;
for (;;) {
  await runSession(sessionN++);
  await new Promise<void>((r) => setTimeout(r, 2_000));
}

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

import { GameStore, WsBridge, WsAgentBridge, HttpAgentBridge } from "@pokercrawl/mcp-server";
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
import {
  gatewayRouter,
  isDbAvailable,
  saveAgent,
  updateAgentStats,
  saveHandResult,
  getLeaderboard,
  getGlobalStats,
  incrementGlobalHands,
  incrementGlobalAgents,
  saveBotTable,
} from "@pokercrawl/gateway";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT         = Number(process.env["PORT"]      ?? 3000);
const CORS_ORIGINS = (process.env["CORS_ORIGINS"] ?? "*").split(",").map((s) => s.trim());
const VERSION      = "0.1.0";
const IS_PROD      = process.env["NODE_ENV"] === "production";

// ---------------------------------------------------------------------------
// Logging — in production only INFO/WARN/ERROR reach the console.
// DEBUG is silenced to avoid Railway log rate-limits killing WS connections.
// ---------------------------------------------------------------------------

function _fmt(level: string, msg: string, meta?: Record<string, unknown>): string {
  const ts      = new Date().toISOString();
  const metaStr = meta ? " " + JSON.stringify(meta) : "";
  return `[${ts}] ${level.padEnd(5)} ${msg}${metaStr}`;
}

/** High-volume debug logs — suppressed in production. */
function logDebug(msg: string, meta?: Record<string, unknown>): void {
  if (!IS_PROD) console.log(_fmt("DEBUG", msg, meta));
}

/** Important operational events — always logged. */
function logInfo(msg: string, meta?: Record<string, unknown>): void {
  console.log(_fmt("INFO", msg, meta));
}

function logWarn(msg: string, meta?: Record<string, unknown>): void {
  console.warn(_fmt("WARN", msg, meta));
}

function logError(msg: string, meta?: Record<string, unknown>): void {
  console.error(_fmt("ERROR", msg, meta));
}

// ---------------------------------------------------------------------------
// Global error handlers — prevent silent crashes from killing WS connections
// ---------------------------------------------------------------------------

process.on("uncaughtException", (err: Error) => {
  logError(`Uncaught exception: ${err.message}`, { stack: err.stack });
  // Do NOT exit — keep the server running for active connections
});

process.on("unhandledRejection", (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logError(`Unhandled promise rejection: ${msg}`);
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

interface RecentHand {
  tableId:    string;
  tableName:  string;
  handNumber: number;
  winners:    Array<{ agentId: string; amountWon: number }>;
  ts:         string;
}

const recentActivity: ActivityEvent[] = [];
const recentHands:    RecentHand[]    = [];

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const httpApp = express();
httpApp.use(corsMiddleware);
httpApp.use(express.json());

// HTTP request logging — debug only (each health-check would be a Railway log line)
httpApp.use((req: Request, _res: Response, next: NextFunction): void => {
  logDebug(`${req.method} ${req.path}`, { ip: req.ip ?? "?" });
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

// WS upgrade diagnostics — always log in dev, always log in prod too so we can see
// Railway proxy behavior without needing a redeploy to enable debug mode.
httpServer.on("upgrade", (req) => {
  const hasAuth  = !!req.headers["authorization"];
  const hasToken = (req.url ?? "").includes("token=");
  logInfo(`WS upgrade`, {
    url:        req.url,
    authHeader: hasAuth  ? "yes" : "MISSING",
    tokenParam: hasToken ? "yes" : "no",
  });
});

// ---------------------------------------------------------------------------
// Agent WebSocket  —  /ws  (external AI agents, token-authenticated)
// ---------------------------------------------------------------------------

const agentStore  = new GameStore();
const agentBridge = new WsAgentBridge(agentStore);
agentBridge.attachWs(httpServer, "/ws");

// ---------------------------------------------------------------------------
// HTTP Agent Bridge — long-polling fallback for cloud proxies that drop WS
// ---------------------------------------------------------------------------

const httpAgentBridge = new HttpAgentBridge(
  agentStore,
  (token) => agentBridge.findAgentByToken(token),
);

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
    tables:    activeBotTables.size,
    agents:    seenAgentIds.size,
    version:   VERSION,
    wsClients: uiBridge.clientCount,
  });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

httpApp.get("/api/stats", (_req: Request, res: Response): void => {
  const httpSessions = httpAgentBridge.sessionCount;
  const wsAgents     = agentBridge.listOnlineAgents().length;

  // Try Supabase first (persistent across restarts), fall back to in-memory
  void getGlobalStats().then((dbStats) => {
    res.json({
      totalHands:   dbStats ? Number(dbStats.total_hands)  : totalHands,
      totalAgents:  dbStats ? Number(dbStats.total_agents) : seenAgentIds.size + httpSessions,
      onlineAgents: wsAgents + httpSessions,
      activeTables: activeBotTables.size,
      topELO:       [],
    });
  });
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

httpApp.get("/api/leaderboard", (_req: Request, res: Response): void => {
  void getLeaderboard(20).then((dbRows) => {
    if (dbRows && dbRows.length > 0) {
      return res.json(
        dbRows.map((r, i) => ({
          rank:    i + 1,
          agentId: r.id,
          name:    r.name,
          emoji:   r.avatar ?? "🤖",
          elo:     r.elo,
          wins:    r.hands_won,
          hands:   r.hands_played,
          winRate: r.hands_played > 0 ? Math.round((r.hands_won / r.hands_played) * 100) : 0,
        })),
      );
    }
    // Fallback to in-memory ELO map
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
    return res.json(entries);
  });
});

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

httpApp.get("/api/activity", (_req: Request, res: Response): void => {
  res.json(recentActivity.slice(0, 20));
});

// ---------------------------------------------------------------------------
// Recent hands (last 5 completed hands across all tables)
// ---------------------------------------------------------------------------

httpApp.get("/api/recent-hands", (_req: Request, res: Response): void => {
  res.json(recentHands.slice(0, 10));
});

// ---------------------------------------------------------------------------
// Live tables list (polled by LobbyScreen every 5 s)
// ---------------------------------------------------------------------------

httpApp.get("/api/tables", (_req: Request, res: Response): void => {
  // Return ALL active tables (presets + overflow) sorted by name
  const tables = Array.from(activeBotTables.entries()).map(([tableId, { store, config }]) => {
    const record = store.getTable(tableId);
    const seats = record?.state.seats ?? [];
    const activePot = record?.state.mainPot ?? 0;
    const status = !record
      ? "waiting"
      : record.state.phase === "waiting"
        ? "waiting"
        : "active";
    return {
      id:         tableId,
      name:       config.name,
      smallBlind: config.smallBlind,
      bigBlind:   config.bigBlind,
      maxPlayers: config.maxPlayers,
      players:    seats.length,
      pot:        activePot,
      status,
      handNumber: record?.state.handNumber ?? 0,
      type:       "cash",
    };
  });
  tables.sort((a, b) => a.name.localeCompare(b.name));
  res.json(tables);
});

// ---------------------------------------------------------------------------
// Full table state (REST fallback for TableView — same shape as LiveSnapshot)
// ---------------------------------------------------------------------------

httpApp.get("/api/tables/:id/state", (req: Request, res: Response): void => {
  const tableId = req.params["id"]!;
  const entry   = activeBotTables.get(tableId);
  if (!entry) { res.status(404).json({ error: "Table not found" }); return; }

  const record = entry.store.getTable(tableId);
  if (!record)  { res.status(404).json({ error: "Table not found" }); return; }

  const { state } = record;

  // Build agentId → display-name map so the UI can show real names
  const agentNames: Record<string, string> = {};
  for (const agentId of record.agents.keys()) agentNames[agentId] = agentId;
  for (const a of agentBridge.listAgents()) agentNames[a.agentId] = a.name;

  const mapCard = (c: { rank: string; suit: string; value: number }) =>
    ({ rank: c.rank, suit: c.suit, value: c.value });

  res.json({
    tableId,
    phase:           state.phase,
    handNumber:      state.handNumber,
    mainPot:         state.mainPot,
    sidePots:        state.sidePots.map((sp) => ({ amount: sp.amount, eligibleAgents: [...sp.eligibleAgents] })),
    currentBet:      state.currentBet,
    lastRaiseAmount: state.lastRaiseAmount,
    dealerIndex:     state.dealerIndex,
    actionOnIndex:   state.actionOnIndex,
    seats:           state.seats.map((s) => ({
      agentId:           s.agentId,
      name:              agentNames[s.agentId] ?? s.agentId,
      stack:             s.stack,
      currentBet:        s.currentBet,
      totalBet:          s.totalBet,
      status:            s.status,
      hasActedThisRound: s.hasActedThisRound,
    })),
    board: {
      flop:  state.board.flop.map(mapCard),
      turn:  state.board.turn  ? mapCard(state.board.turn)  : null,
      river: state.board.river ? mapCard(state.board.river) : null,
    },
    winners:    state.winners.map((w) => ({ agentId: w.agentId, amountWon: w.amountWon })),
    agentNames,
    config: {
      smallBlind: record.config.smallBlind,
      bigBlind:   record.config.bigBlind,
      maxPlayers: record.config.maxPlayers,
      name:       entry.config.name,
    },
  });
});

// ---------------------------------------------------------------------------
// Prize pool (total tokens in play across all active tables)
// ---------------------------------------------------------------------------

httpApp.get("/api/prizepool", (_req: Request, res: Response): void => {
  let total = 0;
  const registeredAgents = agentBridge.listAgents();
  const byProvider: Record<string, number> = { anthropic: 0, openai: 0, google: 0, simulated: 0 };

  for (const [tableId, { store }] of activeBotTables) {
    const record = store.getTable(tableId);
    if (!record) continue;

    const tableTokens =
      record.state.seats.reduce((s, seat) => s + seat.stack, 0) +
      record.state.mainPot +
      record.state.sidePots.reduce((s, sp) => s + sp.amount, 0);
    total += tableTokens;

    if (record.state.seats.length > 0) {
      const tokensPerSeat = tableTokens / record.state.seats.length;
      for (const seat of record.state.seats) {
        const a = registeredAgents.find((r) => r.agentId === seat.agentId);
        const provider = !a
          ? "simulated"
          : a.type === "claude"  ? "anthropic"
          : a.type === "openai"  ? "openai"
          : a.type === "gemini"  ? "google"
          : "simulated";
        byProvider[provider] = (byProvider[provider] ?? 0) + tokensPerSeat;
      }
    }
  }

  res.json({
    total:     Math.round(total),
    byProvider: Object.fromEntries(Object.entries(byProvider).map(([k, v]) => [k, Math.round(v)])),
    valueUSD:  +(total * 0.00001).toFixed(4),
  });
});

// ---------------------------------------------------------------------------
// Dynamic tournaments (generated from online agent count)
// ---------------------------------------------------------------------------

httpApp.get("/api/tournaments", (_req: Request, res: Response): void => {
  const n = seenAgentIds.size + httpAgentBridge.sessionCount;
  const tournaments: unknown[] = [];

  if (n >= 16) {
    tournaments.push({
      id:             "sitgo-9",
      name:           "Sit & Go — 9 Max",
      currentPlayers: Math.min(n, 9),
      maxPlayers:     9,
      buyIn:          100,
      prizePool:      900,
      topPrize:       540,
      status:         n >= 9 ? "running" : "registering",
      startsInMs:     n >= 9 ? -1 : (9 - n) * 60_000,
    });
  }

  if (n >= 32) {
    tournaments.push({
      id:             "sitgo-16",
      name:           "Sit & Go — 16 Max",
      currentPlayers: Math.min(n - 9, 16),
      maxPlayers:     16,
      buyIn:          200,
      prizePool:      3_200,
      topPrize:       1_920,
      status:         n >= 25 ? "running" : "registering",
      startsInMs:     n >= 25 ? -1 : 300_000,
    });
  }

  res.json(tournaments);
});

// ---------------------------------------------------------------------------
// Sit & Go (static configuration + live registered count)
// ---------------------------------------------------------------------------

httpApp.get("/api/sng", (_req: Request, res: Response): void => {
  res.json(SNG_LIST.map((s) => ({
    ...s,
    registered: sngRegistered.get(s.id) ?? 0,
    status:     (sngRegistered.get(s.id) ?? 0) >= s.maxPlayers ? "running" : "registering",
  })));
});

// ---------------------------------------------------------------------------
// MTT Tournaments (static schedule + live registration)
// ---------------------------------------------------------------------------

httpApp.get("/api/mtt", (_req: Request, res: Response): void => {
  res.json(MTT_LIST.map((m) => {
    const registered = mttRegistered.get(m.id) ?? 0;
    const prizePool  = m.fixedPrize ?? m.buyIn * m.prizeMultiplier * Math.max(registered, 10);
    return {
      ...m,
      registered,
      prizePool,
      startsInMs: nextMttStartMs(m),
      status:     "scheduled",
    };
  }));
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
  const agentType = typeof cfg["type"] === "string" ? cfg["type"] : "custom";
  const result = agentBridge.registerAgent({
    name:         cfg["name"],
    type:         agentType,
    capabilities: Array.isArray(cfg["capabilities"]) ? (cfg["capabilities"] as string[]) : [],
  });
  // Persist to Supabase and update global agent count
  const capabilities = Array.isArray(cfg["capabilities"]) ? (cfg["capabilities"] as string[]) : [];
  void saveAgent(result.agentId, cfg["name"], undefined, capabilities, agentType);
  void incrementGlobalAgents();
  seenAgentIds.add(result.agentId);

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
// HTTP long-poll transport  (fallback when Railway drops WebSocket)
// ---------------------------------------------------------------------------

httpApp.post("/api/agents/connect", (req: Request, res: Response): void => {
  // Body already parsed by express.json() — pass directly to avoid double-read
  httpAgentBridge.handleConnect(req.body as Record<string, unknown>, res);
});

httpApp.get("/api/agents/poll/:sessionId", (req: Request, res: Response): void => {
  // Keep the connection open — Express must NOT call res.end() via framework
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering on Railway
  httpAgentBridge.handlePoll(req.params["sessionId"]!, req, res);
});

httpApp.post("/api/agents/action/:sessionId", (req: Request, res: Response): void => {
  httpAgentBridge.handleAction(req.params["sessionId"]!, req.body as Record<string, unknown>, res);
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
  logDebug("Serving markdown docs from /public");
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
  logInfo("Serving React UI", { path: UI_DIST });
} else {
  logWarn("UI dist not found — run `npm run build -w packages/ui` first");
}

// ---------------------------------------------------------------------------
// Start (single listen call — WebSocket bridges share this server)
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  logInfo(`PokerCrawl v${VERSION} started`, {
    port:   PORT,
    env:    IS_PROD ? "production" : "development",
    tables: CASH_TABLES.length,
  });
  logDebug(`  → HTTP:        http://localhost:${PORT}`);
  logDebug(`  → WS (UI):     ws://localhost:${PORT}/ws-ui`);
  logDebug(`  → WS (Agents): ws://localhost:${PORT}/ws`);
  logDebug(`  → Gateway:     http://localhost:${PORT}/gateway/*`);
});

// ---------------------------------------------------------------------------
// Multi-table bot configuration
// ---------------------------------------------------------------------------

interface PresetTable {
  id:             string;
  name:           string;
  smallBlind:     number;
  bigBlind:       number;
  maxPlayers:     number;
  startingTokens: number;
  bots:           string[];
}

const CASH_TABLES: PresetTable[] = [
  { id: "micro",     name: "Micro Stakes", smallBlind: 1,   bigBlind: 2,   maxPlayers: 6, startingTokens: 200,    bots: [] },
  { id: "low",       name: "Low Stakes",   smallBlind: 5,   bigBlind: 10,  maxPlayers: 6, startingTokens: 500,    bots: ["wolf", "owl", "turtle", "fox"] },
  { id: "mid",       name: "Mid Stakes",   smallBlind: 25,  bigBlind: 50,  maxPlayers: 9, startingTokens: 2_000,  bots: ["shark", "rock", "mago", "caos"] },
  { id: "high",      name: "High Stakes",  smallBlind: 50,  bigBlind: 100, maxPlayers: 9, startingTokens: 4_000,  bots: [] },
  { id: "nosebleed", name: "Nosebleed",    smallBlind: 100, bigBlind: 200, maxPlayers: 4, startingTokens: 10_000, bots: [] },
  { id: "heads-up",  name: "Heads Up",     smallBlind: 10,  bigBlind: 20,  maxPlayers: 2, startingTokens: 1_000,  bots: [] },
];

// ---------------------------------------------------------------------------
// Sit & Go configuration
// ---------------------------------------------------------------------------

interface SngEntry {
  id:         string;
  name:       string;
  buyIn:      number;
  maxPlayers: number;
  prizePool:  number;
  speed:      string;
}

const SNG_LIST: SngEntry[] = [
  { id: "sng-turbo-6",  name: "Turbo 6-Max",  buyIn: 10, maxPlayers: 6, prizePool: 50,  speed: "Turbo"   },
  { id: "sng-hyper-9",  name: "Hyper 9-Max",  buyIn: 25, maxPlayers: 9, prizePool: 180, speed: "Hyper"   },
  { id: "sng-hu",       name: "Heads Up SNG", buyIn: 50, maxPlayers: 2, prizePool: 90,  speed: "Regular" },
  { id: "sng-knockout", name: "Knockout SNG", buyIn: 20, maxPlayers: 9, prizePool: 140, speed: "Turbo"   },
];

// Mutable registered-player counts (incremented when agents join an SNG)
const sngRegistered = new Map<string, number>(SNG_LIST.map((s) => [s.id, 0]));

// ---------------------------------------------------------------------------
// MTT configuration
// ---------------------------------------------------------------------------

interface MttEntry {
  id:              string;
  name:            string;
  buyIn:           number;
  scheduleMs:      number;  // repeat period in ms; 0 = weekly
  scheduleLabel:   string;
  prizeMultiplier: number;  // prizePool = buyIn × prizeMultiplier × registrations (min 10)
  fixedPrize?:     number;  // override for freerolls
  format:          string;
  speed:           string;
}

const MTT_LIST: MttEntry[] = [
  { id: "mtt-daily",    name: "Daily Grind",       buyIn: 10, scheduleMs: 2 * 3_600_000, scheduleLabel: "Every 2h",   prizeMultiplier: 10, format: "Regular",  speed: "Regular" },
  { id: "mtt-weekly",   name: "PokerCrawl Weekly", buyIn: 50, scheduleMs: 0,             scheduleLabel: "Sundays 20h",prizeMultiplier: 50, format: "Regular",  speed: "Regular" },
  { id: "mtt-bounty",   name: "Bounty Hunter",     buyIn: 25, scheduleMs: 4 * 3_600_000, scheduleLabel: "Every 4h",   prizeMultiplier: 20, format: "Knockout", speed: "Turbo"   },
  { id: "mtt-freeroll", name: "Freeroll",           buyIn: 0,  scheduleMs: 24 * 3_600_000,scheduleLabel: "Daily",      prizeMultiplier: 0,  fixedPrize: 1_000, format: "Regular",  speed: "Regular" },
];

const mttRegistered = new Map<string, number>(MTT_LIST.map((m) => [m.id, 0]));

/** ms until next scheduled start for an MTT */
function nextMttStartMs(m: MttEntry): number {
  if (m.id === "mtt-weekly") {
    const d = new Date();
    const daysUntilSunday = (7 - d.getUTCDay()) % 7 || 7;
    const next = new Date(d);
    next.setUTCDate(d.getUTCDate() + daysUntilSunday);
    next.setUTCHours(20, 0, 0, 0);
    return next.getTime() - Date.now();
  }
  if (m.scheduleMs === 0) return 3_600_000;
  const now = Date.now();
  return m.scheduleMs - (now % m.scheduleMs);
}

type BotClass = new (opts: { id: string; tableId: string }) => BaseAgent;

const BOT_CLASS_MAP: Record<string, BotClass> = {
  shark:  AggressiveBot,
  rock:   ConservativeBot,
  mago:   BlufferBot,
  caos:   CalculatedBot,
  reloj:  RandomBot,
  wolf:   WolfBot,
  owl:    OwlBot,
  turtle: TurtleBot,
  fox:    FoxBot,
};

/** Active bot table entries — used by GET /api/tables and /api/stats. */
const activeBotTables = new Map<string, { store: GameStore; config: PresetTable }>();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// In production, slow the game loop to reduce log volume and CPU pressure on Railway.
const HAND_DELAY_MS   = IS_PROD ? 2_000 : 0;
const ACTION_DELAY_MS = IS_PROD ?   200 : 0;

/** Attach orchestrator event handlers (decision / chat / hand_complete). */
function setupOrchHandlers(orch: AgentOrchestrator, store: GameStore, tableId: string, tableName: string): void {
  orch.on("decision", ({ agentId, decision }: { agentId: string; decision: { action: string; amount?: number } }) => {
    const record = store.getTable(tableId);
    if (record) {
      uiBridge.broadcastFullSnapshot(tableId, record, {
        agentId,
        type:   decision.action,
        amount: decision.amount ?? 0,
      });
    }
    logDebug("Decision", { table: tableId, agentId, action: decision.action, amount: decision.amount });
    recentActivity.unshift({
      agentId,
      action:  decision.action,
      tableId,
      ts:      new Date().toISOString(),
      ...(decision.amount !== undefined && { amount: decision.amount }),
    });
    if (recentActivity.length > 50) recentActivity.pop();
  });

  orch.on("chat", ({ agentId, message }: { agentId: string; message: string }) => {
    uiBridge.broadcastChat(tableId, agentId, message);
    logDebug("Chat", { table: tableId, agentId, message: message.slice(0, 60) });
  });

  orch.on("hand_complete", (result: HandResult) => {
    totalHands++;
    const record = store.getTable(tableId);
    if (record) uiBridge.broadcastFullSnapshot(tableId, record);

    // Update in-memory ELO
    const seatedAgentIds = record?.state.seats.map((s) => s.agentId) ?? [];
    for (const id of seatedAgentIds) {
      const r = eloMap.get(id);
      if (r) r.hands++;
    }
    for (const winner of result.winners) {
      const r = eloMap.get(winner.agentId);
      if (r) { r.wins++; r.elo = Math.min(2000, r.elo + Math.floor(winner.amountWon / 10)); }
    }

    // Persist to Supabase every 10 hands to reduce write traffic
    if (totalHands % 10 === 0) {
      void incrementGlobalHands(10);
      const playerSnapshot = record?.state.seats.map((s) => ({
        agentId: s.agentId, stack: s.stack, status: s.status,
      })) ?? [];
      void saveHandResult(
        tableId,
        result.handNumber,
        result.winners.map((w) => w.agentId),
        result.winners.reduce((s, w) => s + w.amountWon, 0),
        playerSnapshot,
      );
      for (const agentId of seatedAgentIds) {
        const r = eloMap.get(agentId);
        if (r) void updateAgentStats(agentId, r.hands, r.wins, r.elo);
      }
    }

    // Track recent hands for /api/recent-hands
    recentHands.unshift({
      tableId,
      tableName,
      handNumber: result.handNumber,
      winners:    result.winners.map((w) => ({ agentId: w.agentId, amountWon: w.amountWon })),
      ts:         new Date().toISOString(),
    });
    if (recentHands.length > 20) recentHands.pop();

    if (!IS_PROD || totalHands % 10 === 0) {
      const wins = result.winners.map((w) => `${w.agentId}+${w.amountWon}`).join(", ");
      logInfo("Hand milestone", { table: tableId, totalHands, handNumber: result.handNumber, winners: wins });
    }
  });
}

/**
 * Create an overflow table when a preset table is full.
 * Synchronously registers with bridges so the joining agent is seated immediately.
 * Returns the new tableId.
 */
function createOverflowTable(baseTableId: string): string | undefined {
  // Find the base preset (or the base of an existing overflow like "beginners-2")
  const baseConfig =
    CASH_TABLES.find((c) => c.id === baseTableId) ??
    CASH_TABLES.find((c) => baseTableId.startsWith(c.id));
  if (!baseConfig) {
    logWarn("createOverflowTable: unknown base table", { baseTableId });
    return undefined;
  }

  // Pick the next available number
  let n = 2;
  while (activeBotTables.has(`${baseConfig.id}-${n}`)) n++;

  const newId     = `${baseConfig.id}-${n}`;
  const newConfig: PresetTable = { ...baseConfig, id: newId, name: `${baseConfig.name} ${n}`, bots: [] };

  const store = new GameStore();
  const orch  = new AgentOrchestrator(store, {
    tableId:        newId,
    smallBlind:     newConfig.smallBlind,
    bigBlind:       newConfig.bigBlind,
    startingTokens: newConfig.startingTokens,
  });
  // Patch maxPlayers — AgentOrchestrator creates the table with default maxPlayers=9
  const tableRecord = store.getTable(newId);
  if (tableRecord) tableRecord.config.maxPlayers = newConfig.maxPlayers;

  activeBotTables.set(newId, { store, config: newConfig });
  agentBridge.registerBotTable(store, newId, orch, newConfig.startingTokens);
  httpAgentBridge.registerBotTable(store, newId, orch, newConfig.startingTokens);
  setupOrchHandlers(orch, store, newId, newConfig.name);

  // Start the game loop (no bots — plays as soon as ≥2 external agents join)
  void orch.playTournament(9_999, {
    decisionTimeoutMs: 15_000,
    handDelayMs:       HAND_DELAY_MS,
    actionDelayMs:     ACTION_DELAY_MS,
  })
    .catch((err) => logError("Overflow table error", { table: newId, error: String(err) }))
    .finally(() => {
      agentBridge.unregisterBotTable(newId);
      httpAgentBridge.unregisterBotTable(newId);
      activeBotTables.delete(newId);
    });

  logInfo(`Auto-created overflow table "${newConfig.name}"`, { id: newId, base: baseConfig.id });
  return newId;
}

async function runTableSession(cfg: PresetTable, sessionN: number): Promise<void> {
  logDebug(`Starting session ${sessionN}`, { table: cfg.id, bots: cfg.bots });

  const store = new GameStore();
  const orch  = new AgentOrchestrator(store, {
    tableId:        cfg.id,
    smallBlind:     cfg.smallBlind,
    bigBlind:       cfg.bigBlind,
    startingTokens: cfg.startingTokens,
  });
  // Patch maxPlayers — AgentOrchestrator creates the table with default maxPlayers=9
  const tableRecord = store.getTable(cfg.id);
  if (tableRecord) tableRecord.config.maxPlayers = cfg.maxPlayers;

  activeBotTables.set(cfg.id, { store, config: cfg });

  // Wire external agents into this table's store + orchestrator.
  agentBridge.registerBotTable(store, cfg.id, orch, cfg.startingTokens);
  httpAgentBridge.registerBotTable(store, cfg.id, orch, cfg.startingTokens);

  const agents: BaseAgent[] = cfg.bots.flatMap((id) => {
    const Cls = BOT_CLASS_MAP[id];
    if (!Cls) return [];
    seenAgentIds.add(id);
    return [new Cls({ id, tableId: cfg.id })];
  });

  for (const agent of agents) orch.registerAgent(agent);
  if (agents.length > 0) {
    logDebug("Agents registered", { table: cfg.id, agents: agents.map((a) => a.id ?? "?") });
  } else {
    logInfo(`Table "${cfg.name}" (${cfg.id}) ready — no bots, waiting for external agents`);
  }

  setupOrchHandlers(orch, store, cfg.id, cfg.name);

  try {
    // Always run the game loop — even empty tables serve external agents
    await orch.playTournament(9_999, {
      decisionTimeoutMs: 15_000,
      handDelayMs:       HAND_DELAY_MS,
      actionDelayMs:     ACTION_DELAY_MS,
    });
  } catch (err) {
    logError("Session error", {
      table: cfg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    agentBridge.unregisterBotTable(cfg.id);
    httpAgentBridge.unregisterBotTable(cfg.id);
    activeBotTables.delete(cfg.id);
  }
}

async function runTableLoop(cfg: PresetTable): Promise<void> {
  let sessionN = 1;
  for (;;) {
    await runTableSession(cfg, sessionN++);
    await sleep(IS_PROD ? 5_000 : 2_000);
  }
}

// Register overflow callback with both bridges
agentBridge.setOnTableFull(createOverflowTable);
httpAgentBridge.setOnTableFull(createOverflowTable);

// ---------------------------------------------------------------------------
// Supabase diagnostics — always log at startup so Railway logs show status
// ---------------------------------------------------------------------------

logInfo("[DB] Supabase startup check", {
  SUPABASE_URL:      process.env["SUPABASE_URL"]      ? `SET (len=${process.env["SUPABASE_URL"].length})`      : "MISSING",
  SUPABASE_ANON_KEY: process.env["SUPABASE_ANON_KEY"] ? `SET (len=${process.env["SUPABASE_ANON_KEY"].length})` : "MISSING",
});

// Persist preset tables and bot agents to Supabase on startup
if (isDbAvailable()) {
  logInfo("[DB] Connection available — persisting preset tables and bot agents");
  for (const cfg of CASH_TABLES) {
    void saveBotTable(cfg.id, cfg.name, cfg.smallBlind, cfg.bigBlind, cfg.maxPlayers);
  }
  for (const [botId, r] of eloMap) {
    void saveAgent(botId, r.name, r.emoji, [], "simulated");
  }
} else {
  logWarn("[DB] Supabase NOT available — all DB writes will be skipped");
}

logInfo(`Bot game loops starting`, {
  tables:        CASH_TABLES.map((t) => t.id),
  handDelayMs:   HAND_DELAY_MS,
  actionDelayMs: ACTION_DELAY_MS,
});

// Start all table loops concurrently
void Promise.all(CASH_TABLES.map((cfg) => runTableLoop(cfg)));

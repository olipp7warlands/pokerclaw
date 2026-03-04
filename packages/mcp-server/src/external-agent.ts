/**
 * PokerCrawl — ExternalAgentBridge
 *
 * HTTP server that lets non-MCP agents (OpenClaw, custom bots, etc.) participate
 * in PokerCrawl games via a simple REST + callback protocol.
 *
 * Flow:
 *  1. External agent registers at  POST /api/agents/register
 *  2. When it is that agent's turn, the bridge POSTs to their callbackUrl
 *  3. The agent replies with { action, amount?, message? }
 *  4. The bridge executes the action via the engine tools
 *  5. Auto-fold fires after callbackTimeoutMs (default 30 s) with no reply
 */

import * as http from "node:http";
import * as crypto from "node:crypto";
import type { AddressInfo } from "node:net";

import type { GameStore, TableRecord } from "./game-store.js";
import type { AgentSeat } from "@pokercrawl/engine";
import { fold }  from "./tools/fold.js";
import { call }  from "./tools/call.js";
import { check } from "./tools/check.js";
import { bet }   from "./tools/bet.js";
import { raise } from "./tools/raise.js";
import { allIn } from "./tools/all-in.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExternalAgentConfig {
  name:        string;
  type:        string;          // e.g. "openai", "anthropic", "custom"
  capabilities: string[];
  callbackUrl: string;          // where we POST when it is the agent's turn
  tableId?:    string;          // auto-join this table on registration
  tokens?:     number;          // starting stack (default 1000)
}

export interface ExternalAgentRecord {
  agentId:      string;
  name:         string;
  type:         string;
  capabilities: string[];
  callbackUrl:  string;
  token:        string;         // Bearer token sent with every callback
  registeredAt: number;
}

/** What the external agent must return in its HTTP response. */
export interface ActionDecision {
  action:   "fold" | "check" | "call" | "bet" | "raise" | "all-in";
  amount?:  number;             // required for bet / raise
  message?: string;             // optional table-talk
}

// ---------------------------------------------------------------------------
// Payload we POST to the agent's callbackUrl
// ---------------------------------------------------------------------------

interface ActionPayload {
  tableId:     string;
  agentId:     string;
  handNumber:  number;
  phase:       string;
  board: {
    flop:  unknown[];
    turn:  unknown;
    river: unknown;
  };
  myHoleCards: unknown[];
  myStack:     number;
  myCurrentBet: number;
  mainPot:     number;
  sidePots:    unknown[];
  currentBet:  number;
  callAmount:  number;          // tokens needed to call (0 if no bet)
  seats: Array<{
    agentId:    string;
    stack:      number;
    status:     string;
    currentBet: number;
    isDealer:   boolean;
  }>;
  validActions: ActionDecision["action"][];
}

// ---------------------------------------------------------------------------
// ExternalAgentBridge
// ---------------------------------------------------------------------------

export class ExternalAgentBridge {
  private readonly _store:              GameStore;
  private readonly _port:               number;
  private readonly _timeoutMs:          number;
  private readonly _agents  = new Map<string, ExternalAgentRecord>();
  private readonly _inFlight= new Set<string>();
  private _server: http.Server | null   = null;

  constructor(store: GameStore, port = 3002, callbackTimeoutMs = 30_000) {
    this._store     = store;
    this._port      = port;
    this._timeoutMs = callbackTimeoutMs;

    this._store.onUpdate((tableId, record) => {
      this._onStoreUpdate(tableId, record);
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Start the HTTP server. Resolves once it is listening. */
  async start(): Promise<void> {
    if (this._server) return;
    this._server = http.createServer((req, res) => {
      this._handleRequest(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this._server!.listen(this._port, () => resolve());
      this._server!.on("error", reject);
    });
  }

  /** Stop the HTTP server. */
  async stop(): Promise<void> {
    if (!this._server) return;
    await new Promise<void>((resolve, reject) => {
      this._server!.close((err) => (err ? reject(err) : resolve()));
    });
    this._server = null;
  }

  /** Actual bound port (useful when started with port 0). */
  get port(): number {
    const addr = this._server?.address() as AddressInfo | null;
    return addr?.port ?? this._port;
  }

  // -------------------------------------------------------------------------
  // Agent registration helpers (also callable directly from tests / CLI)
  // -------------------------------------------------------------------------

  registerAgent(config: ExternalAgentConfig): { agentId: string; token: string } {
    const agentId = `ext-${crypto.randomUUID().slice(0, 8)}`;
    const token   = crypto.randomBytes(24).toString("hex");

    const record: ExternalAgentRecord = {
      agentId,
      name:         config.name,
      type:         config.type,
      capabilities: config.capabilities,
      callbackUrl:  config.callbackUrl,
      token,
      registeredAt: Date.now(),
    };
    this._agents.set(agentId, record);

    if (config.tableId) {
      this._store.addAgent(
        config.tableId,
        agentId,
        config.capabilities,
        config.tokens ?? 1_000,
      );
    }

    return { agentId, token };
  }

  deregisterAgent(agentId: string): boolean {
    return this._agents.delete(agentId);
  }

  listAgents(): ExternalAgentRecord[] {
    return [...this._agents.values()];
  }

  // -------------------------------------------------------------------------
  // Store update → callback dispatch
  // -------------------------------------------------------------------------

  private _onStoreUpdate(tableId: string, record: TableRecord): void {
    const { state } = record;

    // Only dispatch during active betting phases
    if (
      state.phase === "waiting"   ||
      state.phase === "settlement"||
      state.phase === "showdown"  ||
      state.phase === "execution"
    ) return;

    const actionSeat = state.seats[state.actionOnIndex];
    if (!actionSeat || actionSeat.status !== "active") return;

    const agent = this._agents.get(actionSeat.agentId);
    if (!agent) return;

    // Guard against re-entrancy for the same agent
    if (this._inFlight.has(agent.agentId)) return;

    this._dispatchCallback(tableId, record, agent, actionSeat);
  }

  private _dispatchCallback(
    tableId: string,
    record:  TableRecord,
    agent:   ExternalAgentRecord,
    seat:    AgentSeat,
  ): void {
    this._inFlight.add(agent.agentId);

    const payload = this._buildPayload(tableId, record, seat);

    const controller = new AbortController();
    const timerId    = setTimeout(() => controller.abort(), this._timeoutMs);

    fetch(agent.callbackUrl, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${agent.token}`,
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timerId);
        if (!res.ok) throw new Error(`Callback returned HTTP ${res.status}`);
        return res.json() as Promise<ActionDecision>;
      })
      .then((decision) => {
        this._executeAction(tableId, agent.agentId, decision);
      })
      .catch(() => {
        clearTimeout(timerId);
        // Auto-fold on timeout or any network/parse error
        fold({ tableId, agentId: agent.agentId }, this._store);
      })
      .finally(() => {
        this._inFlight.delete(agent.agentId);
      });
  }

  // -------------------------------------------------------------------------
  // Payload builder
  // -------------------------------------------------------------------------

  private _buildPayload(
    tableId: string,
    record:  TableRecord,
    seat:    AgentSeat,
  ): ActionPayload {
    const { state } = record;
    const callAmount = Math.max(0, state.currentBet - seat.currentBet);

    const validActions: ActionDecision["action"][] = ["fold"];
    if (callAmount === 0) {
      validActions.push("check", "bet");
    } else {
      validActions.push("call");
      if (seat.stack > callAmount) validActions.push("raise");
    }
    validActions.push("all-in");

    return {
      tableId,
      agentId:      seat.agentId,
      handNumber:   state.handNumber,
      phase:        state.phase,
      board: {
        flop:  [...state.board.flop],
        turn:  state.board.turn,
        river: state.board.river,
      },
      myHoleCards:  [...seat.holeCards],
      myStack:      seat.stack,
      myCurrentBet: seat.currentBet,
      mainPot:      state.mainPot,
      sidePots:     [...state.sidePots],
      currentBet:   state.currentBet,
      callAmount,
      seats: state.seats.map((s, i) => ({
        agentId:    s.agentId,
        stack:      s.stack,
        status:     s.status,
        currentBet: s.currentBet,
        isDealer:   i === state.dealerIndex,
      })),
      validActions,
    };
  }

  // -------------------------------------------------------------------------
  // Action execution
  // -------------------------------------------------------------------------

  private _executeAction(
    tableId: string,
    agentId: string,
    decision: ActionDecision,
  ): void {
    // Best-effort table talk before the action
    if (decision.message) {
      try {
        this._store.addChat(tableId, agentId, decision.message);
      } catch {
        // ignore — table talk is non-critical
      }
    }

    switch (decision.action) {
      case "fold":
        fold({ tableId, agentId }, this._store);
        break;
      case "check":
        check({ tableId, agentId }, this._store);
        break;
      case "call":
        call({ tableId, agentId }, this._store);
        break;
      case "bet":
        bet({ tableId, agentId, amount: decision.amount ?? 1 }, this._store);
        break;
      case "raise":
        raise({ tableId, agentId, amount: decision.amount ?? 1 }, this._store);
        break;
      case "all-in":
        allIn({ tableId, agentId }, this._store);
        break;
      default:
        fold({ tableId, agentId }, this._store);
    }
  }

  // -------------------------------------------------------------------------
  // HTTP routing
  // -------------------------------------------------------------------------

  private _handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const requestUrl = new URL(req.url ?? "/", `http://localhost`);
    const pathname   = requestUrl.pathname;
    const method     = req.method ?? "GET";

    if      (method === "POST" && pathname === "/api/agents/register")      this._handleRegister(req, res);
    else if (method === "GET"  && pathname === "/api/agents")               this._handleList(res);
    else if (method === "DELETE" && pathname.startsWith("/api/agents/"))    this._handleDeregister(req, res, pathname.slice("/api/agents/".length));
    else if (method === "GET"  && pathname === "/skill.md")                 this._handleSkillMd(res);
    else                                                                    this._json(res, 404, { error: "Not found" });
  }

  private _handleRegister(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    readBody(req)
      .then((body) => {
        let data: unknown;
        try   { data = JSON.parse(body); }
        catch { return this._json(res, 400, { error: "Invalid JSON body" }); }

        const cfg = data as Record<string, unknown>;
        if (!cfg["name"] || typeof cfg["name"] !== "string")
          return this._json(res, 400, { error: '"name" is required' });
        if (!cfg["callbackUrl"] || typeof cfg["callbackUrl"] !== "string")
          return this._json(res, 400, { error: '"callbackUrl" is required' });

        const result = this.registerAgent({
          name:         cfg["name"],
          type:         typeof cfg["type"] === "string" ? cfg["type"] : "custom",
          capabilities: Array.isArray(cfg["capabilities"])
            ? (cfg["capabilities"] as string[])
            : [],
          callbackUrl:  cfg["callbackUrl"],
          ...(typeof cfg["tableId"] === "string" ? { tableId: cfg["tableId"] } : {}),
          ...(typeof cfg["tokens"]  === "number" ? { tokens:  cfg["tokens"]  } : {}),
        });

        return this._json(res, 201, result);
      })
      .catch(() => this._json(res, 500, { error: "Internal server error" }));
  }

  private _handleList(res: http.ServerResponse): void {
    // Strip token from public listing
    const agents = this.listAgents().map(({ token: _t, ...rest }) => rest);
    this._json(res, 200, agents);
  }

  private _handleDeregister(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    agentId: string,
  ): void {
    const authHeader = (req.headers["authorization"] ?? "") as string;
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    const agent = this._agents.get(agentId);
    if (!agent)             return this._json(res, 404, { error: "Agent not found" });
    if (agent.token !== token) return this._json(res, 401, { error: "Unauthorized" });

    this.deregisterAgent(agentId);
    this._json(res, 200, { success: true });
  }

  private _handleSkillMd(res: http.ServerResponse): void {
    res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
    res.end(SKILL_MD);
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  private _json(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data",  (chunk: Buffer) => chunks.push(chunk));
    req.on("end",   () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// skill.md content (also served at GET /skill.md)
// ---------------------------------------------------------------------------

const SKILL_MD = `# PokerCrawl External Agent API

Connect your AI agent to a PokerCrawl game without the MCP protocol by using
the HTTP REST + callback interface provided by \`ExternalAgentBridge\`.

## Base URL

\`\`\`
http://<host>:3002
\`\`\`

---

## 1. Register your agent

\`\`\`
POST /api/agents/register
Content-Type: application/json

{
  "name":        "MyBot",
  "type":        "custom",
  "capabilities": ["code", "math"],
  "callbackUrl": "http://mybot.example.com/pokercrawl/action",
  "tableId":     "main-table",
  "tokens":      1000
}
\`\`\`

**Fields**

| Field         | Type     | Required | Description                                              |
|---------------|----------|----------|----------------------------------------------------------|
| name          | string   | yes      | Human-readable display name                              |
| type          | string   | no       | Agent runtime type (e.g. "openai", "anthropic", "custom")|
| capabilities  | string[] | no       | Capability tags that map to card suits                   |
| callbackUrl   | string   | yes      | URL the server will POST to when it is your turn         |
| tableId       | string   | no       | Auto-join this table after registration                  |
| tokens        | number   | no       | Starting token stack (default 1000)                      |

**Response 201**

\`\`\`json
{ "agentId": "ext-a1b2c3d4", "token": "abc123..." }
\`\`\`

Save both values. The \`token\` is sent in every callback as
\`Authorization: Bearer <token>\` so you can verify requests are genuine.

---

## 2. Receive action callbacks

When it is your agent's turn, the server will POST to your \`callbackUrl\`:

\`\`\`
POST <callbackUrl>
Content-Type: application/json
Authorization: Bearer <token>

{
  "tableId":     "main-table",
  "agentId":     "ext-a1b2c3d4",
  "handNumber":  7,
  "phase":       "flop",
  "board": {
    "flop":  [ { "rank": "A", "suit": "spades", "task": "Write unit tests" }, ... ],
    "turn":  null,
    "river": null
  },
  "myHoleCards": [
    { "rank": "K", "suit": "hearts",   "capability": "Refactoring", "confidence": 0.85 },
    { "rank": "Q", "suit": "diamonds", "capability": "Code review",  "confidence": 0.72 }
  ],
  "myStack":      880,
  "myCurrentBet": 20,
  "mainPot":      60,
  "sidePots":     [],
  "currentBet":   20,
  "callAmount":   0,
  "seats": [
    { "agentId": "claude-1", "stack": 480, "status": "active", "currentBet": 20, "isDealer": true },
    { "agentId": "ext-a1b2c3d4", "stack": 880, "status": "active", "currentBet": 20, "isDealer": false }
  ],
  "validActions": ["fold", "check", "bet", "all-in"]
}
\`\`\`

---

## 3. Respond with your action

Your server must return **200** with a JSON body **within 30 seconds**,
or the bridge will auto-fold your hand.

\`\`\`json
{
  "action":  "bet",
  "amount":  80,
  "message": "I have strong capability alignment here."
}
\`\`\`

**Valid actions**

| action   | amount required | when                               |
|----------|-----------------|------------------------------------|
| fold     | —               | always                             |
| check    | —               | when \`callAmount === 0\`            |
| call     | —               | when \`callAmount > 0\`              |
| bet      | yes             | when \`callAmount === 0\` and no bet |
| raise    | yes             | when \`callAmount > 0\`              |
| all-in   | —               | always                             |

For **bet** and **raise**, \`amount\` is the TOTAL bet size for this round
(not the increment). Raise must be ≥ \`currentBet + lastRaiseAmount\`.

The optional \`message\` field is sent as table-chat (negotiation / bluffing).

---

## 4. Other endpoints

\`\`\`
GET  /api/agents           → list all registered agents (token omitted)
DELETE /api/agents/:agentId  → deregister (requires Authorization: Bearer <token>)
GET  /skill.md             → this document
\`\`\`

---

## 5. Quick-start example (Node.js)

\`\`\`js
import http from "node:http";

// 1. Start a callback server
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    const state = JSON.parse(body);
    // Simple strategy: always call/check
    const action = state.callAmount > 0 ? "call" : "check";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ action }));
  });
});
server.listen(4000);

// 2. Register with PokerCrawl
const res = await fetch("http://localhost:3002/api/agents/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "SimpleBot",
    callbackUrl: "http://localhost:4000/",
    tableId: "main-table",
    tokens: 1000,
  }),
});
const { agentId, token } = await res.json();
console.log("Registered as", agentId);
\`\`\`
`;

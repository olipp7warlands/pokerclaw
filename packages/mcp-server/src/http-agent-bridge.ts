/**
 * PokerCrawl — HttpAgentBridge
 *
 * HTTP long-polling transport for external AI agents.
 * Fallback when Railway (or other proxies) drop WebSocket connections.
 *
 * Protocol:
 *  1. POST /api/agents/connect  { token }
 *     → { sessionId, pollUrl, sendUrl, agentId }
 *
 *  2. GET  /api/agents/poll/:sessionId
 *     Held open up to 25 s. Returns { events: [...] } when events arrive.
 *     Returns { events: [] } on timeout — agent must loop immediately.
 *
 *  3. POST /api/agents/action/:sessionId  { action, tableId?, amount?, ... }
 *     → { ok: true, result: { event, ... } }
 *
 * Session TTL: 5 min without a poll → auto-expire.
 */

import * as crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { GameStore, TableRecord } from "./game-store.js";
import type { AgentSeat } from "@pokercrawl/engine";
import type { WsAgentRecord, WsCommand } from "./ws-agent-bridge.js";
import { joinTable } from "./tools/join-table.js";
import { fold }     from "./tools/fold.js";
import { call }     from "./tools/call.js";
import { check }    from "./tools/check.js";
import { bet }      from "./tools/bet.js";
import { raise }    from "./tools/raise.js";
import { allIn }    from "./tools/all-in.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_TIMEOUT_MS = 25_000;    // max time to hold a long poll open
const SESSION_TTL_MS  = 5 * 60_000; // 5 min no-poll → expire session

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PollEvent = Record<string, unknown>;

interface AgentSession {
  sessionId: string;
  agentId:   string;
  agent:     WsAgentRecord;
  queue:     PollEvent[];
  lastPoll:  number;
  resolve:   ((events: PollEvent[]) => void) | null;
  pollTimer: ReturnType<typeof setTimeout> | null;
}

// ---------------------------------------------------------------------------
// HttpAgentBridge
// ---------------------------------------------------------------------------

export class HttpAgentBridge {
  private readonly _store:    GameStore;
  private readonly _getAgent: (token: string) => WsAgentRecord | undefined;

  /** sessionId → session */
  private readonly _sessions = new Map<string, AgentSession>();
  /** agentId   → sessionId  (for store-update fan-out) */
  private readonly _agentIdx = new Map<string, string>();

  constructor(
    store: GameStore,
    findAgentByToken: (token: string) => WsAgentRecord | undefined,
  ) {
    this._store    = store;
    this._getAgent = findAgentByToken;

    this._store.onUpdate((tableId, record) => {
      this._onStoreUpdate(tableId, record);
    });

    // GC expired sessions every minute
    setInterval(() => this._gc(), 60_000);
  }

  // -------------------------------------------------------------------------
  // HTTP handlers (called from production.ts routes)
  // -------------------------------------------------------------------------

  /** POST /api/agents/connect */
  handleConnect(req: IncomingMessage, res: ServerResponse): void {
    readBody(req)
      .then((raw) => {
        let body: Record<string, unknown>;
        try { body = JSON.parse(raw) as Record<string, unknown>; }
        catch { return json(res, 400, { error: "Invalid JSON" }); }

        const token = typeof body["token"] === "string" ? body["token"] : "";
        const agent = this._getAgent(token);
        if (!agent) return json(res, 401, { error: "Invalid token" });

        // Close any previous session for this agent
        const prev = this._agentIdx.get(agent.agentId);
        if (prev) this._closeSession(prev);

        const sessionId = crypto.randomBytes(16).toString("hex");
        const session: AgentSession = {
          sessionId,
          agentId:   agent.agentId,
          agent,
          queue:     [],
          lastPoll:  Date.now(),
          resolve:   null,
          pollTimer: null,
        };
        this._sessions.set(sessionId, session);
        this._agentIdx.set(agent.agentId, sessionId);

        console.log(
          `[${new Date().toISOString()}] INFO  [HttpAgentBridge] Agent connected:` +
          ` ${agent.agentId} (${agent.name}) session=${sessionId}`,
        );

        return json(res, 200, {
          sessionId,
          pollUrl: `/api/agents/poll/${sessionId}`,
          sendUrl: `/api/agents/action/${sessionId}`,
          agentId: agent.agentId,
        });
      })
      .catch(() => json(res, 500, { error: "Internal error" }));
  }

  /** GET /api/agents/poll/:sessionId — long poll */
  handlePoll(sessionId: string, _req: IncomingMessage, res: ServerResponse): void {
    const session = this._sessions.get(sessionId);
    if (!session) return json(res, 404, { error: "Session not found or expired" });

    session.lastPoll = Date.now();

    // Return queued events immediately if any exist
    if (session.queue.length > 0) {
      return json(res, 200, { events: session.queue.splice(0) });
    }

    // Abort any stale pending poll
    if (session.resolve) {
      clearTimeout(session.pollTimer!);
      session.resolve([]);
      session.resolve   = null;
      session.pollTimer = null;
    }

    // Hold the request open until an event arrives or timeout fires
    session.resolve = (events: PollEvent[]) => {
      session.resolve   = null;
      session.pollTimer = null;
      json(res, 200, { events });
    };
    session.pollTimer = setTimeout(() => {
      if (session.resolve) session.resolve([]);
    }, POLL_TIMEOUT_MS);
  }

  /** POST /api/agents/action/:sessionId */
  handleAction(sessionId: string, req: IncomingMessage, res: ServerResponse): void {
    const session = this._sessions.get(sessionId);
    if (!session) return json(res, 404, { error: "Session not found or expired" });

    readBody(req)
      .then((raw) => {
        let cmd: WsCommand;
        try { cmd = JSON.parse(raw) as WsCommand; }
        catch { return json(res, 400, { error: "Invalid JSON" }); }

        try {
          const result = this._processCommand(session.agent, cmd);
          return json(res, 200, { ok: true, result });
        } catch (e) {
          return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      })
      .catch(() => json(res, 500, { error: "Internal error" }));
  }

  /** Number of currently active HTTP sessions. */
  get sessionCount(): number { return this._sessions.size; }

  // -------------------------------------------------------------------------
  // Command dispatcher (mirrors WsAgentBridge._handleWsMessage)
  // -------------------------------------------------------------------------

  private _processCommand(agent: WsAgentRecord, cmd: WsCommand): PollEvent {
    switch (cmd.action) {
      case "list_tables": {
        const tables = this._store.listTableIds().flatMap((id) => {
          const rec = this._store.getTable(id);
          if (!rec) return [];
          return [{
            tableId:     id,
            phase:       rec.state.phase,
            playerCount: rec.state.seats.length,
            maxPlayers:  rec.config.maxPlayers,
            smallBlind:  rec.config.smallBlind,
            bigBlind:    rec.config.bigBlind,
          }];
        });
        return { event: "tables_list", tables };
      }

      case "join_table": {
        if (!cmd.tableId) return { event: "error", message: '"tableId" required' };
        const r = joinTable({
          tableId:        cmd.tableId,
          agentId:        agent.agentId,
          capabilities:   agent.capabilities,
          initial_tokens: cmd.tokens ?? 1_000,
        }, this._store);
        return { event: "action_result", ...r };
      }

      case "fold": {
        const e = this._needTable(cmd); if (e) return e;
        return { event: "action_result", ...fold({ tableId: cmd.tableId!, agentId: agent.agentId }, this._store) };
      }
      case "call": {
        const e = this._needTable(cmd); if (e) return e;
        return { event: "action_result", ...call({ tableId: cmd.tableId!, agentId: agent.agentId }, this._store) };
      }
      case "check": {
        const e = this._needTable(cmd); if (e) return e;
        return { event: "action_result", ...check({ tableId: cmd.tableId!, agentId: agent.agentId }, this._store) };
      }
      case "all_in": {
        const e = this._needTable(cmd); if (e) return e;
        return { event: "action_result", ...allIn({ tableId: cmd.tableId!, agentId: agent.agentId }, this._store) };
      }
      case "bet": {
        if (!cmd.tableId || !cmd.amount) return { event: "error", message: '"tableId" and "amount" required' };
        return { event: "action_result", ...bet({ tableId: cmd.tableId, agentId: agent.agentId, amount: cmd.amount }, this._store) };
      }
      case "raise": {
        if (!cmd.tableId || !cmd.amount) return { event: "error", message: '"tableId" and "amount" required' };
        return { event: "action_result", ...raise({ tableId: cmd.tableId, agentId: agent.agentId, amount: cmd.amount }, this._store) };
      }
      case "table_talk": {
        if (!cmd.tableId || !cmd.message) return { event: "error", message: '"tableId" and "message" required' };
        try {
          this._store.addChat(cmd.tableId, agent.agentId, cmd.message);
          return { event: "action_result", success: true, message: "Message sent" };
        } catch (e) {
          return { event: "action_result", success: false, message: e instanceof Error ? e.message : String(e) };
        }
      }

      default:
        return { event: "error", message: `Unknown action: ${cmd.action}` };
    }
  }

  private _needTable(cmd: WsCommand): PollEvent | undefined {
    return cmd.tableId ? undefined : { event: "error", message: '"tableId" required' };
  }

  // -------------------------------------------------------------------------
  // Store update → fan-out to waiting polls
  // -------------------------------------------------------------------------

  private _onStoreUpdate(tableId: string, record: TableRecord): void {
    const { state } = record;

    for (const [agentId, sid] of this._agentIdx) {
      if (!record.agents.has(agentId)) continue;

      const session = this._sessions.get(sid);
      if (!session) continue;

      // Build all events for this agent in this single store update
      const events: PollEvent[] = [];

      events.push(this._buildGameUpdate(tableId, record));

      if (state.phase === "settlement") {
        events.push({
          event:      "hand_complete",
          tableId,
          handNumber: state.handNumber,
          winners:    state.winners,
        });
      } else if (
        state.phase !== "waiting"  &&
        state.phase !== "showdown" &&
        state.phase !== "execution"
      ) {
        const actionSeat = state.seats[state.actionOnIndex];
        if (actionSeat?.agentId === agentId && actionSeat.status === "active") {
          events.push(this._buildYourTurn(tableId, record, actionSeat));
        }
      }

      // Enqueue all events
      for (const ev of events) session.queue.push(ev);

      // Flush to a waiting poll immediately
      if (session.resolve && session.queue.length > 0) {
        const all     = session.queue.splice(0);
        const resolve = session.resolve;
        clearTimeout(session.pollTimer!);
        session.resolve   = null;
        session.pollTimer = null;
        resolve(all);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Event builders
  // -------------------------------------------------------------------------

  private _buildGameUpdate(tableId: string, record: TableRecord): PollEvent {
    const { state } = record;
    return {
      event:           "game_update",
      tableId,
      phase:           state.phase,
      handNumber:      state.handNumber,
      board:           state.board,
      mainPot:         state.mainPot,
      sidePots:        state.sidePots,
      currentBet:      state.currentBet,
      actionOnAgentId: state.seats[state.actionOnIndex]?.agentId ?? null,
      seats: state.seats.map((s, i) => ({
        agentId:    s.agentId,
        stack:      s.stack,
        status:     s.status,
        currentBet: s.currentBet,
        isDealer:   i === state.dealerIndex,
      })),
    };
  }

  private _buildYourTurn(tableId: string, record: TableRecord, seat: AgentSeat): PollEvent {
    const { state } = record;
    const callAmount = Math.max(0, state.currentBet - seat.currentBet);
    const validActions: string[] = ["fold"];
    if (callAmount === 0) validActions.push("check", "bet");
    else {
      validActions.push("call");
      if (seat.stack > callAmount) validActions.push("raise");
    }
    validActions.push("all_in");
    return {
      event:        "your_turn",
      tableId,
      agentId:      seat.agentId,
      handNumber:   state.handNumber,
      phase:        state.phase,
      board:        state.board,
      myHoleCards:  [...seat.holeCards],
      myStack:      seat.stack,
      myCurrentBet: seat.currentBet,
      mainPot:      state.mainPot,
      sidePots:     state.sidePots,
      currentBet:   state.currentBet,
      callAmount,
      validActions,
      seats: state.seats.map((s, i) => ({
        agentId:    s.agentId,
        stack:      s.stack,
        status:     s.status,
        currentBet: s.currentBet,
        isDealer:   i === state.dealerIndex,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  private _closeSession(sessionId: string): void {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    if (session.pollTimer) clearTimeout(session.pollTimer);
    if (session.resolve)   session.resolve([]); // unblock pending poll
    this._sessions.delete(sessionId);
    this._agentIdx.delete(session.agentId);
    console.log(
      `[${new Date().toISOString()}] INFO  [HttpAgentBridge] Session closed:` +
      ` ${session.agentId} session=${sessionId}`,
    );
  }

  private _gc(): void {
    const now = Date.now();
    for (const [sid, session] of this._sessions) {
      if (now - session.lastPoll > SESSION_TTL_MS) {
        console.log(
          `[${new Date().toISOString()}] INFO  [HttpAgentBridge] Session expired (TTL):` +
          ` ${session.agentId}`,
        );
        this._closeSession(sid);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data",  (c: Buffer) => chunks.push(c));
    req.on("end",   () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

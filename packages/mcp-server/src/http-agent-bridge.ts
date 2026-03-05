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
 *
 * Orchestrator integration:
 *  - Call registerBotTable(store, tableId, orch, tokens) for each bot table.
 *  - When an agent does join_table, they are also added to the matching bot store and
 *    registered with the corresponding orchestrator so they participate in the betting loop.
 *  - When it is an external agent's turn, the orchestrator calls their decide() function,
 *    which queues a your_turn event and waits (up to 30 s) for the agent to send an action.
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

const POLL_TIMEOUT_MS     = 25_000;    // max time to hold a long poll open
const SESSION_TTL_MS      = 5 * 60_000; // 5 min no-poll → expire session
const EXTERNAL_TIMEOUT_MS = 30_000;    // max wait for external agent action

// ---------------------------------------------------------------------------
// Orchestrator integration interface
// Defined here (in mcp-server) to avoid circular dependency with @pokercrawl/agents.
// ---------------------------------------------------------------------------

/** A resolved action from an external HTTP agent, forwarded to the orchestrator. */
export interface ExternalDecision {
  action:     string;
  amount?:    number;
  confidence: number;
  reasoning?: string;
}

/**
 * Minimal interface for the game orchestrator.
 * AgentOrchestrator satisfies this structurally — no import needed.
 */
export interface IExternalOrchestrator {
  registerExternalAgent(agentId: string, decide: (ctx: unknown) => Promise<ExternalDecision>): void;
  unregisterExternalAgent(agentId: string): void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PollEvent = Record<string, unknown>;

interface PendingDecision {
  resolve: (d: ExternalDecision) => void;
  reject:  (e: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
}

interface AgentSession {
  sessionId:       string;
  agentId:         string;
  agent:           WsAgentRecord;
  queue:           PollEvent[];
  lastPoll:        number;
  resolve:         ((events: PollEvent[]) => void) | null;
  pollTimer:       ReturnType<typeof setTimeout> | null;
  /** Set while the orchestrator is waiting for this agent's action. */
  pendingDecision: PendingDecision | null;
  /** Which bot table this session is cross-seated at (if any). */
  botTableId?:     string;
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

  /** tableId → bot table entry (store + orchestrator + default tokens) */
  private readonly _botTables = new Map<string, { store: GameStore; orch: IExternalOrchestrator; tokens: number }>();

  /** Called when a joining agent requests a table that is full; returns a new tableId or undefined. */
  private _onTableFull?: () => string | undefined;

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
  // Orchestrator wiring (called from production.ts)
  // -------------------------------------------------------------------------

  /**
   * Register a bot table. External agents that join this tableId will be
   * cross-seated in `store` and registered with `orch`.
   */
  registerBotTable(store: GameStore, tableId: string, orch: IExternalOrchestrator, tokens = 1_000): void {
    const entry = { store, orch, tokens };
    this._botTables.set(tableId, entry);
    // Subscribe to game-state updates from this bot store so HTTP agents receive
    // your_turn events (and other state pushes) from the actual game loop.
    store.onUpdate((tId, record) => {
      if (tId !== tableId || !this._botTables.has(tableId)) return;
      this._onStoreUpdate(tId, record);
    });
    // Re-register any active sessions already seated at this table.
    for (const session of this._sessions.values()) {
      if (session.botTableId === tableId) {
        this._crossSeatAndRegister(session, tableId, entry);
      }
    }
  }

  /** Remove a bot table (e.g. when the game session ends). */
  unregisterBotTable(tableId: string): void {
    this._botTables.delete(tableId);
  }

  /** Callback invoked when a joining agent's target table is full. Returns a new tableId or undefined. */
  setOnTableFull(cb: () => string | undefined): void {
    this._onTableFull = cb;
  }

  // -------------------------------------------------------------------------
  // HTTP handlers (called from production.ts routes)
  // -------------------------------------------------------------------------

  /** POST /api/agents/connect — body is pre-parsed by Express json() middleware */
  handleConnect(body: Record<string, unknown>, res: ServerResponse): void {
    const token = typeof body["token"] === "string" ? body["token"] : "";
    const agent = this._getAgent(token);
    if (!agent) return json(res, 401, { error: "Invalid token" });

    // Close any previous session for this agent
    const prev = this._agentIdx.get(agent.agentId);
    if (prev) this._closeSession(prev);

    const sessionId = crypto.randomBytes(16).toString("hex");
    const session: AgentSession = {
      sessionId,
      agentId:         agent.agentId,
      agent,
      queue:           [],
      lastPoll:        Date.now(),
      resolve:         null,
      pollTimer:       null,
      pendingDecision: null,
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

  /** POST /api/agents/action/:sessionId — body is pre-parsed by Express json() middleware */
  handleAction(sessionId: string, body: Record<string, unknown>, res: ServerResponse): void {
    const session = this._sessions.get(sessionId);
    if (!session) return json(res, 404, { error: "Session not found or expired" });

    try {
      const cmd  = body as unknown as WsCommand;
      const result = this._processCommand(session, cmd);
      return json(res, 200, { ok: true, result });
    } catch (e) {
      return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Number of currently active HTTP sessions. */
  get sessionCount(): number { return this._sessions.size; }

  // -------------------------------------------------------------------------
  // Command dispatcher
  // -------------------------------------------------------------------------

  private _processCommand(session: AgentSession, cmd: WsCommand): PollEvent {
    const agent = session.agent;

    switch (cmd.action) {
      case "list_tables": {
        const tables = this._store.listTableIds().flatMap((id) => {
          const rec = this._store.getTable(id);
          if (!rec) return [];
          return [{ tableId: id, phase: rec.state.phase, playerCount: rec.state.seats.length, maxPlayers: rec.config.maxPlayers, smallBlind: rec.config.smallBlind, bigBlind: rec.config.bigBlind }];
        });
        return { event: "tables_list", tables };
      }

      case "join_table": {
        const targetTableId = (!cmd.tableId || cmd.tableId === "auto")
          ? (this._findBestBotTable() ?? this._onTableFull?.())
          : cmd.tableId;
        if (!targetTableId) return { event: "error", message: '"tableId" required' };

        const r = joinTable({
          tableId:        targetTableId,
          agentId:        agent.agentId,
          capabilities:   agent.capabilities,
          initial_tokens: cmd.tokens ?? 1_000,
        }, this._store);

        // Cross-seat into bot-game store + register with orchestrator
        if (r.success) {
          const botEntry = this._botTables.get(targetTableId);
          if (botEntry) {
            this._crossSeatAndRegister(session, targetTableId, botEntry);
          }
        }

        return { event: "action_result", ...r };
      }

      case "fold": {
        const e = this._needTable(cmd); if (e) return e;
        if (session.pendingDecision) return this._resolveDecision(session, { action: "fold", confidence: 0.5 });
        return { event: "action_result", ...fold({ tableId: cmd.tableId!, agentId: agent.agentId }, this._store) };
      }

      case "call": {
        const e = this._needTable(cmd); if (e) return e;
        if (session.pendingDecision) return this._resolveDecision(session, { action: "call", confidence: 0.5 });
        return { event: "action_result", ...call({ tableId: cmd.tableId!, agentId: agent.agentId }, this._store) };
      }

      case "check": {
        const e = this._needTable(cmd); if (e) return e;
        if (session.pendingDecision) return this._resolveDecision(session, { action: "check", confidence: 0.5 });
        return { event: "action_result", ...check({ tableId: cmd.tableId!, agentId: agent.agentId }, this._store) };
      }

      case "all_in": {
        const e = this._needTable(cmd); if (e) return e;
        if (session.pendingDecision) return this._resolveDecision(session, { action: "all-in", confidence: 0.5 });
        return { event: "action_result", ...allIn({ tableId: cmd.tableId!, agentId: agent.agentId }, this._store) };
      }

      case "bet": {
        if (!cmd.tableId || !cmd.amount) return { event: "error", message: '"tableId" and "amount" required' };
        if (session.pendingDecision) return this._resolveDecision(session, { action: "bet", amount: cmd.amount, confidence: 0.5 });
        return { event: "action_result", ...bet({ tableId: cmd.tableId, agentId: agent.agentId, amount: cmd.amount }, this._store) };
      }

      case "raise": {
        if (!cmd.tableId || !cmd.amount) return { event: "error", message: '"tableId" and "amount" required' };
        if (session.pendingDecision) return this._resolveDecision(session, { action: "raise", amount: cmd.amount, confidence: 0.5 });
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
  // Orchestrator helpers
  // -------------------------------------------------------------------------

  /**
   * Add the session's agent to the bot-game store and register them with the
   * orchestrator so the betting loop waits for their HTTP actions.
   */
  private _crossSeatAndRegister(
    session: AgentSession,
    tableId: string,
    entry: { store: GameStore; orch: IExternalOrchestrator; tokens: number },
  ): void {
    session.botTableId = tableId;

    // Cross-seat into bot store
    try {
      joinTable({
        tableId,
        agentId:        session.agentId,
        capabilities:   session.agent.capabilities,
        initial_tokens: entry.tokens,
      }, entry.store);
    } catch {
      // Already seated — fine, agent persists across sessions
    }

    // Register decide function with orchestrator
    const self = this;
    const agentId = session.agentId;

    const decide = (_ctx: unknown): Promise<ExternalDecision> => {
      return new Promise<ExternalDecision>((resolve, reject) => {
        // Cancel any leftover pending decision from a previous hand
        if (session.pendingDecision) {
          clearTimeout(session.pendingDecision.timer);
          session.pendingDecision.reject(new Error("superseded by new turn"));
          session.pendingDecision = null;
        }

        // 30-second auto-fold timeout
        const timer = setTimeout(() => {
          if (session.pendingDecision) {
            session.pendingDecision = null;
            resolve({ action: "fold", confidence: 0, reasoning: "timeout 30s" });
          }
        }, EXTERNAL_TIMEOUT_MS);

        session.pendingDecision = { resolve, reject, timer };

        // Flush queued events (your_turn was already enqueued by _onStoreUpdate)
        self._flushQueue(session);
      });
    };

    entry.orch.registerExternalAgent(agentId, decide);
  }

  /** Find the registered bot table with the most available seat space. */
  private _findBestBotTable(): string | undefined {
    let bestId: string | undefined;
    let bestSpace = 0;
    for (const [tableId, { store }] of this._botTables) {
      const record = store.getTable(tableId);
      if (!record) continue;
      const space = record.config.maxPlayers - record.state.seats.length;
      if (space > bestSpace) { bestSpace = space; bestId = tableId; }
    }
    return bestId;
  }

  /**
   * Resolve the orchestrator's pending decision with the action the agent just sent.
   * Returns an action_result event instead of applying the action directly
   * (the orchestrator will apply it via processAction).
   */
  private _resolveDecision(session: AgentSession, decision: ExternalDecision): PollEvent {
    const pending = session.pendingDecision!;
    clearTimeout(pending.timer);
    session.pendingDecision = null;
    pending.resolve(decision);
    return { event: "action_result", success: true, message: "Action submitted to game" };
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
      this._flushQueue(session);
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
      pot:             state.mainPot,
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

    // Min-raise = at least the size of the last raise, or 1 big blind
    const lastRaise = (state as unknown as Record<string, unknown>)["lastRaiseAmount"] as number | undefined ?? record.config.bigBlind;
    const minRaise  = callAmount + Math.max(lastRaise, record.config.bigBlind);

    return {
      event:        "your_turn",
      tableId,
      agentId:      seat.agentId,
      handNumber:   state.handNumber,
      phase:        state.phase,
      board:        state.board,
      // Canonical field names (agent-friendly)
      holeCards:    [...seat.holeCards],
      pot:          state.mainPot,
      callAmount,
      minRaise,
      validActions,
      // Legacy aliases kept for backward compat
      myHoleCards:  [...seat.holeCards],
      myStack:      seat.stack,
      myCurrentBet: seat.currentBet,
      mainPot:      state.mainPot,
      sidePots:     state.sidePots,
      currentBet:   state.currentBet,
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
  // Poll helpers
  // -------------------------------------------------------------------------

  /** Flush queued events to a waiting long-poll response if one is pending. */
  private _flushQueue(session: AgentSession): void {
    if (session.resolve && session.queue.length > 0) {
      const all     = session.queue.splice(0);
      const resolve = session.resolve;
      clearTimeout(session.pollTimer!);
      session.resolve   = null;
      session.pollTimer = null;
      resolve(all);
    }
  }

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  private _closeSession(sessionId: string): void {
    const session = this._sessions.get(sessionId);
    if (!session) return;

    if (session.pollTimer)       clearTimeout(session.pollTimer);
    if (session.resolve)         session.resolve([]);
    if (session.pendingDecision) {
      clearTimeout(session.pendingDecision.timer);
      session.pendingDecision.resolve({ action: "fold", confidence: 0, reasoning: "agent disconnected" });
    }

    if (session.botTableId) {
      const entry = this._botTables.get(session.botTableId);
      if (entry) entry.orch.unregisterExternalAgent(session.agentId);
    }

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

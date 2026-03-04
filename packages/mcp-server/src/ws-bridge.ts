/**
 * PokerCrawl — WebSocket Bridge
 *
 * Broadcasts game events to connected UI clients whenever the game state changes.
 * Clients subscribe by connecting to ws://host:port/
 *
 * Message format:
 * {
 *   type: 'game_update' | 'agent_action' | 'phase_change' | 'showdown' | 'chat'
 *   tableId: string
 *   data: unknown
 *   timestamp: number
 * }
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { TableRecord } from "./game-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WSEventType =
  | "game_update"
  | "agent_action"
  | "phase_change"
  | "showdown"
  | "chat"
  | "error";

export interface WSEvent {
  type: WSEventType;
  tableId: string;
  data: unknown;
  timestamp: number;
}

/** Minimal card representation sent over the wire (no engine-internal fields). */
export interface CardSnapshot {
  rank: string;
  suit: string;
  value: number;
}

/** Per-seat snapshot — hole cards are intentionally excluded for privacy. */
export interface SeatSnapshot {
  agentId: string;
  stack: number;
  currentBet: number;
  totalBet: number;
  status: string;
  hasActedThisRound: boolean;
}

/**
 * Full game snapshot broadcast to UI clients after each action.
 * Contains everything the UI needs to render the table without
 * any server-side secrets (no hole cards, no deck).
 */
export interface LiveSnapshot {
  phase: string;
  handNumber: number;
  mainPot: number;
  sidePots: Array<{ amount: number; eligibleAgents: string[] }>;
  currentBet: number;
  lastRaiseAmount: number;
  dealerIndex: number;
  actionOnIndex: number;
  seats: SeatSnapshot[];
  board: {
    flop: CardSnapshot[];
    turn: CardSnapshot | null;
    river: CardSnapshot | null;
  };
  winners: Array<{ agentId: string; amountWon: number; handRank?: string }>;
  lastAction?: { agentId: string; type: string; amount: number };
}

// ---------------------------------------------------------------------------
// WsBridge
// ---------------------------------------------------------------------------

export class WsBridge {
  private wss: WebSocketServer | null = null;
  private port: number;
  private maxClients: number;

  constructor(port = 3001, options?: { maxClients?: number }) {
    this.port       = port;
    this.maxClients = options?.maxClients ?? 100;
  }

  private _log(msg: string): void {
    console.log(`[${new Date().toISOString()}] INFO  [WsBridge] ${msg}`);
  }

  private _warn(msg: string): void {
    console.warn(`[${new Date().toISOString()}] WARN  [WsBridge] ${msg}`);
  }

  /** Start the WebSocket server. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port });
        this.wss.on("listening", () => {
          this._log(`Listening on port ${this.port} (max ${this.maxClients} clients)`);
          resolve();
        });
        this.wss.on("error", (err) => {
          console.error(`[${new Date().toISOString()}] ERROR [WsBridge] ${err.message}`);
          reject(err);
        });
        this.wss.on("connection", (ws) => {
          if (this.wss!.clients.size > this.maxClients) {
            this._warn(`Connection limit reached (${this.maxClients}) — rejecting client`);
            ws.close(1013, "Too many connections");
            return;
          }
          this._log(`Client connected (${this.wss!.clients.size}/${this.maxClients})`);
          ws.on("close", () => this._log(`Client disconnected (${this.wss!.clients.size - 1}/${this.maxClients})`));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Attach to an existing HTTP server at `path`.
   * Use instead of `start()` when embedding in a unified server.
   * The `port` constructor argument is ignored when using this method.
   */
  attachToServer(server: HttpServer, wsPath: string): void {
    if (this.wss) return; // already active
    this.wss = new WebSocketServer({ server, path: wsPath });
    this.wss.on("connection", (ws) => {
      if (this.wss!.clients.size > this.maxClients) {
        this._warn(`Connection limit reached (${this.maxClients}) — rejecting client`);
        ws.close(1013, "Too many connections");
        return;
      }
      this._log(`UI client connected via ${wsPath} (${this.wss!.clients.size}/${this.maxClients})`);
      ws.on("close", () =>
        this._log(`UI client disconnected (${this.wss!.clients.size - 1}/${this.maxClients})`),
      );
    });
    this._log(`Attached UI bridge at path ${wsPath}`);
  }

  /** Stop the WebSocket server. */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }
      this.wss.close(() => {
        this.wss = null;
        resolve();
      });
    });
  }

  /** Broadcast a typed event to all connected clients. */
  broadcast(event: WSEvent): void {
    if (!this.wss) return;
    const payload = JSON.stringify(event);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  /** Convenience: broadcast a full game_update when the state changes. */
  broadcastStateUpdate(tableId: string, record: TableRecord): void {
    // Emit the most recent engine event (if any) as the event type
    const lastEvent = record.state.events[record.state.events.length - 1];

    const eventType: WSEventType =
      lastEvent?.type === "phase-changed"
        ? "phase_change"
        : lastEvent?.type === "showdown-result"
          ? "showdown"
          : lastEvent?.type === "action-taken"
            ? "agent_action"
            : "game_update";

    this.broadcast({
      type: eventType,
      tableId,
      data: {
        phase: record.state.phase,
        handNumber: record.state.handNumber,
        mainPot: record.state.mainPot,
        actionOnIndex: record.state.actionOnIndex,
        lastEvent: lastEvent ?? null,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast a rich snapshot of the full table state.
   * Replaces broadcastStateUpdate for richer UI updates.
   *
   * @param lastAction  The action that just occurred (optional).
   */
  broadcastFullSnapshot(
    tableId: string,
    record: TableRecord,
    lastAction?: { agentId: string; type: string; amount: number }
  ): void {
    const state = record.state;

    const mapCard = (c: { rank: string; suit: string; value: number }): CardSnapshot => ({
      rank: c.rank,
      suit: c.suit,
      value: c.value,
    });

    const snapshot: LiveSnapshot = {
      phase: state.phase,
      handNumber: state.handNumber,
      mainPot: state.mainPot,
      sidePots: state.sidePots.map((sp) => ({
        amount: sp.amount,
        eligibleAgents: [...sp.eligibleAgents],
      })),
      currentBet: state.currentBet,
      lastRaiseAmount: state.lastRaiseAmount,
      dealerIndex: state.dealerIndex,
      actionOnIndex: state.actionOnIndex,
      seats: state.seats.map((s) => ({
        agentId: s.agentId,
        stack: s.stack,
        currentBet: s.currentBet,
        totalBet: s.totalBet,
        status: s.status,
        hasActedThisRound: s.hasActedThisRound,
      })),
      board: {
        flop: state.board.flop.map(mapCard),
        turn: state.board.turn ? mapCard(state.board.turn) : null,
        river: state.board.river ? mapCard(state.board.river) : null,
      },
      winners: state.winners.map((w) => ({
        agentId: w.agentId,
        amountWon: w.amountWon,
        ...(w.hand !== null && { handRank: w.hand.rank }),
      })),
      ...(lastAction !== undefined && { lastAction }),
    };

    const lastEvent = state.events[state.events.length - 1];
    const eventType: WSEventType =
      lastEvent?.type === "phase-changed"
        ? "phase_change"
        : lastEvent?.type === "showdown-result"
          ? "showdown"
          : lastEvent?.type === "action-taken"
            ? "agent_action"
            : "game_update";

    this.broadcast({
      type: eventType,
      tableId,
      data: snapshot,
      timestamp: Date.now(),
    });
  }

  /** Broadcast a chat message. */
  broadcastChat(tableId: string, agentId: string, message: string): void {
    this.broadcast({
      type: "chat",
      tableId,
      data: { agentId, message },
      timestamp: Date.now(),
    });
  }

  get clientCount(): number {
    return this.wss?.clients.size ?? 0;
  }
}

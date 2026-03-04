/**
 * PokerCrawl MCP Server — Game Store
 *
 * Central registry of all active tables. Provides the bridge between the
 * stateless MCP tools/resources and the mutable GameState managed by the engine.
 */

import {
  createGame,
  createSeat,
  startHand as engineStartHand,
  type GameState,
} from "@pokercrawl/engine";

// ---------------------------------------------------------------------------
// Domain types for the store layer
// ---------------------------------------------------------------------------

export interface TableConfig {
  smallBlind: number;
  bigBlind: number;
  minPlayers: number;
  maxPlayers: number;
}

export interface AgentMeta {
  capabilities: readonly string[];
  joinedAt: number;
}

export interface TaskResult {
  agentId: string;
  taskId: string;
  result: string;
  evidence?: string;
  submittedAt: number;
}

export interface ChatMessage {
  agentId: string;
  message: string;
  timestamp: number;
}

export interface TableRecord {
  state: GameState;
  config: TableConfig;
  /** Metadata that lives outside the engine's GameState */
  agents: Map<string, AgentMeta>;
  taskResults: TaskResult[];
  chatLog: ChatMessage[];
}

// ---------------------------------------------------------------------------
// Default table config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TableConfig = {
  smallBlind: 5,
  bigBlind: 10,
  minPlayers: 2,
  maxPlayers: 9,
};

// ---------------------------------------------------------------------------
// GameStore
// ---------------------------------------------------------------------------

export class GameStore {
  private readonly tables = new Map<string, TableRecord>();

  /** Listeners called whenever a table's state changes. */
  private readonly listeners: Array<(tableId: string, record: TableRecord) => void> = [];

  // -------------------------------------------------------------------------
  // Table lifecycle
  // -------------------------------------------------------------------------

  /** Create a new empty table. Throws if tableId already exists. */
  createTable(tableId: string, config: Partial<TableConfig> = {}): TableRecord {
    if (this.tables.has(tableId)) {
      throw new Error(`Table "${tableId}" already exists`);
    }
    const fullConfig: TableConfig = { ...DEFAULT_CONFIG, ...config };
    const state = createGame({
      agents: [], // seats are added dynamically via addAgent()
      smallBlind: fullConfig.smallBlind,
      bigBlind: fullConfig.bigBlind,
    });
    const record: TableRecord = {
      state,
      config: fullConfig,
      agents: new Map(),
      taskResults: [],
      chatLog: [],
    };
    this.tables.set(tableId, record);
    return record;
  }

  /** Get a table record or undefined. */
  getTable(tableId: string): TableRecord | undefined {
    return this.tables.get(tableId);
  }

  /** Get a table record or throw if missing. */
  requireTable(tableId: string): TableRecord {
    const record = this.tables.get(tableId);
    if (!record) throw new Error(`Table "${tableId}" not found`);
    return record;
  }

  /** List all table IDs. */
  listTableIds(): string[] {
    return [...this.tables.keys()];
  }

  // -------------------------------------------------------------------------
  // Agent management
  // -------------------------------------------------------------------------

  /**
   * Add an agent to an existing table.
   * Creates a seat with the given token stack.
   * Auto-starts the first hand if the table now has ≥ minPlayers.
   */
  addAgent(
    tableId: string,
    agentId: string,
    capabilities: string[],
    tokens: number
  ): void {
    const record = this.requireTable(tableId);

    if (record.agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" is already seated at table "${tableId}"`);
    }
    if (record.agents.size >= record.config.maxPlayers) {
      throw new Error(`Table "${tableId}" is full (${record.config.maxPlayers} players)`);
    }

    // Push a new seat to the engine GameState
    const seat = createSeat(agentId, tokens);
    record.state.seats.push(seat);
    record.agents.set(agentId, { capabilities, joinedAt: Date.now() });

    // Auto-start first hand once minimum players are seated
    if (
      record.state.seats.length >= record.config.minPlayers &&
      record.state.phase === "waiting"
    ) {
      this.startHand(tableId);
    } else {
      this.notify(tableId, record);
    }
  }

  // -------------------------------------------------------------------------
  // Hand management
  // -------------------------------------------------------------------------

  /** Start a new hand at the given table, optionally overriding blind/ante levels. */
  startHand(
    tableId: string,
    blindOverride?: { smallBlind?: number; bigBlind?: number; ante?: number }
  ): void {
    const record = this.requireTable(tableId);
    const activePlayers = record.state.seats.filter((s) => s.stack > 0);
    if (activePlayers.length < record.config.minPlayers) {
      throw new Error(
        `Need at least ${record.config.minPlayers} players with chips to start a hand`
      );
    }
    const sb = blindOverride?.smallBlind ?? record.config.smallBlind;
    const bb = blindOverride?.bigBlind ?? record.config.bigBlind;
    const ante = blindOverride?.ante ?? 0;
    engineStartHand(record.state, sb, bb, ante);
    this.notify(tableId, record);
  }

  /**
   * If the current phase is "settlement", automatically start the next hand
   * (provided there are still enough players with chips).
   * Call this from betting tools to enable seamless multi-hand play.
   */
  maybeRestartHand(tableId: string): void {
    const record = this.requireTable(tableId);
    if (record.state.phase !== "settlement") return;
    const canPlay = record.state.seats.filter((s) => s.stack > 0).length;
    if (canPlay >= record.config.minPlayers) {
      this.startHand(tableId);
    }
  }

  /**
   * Remove an agent from a table.
   * If the agent is currently the acting player, their seat is folded so the
   * hand can continue. Their remaining stack is forfeited (cash-game refunds
   * should be handled at the lobby layer before calling this).
   */
  removeAgent(tableId: string, agentId: string): void {
    const record = this.requireTable(tableId);
    if (!record.agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" is not seated at table "${tableId}"`);
    }

    const seatIdx = record.state.seats.findIndex((s) => s.agentId === agentId);
    if (seatIdx >= 0) {
      const seat = record.state.seats[seatIdx]!;
      // Fold active seat so the betting round can close naturally
      if (seat.status === "active") {
        seat.status = "folded";
        seat.hasActedThisRound = true;
      }
      // Zero stack — engine skips 0-chip seats on next startHand
      seat.stack = 0;
    }

    record.agents.delete(agentId);
    this.notify(tableId, record);
  }

  // -------------------------------------------------------------------------
  // Chat / task results
  // -------------------------------------------------------------------------

  addChat(tableId: string, agentId: string, message: string): ChatMessage {
    const record = this.requireTable(tableId);
    const entry: ChatMessage = { agentId, message, timestamp: Date.now() };
    record.chatLog.push(entry);
    this.notify(tableId, record);
    return entry;
  }

  submitTaskResult(
    tableId: string,
    agentId: string,
    taskId: string,
    result: string,
    evidence?: string
  ): TaskResult {
    const record = this.requireTable(tableId);
    const entry: TaskResult = {
      agentId,
      taskId,
      result,
      submittedAt: Date.now(),
      ...(evidence !== undefined ? { evidence } : {}),
    };
    record.taskResults.push(entry);
    this.notify(tableId, record);
    return entry;
  }

  // -------------------------------------------------------------------------
  // Notification / change listeners
  // -------------------------------------------------------------------------

  /** Register a listener to be called whenever a table's state changes. */
  onUpdate(listener: (tableId: string, record: TableRecord) => void): void {
    this.listeners.push(listener);
  }

  /** Manually trigger a notification (called by tools after processAction). */
  notify(tableId: string, record: TableRecord): void {
    for (const listener of this.listeners) {
      listener(tableId, record);
    }
  }
}

// Singleton instance used by the server (tests create their own instance)
export const globalStore = new GameStore();

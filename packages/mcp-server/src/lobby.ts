/**
 * PokerCrawl — Lobby
 *
 * Manages named tables with richer metadata than raw GameStore provides:
 * display name, game type, buy-in bounds, privacy, and rolling average pot.
 *
 * The Lobby is a thin coordination layer on top of GameStore — it never
 * touches engine state directly; all game logic stays in the store.
 */

import type { GameStore } from "./game-store.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GameType    = "cash" | "tournament" | "sit-n-go";
export type TableStatus = "waiting" | "playing" | "paused";

/** Public view of a table — no passwords. */
export interface TableInfo {
  id: string;
  name: string;
  blinds: { small: number; big: number };
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  currentPlayers: number;
  avgPotSize: number;
  handsPlayed: number;
  type: GameType;
  status: TableStatus;
  isPrivate: boolean;
}

/** Config provided when creating a lobby table. */
export interface LobbyTableConfig {
  name: string;
  blinds: { small: number; big: number };
  maxSeats: number;
  type: GameType;
  buyIn: { min: number; max: number };
  isPrivate: boolean;
  password?: string;
  allowRealAgents: boolean;
  allowSimulatedBots: boolean;
}

/** Agent descriptor for lobby-level join validation. */
export interface AgentJoinRequest {
  agentId: string;
  capabilities: string[];
  buyIn: number;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

interface LobbyMeta {
  name: string;
  blinds: { small: number; big: number };
  buyIn: { min: number; max: number };
  maxSeats: number;
  type: GameType;
  isPrivate: boolean;
  password: string | undefined;
  allowRealAgents: boolean;
  allowSimulatedBots: boolean;
  createdAt: number;
  /** Rolling average pot tracking. */
  potHistory: { total: number; count: number };
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export class Lobby {
  private readonly store: GameStore;
  private readonly meta = new Map<string, LobbyMeta>();
  /** Peak pot seen so far in the current hand, per table. */
  private readonly peakPot = new Map<string, number>();

  constructor(store: GameStore) {
    this.store = store;

    // Track peak pot per hand to build a rolling average
    store.onUpdate((tableId, record) => {
      if (!this.meta.has(tableId)) return;
      const pot = record.state.mainPot;
      if (pot > (this.peakPot.get(tableId) ?? 0)) {
        this.peakPot.set(tableId, pot);
      }
      // When a new hand begins (phase resets to "preflop"), commit the peak
      // from the previous hand.  We detect this by checking handNumber change
      // via a stored value on the meta.
      const m = this.meta.get(tableId);
      if (m && record.state.phase === "preflop") {
        const prev = this.peakPot.get(tableId) ?? 0;
        if (prev > 0) {
          m.potHistory.total += prev;
          m.potHistory.count++;
          this.peakPot.set(tableId, 0);
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Table lifecycle
  // -------------------------------------------------------------------------

  /**
   * Create a new named table and register it in the lobby.
   * Returns the generated tableId.
   */
  createTable(config: LobbyTableConfig): string {
    if (config.maxSeats < 2 || config.maxSeats > 8) {
      throw new Error("maxSeats must be between 2 and 8");
    }
    if (config.buyIn.min <= 0 || config.buyIn.max < config.buyIn.min) {
      throw new Error("Invalid buy-in range: min must be > 0 and max ≥ min");
    }
    if (config.blinds.small <= 0 || config.blinds.big < config.blinds.small) {
      throw new Error("Invalid blinds: small must be > 0 and big ≥ small");
    }

    const tableId = _generateId(config.name);

    this.store.createTable(tableId, {
      smallBlind: config.blinds.small,
      bigBlind:   config.blinds.big,
      maxPlayers: config.maxSeats,
    });

    this.meta.set(tableId, {
      name:               config.name,
      blinds:             config.blinds,
      buyIn:              config.buyIn,
      maxSeats:           config.maxSeats,
      type:               config.type,
      isPrivate:          config.isPrivate,
      password:           config.password,
      allowRealAgents:    config.allowRealAgents,
      allowSimulatedBots: config.allowSimulatedBots,
      createdAt:          Date.now(),
      potHistory:         { total: 0, count: 0 },
    });

    this.peakPot.set(tableId, 0);
    return tableId;
  }

  // -------------------------------------------------------------------------
  // Listing
  // -------------------------------------------------------------------------

  /** List all public tables (private tables are included but password omitted). */
  listTables(): TableInfo[] {
    const result: TableInfo[] = [];
    for (const [id] of this.meta) {
      const info = this.getTableInfo(id);
      if (info) result.push(info);
    }
    return result;
  }

  /** Get public info for one table, or undefined if not found. */
  getTableInfo(tableId: string): TableInfo | undefined {
    const m = this.meta.get(tableId);
    if (!m) return undefined;

    const record = this.store.getTable(tableId);
    if (!record) return undefined;

    const currentPlayers = record.agents.size;
    const handsPlayed    = record.state.handNumber;

    const status: TableStatus =
      record.state.phase === "waiting" || record.state.phase === "settlement"
        ? "waiting"
        : "playing";

    const avgPotSize =
      m.potHistory.count > 0
        ? Math.round(m.potHistory.total / m.potHistory.count)
        : 0;

    return {
      id: tableId,
      name:           m.name,
      blinds:         m.blinds,
      minBuyIn:       m.buyIn.min,
      maxBuyIn:       m.buyIn.max,
      maxSeats:       m.maxSeats,
      currentPlayers,
      avgPotSize,
      handsPlayed,
      type:           m.type,
      status,
      isPrivate:      m.isPrivate,
    };
  }

  // -------------------------------------------------------------------------
  // Join / leave
  // -------------------------------------------------------------------------

  /**
   * Join a lobby table.
   * Validates password (if private), buy-in range, and seat availability.
   */
  joinTable(tableId: string, agent: AgentJoinRequest, password?: string): void {
    const m = this.meta.get(tableId);
    if (!m) throw new Error(`Table "${tableId}" not found in lobby`);

    if (m.isPrivate && m.password !== undefined && m.password !== password) {
      throw new Error("Incorrect table password");
    }

    if (agent.buyIn < m.buyIn.min) {
      throw new Error(
        `Buy-in ${agent.buyIn} is below the minimum (${m.buyIn.min})`
      );
    }
    if (agent.buyIn > m.buyIn.max) {
      throw new Error(
        `Buy-in ${agent.buyIn} exceeds the maximum (${m.buyIn.max})`
      );
    }

    const record = this.store.requireTable(tableId);
    if (record.agents.size >= m.maxSeats) {
      throw new Error(
        `Table "${tableId}" is full (${m.maxSeats} / ${m.maxSeats} seats)`
      );
    }

    this.store.addAgent(tableId, agent.agentId, agent.capabilities, agent.buyIn);
  }

  /**
   * Remove an agent from a lobby table.
   * Best called between hands; mid-hand removal folds the seat automatically.
   */
  leaveTable(tableId: string, agentId: string): void {
    if (!this.meta.has(tableId)) {
      throw new Error(`Table "${tableId}" not found in lobby`);
    }
    this.store.removeAgent(tableId, agentId);
  }

  /** True if the tableId was created through this lobby. */
  hasTable(tableId: string): boolean {
    return this.meta.has(tableId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _generateId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${slug}-${suffix}`;
}

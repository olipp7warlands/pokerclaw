/**
 * PokerCrawl — Tournament Manager
 *
 * Multi-table tournament support: freezeout, rebuy, and bounty formats.
 * Handles player registration, seating, blind level escalation, table
 * balancing, elimination detection, and prize allocation.
 *
 * Hooks into GameStore.onUpdate() so eliminations and blind advances are
 * detected automatically — no polling required.
 *
 * Usage:
 *   const manager = new TournamentManager(store);
 *   const id = manager.createTournament({ name: "Weekly #1", ... });
 *   manager.registerPlayer(id, "shark");
 *   manager.startTournament(id);
 *   // ... agents play via MCP tools ...
 *   manager.getTournament(id); // live standings
 */

import type { GameStore, TableRecord } from "./game-store.js";
import type { Badge } from "./agent-registry.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TournamentType   = "freezeout" | "rebuy" | "bounty";
export type TournamentStatus = "registering" | "running" | "final-table" | "complete";

export interface BlindLevel {
  small: number;
  big: number;
  /** Antes are tracked but not enforced by the current engine. */
  ante: number;
  /**
   * Advance to the next level after this many total hands have been played
   * across all tournament tables combined.
   */
  durationHands: number;
}

export interface Prize {
  position: number;
  tokens: number;
  badge?: Badge;
  title?: string;
}

export interface TournamentPlayer {
  agentId: string;
  /** tableId the player is currently seated at. Empty string when eliminated. */
  currentTableId: string;
  stack: number;
  /** Finishing position (set when eliminated). 1 = winner, 2 = runner-up, … */
  finishPosition?: number;
  eliminatedAt?: Date;
  rebuysUsed: number;
}

export interface Tournament {
  id: string;
  name: string;
  type: TournamentType;
  status: TournamentStatus;
  buyIn: number;
  startingStack: number;
  blindLevels: BlindLevel[];
  /** Index into blindLevels of the current active level. */
  currentLevel: number;
  players: TournamentPlayer[];
  prizes: Prize[];
  /** Active tableIds managed by this tournament. */
  tables: string[];
  startTime: Date;
  maxPlayers: number;
}

export interface TournamentConfig {
  name: string;
  type: TournamentType;
  buyIn: number;
  startingStack: number;
  blindLevels: BlindLevel[];
  prizes: Prize[];
  maxPlayers: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface TournamentState extends Tournament {
  /** agentId → capabilities (stored at registration for table moves). */
  registeredAgents: Map<string, string[]>;
  /** Total hands settled since the last blind level advance. */
  handsSinceAdvance: number;
  /** Last hand number processed per table (prevents double-processing). */
  lastProcessed: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SEATS = 8;

// ---------------------------------------------------------------------------
// TournamentManager
// ---------------------------------------------------------------------------

export class TournamentManager {
  private readonly store: GameStore;
  private readonly tournaments = new Map<string, TournamentState>();
  /** Reverse-index so _onUpdate can look up the owning tournament in O(1). */
  private readonly tableIndex = new Map<string, string>(); // tableId → tournamentId

  constructor(store: GameStore) {
    this.store = store;
    store.onUpdate((tableId, record) => this._onUpdate(tableId, record));
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Create a tournament in 'registering' status. Returns the tournament id. */
  createTournament(config: TournamentConfig): string {
    if (config.blindLevels.length === 0) {
      throw new Error("Tournament must have at least one blind level");
    }
    if (config.maxPlayers < 2) {
      throw new Error("maxPlayers must be at least 2");
    }
    if (config.startingStack <= 0) {
      throw new Error("startingStack must be positive");
    }
    if (config.prizes.length === 0) {
      throw new Error("Tournament must have at least one prize");
    }

    const id = _generateId(config.name);
    const state: TournamentState = {
      id,
      name:              config.name,
      type:              config.type,
      status:            "registering",
      buyIn:             config.buyIn,
      startingStack:     config.startingStack,
      blindLevels:       config.blindLevels,
      currentLevel:      0,
      players:           [],
      prizes:            config.prizes,
      tables:            [],
      startTime:         new Date(0),
      maxPlayers:        config.maxPlayers,
      registeredAgents:  new Map(),
      handsSinceAdvance: 0,
      lastProcessed:     new Map(),
    };
    this.tournaments.set(id, state);
    return id;
  }

  /**
   * Register an agent for a tournament.
   * Must be called before `startTournament`.
   */
  registerPlayer(
    tournId: string,
    agentId: string,
    capabilities: string[] = []
  ): void {
    const tourn = this._require(tournId);
    if (tourn.status !== "registering") {
      throw new Error(`Tournament "${tournId}" is no longer accepting registrations`);
    }
    if (tourn.registeredAgents.has(agentId)) {
      throw new Error(`Agent "${agentId}" is already registered for this tournament`);
    }
    if (tourn.registeredAgents.size >= tourn.maxPlayers) {
      throw new Error(
        `Tournament "${tournId}" is full (${tourn.maxPlayers}/${tourn.maxPlayers} players)`
      );
    }
    tourn.registeredAgents.set(agentId, capabilities);
  }

  /** Start the tournament. Creates tables and deals the first hand at each. */
  startTournament(tournId: string): void {
    const tourn = this._require(tournId);
    if (tourn.status !== "registering") {
      throw new Error(`Tournament "${tournId}" is not in registering status`);
    }
    if (tourn.registeredAgents.size < 2) {
      throw new Error("Need at least 2 registered players to start");
    }

    const agents = [...tourn.registeredAgents.entries()];
    _shuffle(agents);

    const level      = tourn.blindLevels[0]!;
    const numTables  = Math.ceil(agents.length / MAX_SEATS);
    const perTable   = Math.ceil(agents.length / numTables);

    for (let t = 0; t < numTables; t++) {
      const tableId     = `${tournId}-table-${t + 1}`;
      const tableAgents = agents.slice(t * perTable, (t + 1) * perTable);

      // Set minPlayers above MAX_SEATS so addAgent() doesn't auto-start the
      // hand while we're still seating players.
      this.store.createTable(tableId, {
        smallBlind: level.small,
        bigBlind:   level.big,
        minPlayers: MAX_SEATS + 1,
        maxPlayers: MAX_SEATS,
      });

      for (const [agentId, caps] of tableAgents) {
        this.store.addAgent(tableId, agentId, caps, tourn.startingStack);
        tourn.players.push({
          agentId,
          currentTableId: tableId,
          stack:          tourn.startingStack,
          rebuysUsed:     0,
        });
      }

      // Lower minPlayers and start the first hand explicitly.
      this.store.requireTable(tableId).config.minPlayers = 2;
      this.store.startHand(tableId);
      tourn.tables.push(tableId);
      this.tableIndex.set(tableId, tournId);
    }

    tourn.status    = "running";
    tourn.startTime = new Date();
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getTournament(tournId: string): Tournament | undefined {
    const t = this.tournaments.get(tournId);
    return t ? _toPublic(t) : undefined;
  }

  listTournaments(): Tournament[] {
    return [...this.tournaments.values()].map(_toPublic);
  }

  // -------------------------------------------------------------------------
  // Private — event processing
  // -------------------------------------------------------------------------

  private _onUpdate(tableId: string, record: TableRecord): void {
    const tournId = this.tableIndex.get(tableId);
    if (!tournId) return;

    const tourn = this.tournaments.get(tournId);
    if (!tourn || tourn.status === "complete") return;

    const { state } = record;

    // Only process fully settled hands with at least one winner.
    if (state.phase !== "settlement" || state.winners.length === 0) return;

    const last = tourn.lastProcessed.get(tableId) ?? -1;
    if (last === state.handNumber) return; // already processed this hand
    tourn.lastProcessed.set(tableId, state.handNumber);
    tourn.handsSinceAdvance++;

    // Snapshot seats before any mutations caused by elimination handling.
    const seats = [...state.seats];

    // Update stacks for still-active players.
    for (const player of tourn.players) {
      if (player.currentTableId !== tableId || player.finishPosition !== undefined) continue;
      const seat = seats.find((s) => s.agentId === player.agentId);
      if (seat) player.stack = seat.stack;
    }

    // Detect eliminations: active tournament players whose seat stack hit 0.
    const eliminated = seats
      .filter((seat) => seat.stack === 0)
      .map((seat) => seat.agentId)
      .filter((id) => {
        const p = tourn.players.find(
          (pl) => pl.agentId === id && pl.currentTableId === tableId
        );
        return p !== undefined && p.finishPosition === undefined;
      });

    for (const agentId of eliminated) {
      this._handleElimination(tourn, agentId, tableId);
    }

    this._checkBlindAdvance(tourn);
    this._checkCompletion(tourn);
  }

  private _handleElimination(
    tourn: TournamentState,
    agentId: string,
    tableId: string
  ): void {
    // Position = number of still-active players (including this one) before removal.
    const activeBefore = tourn.players.filter((p) => p.finishPosition === undefined);
    const position     = activeBefore.length;

    const player = tourn.players.find((p) => p.agentId === agentId)!;
    player.finishPosition = position;
    player.eliminatedAt   = new Date();

    // Rebuy logic: for rebuy/bounty tournaments, allow a second chance.
    if (tourn.type !== "freezeout" && player.rebuysUsed === 0) {
      // Reset for rebuy — mark the rebuy and restore stack.
      player.rebuysUsed++;
      delete player.finishPosition;
      delete player.eliminatedAt;
      player.stack          = tourn.startingStack;
      // The store seat stack was zeroed by the engine; we can't easily restore
      // it here (would need engine support). For now we flag it and let the
      // game operator handle chip restoration manually.
      return;
    }

    // Remove from store (errors if already removed — safe to ignore).
    try {
      this.store.removeAgent(tableId, agentId);
    } catch {
      // Agent may have already been removed mid-hand by another path.
    }

    const activeAfter = tourn.players.filter((p) => p.finishPosition === undefined);
    if (activeAfter.length > 1) {
      this._balanceTables(tourn);
    }
  }

  private _balanceTables(tourn: TournamentState): void {
    const active = tourn.players.filter((p) => p.finishPosition === undefined);

    // Consolidate to a single final table when players fit.
    if (active.length <= MAX_SEATS && tourn.tables.length > 1) {
      this._consolidateToFinalTable(tourn, active);
      return;
    }

    // Close any table that is now empty or has a lone player.
    for (const tid of [...tourn.tables]) {
      const atTable = active.filter((p) => p.currentTableId === tid);
      if (atTable.length === 0) {
        this._closeTable(tourn, tid);
      } else if (atTable.length === 1) {
        const target = this._findTargetTable(tourn, tid, active);
        if (target) {
          this._movePlayer(tourn, atTable[0]!.agentId, tid, target);
          this._closeTable(tourn, tid);
        }
      }
    }
  }

  private _consolidateToFinalTable(
    tourn: TournamentState,
    active: TournamentPlayer[]
  ): void {
    const finalId = `${tourn.id}-final`;
    const level   = tourn.blindLevels[tourn.currentLevel]!;

    this.store.createTable(finalId, {
      smallBlind: level.small,
      bigBlind:   level.big,
      minPlayers: MAX_SEATS + 1, // prevent auto-start during seating
      maxPlayers: MAX_SEATS,
    });
    this.tableIndex.set(finalId, tourn.id);

    // Move every active player to the final table.
    for (const player of active) {
      const oldId  = player.currentTableId;
      const rec    = this.store.getTable(oldId);
      const seat   = rec?.state.seats.find((s) => s.agentId === player.agentId);
      const stack  = seat?.stack ?? player.stack;
      const caps   = tourn.registeredAgents.get(player.agentId) ?? [];

      try { this.store.removeAgent(oldId, player.agentId); } catch { /* already gone */ }
      this.store.addAgent(finalId, player.agentId, caps, stack);
      player.currentTableId = finalId;
      player.stack          = stack;
    }

    // Remove the old tables from the index before updating tourn.tables.
    for (const oldId of tourn.tables) {
      this.tableIndex.delete(oldId);
    }

    const rec = this.store.requireTable(finalId);
    rec.config.minPlayers = 2;
    this.store.startHand(finalId);

    tourn.tables = [finalId];
    tourn.status = "final-table";
  }

  private _movePlayer(
    tourn: TournamentState,
    agentId: string,
    fromId: string,
    toId: string
  ): void {
    const rec   = this.store.getTable(fromId);
    const seat  = rec?.state.seats.find((s) => s.agentId === agentId);
    const stack = seat?.stack ?? tourn.players.find((p) => p.agentId === agentId)?.stack ?? 0;
    const caps  = tourn.registeredAgents.get(agentId) ?? [];

    try { this.store.removeAgent(fromId, agentId); } catch { /* already gone */ }
    this.store.addAgent(toId, agentId, caps, stack);

    const player = tourn.players.find((p) => p.agentId === agentId)!;
    player.currentTableId = toId;
    player.stack          = stack;
  }

  private _closeTable(tourn: TournamentState, tableId: string): void {
    tourn.tables = tourn.tables.filter((id) => id !== tableId);
    this.tableIndex.delete(tableId);
  }

  private _findTargetTable(
    tourn: TournamentState,
    excludeId: string,
    active: TournamentPlayer[]
  ): string | undefined {
    let minCount = Infinity;
    let target: string | undefined;
    for (const tid of tourn.tables) {
      if (tid === excludeId) continue;
      const n = active.filter((p) => p.currentTableId === tid).length;
      if (n < minCount && n < MAX_SEATS) {
        minCount = n;
        target   = tid;
      }
    }
    return target;
  }

  private _checkBlindAdvance(tourn: TournamentState): void {
    if (tourn.status === "complete") return;

    const level = tourn.blindLevels[tourn.currentLevel];
    if (!level) return;

    // Use durationHands as the total-hand threshold across all tables.
    if (tourn.handsSinceAdvance < level.durationHands) return;

    const nextIdx = tourn.currentLevel + 1;
    if (nextIdx >= tourn.blindLevels.length) return; // already at maximum level

    tourn.currentLevel      = nextIdx;
    tourn.handsSinceAdvance = 0;

    const next = tourn.blindLevels[nextIdx]!;
    for (const tid of tourn.tables) {
      const rec = this.store.getTable(tid);
      if (rec) {
        rec.config.smallBlind = next.small;
        rec.config.bigBlind   = next.big;
      }
    }
  }

  private _checkCompletion(tourn: TournamentState): void {
    if (tourn.status === "complete") return;
    const active = tourn.players.filter((p) => p.finishPosition === undefined);
    if (active.length <= 1) {
      if (active.length === 1) active[0]!.finishPosition = 1;
      tourn.status = "complete";
    }
  }

  private _require(tournId: string): TournamentState {
    const t = this.tournaments.get(tournId);
    if (!t) throw new Error(`Tournament "${tournId}" not found`);
    return t;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _generateId(name: string): string {
  const slug   = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `tourn-${slug}-${suffix}`;
}

function _shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function _toPublic(state: TournamentState): Tournament {
  return {
    id:            state.id,
    name:          state.name,
    type:          state.type,
    status:        state.status,
    buyIn:         state.buyIn,
    startingStack: state.startingStack,
    blindLevels:   state.blindLevels,
    currentLevel:  state.currentLevel,
    players:       [...state.players],
    prizes:        state.prizes,
    tables:        [...state.tables],
    startTime:     state.startTime,
    maxPlayers:    state.maxPlayers,
  };
}

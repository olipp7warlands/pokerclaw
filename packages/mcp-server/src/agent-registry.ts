/**
 * PokerCrawl — Agent Registry
 *
 * Persistent cross-game agent profiles. Tracks stats, ELO ratings, and
 * awards badges as agents play. Hooks into GameStore.onUpdate() so stats
 * update automatically with no extra calls needed from the game loop.
 *
 * Usage:
 *   const registry = new AgentRegistry();
 *   registry.attachToStore(store);   // auto-tracks every hand
 *   registry.registerAgent({ id: "shark", name: "El Tiburón", type: "simulated" });
 *   // ... play hands ...
 *   registry.getProfile("shark");    // { elo, stats, badges, … }
 */

import type { GameStore, TableRecord } from "./game-store.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AgentType = "claude" | "openai" | "openclaw" | "simulated" | "custom";

export type Badge =
  | "first-hand"       // Played their first hand
  | "shark"            // Won 100+ hands
  | "bluff-master"     // ≥80% bluff success rate with ≥10 attempts
  | "rock-solid"       // 50 consecutive hands without an early fold
  | "high-roller"      // Won a single pot of 1000+ tokens
  | "comeback-kid"     // Won after stack dropped below 10% of starting
  | "tournament-winner"// Won a sit-n-go / tournament
  | "elo-1500"         // Reached 1500 ELO
  | "all-in-survivor"  // Survived 5 all-in situations
  | "table-captain"    // Chip leader for 20+ consecutive hands
  | "silent-assassin"  // Won a hand without using table-talk
  | "trash-talker"     // 100+ table-talk messages sent
  | "molt-veteran";    // Verified Molt ecosystem agent (manual)

export interface AgentStats {
  handsPlayed: number;
  handsWon: number;
  /** Win percentage 0–100. */
  winRate: number;
  totalTokensWon: number;
  totalTokensLost: number;
  /** Highest single pot won. */
  biggestPot: number;
  /** Showdown win percentage 0–100. */
  showdownWinRate: number;
  /**
   * Heuristic: % of aggressive actions (raise/bet) that resulted in winning
   * without a showdown (opponent folded). Proxy for bluff effectiveness.
   */
  bluffSuccessRate: number;
  /** Average finishing position in tournaments (lower = better). 0 if no tournaments. */
  averagePosition: number;
  /** Current consecutive-win streak. */
  currentStreak: number;
  /** All-time best consecutive-win streak. */
  bestStreak: number;
}

export interface AgentProfile {
  id: string;
  name: string;
  type: AgentType;
  /** Emoji or image URL. */
  avatar: string;
  /** Current ELO rating (starts at 1200). */
  elo: number;
  stats: AgentStats;
  badges: Badge[];
  joinedAt: Date;
  lastSeen: Date;
}

// ---------------------------------------------------------------------------
// Internal tracking
// ---------------------------------------------------------------------------

/** Per-agent progress counters not directly in AgentStats. */
interface BadgeProgress {
  consecutiveWins: number;
  allInSurvivals: number;
  /** Consecutive hands as chip leader across ALL tables. */
  consecutiveChipLeader: number;
  /** Total table-talk messages (cumulative across sessions). */
  totalChatMessages: number;
  /** Number of times the agent raised/bet this session. */
  bluffAttempts: number;
  /** Raised/bet and won without showdown. */
  successfulBluffs: number;
  /** Consecutive hands without an early fold (≤ preflop fold). */
  handsWithoutEarlyFold: number;
  showdowns: number;
  showdownWins: number;
}

/** State captured at hand start, consumed at settlement. */
interface HandContext {
  handNumber: number;
  /** Stack each agent had at the start of the hand. */
  startStacks: Record<string, number>;
  /**
   * Minimum stack each agent reached during the hand.
   * Updated on every onUpdate tick while the hand is in progress.
   */
  minStacks: Record<string, number>;
  /** Agents who used all-in this hand. */
  allInActors: Set<string>;
  /** Agents who raised or bet this hand. */
  aggressiveActors: Set<string>;
  /** Chat log length per agent at hand start, used for silent-assassin. */
  chatCountAtStart: Record<string, number>;
}

// ---------------------------------------------------------------------------
// ELO constants
// ---------------------------------------------------------------------------

const K = 32;

function _expected(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

// ---------------------------------------------------------------------------
// AgentRegistry
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private readonly profiles  = new Map<string, AgentProfile>();
  private readonly progress  = new Map<string, BadgeProgress>();
  /** tableId → per-hand context. */
  private readonly handCtx   = new Map<string, HandContext>();
  /** tableId → last hand number fully processed. */
  private readonly lastDone  = new Map<string, number>();
  /** agentId → consecutive hands as chip leader (all tables combined). */
  private readonly chipStreak = new Map<string, number>();

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a new agent profile, or return the existing one if already known.
   * Auto-registration also happens when the agent appears in a store hand.
   */
  registerAgent(params: {
    id: string;
    name: string;
    type: AgentType;
    avatar?: string;
  }): AgentProfile {
    const existing = this.profiles.get(params.id);
    if (existing) return existing;

    const profile: AgentProfile = {
      id:       params.id,
      name:     params.name,
      type:     params.type,
      avatar:   params.avatar ?? _defaultAvatar(params.type),
      elo:      1200,
      stats:    _emptyStats(),
      badges:   [],
      joinedAt: new Date(),
      lastSeen: new Date(),
    };
    this.profiles.set(params.id, profile);
    this.progress.set(params.id, _emptyProgress());
    return profile;
  }

  getProfile(id: string): AgentProfile | undefined {
    return this.profiles.get(id);
  }

  /** All profiles sorted by ELO descending. */
  listProfiles(): AgentProfile[] {
    return [...this.profiles.values()].sort((a, b) => b.elo - a.elo);
  }

  /**
   * Manually award a badge (e.g. "molt-veteran", "tournament-winner").
   * No-op if already held.
   */
  awardBadge(agentId: string, badge: Badge): void {
    const profile = this.profiles.get(agentId);
    if (!profile) throw new Error(`Agent "${agentId}" not registered`);
    _grantBadge(profile, badge);
  }

  // -------------------------------------------------------------------------
  // Store integration
  // -------------------------------------------------------------------------

  /** Hook into a GameStore so every completed hand updates stats automatically. */
  attachToStore(store: GameStore): void {
    store.onUpdate((tableId, record) => this._onUpdate(tableId, record));
  }

  // -------------------------------------------------------------------------
  // Private — event processing
  // -------------------------------------------------------------------------

  private _onUpdate(tableId: string, record: TableRecord): void {
    const { state } = record;

    // ── 1. Capture hand context at preflop start ───────────────────────────
    const existingCtx = this.handCtx.get(tableId);
    if (
      state.phase === "preflop" &&
      existingCtx?.handNumber !== state.handNumber
    ) {
      const startStacks: Record<string, number> = {};
      const chatCountAtStart: Record<string, number> = {};

      for (const seat of state.seats) {
        const { agentId } = seat;
        startStacks[agentId] = seat.stack;

        // Auto-register unseen agents
        if (!this.profiles.has(agentId)) {
          this.registerAgent({ id: agentId, name: agentId, type: "simulated" });
        }

        chatCountAtStart[agentId] =
          record.chatLog.filter((m) => m.agentId === agentId).length;
      }

      this.handCtx.set(tableId, {
        handNumber:       state.handNumber,
        startStacks,
        minStacks:        { ...startStacks },
        allInActors:      new Set(),
        aggressiveActors: new Set(),
        chatCountAtStart,
      });
    }

    const ctx = this.handCtx.get(tableId);
    if (!ctx || ctx.handNumber !== state.handNumber) return;

    // ── 2. Track min stacks during the hand (needed for comeback-kid) ──────
    if (state.phase !== "waiting" && state.phase !== "settlement") {
      for (const seat of state.seats) {
        const cur = ctx.minStacks[seat.agentId] ?? Infinity;
        if (seat.stack < cur) ctx.minStacks[seat.agentId] = seat.stack;
      }
    }

    // ── 3. Process completed hand at settlement ────────────────────────────
    if (
      state.phase === "settlement" &&
      state.winners.length > 0 &&
      (this.lastDone.get(tableId) ?? -1) !== state.handNumber
    ) {
      this._processHand(tableId, record, ctx);
      this.lastDone.set(tableId, state.handNumber);
    }
  }

  private _processHand(
    tableId: string,
    record: TableRecord,
    ctx: HandContext
  ): void {
    const { state } = record;
    const winnerIds = new Set(state.winners.map((w) => w.agentId));
    // If every WinnerResult.hand is null, it was a fold (no showdown)
    const wentToShowdown = state.winners.some((w) => w.hand !== null);

    // Scan action-taken events for all-in and aggressive actors
    for (const event of state.events) {
      if (event.type !== "action-taken") continue;
      const agentId = event.payload["agentId"] as string | undefined;
      const action  = event.payload["type"]    as string | undefined;
      if (!agentId || !action) continue;
      if (action === "all-in") ctx.allInActors.add(agentId);
      if (action === "raise" || action === "bet") ctx.aggressiveActors.add(agentId);
    }

    // ELO update (pairwise: each winner beats each loser)
    const losers = state.seats
      .map((s) => s.agentId)
      .filter((id) => !winnerIds.has(id));
    this._updateElo([...winnerIds], losers);

    // Per-seat stat + badge update
    for (const seat of state.seats) {
      const { agentId } = seat;
      const profile = this.profiles.get(agentId);
      const prog    = this.progress.get(agentId);
      if (!profile || !prog) continue;

      profile.lastSeen = new Date();
      const { stats } = profile;
      const isWinner = winnerIds.has(agentId);

      // Basic counts
      stats.handsPlayed++;
      if (isWinner) stats.handsWon++;
      stats.winRate = _pct(stats.handsWon, stats.handsPlayed);

      // Tokens won / lost
      if (isWinner) {
        const won = state.winners
          .filter((w) => w.agentId === agentId)
          .reduce((s, w) => s + w.amountWon, 0);
        stats.totalTokensWon += won;
        if (won > stats.biggestPot) stats.biggestPot = won;
      }
      const startStack = ctx.startStacks[agentId] ?? 0;
      const endStack   = seat.stack;
      const net        = endStack - startStack;
      if (net < 0) stats.totalTokensLost += -net;

      // Showdown win rate
      const agentFolded = seat.status === "folded" && !isWinner;
      if (wentToShowdown && !agentFolded) {
        prog.showdowns++;
        if (isWinner) prog.showdownWins++;
        stats.showdownWinRate = _pct(prog.showdownWins, prog.showdowns);
      }

      // Win streak
      if (isWinner) {
        prog.consecutiveWins++;
        stats.currentStreak = prog.consecutiveWins;
        if (prog.consecutiveWins > stats.bestStreak) {
          stats.bestStreak = prog.consecutiveWins;
        }
      } else {
        prog.consecutiveWins = 0;
        stats.currentStreak  = 0;
      }

      // Bluff success rate
      if (ctx.aggressiveActors.has(agentId)) {
        prog.bluffAttempts++;
        if (isWinner && !wentToShowdown) prog.successfulBluffs++;
        stats.bluffSuccessRate = _pct(prog.successfulBluffs, prog.bluffAttempts);
      }

      // All-in survival
      if (ctx.allInActors.has(agentId) && seat.stack > 0) {
        prog.allInSurvivals++;
      }

      // Chat messages (cumulative)
      prog.totalChatMessages =
        record.chatLog.filter((m) => m.agentId === agentId).length;

      // Early-fold streak (for rock-solid)
      // "Early fold" = folded before reaching showdown when not obviously beat
      const foldedEarly =
        seat.status === "folded" &&
        !wentToShowdown &&
        !isWinner;
      if (foldedEarly) {
        prog.handsWithoutEarlyFold = 0;
      } else {
        prog.handsWithoutEarlyFold++;
      }

      // Chip leader tracking (for table-captain)
      const chipLeader = [...state.seats].sort((a, b) => b.stack - a.stack)[0];
      if (chipLeader?.agentId === agentId) {
        const s = (this.chipStreak.get(agentId) ?? 0) + 1;
        this.chipStreak.set(agentId, s);
        if (s >= 20) _grantBadge(profile, "table-captain");
      } else {
        this.chipStreak.set(agentId, 0);
      }

      // ── Badge: comeback-kid ──────────────────────────────────────────────
      if (isWinner && startStack > 0) {
        const minStack = ctx.minStacks[agentId] ?? startStack;
        if (minStack / startStack < 0.10) {
          _grantBadge(profile, "comeback-kid");
        }
      }

      // ── Badge: silent-assassin ───────────────────────────────────────────
      if (isWinner) {
        const chatBefore = ctx.chatCountAtStart[agentId] ?? 0;
        const chatNow    = prog.totalChatMessages;
        if (chatNow === chatBefore) {
          _grantBadge(profile, "silent-assassin");
        }
      }

      // ── Threshold badges ─────────────────────────────────────────────────
      this._checkThresholds(profile, prog);
    }
  }

  private _updateElo(winners: string[], losers: string[]): void {
    for (const wId of winners) {
      const wP = this.profiles.get(wId);
      if (!wP) continue;
      for (const lId of losers) {
        const lP = this.profiles.get(lId);
        if (!lP) continue;
        const we = _expected(wP.elo, lP.elo);
        const le = _expected(lP.elo, wP.elo);
        wP.elo = Math.round(Math.max(100, wP.elo + K * (1 - we)));
        lP.elo = Math.round(Math.max(100, lP.elo + K * (0 - le)));
      }
    }
  }

  private _checkThresholds(profile: AgentProfile, prog: BadgeProgress): void {
    const { stats } = profile;
    if (stats.handsPlayed >= 1)  _grantBadge(profile, "first-hand");
    if (stats.handsWon >= 100)   _grantBadge(profile, "shark");
    if (stats.biggestPot >= 1000) _grantBadge(profile, "high-roller");
    if (profile.elo >= 1500)     _grantBadge(profile, "elo-1500");
    if (prog.allInSurvivals >= 5) _grantBadge(profile, "all-in-survivor");
    if (prog.totalChatMessages >= 100) _grantBadge(profile, "trash-talker");
    if (prog.handsWithoutEarlyFold >= 50) _grantBadge(profile, "rock-solid");
    if (
      prog.bluffAttempts >= 10 &&
      prog.successfulBluffs / prog.bluffAttempts >= 0.8
    ) {
      _grantBadge(profile, "bluff-master");
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function _pct(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 100) : 0;
}

function _grantBadge(profile: AgentProfile, badge: Badge): void {
  if (!profile.badges.includes(badge)) profile.badges.push(badge);
}

function _defaultAvatar(type: AgentType): string {
  const map: Record<AgentType, string> = {
    claude:    "🤖",
    openai:    "🧠",
    openclaw:  "🦞",
    simulated: "🎲",
    custom:    "🎭",
  };
  return map[type];
}

function _emptyStats(): AgentStats {
  return {
    handsPlayed:      0,
    handsWon:         0,
    winRate:          0,
    totalTokensWon:   0,
    totalTokensLost:  0,
    biggestPot:       0,
    showdownWinRate:  0,
    bluffSuccessRate: 0,
    averagePosition:  0,
    currentStreak:    0,
    bestStreak:       0,
  };
}

function _emptyProgress(): BadgeProgress {
  return {
    consecutiveWins:       0,
    allInSurvivals:        0,
    consecutiveChipLeader: 0,
    totalChatMessages:     0,
    bluffAttempts:         0,
    successfulBluffs:      0,
    handsWithoutEarlyFold: 0,
    showdowns:             0,
    showdownWins:          0,
  };
}

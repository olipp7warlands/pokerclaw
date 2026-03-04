/**
 * AgentOrchestrator
 *
 * Drives the betting loop for a table of registered BaseAgent instances.
 * Uses the engine's processAction directly (bypassing MCP tools) to avoid
 * auto-restart side-effects from maybeRestartHand.
 *
 * Events emitted:
 *   decision      — { agentId, decision } — every time an agent acts
 *   timeout       — { agentId }           — when a decision times out
 *   error         — { agentId, error }    — when decide() rejects
 *   hand_complete — HandResult            — when a hand reaches settlement
 *   chat          — { agentId, message }  — when an agent sends table talk
 */

import { EventEmitter } from "node:events";
import { processAction } from "@pokercrawl/engine";
import type { GameState, PlayerAction as EngineAction } from "@pokercrawl/engine";
import { GameStore } from "@pokercrawl/mcp-server";
import type { TableRecord } from "@pokercrawl/mcp-server";

import { BaseAgent } from "./base-agent.js";
import type {
  AgentDecision,
  BlindLevel,
  GameConfig,
  HandResult,
  OpponentInfo,
  StrategyContext,
  TablePosition,
  TournamentResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Phases where agents must take betting actions. */
const BETTING_PHASES = new Set(["preflop", "flop", "turn", "river"]);

const DEFAULT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Typed event declarations (interface merging)
// ---------------------------------------------------------------------------

export declare interface AgentOrchestrator {
  on(
    event: "decision",
    listener: (data: { agentId: string; decision: AgentDecision }) => void
  ): this;
  on(event: "timeout", listener: (data: { agentId: string }) => void): this;
  on(event: "agent_error", listener: (data: { agentId: string; error: unknown }) => void): this;
  on(event: "hand_complete", listener: (result: HandResult) => void): this;
  on(event: "chat", listener: (data: { agentId: string; message: string }) => void): this;

  emit(
    event: "decision",
    data: { agentId: string; decision: AgentDecision }
  ): boolean;
  emit(event: "timeout", data: { agentId: string }): boolean;
  emit(event: "agent_error", data: { agentId: string; error: unknown }): boolean;
  emit(event: "hand_complete", result: HandResult): boolean;
  emit(event: "chat", data: { agentId: string; message: string }): boolean;
}

// ---------------------------------------------------------------------------
// AgentOrchestrator
// ---------------------------------------------------------------------------

export class AgentOrchestrator extends EventEmitter {
  private readonly agents = new Map<string, BaseAgent>();
  private readonly initialTokens = new Map<string, number>();
  private readonly store: GameStore;
  private readonly config: GameConfig;
  private started = false;

  constructor(store: GameStore, config: GameConfig) {
    super();
    this.store = store;
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /** Register an agent. Must be called before setup() / playHand(). */
  registerAgent(agent: BaseAgent, tokens?: number): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent "${agent.id}" is already registered`);
    }
    this.agents.set(agent.id, agent);
    this.initialTokens.set(agent.id, tokens ?? this.config.startingTokens ?? 1000);
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  /**
   * Create the table and seat all registered agents.
   * Idempotent — safe to call multiple times; only runs once.
   */
  async setup(): Promise<void> {
    if (this.started) return;

    if (!this.store.getTable(this.config.tableId)) {
      this.store.createTable(this.config.tableId, {
        smallBlind: this.config.smallBlind,
        bigBlind: this.config.bigBlind,
      });
    }

    for (const [agentId] of this.agents) {
      const tokens = this.initialTokens.get(agentId) ?? 1000;
      this.store.addAgent(this.config.tableId, agentId, [], tokens);
    }

    this.started = true;
  }

  // -------------------------------------------------------------------------
  // Play
  // -------------------------------------------------------------------------

  /**
   * Play one complete hand.
   * Calls setup() automatically on first invocation.
   * Returns a HandResult once the hand reaches a non-betting phase.
   */
  async playHand(
    opts: { decisionTimeoutMs?: number; smallBlind?: number; bigBlind?: number; ante?: number } = {}
  ): Promise<HandResult> {
    await this.setup();

    const timeoutMs =
      opts.decisionTimeoutMs ?? this.config.decisionTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const record = this.store.requireTable(this.config.tableId);
    const state = record.state;

    // Ensure a hand is in a betting phase; start one if not.
    if (!BETTING_PHASES.has(state.phase)) {
      this.store.startHand(this.config.tableId, {
        ...(opts.smallBlind !== undefined ? { smallBlind: opts.smallBlind } : {}),
        ...(opts.bigBlind !== undefined ? { bigBlind: opts.bigBlind } : {}),
        ...(opts.ante !== undefined ? { ante: opts.ante } : {}),
      });
    }

    // Main betting loop — runs until the engine exits all betting phases.
    while (BETTING_PHASES.has(state.phase)) {
      const actorSeat = state.seats[state.actionOnIndex];

      // Safety: no valid actor (engine invariant violation)
      if (!actorSeat) break;

      // Safety: skip seats that should not be acting (folded / all-in)
      if (actorSeat.status === "folded" || actorSeat.status === "all-in") break;

      const agentId = actorSeat.agentId;
      const agent = this.agents.get(agentId);

      let decision: AgentDecision;
      if (!agent) {
        decision = {
          action: "fold",
          reasoning: `No registered agent for seat "${agentId}"`,
          confidence: 0,
        };
      } else {
        const context = this._buildContext(agentId, record);
        decision = await this._requestDecision(agent, context, timeoutMs);
      }

      this.emit("decision", { agentId, decision });

      if (decision.tableTalk) {
        this.store.addChat(this.config.tableId, agentId, decision.tableTalk);
        this.emit("chat", { agentId, message: decision.tableTalk });
      }

      this._applyDecision(state, record, agentId, decision);
    }

    const result = this._collectResult(record);
    this.emit("hand_complete", result);
    return result;
  }

  /**
   * Play up to maxHands hands or until only one agent has chips.
   * Returns overall tournament statistics.
   */
  async playTournament(
    maxHands = 100,
    opts: { decisionTimeoutMs?: number } = {}
  ): Promise<TournamentResult> {
    await this.setup();

    let handsPlayed = 0;
    const handsWon: Record<string, number> = {};

    for (let i = 0; i < maxHands; i++) {
      const record = this.store.requireTable(this.config.tableId);
      const activePlayers = record.state.seats.filter((s) => s.stack > 0);
      if (activePlayers.length < 2) break;

      const blindOverride = this._computeBlindLevel(handsPlayed);
      const result = await this.playHand({ ...opts, ...blindOverride });
      handsPlayed++;

      for (const w of result.winners) {
        handsWon[w.agentId] = (handsWon[w.agentId] ?? 0) + 1;
      }
    }

    // Collect final state
    const finalRecord = this.store.requireTable(this.config.tableId);
    const finalStacks: Record<string, number> = {};
    const eliminated: string[] = [];

    for (const seat of finalRecord.state.seats) {
      finalStacks[seat.agentId] = seat.stack;
      if (seat.stack === 0) eliminated.push(seat.agentId);
    }

    return { hands: handsPlayed, finalStacks, handsWon, eliminated };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _requestDecision(
    agent: BaseAgent,
    context: StrategyContext,
    timeoutMs: number
  ): Promise<AgentDecision> {
    try {
      const decisionPromise = agent.decide(context);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Decision timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
      );
      return await Promise.race([decisionPromise, timeoutPromise]);
    } catch (e) {
      this.emit("timeout", { agentId: agent.id });
      this.emit("agent_error", { agentId: agent.id, error: e });
      console.warn(
        `[Orchestrator] ${agent.id} timed out or errored — auto-folding:`,
        e instanceof Error ? e.message : e
      );
      return { action: "fold", reasoning: "auto-fold: timeout or error", confidence: 0 };
    }
  }

  private _applyDecision(
    state: GameState,
    record: TableRecord,
    agentId: string,
    decision: AgentDecision
  ): void {
    const seat = state.seats.find((s) => s.agentId === agentId);
    if (!seat) throw new Error(`No seat found for agent "${agentId}"`);

    // Map AgentDecision action → engine PlayerAction type + amount
    let engineType: EngineAction["type"];
    let amount: number;

    // ── Pre-sanitize: fix logically invalid actions before they hit the engine ──
    // 1. call when nothing to call → check
    const toCall = state.currentBet - seat.currentBet;
    let action = decision.action;
    if (action === "call" && toCall <= 0) action = "check";

    switch (action) {
      case "bet":
        // "bet" = open bet (currentBet === 0); engine uses "raise" for all bets
        engineType = "raise";
        amount = decision.amount ?? this.config.bigBlind * 2;
        break;
      case "raise": {
        engineType = "raise";
        // 2. Clamp raise-to amount: can't exceed what the seat can afford
        const maxRaiseTo = seat.currentBet + seat.stack;
        amount = Math.min(decision.amount ?? this.config.bigBlind * 2, maxRaiseTo);
        break;
      }
      case "call":
        engineType = "call";
        amount = Math.min(toCall, seat.stack);
        break;
      case "check":
        engineType = "check";
        amount = 0;
        break;
      case "all-in":
        engineType = "all-in";
        amount = seat.stack;
        break;
      case "fold":
      default:
        engineType = "fold";
        amount = 0;
        break;
    }

    try {
      processAction(state, { agentId, type: engineType, amount });
      this.store.notify(this.config.tableId, record);
    } catch (e) {
      // Invalid action — fold as safety net
      console.warn(
        `[Orchestrator] Invalid action "${decision.action}" for ${agentId}: ` +
          `${e instanceof Error ? e.message : e} — falling back to fold`
      );
      try {
        processAction(state, { agentId, type: "fold", amount: 0 });
        this.store.notify(this.config.tableId, record);
      } catch {
        // Even fold failed — engine is in an unexpected state, exit loop gracefully
      }
    }
  }

  private _buildContext(agentId: string, record: TableRecord): StrategyContext {
    const state = record.state;
    const mySeat = state.seats.find((s) => s.agentId === agentId);
    if (!mySeat) throw new Error(`Agent "${agentId}" is not seated at this table`);

    const seatIndex = state.seats.indexOf(mySeat);

    const communityCards = [
      ...state.board.flop,
      ...(state.board.turn ? [state.board.turn] : []),
      ...(state.board.river ? [state.board.river] : []),
    ];

    const position = this._computePosition(
      seatIndex,
      state.dealerIndex,
      state.seats.length
    );

    const opponents: OpponentInfo[] = state.seats
      .filter((s) => s.agentId !== agentId)
      .map((s) => ({
        id: s.agentId,
        stack: s.stack,
        currentBet: s.currentBet,
        totalBet: s.totalBet,
        isFolded: s.status === "folded",
        isAllIn: s.status === "all-in",
      }));

    const eventHistory = state.events.map((e) => {
      const agentId = e.payload["agentId"] as string | undefined;
      const amount  = e.payload["amount"]  as number | undefined;
      return {
        type: e.type,
        ...(agentId !== undefined && { agentId }),
        ...(amount  !== undefined && { amount }),
      };
    });

    return {
      agentId,
      tableId: this.config.tableId,
      myHand: mySeat.holeCards,
      communityCards,
      potSize: state.mainPot,
      sidePots: state.sidePots,
      myStack: mySeat.stack,
      myCurrentBet: mySeat.currentBet,
      currentBet: state.currentBet,
      lastRaiseSize: state.lastRaiseAmount,
      phase: state.phase,
      opponents,
      position,
      isMyTurn: seatIndex === state.actionOnIndex,
      smallBlind: record.config.smallBlind,
      bigBlind: record.config.bigBlind,
      eventHistory,
    };
  }

  private _computePosition(
    seatIndex: number,
    dealerIndex: number,
    numSeats: number
  ): TablePosition {
    const relative = (seatIndex - dealerIndex + numSeats) % numSeats;
    if (relative === 0) return "late"; // dealer button = late position
    if (relative === 1 || relative === 2) return "blinds"; // SB / BB
    const third = Math.ceil(numSeats / 3);
    if (relative <= third) return "early";
    if (relative <= 2 * third) return "middle";
    return "late";
  }

  /**
   * Compute the blind/ante override for the current hand based on the blind schedule.
   * Returns an empty object if no blind schedule is configured.
   */
  private _computeBlindLevel(
    handsPlayed: number
  ): { smallBlind?: number; bigBlind?: number; ante?: number } {
    const schedule = this.config.blindSchedule;
    const every = this.config.blindIncreaseEvery;
    if (!schedule || schedule.length === 0 || !every || every <= 0) return {};
    const levelIndex = Math.min(Math.floor(handsPlayed / every), schedule.length - 1);
    const level = schedule[levelIndex]!;
    return { smallBlind: level.small, bigBlind: level.big, ante: level.ante ?? 0 };
  }

  private _collectResult(record: TableRecord): HandResult {
    const state = record.state;
    const winners = state.winners.map((w) => ({
      agentId: w.agentId,
      amountWon: w.amountWon,
      hand: w.hand?.rank ?? null,
    }));

    return {
      handNumber: state.handNumber,
      winner: winners[0]?.agentId ?? null,
      winners,
      totalPot: state.winners.reduce((sum, w) => sum + w.amountWon, 0),
      phase: state.phase,
    };
  }
}

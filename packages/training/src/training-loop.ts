/**
 * Training Loop
 *
 * Two entry points:
 *
 *   TrainingLoop.run(N, config)       — simple N-hand session (backward compat)
 *   TrainingLoop.trainBots(N, config) — full adaptive training with per-chunk
 *                                       strategy adjustment, snapshots and report
 *
 * CLI: npx pokercrawl-train --hands=10000 --bots=5 --save
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

import type { GameState, CapabilityCard, TaskCard } from "@pokercrawl/engine";
import { GameStore } from "@pokercrawl/mcp-server";
import {
  AgentOrchestrator,
  AggressiveBot,
  BlufferBot,
  CalculatedBot,
  ConservativeBot,
  RandomBot,
  WolfBot,
  OwlBot,
  TurtleBot,
  FoxBot,
  DEFAULT_PERSONALITY,
  BaseAgent,
} from "@pokercrawl/agents";
import type {
  AgentPersonality,
  AgentDecision,
  StrategyContext,
  ActionType,
} from "@pokercrawl/agents";

import { HandHistoryDb } from "./hand-history-db.js";
import type { HandAction, HandRecord, AgentStats } from "./hand-history-db.js";
import { EloRating } from "./elo-rating.js";
import type { AgentRating } from "./elo-rating.js";
import { OpponentModel } from "./opponent-model.js";
import { StrategyLearner } from "./strategy-learner.js";
import type { StrategyRecommendation, HandOutcome } from "./strategy-learner.js";
import { getPosition } from "./position-evaluator.js";

// ─── Types — TrainingConfig ───────────────────────────────────────────────────

export interface TrainingConfig {
  tableId?: string;
  smallBlind?: number;
  bigBlind?: number;
  startingTokens?: number;
  decisionTimeoutMs?: number;
  /** Personality overrides per agent id. */
  personalities?: Record<string, Partial<AgentPersonality>>;
  // ── trainBots() options ──────────────────────────────────────────────────
  /** Number of bots at the table (2–6, default 5). */
  bots?: number;
  /** Adjust personality every N hands (default 50). */
  adjustEvery?: number;
  /** Snapshot strategies every N hands (default 200). */
  snapshotEvery?: number;
  /** Print progress to stdout (default false). */
  verbose?: boolean;
  /** Path to write strategies.json after training. Null = don't save. */
  savePath?: string | null;
  /** Called after each adjustEvery-hand chunk with live progress data. */
  onProgress?: (progress: TrainingProgress) => void;
}

// ─── Types — live progress ────────────────────────────────────────────────────

export interface BiggestPot {
  handNumber: number;
  amount: number;
  winnerId: string;
  loserId: string;
}

export interface TrainingProgress {
  handsPlayed: number;
  totalHands: number;
  eloRankings: AgentRating[];
  currentPersonalities: Record<string, AgentPersonality>;
  initialPersonalities: Record<string, AgentPersonality>;
  biggestPot: BiggestPot | null;
  elapsedMs: number;
}

// ─── Types — run() output ─────────────────────────────────────────────────────

/** Simple result returned by TrainingLoop.run() — backward compatible. */
export interface TrainingResult {
  handsPlayed: number;
  agentStats: Record<string, AgentStats>;
  eloRankings: AgentRating[];
  recommendations: StrategyRecommendation[];
}

// ─── Types — trainBots() output ───────────────────────────────────────────────

export interface StackSnapshot {
  handNumber: number;
  /** Virtual cumulative stack: startingTokens + totalProfit (not per-chunk). */
  stacks: Record<string, number>;
}

export interface StrategySnapshot {
  handNumber: number;
  personalities: Record<string, Partial<AgentPersonality>>;
  eloRatings: Record<string, number>;
}

export interface ActionStats {
  count: number;
  totalProfit: number;
  avgProfit: number;
}

export interface AgentReport {
  totalDecisions: number;
  byAction: Record<string, ActionStats>;
  bestAction: { action: string; avgProfit: number };
  worstAction: { action: string; avgProfit: number };
  /** Net personality drift: initial → final. */
  personalityDrift: Partial<AgentPersonality>;
}

export interface DecisionReport {
  perAgent: Record<string, AgentReport>;
  overallBestAction: { agentId: string; action: string; avgProfit: number };
  overallWorstAction: { agentId: string; action: string; avgProfit: number };
}

/** Full report returned by TrainingLoop.trainBots(). */
export interface TrainingReport {
  handsPlayed: number;
  agentStats: Record<string, AgentStats>;
  eloRankings: AgentRating[];
  recommendations: StrategyRecommendation[];
  /** Per-hand stack evolution (virtual cumulative). */
  stackHistory: StackSnapshot[];
  /** Periodic strategy snapshots. */
  snapshots: StrategySnapshot[];
  /** Decision profitability breakdown. */
  decisionReport: DecisionReport;
  /** Final personalities after all adjustments. */
  finalPersonalities: Record<string, AgentPersonality>;
  durationMs: number;
}

// ─── Bot pool ─────────────────────────────────────────────────────────────────

// Full 9-bot pool — slice to config.bots at runtime
const BOT_POOL: ReadonlyArray<{
  id: string;
  make: (id: string, tableId: string, personality: AgentPersonality) => BaseAgent;
}> = [
  { id: "shark",  make: (id, t, p) => new AggressiveBot ({ id, tableId: t, personality: p }) },
  { id: "rock",   make: (id, t, p) => new ConservativeBot({ id, tableId: t, personality: p }) },
  { id: "mago",   make: (id, t, p) => new BlufferBot     ({ id, tableId: t, personality: p }) },
  { id: "caos",   make: (id, t, p) => new RandomBot      ({ id, tableId: t, personality: p }) },
  { id: "reloj",  make: (id, t, p) => new CalculatedBot  ({ id, tableId: t, personality: p }) },
  { id: "wolf",   make: (id, t, p) => new WolfBot        ({ id, tableId: t, personality: p }) },
  { id: "owl",    make: (id, t, p) => new OwlBot         ({ id, tableId: t, personality: p }) },
  { id: "turtle", make: (id, t, p) => new TurtleBot      ({ id, tableId: t, personality: p }) },
  { id: "fox",    make: (id, t, p) => new FoxBot         ({ id, tableId: t, personality: p }) },
];

const AGENT_IDS = ["shark", "rock", "mago", "caos", "reloj"] as const;

// ─── TrainingLoop ─────────────────────────────────────────────────────────────

export class TrainingLoop {
  private readonly db: HandHistoryDb;
  private readonly elo: EloRating;
  private readonly model: OpponentModel;
  private readonly learner: StrategyLearner;

  constructor(db?: HandHistoryDb) {
    this.db = db ?? new HandHistoryDb();
    this.elo = new EloRating();
    this.model = new OpponentModel(this.db);
    this.learner = new StrategyLearner();
  }

  // ── Simple run (backward compatible) ───────────────────────────────────────

  /**
   * Play up to numHands hands with the 5 standard bots.
   * No mid-session strategy adjustment — use trainBots() for that.
   */
  async run(numHands: number, config: TrainingConfig = {}): Promise<TrainingResult> {
    const tableId          = config.tableId          ?? "training-table";
    const smallBlind       = config.smallBlind       ?? 5;
    const bigBlind         = config.bigBlind         ?? 10;
    const startingTokens   = config.startingTokens   ?? 500;
    const decisionTimeoutMs = config.decisionTimeoutMs ?? 5_000;

    const store = new GameStore();
    const orch = new AgentOrchestrator(store, {
      tableId, smallBlind, bigBlind, startingTokens, decisionTimeoutMs,
    });

    orch.registerAgent(new AggressiveBot (_agentCfg("shark", tableId, config)));
    orch.registerAgent(new ConservativeBot(_agentCfg("rock",  tableId, config)));
    orch.registerAgent(new BlufferBot    (_agentCfg("mago",  tableId, config)));
    orch.registerAgent(new RandomBot     (_agentCfg("caos",  tableId, config)));
    orch.registerAgent(new CalculatedBot (_agentCfg("reloj", tableId, config)));

    let currentActions: HandAction[] = [];

    orch.on("decision", ({ agentId, decision }) => {
      const record = store.getTable(tableId);
      const phase = record?.state.phase ?? "unknown";
      const action: HandAction =
        decision.amount !== undefined
          ? { agentId, action: decision.action, phase, amount: decision.amount }
          : { agentId, action: decision.action, phase };
      currentActions.push(action);
    });

    await orch.setup();

    let handsPlayed = 0;

    for (let i = 0; i < numHands; i++) {
      const record = store.requireTable(tableId);
      if (record.state.seats.filter((s) => s.stack > 0).length < 2) break;

      const startStacks: Record<string, number> = {};
      for (const seat of record.state.seats) startStacks[seat.agentId] = seat.stack;
      currentActions = [];

      const result = await orch.playHand({ decisionTimeoutMs });
      handsPlayed++;

      const endRecord = store.requireTable(tableId);
      const endStacks: Record<string, number> = {};
      for (const seat of endRecord.state.seats) endStacks[seat.agentId] = seat.stack;

      this.db.addHand({
        handNumber: result.handNumber,
        timestamp: Date.now(),
        agents: [...AGENT_IDS],
        actions: currentActions,
        winners: result.winners,
        startStacks,
        endStacks,
        finalPhase: result.phase,
      });

      const winnerIds = result.winners.map((w) => w.agentId);
      const loserIds = endRecord.state.seats
        .map((s) => s.agentId)
        .filter((id) => !winnerIds.includes(id));
      this.elo.updateAfterHand(winnerIds, loserIds);
    }

    const agentStats: Record<string, AgentStats> = {};
    const recommendations: StrategyRecommendation[] = [];
    for (const agentId of AGENT_IDS) {
      const stats = this.db.computeStats(agentId);
      agentStats[agentId] = stats;
      recommendations.push(this.learner.analyze(agentId, stats));
    }

    return { handsPlayed, agentStats, eloRankings: this.elo.getRankings(), recommendations };
  }

  // ── Full adaptive training ─────────────────────────────────────────────────

  /**
   * Adaptive training session:
   *  - Plays numHands in adjustEvery-sized chunks
   *  - After each chunk: analyzes decisions → adjusts personality
   *  - Every snapshotEvery hands: snapshots strategies + ELO
   *  - Returns comprehensive TrainingReport
   */
  async trainBots(numHands: number, config: TrainingConfig = {}): Promise<TrainingReport> {
    const startTime        = Date.now();
    const tableId          = config.tableId          ?? "training-table";
    const smallBlind       = config.smallBlind       ?? 5;
    const bigBlind         = config.bigBlind         ?? 10;
    const startingTokens   = config.startingTokens   ?? 500;
    const decisionTimeoutMs = config.decisionTimeoutMs ?? 2_000;
    const adjustEvery      = config.adjustEvery      ?? 50;
    const snapshotEvery    = config.snapshotEvery    ?? 200;
    const verbose          = config.verbose          ?? false;
    const numBots          = Math.max(2, Math.min(9, config.bots ?? 5));

    // Select bots
    const botDefs = BOT_POOL.slice(0, numBots);
    const agentIds = botDefs.map((b) => b.id);

    // Initialize full personalities
    const currentPersonalities: Record<string, AgentPersonality> = {};
    const initialPersonalities: Record<string, AgentPersonality> = {};
    for (const { id } of botDefs) {
      const p: AgentPersonality = {
        ...DEFAULT_PERSONALITY,
        ...(config.personalities?.[id] ?? {}),
      };
      currentPersonalities[id] = p;
      initialPersonalities[id] = { ...p };
    }

    // Shared accumulation across chunks
    const db    = new HandHistoryDb();
    const elo   = new EloRating();
    const learner = new StrategyLearner();

    const stackHistory: StackSnapshot[] = [];
    const snapshots: StrategySnapshot[] = [];
    const decisionAcc = new Map<string, Map<string, { count: number; profit: number }>>();

    let handsPlayed = 0;
    let biggestPot: BiggestPot | null = null;

    if (verbose) _printHeader(agentIds, numHands, adjustEvery, snapshotEvery);

    // ── Main chunk loop ──────────────────────────────────────────────────────
    while (handsPlayed < numHands) {
      const handsThisChunk = Math.min(adjustEvery, numHands - handsPlayed);

      // Create fresh store + orch with CURRENT personalities for this chunk
      const store = new GameStore();
      const orch = new AgentOrchestrator(store, {
        tableId, smallBlind, bigBlind, startingTokens, decisionTimeoutMs,
      });
      for (const botDef of botDefs) {
        const personality = currentPersonalities[botDef.id] ?? DEFAULT_PERSONALITY;
        orch.registerAgent(botDef.make(botDef.id, tableId, personality));
      }
      await orch.setup();

      let currentActions: HandAction[] = [];

      orch.on("decision", ({ agentId, decision }) => {
        const record = store.getTable(tableId);
        if (record === undefined) return;
        const state = record.state;
        const phase = state.phase;

        const action: HandAction =
          decision.amount !== undefined
            ? { agentId, action: decision.action, phase, amount: decision.amount }
            : { agentId, action: decision.action, phase };
        currentActions.push(action);

        // Update opponent model in real-time
        const minCtx = _buildMinCtx(agentId, tableId, state, smallBlind, bigBlind);
        const actArg =
          decision.amount !== undefined
            ? { action: decision.action as ActionType, amount: decision.amount }
            : { action: decision.action as ActionType };
        learner.updateOpponentModel(agentId, actArg, minCtx);
      });

      // ── Per-hand inner loop ────────────────────────────────────────────────
      for (let i = 0; i < handsThisChunk; i++) {
        const record = store.requireTable(tableId);
        if (record.state.seats.filter((s) => s.stack > 0).length < 2) break;

        const startStacks: Record<string, number> = {};
        for (const seat of record.state.seats) startStacks[seat.agentId] = seat.stack;
        currentActions = [];
        learner.newHand();

        const result = await orch.playHand({ decisionTimeoutMs });
        handsPlayed++;

        const endRecord = store.requireTable(tableId);
        const endStacks: Record<string, number> = {};
        for (const seat of endRecord.state.seats) endStacks[seat.agentId] = seat.stack;

        const handRecord: HandRecord = {
          handNumber: result.handNumber,
          timestamp: Date.now(),
          agents: agentIds,
          actions: currentActions,
          winners: result.winners,
          startStacks,
          endStacks,
          finalPhase: result.phase,
        };

        db.addHand(handRecord);
        learner.recordHand(handRecord);

        // Track biggest pot (by amount won by a single winner)
        for (const w of result.winners) {
          if (biggestPot === null || w.amountWon > biggestPot.amount) {
            // Loser = agent who lost the most chips this hand
            let maxLoss = 0, loserId = "";
            for (const id of agentIds) {
              const loss = (startStacks[id] ?? 0) - (endStacks[id] ?? 0);
              if (loss > maxLoss) { maxLoss = loss; loserId = id; }
            }
            biggestPot = { handNumber: result.handNumber, amount: w.amountWon, winnerId: w.agentId, loserId };
          }
        }

        // analyzeDecision + accumulate report stats (step 3)
        const wentToShowdown =
          result.phase === "showdown" || result.phase === "settlement";
        for (const agentId of agentIds) {
          const outcome = _buildOutcome(agentId, handRecord, wentToShowdown);
          const agentActions = handRecord.actions.filter((a) => a.agentId === agentId);

          for (const a of agentActions) {
            const mockDecision: AgentDecision =
              a.amount !== undefined
                ? { action: a.action as ActionType, reasoning: "training", confidence: 0.5, amount: a.amount }
                : { action: a.action as ActionType, reasoning: "training", confidence: 0.5 };
            learner.analyzeDecision(mockDecision, outcome);

            // Accumulate for report
            const actionMap = decisionAcc.get(agentId) ?? new Map<string, { count: number; profit: number }>();
            const key = a.action;
            const prev = actionMap.get(key) ?? { count: 0, profit: 0 };
            actionMap.set(key, { count: prev.count + 1, profit: prev.profit + outcome.netAmount });
            decisionAcc.set(agentId, actionMap);
          }

          // WTSD for opponent model
          const folded = agentActions.some((a) => a.action === "fold");
          learner.recordShowdown(agentId, wentToShowdown && !folded);
        }

        // ELO update
        const winnerIds = result.winners.map((w) => w.agentId);
        const loserIds  = endRecord.state.seats.map((s) => s.agentId).filter((id) => !winnerIds.includes(id));
        elo.updateAfterHand(winnerIds, loserIds);

        // Stack history (virtual cumulative)
        const stackInterval = numHands > 1000 ? Math.ceil(numHands / 200) : 1;
        if (handsPlayed % stackInterval === 0) {
          const snap: Record<string, number> = {};
          for (const id of agentIds) {
            snap[id] = startingTokens + db.computeStats(id).totalProfit;
          }
          stackHistory.push({ handNumber: handsPlayed, stacks: snap });
        }

        // Strategy snapshot (step 5)
        if (snapshotEvery > 0 && handsPlayed % snapshotEvery === 0) {
          const eloMap: Record<string, number> = {};
          for (const r of elo.getRankings()) eloMap[r.agentId] = r.rating;
          const persSnap: Record<string, Partial<AgentPersonality>> = {};
          for (const id of agentIds) persSnap[id] = { ...currentPersonalities[id] };
          snapshots.push({ handNumber: handsPlayed, personalities: persSnap, eloRatings: eloMap });
        }
      }

      // ── adjustStrategy every adjustEvery hands (step 4) ─────────────────
      for (const agentId of agentIds) {
        const stats = db.computeStats(agentId);
        const session = learner.buildSessionResults(agentId, stats.totalProfit, handsPlayed);
        const current = currentPersonalities[agentId] ?? DEFAULT_PERSONALITY;
        const adjusted = learner.adjustStrategy(session, current);
        if (!adjusted.changes[0]?.includes("unchanged") && !adjusted.changes[0]?.includes("No decisions")) {
          currentPersonalities[agentId] = adjusted.after;
        }
      }
      // Clear per-chunk decision records so next chunk starts fresh
      learner.clearSession();

      // Live progress callback (step 4 output)
      if (config.onProgress !== undefined) {
        config.onProgress({
          handsPlayed,
          totalHands: numHands,
          eloRankings: elo.getRankings(),
          currentPersonalities: { ...currentPersonalities } as Record<string, AgentPersonality>,
          initialPersonalities,
          biggestPot,
          elapsedMs: Date.now() - startTime,
        });
      }

      // Verbose progress (step 4 output)
      if (verbose && handsPlayed % Math.max(adjustEvery, 50) === 0) {
        const isSnap = snapshotEvery > 0 && handsPlayed % snapshotEvery === 0;
        _printProgress(handsPlayed, numHands, agentIds, db, elo, startingTokens, isSnap);
      }
    }

    // ── Final analysis (step 6) ───────────────────────────────────────────
    const durationMs = Date.now() - startTime;
    const agentStats: Record<string, AgentStats> = {};
    const recommendations: StrategyRecommendation[] = [];
    for (const id of agentIds) {
      const stats = db.computeStats(id);
      agentStats[id] = stats;
      recommendations.push(learner.analyze(id, stats));
    }

    const finalPersonalities: Record<string, AgentPersonality> = {};
    for (const id of agentIds) finalPersonalities[id] = currentPersonalities[id] ?? DEFAULT_PERSONALITY;

    const decisionReport = _buildDecisionReport(decisionAcc, initialPersonalities, finalPersonalities);

    if (verbose) _printReport(agentIds, elo.getRankings(), decisionReport, initialPersonalities, finalPersonalities, durationMs);

    // Persist strategies.json if requested (step 6)
    if (config.savePath !== undefined && config.savePath !== null) {
      _saveStrategies(config.savePath, agentIds, finalPersonalities, agentStats, elo, handsPlayed);
    }

    return {
      handsPlayed,
      agentStats,
      eloRankings: elo.getRankings(),
      recommendations,
      stackHistory,
      snapshots,
      decisionReport,
      finalPersonalities,
      durationMs,
    };
  }

  getDb(): HandHistoryDb { return this.db; }
  getElo(): EloRating { return this.elo; }
  getOpponentModel(): OpponentModel { return this.model; }
}

// ─── Standalone export ────────────────────────────────────────────────────────

/** Convenience function — creates a fresh TrainingLoop and calls trainBots(). */
export async function trainBots(
  numHands: number,
  config: TrainingConfig = {}
): Promise<TrainingReport> {
  return new TrainingLoop().trainBots(numHands, config);
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

interface AgentCfg {
  id: string;
  tableId: string;
  personality?: Partial<AgentPersonality>;
}

function _agentCfg(id: string, tableId: string, config: TrainingConfig): AgentCfg {
  const personality = config.personalities?.[id];
  if (personality !== undefined) return { id, tableId, personality };
  return { id, tableId };
}

function _buildOutcome(agentId: string, hand: HandRecord, wentToShowdown: boolean): HandOutcome {
  return {
    wonPot:         hand.winners.some((w) => w.agentId === agentId),
    netAmount:      (hand.endStacks[agentId] ?? 0) - (hand.startStacks[agentId] ?? 0),
    finalPhase:     hand.finalPhase,
    wentToShowdown,
  };
}

function _buildMinCtx(
  agentId: string,
  tableId: string,
  state: GameState,
  smallBlind: number,
  bigBlind: number
): StrategyContext {
  const seatIndex = state.seats.findIndex((s) => s.agentId === agentId);
  const mySeat    = seatIndex >= 0 ? state.seats[seatIndex] : undefined;

  const eventHistory = state.events.map((e) => {
    const evAgentId = e.payload["agentId"];
    const evAmount  = e.payload["amount"];
    const entry: { type: string; agentId?: string; amount?: number } = { type: e.type };
    if (typeof evAgentId === "string") entry.agentId = evAgentId;
    if (typeof evAmount  === "number") entry.amount  = evAmount;
    return entry;
  });

  return {
    agentId,
    tableId,
    myHand:        [] as unknown as readonly CapabilityCard[],
    communityCards:[] as unknown as readonly TaskCard[],
    potSize:       state.mainPot,
    sidePots:      state.sidePots,
    myStack:       mySeat?.stack       ?? 0,
    myCurrentBet:  mySeat?.currentBet  ?? 0,
    currentBet:    state.currentBet,
    lastRaiseSize: state.lastRaiseAmount,
    phase:         state.phase,
    opponents:     state.seats
      .filter((s) => s.agentId !== agentId)
      .map((s) => ({
        id:          s.agentId,
        stack:       s.stack,
        currentBet:  s.currentBet,
        totalBet:    s.totalBet,
        isFolded:    s.status === "folded",
        isAllIn:     s.status === "all-in",
      })),
    position:      getPosition(
      Math.max(0, seatIndex),
      state.dealerIndex,
      state.seats.length
    ),
    isMyTurn:      seatIndex === state.actionOnIndex,
    smallBlind,
    bigBlind,
    eventHistory,
  };
}

function _buildDecisionReport(
  acc: Map<string, Map<string, { count: number; profit: number }>>,
  initial: Record<string, AgentPersonality>,
  final:   Record<string, AgentPersonality>
): DecisionReport {
  const perAgent: Record<string, AgentReport> = {};
  let globalBest  = { agentId: "", action: "", avgProfit: -Infinity };
  let globalWorst = { agentId: "", action: "", avgProfit:  Infinity };

  for (const [agentId, actionMap] of acc) {
    let totalDecisions = 0;
    const byAction: Record<string, ActionStats> = {};
    let bestAction  = { action: "", avgProfit: -Infinity };
    let worstAction = { action: "", avgProfit:  Infinity };

    for (const [action, stats] of actionMap) {
      const avgProfit = stats.count > 0 ? stats.profit / stats.count : 0;
      byAction[action] = { count: stats.count, totalProfit: stats.profit, avgProfit };
      totalDecisions += stats.count;
      if (avgProfit > bestAction.avgProfit)  bestAction  = { action, avgProfit };
      if (avgProfit < worstAction.avgProfit) worstAction = { action, avgProfit };
      if (avgProfit > globalBest.avgProfit)  globalBest  = { agentId, action, avgProfit };
      if (avgProfit < globalWorst.avgProfit) globalWorst = { agentId, action, avgProfit };
    }

    const personalityDrift: Partial<AgentPersonality> = {};
    const initP = initial[agentId];
    const finP  = final[agentId];
    if (initP !== undefined && finP !== undefined) {
      for (const key of Object.keys(initP) as (keyof AgentPersonality)[]) {
        const diff = finP[key] - initP[key];
        if (Math.abs(diff) > 0.005) personalityDrift[key] = diff;
      }
    }

    perAgent[agentId] = { totalDecisions, byAction, bestAction, worstAction, personalityDrift };
  }

  return { perAgent, overallBestAction: globalBest, overallWorstAction: globalWorst };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function _saveStrategies(
  filePath: string,
  agentIds: string[],
  personalities: Record<string, AgentPersonality>,
  stats: Record<string, AgentStats>,
  elo: EloRating,
  handsAnalyzed: number
): void {
  const agents: Record<string, unknown> = {};
  for (const id of agentIds) {
    const p = personalities[id];
    const s = stats[id];
    agents[id] = {
      personality:  p,
      lastStats:    s ?? null,
      eloRating:    Math.round(elo.getRating(id)),
    };
  }
  const payload = {
    version:       1,
    updatedAt:     new Date().toISOString(),
    handsAnalyzed,
    agents,
  };
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

// ─── Verbose output ───────────────────────────────────────────────────────────

/**
 * Print a compact progress table to stdout every adjustEvery hands.
 *
 * Example:
 *   [ 100/1000] ─────────────────────────────────────────────────
 *   Bot       Stack    VPIP   PFR    AF    ELO    Δ
 *   shark      +320    31%   19%   2.4   1235  +35
 *   rock        -85    11%    7%   0.7   1168  -32
 *   ...
 */
function _printProgress(
  handsPlayed: number,
  totalHands: number,
  agentIds: string[],
  db: HandHistoryDb,
  elo: EloRating,
  startingTokens: number,
  isSnapshot: boolean
): void {
  const padLen = String(totalHands).length;
  const header = `[${String(handsPlayed).padStart(padLen)}/${totalHands}]${isSnapshot ? " ◉" : ""}`;
  const bar = "─".repeat(Math.max(0, 50 - header.length));
  process.stdout.write(`${header} ${bar}\n`);
  process.stdout.write(
    `  ${"Bot".padEnd(8)} ${"Stack".padStart(6)}  ${"VPIP".padStart(5)} ${"PFR".padStart(4)} ${"AF".padStart(4)}  ${"ELO".padStart(4)}  ${"Δ".padStart(4)}\n`
  );

  const rankings = elo.getRankings();
  const eloByAgent = new Map(rankings.map((r) => [r.agentId, r.rating]));

  for (const agentId of agentIds) {
    const stats  = db.computeStats(agentId);
    const rating = eloByAgent.get(agentId) ?? 1200;
    const delta  = Math.round(rating - 1200);
    const profit = Math.round(stats.totalProfit);
    const stack  = startingTokens + profit;
    const stackStr = stack >= startingTokens
      ? `+${profit}`.padStart(6)
      : String(profit).padStart(6);
    const vpip = (stats.vpip   * 100).toFixed(0).padStart(3) + "%";
    const pfr  = (stats.pfr    * 100).toFixed(0).padStart(3) + "%";
    const af   = stats.af.toFixed(1).padStart(4);
    const eloStr   = Math.round(rating).toString().padStart(4);
    const deltaStr = (delta >= 0 ? `+${delta}` : String(delta)).padStart(5);
    process.stdout.write(
      `  ${agentId.padEnd(8)} ${stackStr}  ${vpip} ${pfr} ${af}  ${eloStr} ${deltaStr}\n`
    );
  }
  process.stdout.write("\n");
}

function _printHeader(
  agentIds: string[],
  numHands: number,
  adjustEvery: number,
  snapshotEvery: number
): void {
  console.log(`\n🃏  PokerCrawl Training Session`);
  console.log(`   Bots    : ${agentIds.join(" · ")} (${agentIds.length})`);
  console.log(`   Hands   : ${numHands.toLocaleString()}`);
  console.log(`   Adjust  : every ${adjustEvery} hands`);
  console.log(`   Snapshot: every ${snapshotEvery} hands`);
  console.log(`${"─".repeat(60)}`);
}

function _printReport(
  agentIds: string[],
  rankings: AgentRating[],
  report: DecisionReport,
  initial: Record<string, AgentPersonality>,
  final:   Record<string, AgentPersonality>,
  durationMs: number
): void {
  const secs = (durationMs / 1000).toFixed(1);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Done in ${secs}s\n`);

  console.log("FINAL ELO RANKINGS");
  for (let i = 0; i < rankings.length; i++) {
    const r = rankings[i];
    if (r === undefined) continue;
    const diff = Math.round(r.rating - 1200);
    const sign = diff >= 0 ? "+" : "";
    console.log(`  #${i + 1}  ${r.agentId.padEnd(8)} ${Math.round(r.rating).toString().padStart(4)}  (${sign}${diff})`);
  }

  console.log("\nDECISION REPORT");
  for (const agentId of agentIds) {
    const ag = report.perAgent[agentId];
    if (ag === undefined) continue;
    const best  = `${ag.bestAction.action.padEnd(6)} (${ag.bestAction.avgProfit >= 0 ? "+" : ""}${ag.bestAction.avgProfit.toFixed(0)}/hand)`;
    const worst = `${ag.worstAction.action.padEnd(6)} (${ag.worstAction.avgProfit.toFixed(0)}/hand)`;
    console.log(`  ${agentId.padEnd(8)} best=${best}  worst=${worst}`);
  }

  console.log("\nSTRATEGY EVOLUTION");
  for (const agentId of agentIds) {
    const initP = initial[agentId];
    const finP  = final[agentId];
    if (initP === undefined || finP === undefined) continue;
    const diffs: string[] = [];
    for (const key of Object.keys(initP) as (keyof AgentPersonality)[]) {
      const diff = finP[key] - initP[key];
      if (Math.abs(diff) > 0.005) {
        diffs.push(`${key} ${initP[key].toFixed(2)}→${finP[key].toFixed(2)}`);
      }
    }
    const diffStr = diffs.length > 0 ? diffs.join("  ") : "no change";
    console.log(`  ${agentId.padEnd(8)} ${diffStr}`);
  }
  console.log("");
}

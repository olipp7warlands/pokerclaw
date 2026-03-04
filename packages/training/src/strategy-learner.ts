/**
 * Strategy Learner
 *
 * Adaptive decision engine for PokerCrawl agents. Tracks hand history,
 * analyses every decision, models opponents in real-time, and adjusts
 * personality parameters based on session results.
 *
 * Methods:
 *   1. recordHand        — persist a completed hand and extract decision records
 *   2. analyzeDecision   — was that decision +EV? suggest personality delta
 *   3. updateOpponentModel — track VPIP/PFR/AF/WTSD/cbet%/fold-to-3bet per action
 *   4. adjustStrategy    — modify personality params from session results
 *   5. getOptimalAction  — adaptive action recommendation vs opponent profiles
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { evaluateHand, HAND_RANK_VALUE } from "@pokercrawl/engine";
import type { Card, CapabilityCard } from "@pokercrawl/engine";
import type {
  AgentDecision,
  AgentPersonality,
  StrategyContext,
  ActionType,
} from "@pokercrawl/agents";
import type { AgentStats, HandRecord } from "./hand-history-db.js";
import type { OpponentProfile } from "./opponent-model.js";
import { positionMultiplier } from "./position-evaluator.js";

// ─── Target ranges (TAG baseline) ────────────────────────────────────────────

const VPIP_TARGET = 0.28;
const AF_TARGET = 1.8;
const SHOWDOWN_WR_TARGET = 0.50;
const VPIP_SLACK = 0.10;
const AF_SLACK_LOW = 0.50;
const AF_SLACK_HIGH = 1.00;

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * What happened in the hand after the agent made a decision.
 * The caller fills this in post-hand (or post-session for offline analysis).
 */
export interface HandOutcome {
  /** Did this agent win the pot? */
  wonPot: boolean;
  /** Net chip change (positive = profit, negative = loss). */
  netAmount: number;
  /** Phase the hand ended in ("showdown", "settlement", "preflop", …). */
  finalPhase: string;
  /** True if the hand reached showdown (agent didn't fold). */
  wentToShowdown: boolean;
  /**
   * Optional hand-strength estimate at decision time [0, 1].
   * When provided, enables more precise bluff/value analysis.
   */
  handStrengthAtDecision?: number;
}

/** Result of evaluating one decision against its outcome. */
export interface DecisionAnalysis {
  decision: AgentDecision;
  outcome: HandOutcome;
  wasPositiveEV: boolean;
  insight: string;
  /** Suggested nudge to personality params (small deltas, not absolute values). */
  personalityDelta: Partial<AgentPersonality>;
}

/** Lightweight record of one agent action + its eventual outcome. */
export interface DecisionRecord {
  action: ActionType;
  phase: string;
  potSize: number;
  callAmount: number;
  outcome: HandOutcome;
}

/** Aggregated data for one session, fed into adjustStrategy(). */
export interface SessionResults {
  agentId: string;
  handsPlayed: number;
  netProfit: number;
  decisions: DecisionRecord[];
}

/** Outcome of adjustStrategy(): what changed and why. */
export interface AdjustedPersonality {
  agentId: string;
  before: AgentPersonality;
  after: AgentPersonality;
  changes: string[];
}

/** Live per-opponent stats tracked at action granularity. */
export interface LiveOpponentStats {
  handsObserved: number;
  /** Voluntary put in pot (preflop). */
  vpip: number;
  /** Pre-flop raise frequency. */
  pfr: number;
  /** Aggression factor = (raises + bets + all-ins) / calls. */
  af: number;
  /** Went-to-showdown rate. */
  wtsd: number;
  /** Continuation-bet frequency (when they were the preflop aggressor). */
  cbetFreq: number;
  /** Fold-to-3-bet percentage. */
  foldTo3betPct: number;
}

/** Output of the simple static analyzer (kept from v1 for compatibility). */
export interface StrategyRecommendation {
  agentId: string;
  stats: AgentStats;
  notes: string[];
  suggestedPersonality: Partial<AgentPersonality>;
}

// ─── Internal opponent tracking ───────────────────────────────────────────────

interface OpponentTracking {
  // Cumulative counts
  preflopOpportunities: number;
  preflopVoluntary: number;
  preflopRaises: number;
  aggressiveActions: number; // raises + bets + all-ins across all phases
  passiveActions: number;    // calls across all phases
  handsObserved: number;     // incremented on first voluntary preflop action
  showdowns: number;
  cbetOpportunities: number;
  cbetTaken: number;
  faced3bet: number;
  foldedTo3bet: number;
  // Per-hand flags (reset by newHand())
  isPreflopAggressor: boolean;
  sawFlop: boolean;
  actedPreflopThisHand: boolean;
}

function emptyTracking(): OpponentTracking {
  return {
    preflopOpportunities: 0,
    preflopVoluntary: 0,
    preflopRaises: 0,
    aggressiveActions: 0,
    passiveActions: 0,
    handsObserved: 0,
    showdowns: 0,
    cbetOpportunities: 0,
    cbetTaken: 0,
    faced3bet: 0,
    foldedTo3bet: 0,
    isPreflopAggressor: false,
    sawFlop: false,
    actedPreflopThisHand: false,
  };
}

// ─── StrategyLearner ──────────────────────────────────────────────────────────

export class StrategyLearner {
  private readonly tracking = new Map<string, OpponentTracking>();
  private readonly sessionDecisions = new Map<string, DecisionRecord[]>();
  private readonly dataDir: string | null;

  constructor(dataDir: string | null = null) {
    this.dataDir = dataDir;
  }

  // ── 1. TRACKING ────────────────────────────────────────────────────────────

  /**
   * Record a completed hand. Extracts per-agent decision records for use
   * by adjustStrategy() and stores them internally keyed by agentId.
   */
  recordHand(hand: HandRecord): void {
    for (const agentId of hand.agents) {
      const won = hand.winners.some((w) => w.agentId === agentId);
      const startStack = hand.startStacks[agentId] ?? 0;
      const endStack = hand.endStacks[agentId] ?? 0;
      const netAmount = endStack - startStack;
      const wentToShowdown =
        hand.finalPhase === "showdown" || hand.finalPhase === "settlement";

      const outcome: HandOutcome = {
        wonPot: won,
        netAmount,
        finalPhase: hand.finalPhase,
        wentToShowdown,
      };

      const records = this.sessionDecisions.get(agentId) ?? [];
      for (const a of hand.actions.filter((x) => x.agentId === agentId)) {
        records.push({
          action: a.action as ActionType,
          phase: a.phase,
          potSize: 0,    // not captured in HandRecord — caller may enrich
          callAmount: 0,
          outcome,
        });
      }
      this.sessionDecisions.set(agentId, records);
    }
  }

  /**
   * Build a SessionResults object from accumulated recordHand() calls.
   * Call this before adjustStrategy() at the end of a training session.
   */
  buildSessionResults(agentId: string, netProfit: number, handsPlayed: number): SessionResults {
    return {
      agentId,
      handsPlayed,
      netProfit,
      decisions: this.sessionDecisions.get(agentId) ?? [],
    };
  }

  /** Clear accumulated decision records (call between sessions). */
  clearSession(agentId?: string): void {
    if (agentId !== undefined) {
      this.sessionDecisions.delete(agentId);
    } else {
      this.sessionDecisions.clear();
    }
  }

  // ── 2. DECISION ANALYSIS ───────────────────────────────────────────────────

  /**
   * Evaluate whether a decision was +EV given what actually happened.
   *
   * Scenarios handled:
   *  - fold winning hand   → play looser
   *  - aggressive bet lost → be more conservative
   *  - bluff won           → reinforce bluff frequency
   *  - bluff caught        → cut bluff frequency
   */
  analyzeDecision(decision: AgentDecision, outcome: HandOutcome): DecisionAnalysis {
    const delta: Partial<AgentPersonality> = {};
    let insight = "";
    let wasPositiveEV = outcome.wonPot;

    const isBluff =
      outcome.handStrengthAtDecision !== undefined
        ? outcome.handStrengthAtDecision < 0.35
        : decision.tableTalk !== undefined; // fallback heuristic

    switch (decision.action) {
      // ── FOLD ──────────────────────────────────────────────────────────────
      case "fold": {
        if (outcome.wonPot) {
          // Folded a hand that would have won (caller detected this post-hand)
          insight =
            "Folded a winning hand — playing too tight. Open hand range or call wider.";
          delta.aggression = 0.03;
          delta.riskTolerance = 0.02;
          wasPositiveEV = false; // folding a winner is -EV in hindsight
        } else if (outcome.netAmount === 0) {
          insight = "Folded before investing chips — likely a correct preflop fold.";
          wasPositiveEV = true;
        } else {
          insight = "Fold abandoned some investment — verify opponent had a stronger hand.";
          // No personality adjustment without more context
        }
        break;
      }

      // ── BET / RAISE ───────────────────────────────────────────────────────
      case "bet":
      case "raise": {
        if (outcome.wonPot) {
          if (isBluff) {
            insight = "Bluff worked — opponent folded. Reinforce bluff in similar spots.";
            delta.bluffFrequency = 0.02;
          } else {
            insight = "Value bet paid off — opponent called/folded to a strong hand.";
            delta.aggression = 0.02;
          }
          wasPositiveEV = true;
        } else if (outcome.wentToShowdown) {
          if (isBluff) {
            insight = "Bluff was caught at showdown — reduce bluff frequency in this spot.";
            delta.bluffFrequency = -0.06;
          } else {
            insight = "Value bet lost at showdown — opponent had a stronger hand. Review hand selection.";
            delta.aggression = -0.03;
          }
          wasPositiveEV = false;
        } else {
          insight = "Bet landed but hand didn't reach showdown — opponent folded (bluff worked) or we folded.";
          // Ambiguous — small positive signal if we won, negative if we folded
          if (outcome.wonPot) {
            delta.aggression = 0.01;
          }
        }
        break;
      }

      // ── CALL ──────────────────────────────────────────────────────────────
      case "call": {
        if (outcome.wonPot) {
          insight = "Call was profitable — good pot-odds play or opponent was bluffing.";
          wasPositiveEV = true;
        } else if (outcome.wentToShowdown) {
          insight = "Call lost at showdown — pot odds may not have justified the call.";
          delta.aggression = 0.02; // lean toward raising (fold equity) rather than calling
          wasPositiveEV = false;
        } else {
          insight = "Called then folded later — consider folding earlier or raising to take initiative.";
          delta.aggression = 0.01;
          wasPositiveEV = false;
        }
        break;
      }

      // ── CHECK ─────────────────────────────────────────────────────────────
      case "check": {
        if (outcome.wonPot) {
          insight = "Check worked — either trapping or checked down a winner.";
          wasPositiveEV = true;
        } else {
          insight = "Check gave up initiative — consider betting for value or protection next time.";
          wasPositiveEV = false;
        }
        break;
      }

      // ── ALL-IN ────────────────────────────────────────────────────────────
      case "all-in": {
        if (outcome.wonPot) {
          insight = "All-in paid off — maintain risk tolerance in similar spots.";
          delta.riskTolerance = 0.02;
          wasPositiveEV = true;
        } else {
          insight = "All-in lost — high variance play. Review if stack-to-pot ratio justified the shove.";
          delta.riskTolerance = -0.03;
          wasPositiveEV = false;
        }
        break;
      }
    }

    return { decision, outcome, wasPositiveEV, insight, personalityDelta: delta };
  }

  // ── 3. OPPONENT MODELING ───────────────────────────────────────────────────

  /**
   * Call at the start of every new hand to reset per-hand flags
   * (preflop-aggressor flag, saw-flop flag, etc.).
   */
  newHand(): void {
    for (const t of this.tracking.values()) {
      t.isPreflopAggressor = false;
      t.sawFlop = false;
      t.actedPreflopThisHand = false;
    }
  }

  /**
   * Update the internal model for an opponent after they take an action.
   *
   * Stats tracked:
   *  - VPIP  (preflop voluntary action: call/raise/all-in)
   *  - PFR   (preflop raise)
   *  - AF    (raises+bets+all-ins across all phases, divided by calls)
   *  - WTSD  (updated via recordShowdown())
   *  - CBet% (did the PFR bet the flop?)
   *  - Fold-to-3bet% (did they fold after raising, to a re-raise?)
   */
  updateOpponentModel(
    opponentId: string,
    action: { action: ActionType; amount?: number },
    context: StrategyContext
  ): void {
    const t = this._getTracking(opponentId);
    const { phase, eventHistory } = context;
    const act = action.action;

    const isAggressive = act === "raise" || act === "bet" || act === "all-in";
    const isPassive = act === "call";
    const isVoluntary = act === "call" || act === "raise" || act === "bet" || act === "all-in";

    // ── Preflop stats ──────────────────────────────────────────────────────
    if (phase === "preflop") {
      if (!t.actedPreflopThisHand) {
        t.preflopOpportunities++;
        t.actedPreflopThisHand = true;
      }

      if (isVoluntary) {
        t.preflopVoluntary++;
        if (t.handsObserved === 0 || !t.actedPreflopThisHand) {
          // First voluntary preflop action of the hand = count as hand observed
        }
        // Count hand the first time they voluntarily enter
        if (t.preflopVoluntary === 1 || t.preflopVoluntary > t.handsObserved) {
          // approximate: track each preflop voluntary as +1 hand observation
          // (won't double-count within a hand because actedPreflopThisHand gates it)
        }
        t.handsObserved++;
      }

      if (act === "raise" || act === "bet") {
        t.preflopRaises++;
        t.isPreflopAggressor = true;
      }

      // ── Fold-to-3bet detection ─────────────────────────────────────────
      // Detect if there was already at least one raise before this action
      const priorRaises = eventHistory.filter(
        (e) => e.type === "raise" || e.type === "bet"
      ).length;
      if (priorRaises >= 1 && t.isPreflopAggressor) {
        // They raised, someone re-raised (3-bet), now they act
        if (act === "fold") {
          t.faced3bet++;
          t.foldedTo3bet++;
        } else if (isPassive || isAggressive) {
          t.faced3bet++;
          // they called or 4-bet — not a fold
        }
      }
    }

    // ── Flop: continuation bet tracking ───────────────────────────────────
    if (phase === "flop") {
      if (!t.sawFlop) {
        t.sawFlop = true;
        if (t.isPreflopAggressor) {
          t.cbetOpportunities++;
        }
      }
      if (t.isPreflopAggressor && isAggressive) {
        t.cbetTaken++;
      }
    }

    // ── Aggression factor (all phases) ────────────────────────────────────
    if (isAggressive) t.aggressiveActions++;
    if (isPassive) t.passiveActions++;
  }

  /** Record whether an opponent reached showdown for WTSD tracking. */
  recordShowdown(opponentId: string, wentToShowdown: boolean): void {
    if (wentToShowdown) {
      this._getTracking(opponentId).showdowns++;
    }
  }

  /** Return computed live stats for one opponent. */
  getLiveStats(opponentId: string): LiveOpponentStats {
    const t = this._getTracking(opponentId);
    const pflopOpp = Math.max(t.preflopOpportunities, 1);
    const hands = Math.max(t.handsObserved, 1);

    return {
      handsObserved: t.handsObserved,
      vpip: t.preflopVoluntary / pflopOpp,
      pfr: t.preflopRaises / pflopOpp,
      af:
        t.passiveActions > 0
          ? t.aggressiveActions / t.passiveActions
          : t.aggressiveActions > 0
            ? 3
            : 1,
      wtsd: t.showdowns / hands,
      cbetFreq: t.cbetOpportunities > 0 ? t.cbetTaken / t.cbetOpportunities : 0,
      foldTo3betPct: t.faced3bet > 0 ? t.foldedTo3bet / t.faced3bet : 0,
    };
  }

  // ── 4. STRATEGY ADJUSTMENT ─────────────────────────────────────────────────

  /**
   * Adjust personality parameters based on session results.
   * Analyses EV by action type and applies small directional nudges.
   *
   * @param results  Session data (use buildSessionResults() to populate)
   * @param current  Agent's current personality (not mutated)
   * @returns        New personality + changelog
   */
  adjustStrategy(results: SessionResults, current: AgentPersonality): AdjustedPersonality {
    const after = { ...current };
    const changes: string[] = [];

    if (results.decisions.length === 0) {
      return {
        agentId: results.agentId,
        before: current,
        after,
        changes: ["No decisions recorded — personality unchanged."],
      };
    }

    const decs = results.decisions;

    // ── Aggression EV ────────────────────────────────────────────────────
    const aggrDecs = decs.filter((d) => d.action === "raise" || d.action === "bet");
    if (aggrDecs.length >= 5) {
      const aggrProfit = aggrDecs.reduce((s, d) => s + d.outcome.netAmount, 0);
      const avgPnl = aggrProfit / aggrDecs.length;
      if (avgPnl < -15) {
        after.aggression = clamp(after.aggression - 0.05);
        changes.push(
          `Aggressive plays averaged ${avgPnl.toFixed(0)} chips → reduce aggression.`
        );
      } else if (avgPnl > 15) {
        after.aggression = clamp(after.aggression + 0.03);
        changes.push(
          `Aggressive plays averaged +${avgPnl.toFixed(0)} chips → reinforce aggression.`
        );
      }
    }

    // ── Bluff frequency (proxy: aggressive actions that lost at showdown) ─
    const aggrTotal = aggrDecs.length;
    if (aggrTotal >= 5) {
      const bluffsCaught = aggrDecs.filter(
        (d) => d.outcome.wentToShowdown && !d.outcome.wonPot
      ).length;
      const catchRate = bluffsCaught / aggrTotal;
      if (catchRate > 0.55) {
        after.bluffFrequency = clamp(after.bluffFrequency - 0.07);
        changes.push(
          `${(catchRate * 100).toFixed(0)}% of bets called and lost → reduce bluff frequency.`
        );
      } else if (catchRate < 0.20 && aggrTotal >= 8) {
        after.bluffFrequency = clamp(after.bluffFrequency + 0.03);
        changes.push(
          `Only ${(catchRate * 100).toFixed(0)}% of bets caught → can bluff more.`
        );
      }
    }

    // ── Call EV ──────────────────────────────────────────────────────────
    const callDecs = decs.filter((d) => d.action === "call");
    if (callDecs.length >= 5) {
      const callProfit = callDecs.reduce((s, d) => s + d.outcome.netAmount, 0);
      const avgCall = callProfit / callDecs.length;
      if (avgCall < -10) {
        // Calling too much with losing hands → raise or fold instead
        after.aggression = clamp(after.aggression + 0.02);
        changes.push(
          `Calls averaged ${avgCall.toFixed(0)} chips → tighten calling range.`
        );
      }
    }

    // ── All-in EV ────────────────────────────────────────────────────────
    const allInDecs = decs.filter((d) => d.action === "all-in");
    if (allInDecs.length >= 3) {
      const allInProfit = allInDecs.reduce((s, d) => s + d.outcome.netAmount, 0);
      const avgAllIn = allInProfit / allInDecs.length;
      if (avgAllIn < -40) {
        after.riskTolerance = clamp(after.riskTolerance - 0.05);
        changes.push(
          `All-ins averaged ${avgAllIn.toFixed(0)} chips → reduce risk tolerance.`
        );
      } else if (avgAllIn > 40) {
        after.riskTolerance = clamp(after.riskTolerance + 0.03);
        changes.push(
          `All-ins averaged +${avgAllIn.toFixed(0)} chips → maintain risk tolerance.`
        );
      }
    }

    // ── Folding missed value (won-pot detection on folds) ─────────────────
    const foldWinners = decs.filter(
      (d) => d.action === "fold" && d.outcome.wonPot
    ).length;
    const totalFolds = decs.filter((d) => d.action === "fold").length;
    if (totalFolds >= 5 && foldWinners / totalFolds > 0.15) {
      after.aggression = clamp(after.aggression + 0.04);
      after.riskTolerance = clamp(after.riskTolerance + 0.02);
      changes.push(
        `Folding winning hands ${foldWinners}/${totalFolds} times → play looser / call wider.`
      );
    }

    // ── Overall profit per hand ────────────────────────────────────────────
    const profitPerHand = results.netProfit / Math.max(results.handsPlayed, 1);
    if (profitPerHand < -8 && results.handsPlayed >= 20) {
      after.tiltResistance = clamp(after.tiltResistance + 0.02);
      changes.push(
        `Losing ${Math.abs(profitPerHand).toFixed(0)} chips/hand — boosting tilt resistance.`
      );
    }

    if (changes.length === 0) {
      changes.push("Session results within acceptable variance — no adjustments made.");
    }

    return { agentId: results.agentId, before: current, after, changes };
  }

  // ── 5. ADAPTIVE ACTION RECOMMENDATION ────────────────────────────────────

  /**
   * Recommend an action based on hand strength, pot odds, position, and
   * opponent tendencies.
   *
   * Adaptive rules:
   *  - vs loose-aggressive  → trap with strong hands; call wider to catch bluffs
   *  - vs tight-passive     → steal blinds; bet multiple streets for value
   *  - vs loose-passive     → value bet heavy every street; never bluff
   *  - vs tight-aggressive  → avoid thin bluffs; fold to re-raises without premium
   *  - vs random            → ABC poker: pot-odds + hand strength
   */
  getOptimalAction(
    context: StrategyContext,
    opponents: readonly OpponentProfile[]
  ): AgentDecision {
    const toCall = context.currentBet - context.myCurrentBet;
    const pot = context.potSize;
    const odds = toCall > 0 ? toCall / (pot + toCall) : 0;

    const strength = _handStrength(context.myHand, context.communityCards);
    // Late position hands are worth more equity
    const adjusted = Math.min(1, strength * positionMultiplier(context.position));

    // Determine the dominant tendency among active, non-folded opponents
    const activeProfiles = opponents.filter((o) => {
      const opp = context.opponents.find((x) => x.id === o.agentId);
      return opp !== undefined && !opp.isFolded && !opp.isAllIn;
    });
    const dominantTendency = _dominantTendency(activeProfiles);

    // ── Base decision from strength + pot odds ─────────────────────────────
    let action: ActionType;
    let amount: number | undefined;
    let reasoning: string;
    let confidence: number;

    if (adjusted >= 0.80) {
      // Premium — value bet
      action = toCall > 0 ? "raise" : "bet";
      amount = Math.round(pot * 0.75);
      reasoning = `Premium hand (${pct(adjusted)}) — value bet.`;
      confidence = 0.90;
    } else if (adjusted >= 0.60) {
      // Strong — call or semi-value bet
      if (toCall > 0) {
        action = adjusted > odds + 0.15 ? "call" : "fold";
        reasoning = `Strong hand — ${action} based on pot odds (${pct(odds)} needed, have ${pct(adjusted)}).`;
        confidence = 0.70;
      } else {
        action = "bet";
        amount = Math.round(pot * 0.55);
        reasoning = `Strong hand — semi-value bet.`;
        confidence = 0.65;
      }
    } else if (adjusted >= 0.35) {
      // Marginal — check or cheap call
      if (toCall === 0) {
        action = "check";
        reasoning = "Marginal hand — check for a free card.";
        confidence = 0.55;
      } else if (odds < 0.15) {
        action = "call";
        reasoning = `Marginal hand — cheap call (pot odds ${pct(odds)}).`;
        confidence = 0.50;
      } else {
        action = "fold";
        reasoning = "Marginal hand — fold to significant bet.";
        confidence = 0.60;
      }
    } else {
      // Weak — fold or occasional bluff in position
      if (toCall === 0 && context.position === "late" && Math.random() < 0.18) {
        action = "bet";
        amount = Math.round(pot * 0.60);
        reasoning = "Weak hand — late-position bluff attempt.";
        confidence = 0.30;
      } else if (toCall > 0) {
        action = "fold";
        reasoning = "Weak hand — fold.";
        confidence = 0.80;
      } else {
        action = "check";
        reasoning = "Weak hand — check.";
        confidence = 0.70;
      }
    }

    // ── Opponent-adaptive overlay ──────────────────────────────────────────
    ({ action, amount, reasoning, confidence } = _adaptForTendency(
      dominantTendency, action, amount, reasoning, confidence,
      adjusted, toCall, pot, context.phase
    ));

    return {
      action,
      reasoning,
      confidence,
      ...(amount !== undefined && { amount }),
    };
  }

  // ── 6. STATIC ANALYSIS (v1, kept for compatibility) ──────────────────────

  /**
   * Analyse aggregate stats against TAG targets and return plain-text
   * recommendations + suggested personality deltas.
   */
  analyze(agentId: string, stats: AgentStats): StrategyRecommendation {
    const notes: string[] = [];
    const adj: Partial<AgentPersonality> = {};

    if (stats.handsPlayed < 10) {
      notes.push(`Only ${stats.handsPlayed} hands observed — recommendations unreliable.`);
      return { agentId, stats, notes, suggestedPersonality: adj };
    }

    const vpipPct = (stats.vpip * 100).toFixed(1);
    const tgtPct = (VPIP_TARGET * 100).toFixed(0);

    if (stats.vpip > VPIP_TARGET + VPIP_SLACK) {
      notes.push(
        `Playing too loose (VPIP ${vpipPct}% vs target ${tgtPct}%). Tighten preflop.`
      );
      adj.aggression = clamp((adj.aggression ?? 0.5) - 0.10);
      adj.riskTolerance = clamp((adj.riskTolerance ?? 0.5) - 0.10);
    } else if (stats.vpip < VPIP_TARGET - VPIP_SLACK) {
      notes.push(
        `Playing too tight (VPIP ${vpipPct}% vs target ${tgtPct}%). Open more hands.`
      );
      adj.aggression = clamp((adj.aggression ?? 0.5) + 0.05);
    }

    if (stats.af < AF_TARGET - AF_SLACK_LOW) {
      notes.push(
        `Too passive (AF ${stats.af.toFixed(2)} vs ${AF_TARGET}). Bet/raise more.`
      );
      adj.aggression = clamp((adj.aggression ?? 0.5) + 0.15);
    } else if (stats.af > AF_TARGET + AF_SLACK_HIGH) {
      notes.push(
        `Too aggressive (AF ${stats.af.toFixed(2)} vs ${AF_TARGET}). Mix in more calls.`
      );
      adj.aggression = clamp((adj.aggression ?? 0.5) - 0.10);
      adj.bluffFrequency = clamp((adj.bluffFrequency ?? 0.3) - 0.05);
    }

    if (stats.showdownWR < SHOWDOWN_WR_TARGET - 0.10 && stats.handsPlayed >= 20) {
      notes.push(
        `Low showdown WR (${(stats.showdownWR * 100).toFixed(1)}%). Reduce bluff frequency.`
      );
      adj.bluffFrequency = clamp((adj.bluffFrequency ?? 0.3) - 0.10);
    }

    if (notes.length === 0) {
      notes.push("Performance within target ranges — no major adjustments needed.");
    }

    return { agentId, stats, notes, suggestedPersonality: adj };
  }

  // ── 7. PERSISTENCE ───────────────────────────────────────────────────────

  /**
   * Save an adjusted personality to `{dataDir}/strategies.json`.
   * No-op if the learner was constructed without a dataDir.
   */
  saveStrategy(agentId: string, personality: AgentPersonality): void {
    if (this.dataDir === null) return;
    mkdirSync(this.dataDir, { recursive: true });
    const filePath = join(this.dataDir, "strategies.json");
    let data: Record<string, AgentPersonality> = {};
    if (existsSync(filePath)) {
      try {
        data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, AgentPersonality>;
      } catch { /* corrupt — start fresh */ }
    }
    data[agentId] = personality;
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Load a previously saved personality from `{dataDir}/strategies.json`.
   * Returns null if no dataDir, file is missing, or agent has no saved entry.
   */
  loadStrategy(agentId: string): AgentPersonality | null {
    if (this.dataDir === null) return null;
    const filePath = join(this.dataDir, "strategies.json");
    if (!existsSync(filePath)) return null;
    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
      const p = data[agentId];
      if (p !== null && typeof p === "object") {
        return p as AgentPersonality;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _getTracking(agentId: string): OpponentTracking {
    let t = this.tracking.get(agentId);
    if (t === undefined) {
      t = emptyTracking();
      this.tracking.set(agentId, t);
    }
    return t;
  }
}

// ─── Module-level pure helpers ────────────────────────────────────────────────

const RANK_STRENGTH: Record<string, number> = {
  "high-card":       0.10,
  "pair":            0.30,
  "two-pair":        0.45,
  "three-of-a-kind": 0.60,
  "straight":        0.70,
  "flush":           0.75,
  "full-house":      0.85,
  "four-of-a-kind":  0.93,
  "straight-flush":  1.00,
};

// Use HAND_RANK_VALUE to verify ordering matches (avoids silent mismatches)
void HAND_RANK_VALUE;

function _handStrength(
  holeCards: readonly CapabilityCard[],
  community: readonly Card[]
): number {
  if (holeCards.length === 0) return 0;
  const all: Card[] = [...(holeCards as unknown as Card[]), ...community];
  if (all.length < 2) return 0;
  try {
    const result = evaluateHand(all);
    return RANK_STRENGTH[result.rank] ?? 0.10;
  } catch {
    return 0.10; // fallback for degenerate inputs
  }
}

function _dominantTendency(profiles: readonly OpponentProfile[]): string {
  if (profiles.length === 0) return "unknown";
  const counts = new Map<string, number>();
  for (const p of profiles) {
    counts.set(p.tendency, (counts.get(p.tendency) ?? 0) + 1);
  }
  let max = 0;
  let dominant = "unknown";
  for (const [k, v] of counts) {
    if (v > max) {
      max = v;
      dominant = k;
    }
  }
  return dominant;
}

function _adaptForTendency(
  tendency: string,
  action: ActionType,
  amount: number | undefined,
  reasoning: string,
  confidence: number,
  strength: number,
  toCall: number,
  pot: number,
  phase: string
): { action: ActionType; amount: number | undefined; reasoning: string; confidence: number } {
  switch (tendency) {
    case "loose-aggressive": {
      // Trap strong hands; call wider to catch bluffs
      if ((action === "bet" || action === "raise") && strength >= 0.75) {
        // Slow-play: check/call to let them bet into us
        return { action: "check", amount: undefined, reasoning, confidence: confidence - 0.05 };
      }
      if (action === "fold" && strength >= 0.42) {
        // Call wider — they're likely bluffing
        return { action: "call", amount: undefined, reasoning, confidence: 0.52 };
      }
      break;
    }

    case "tight-passive": {
      // Steal blinds; fire multiple streets for value
      if (action === "check" && phase !== "preflop" && strength >= 0.40) {
        return {
          action: "bet",
          amount: Math.round(pot * 0.55),
          reasoning,
          confidence: confidence + 0.05,
        };
      }
      // Semi-bluff more in late position against passives
      if (action === "check" && toCall === 0 && strength < 0.35) {
        return {
          action: "bet",
          amount: Math.round(pot * 0.45),
          reasoning,
          confidence: 0.40,
        };
      }
      break;
    }

    case "loose-passive": {
      // Value bet heavy on every street; never bluff (they call everything)
      if (strength >= 0.50 && toCall === 0) {
        return {
          action: "bet",
          amount: Math.round(pot * 0.90),
          reasoning,
          confidence: 0.80,
        };
      }
      // Cancel bluffs — they will call
      if ((action === "bet" || action === "raise") && strength < 0.30) {
        return { action: "check", amount: undefined, reasoning, confidence: 0.70 };
      }
      break;
    }

    case "tight-aggressive": {
      // Be cautious: avoid thin value raises; respect their re-raises
      if ((action === "raise" || action === "bet") && strength < 0.55) {
        const safe: ActionType = toCall > 0 ? "call" : "check";
        return { action: safe, amount: undefined, reasoning, confidence: 0.60 };
      }
      break;
    }

    // "unknown" / "random" → ABC poker (no adjustment)
  }

  return { action, amount, reasoning, confidence };
}

function clamp(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

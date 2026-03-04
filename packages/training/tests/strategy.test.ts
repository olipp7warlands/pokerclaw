/**
 * strategy.test.ts — Tests for StrategyLearner
 *
 * Covers: adjustStrategy (aggression, bluff, all-in, call EV, clamping),
 *         getOptimalAction (tendency overlays), saveStrategy / loadStrategy.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { StrategyLearner } from "../src/strategy-learner.js";
import type { DecisionRecord } from "../src/strategy-learner.js";
import type { AgentPersonality, StrategyContext, OpponentInfo } from "@pokercrawl/agents";
import type { CapabilityCard, TaskCard } from "@pokercrawl/engine";
import type { OpponentProfile, Tendency } from "../src/opponent-model.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function personality(aggression = 0.60): AgentPersonality {
  return {
    aggression,
    bluffFrequency: 0.30,
    tiltResistance: 0.70,
    trashTalkLevel: 0.40,
    riskTolerance: 0.50,
  };
}

function losingRaise(netAmount = -20): DecisionRecord {
  return {
    action: "raise",
    phase: "flop",
    potSize: 100,
    callAmount: 0,
    outcome: { wonPot: false, netAmount, finalPhase: "showdown", wentToShowdown: true },
  };
}

function winningBet(netAmount = 30): DecisionRecord {
  return {
    action: "bet",
    phase: "flop",
    potSize: 100,
    callAmount: 0,
    outcome: { wonPot: true, netAmount, finalPhase: "preflop", wentToShowdown: false },
  };
}

function losingCall(netAmount = -20): DecisionRecord {
  return {
    action: "call",
    phase: "flop",
    potSize: 100,
    callAmount: 20,
    outcome: { wonPot: false, netAmount, finalPhase: "showdown", wentToShowdown: true },
  };
}

/** Build a CapabilityCard (hole card). */
function cap(suit: string, rank: string, value: number): CapabilityCard {
  return { suit, rank, value, capability: "test", confidence: 0.5 } as unknown as CapabilityCard;
}

/** Build a TaskCard (community card). */
function task(suit: string, rank: string, value: number): TaskCard {
  return { suit, rank, value, task: "test", effort: 1 } as unknown as TaskCard;
}

function makeContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    agentId: "shark",
    tableId: "table-1",
    myHand: [],
    communityCards: [],
    potSize: 100,
    sidePots: [],
    myStack: 500,
    myCurrentBet: 0,
    currentBet: 0,
    lastRaiseSize: 0,
    phase: "flop",
    opponents: [],
    position: "middle",
    isMyTurn: true,
    smallBlind: 5,
    bigBlind: 10,
    eventHistory: [],
    ...overrides,
  } as StrategyContext;
}

function makeProfile(agentId: string, tendency: Tendency): OpponentProfile {
  return {
    agentId,
    handsObserved: 20,
    stats: {
      handsPlayed: 20,
      handsWon: 10,
      vpip: 0.5,
      pfr: 0.3,
      af: 1.5,
      showdownWR: 0.5,
      wtsd: 0.4,
      totalProfit: 0,
    },
    tendency,
    counterStrategy: "",
  };
}

function makeOpponentInfo(id: string): OpponentInfo {
  return { id, stack: 500, currentBet: 0, totalBet: 0, isFolded: false, isAllIn: false };
}

// ---------------------------------------------------------------------------
// 1. adjustStrategy — aggression
// ---------------------------------------------------------------------------

describe("adjustStrategy — aggression", () => {
  it("no decisions → personality unchanged", () => {
    const learner = new StrategyLearner();
    const current = personality();
    const adj = learner.adjustStrategy(
      { agentId: "shark", handsPlayed: 10, netProfit: 0, decisions: [] },
      current
    );
    expect(adj.after.aggression).toBe(current.aggression);
    expect(adj.after.bluffFrequency).toBe(current.bluffFrequency);
  });

  it("aggression drops when ≥5 losing raises (avgPnl < −15)", () => {
    const learner = new StrategyLearner();
    const current = personality(0.70);
    const decisions: DecisionRecord[] = Array.from({ length: 6 }, () => losingRaise(-20));
    const adj = learner.adjustStrategy(
      { agentId: "shark", handsPlayed: 10, netProfit: -120, decisions },
      current
    );
    expect(adj.after.aggression).toBeLessThan(current.aggression);
    expect(adj.changes.some((c) => /aggression/i.test(c))).toBe(true);
  });

  it("aggression increases when ≥5 winning bets (avgPnl > 15)", () => {
    const learner = new StrategyLearner();
    const current = personality(0.50);
    const decisions: DecisionRecord[] = Array.from({ length: 5 }, () => winningBet(30));
    const adj = learner.adjustStrategy(
      { agentId: "shark", handsPlayed: 10, netProfit: 150, decisions },
      current
    );
    expect(adj.after.aggression).toBeGreaterThan(current.aggression);
  });
});

// ---------------------------------------------------------------------------
// 2. adjustStrategy — bluffFrequency
// ---------------------------------------------------------------------------

describe("adjustStrategy — bluffFrequency", () => {
  it("bluffFrequency decreases when catch rate > 55% (most bets go to showdown & lose)", () => {
    const learner = new StrategyLearner();
    const current = personality();
    // 6 aggressive decisions that all went to showdown and lost → catch rate 100%
    const decisions: DecisionRecord[] = Array.from({ length: 6 }, () => losingRaise(-20));
    const adj = learner.adjustStrategy(
      { agentId: "shark", handsPlayed: 10, netProfit: -120, decisions },
      current
    );
    expect(adj.after.bluffFrequency).toBeLessThan(current.bluffFrequency);
  });

  it("bluffFrequency increases when catch rate < 20% and ≥8 aggressive decisions", () => {
    const learner = new StrategyLearner();
    const current = personality();
    // 8 bets that won without showdown → catch rate 0%
    const decisions: DecisionRecord[] = Array.from({ length: 8 }, () => winningBet(25));
    const adj = learner.adjustStrategy(
      { agentId: "shark", handsPlayed: 10, netProfit: 200, decisions },
      current
    );
    expect(adj.after.bluffFrequency).toBeGreaterThan(current.bluffFrequency);
  });
});

// ---------------------------------------------------------------------------
// 3. adjustStrategy — all-in & call EV
// ---------------------------------------------------------------------------

describe("adjustStrategy — all-in and call EV", () => {
  it("riskTolerance decreases after ≥3 losing all-ins (avgPnl < −40)", () => {
    const learner = new StrategyLearner();
    const current = personality();
    const decisions: DecisionRecord[] = Array.from({ length: 3 }, () => ({
      action: "all-in" as const,
      phase: "river",
      potSize: 200,
      callAmount: 0,
      outcome: { wonPot: false, netAmount: -100, finalPhase: "showdown", wentToShowdown: true },
    }));
    const adj = learner.adjustStrategy(
      { agentId: "shark", handsPlayed: 10, netProfit: -300, decisions },
      current
    );
    expect(adj.after.riskTolerance).toBeLessThan(current.riskTolerance);
  });

  it("losing calls nudge aggression up (agent should raise not call)", () => {
    const learner = new StrategyLearner();
    const current = personality(0.40);
    const decisions: DecisionRecord[] = Array.from({ length: 5 }, () => losingCall(-15));
    const adj = learner.adjustStrategy(
      { agentId: "shark", handsPlayed: 10, netProfit: -75, decisions },
      current
    );
    // avgCall = -15 < -10 → aggression bumped up
    expect(adj.after.aggression).toBeGreaterThan(current.aggression);
  });
});

// ---------------------------------------------------------------------------
// 4. adjustStrategy — clamping
// ---------------------------------------------------------------------------

describe("adjustStrategy — clamping", () => {
  it("parameters stay ≥ 0 after repeated negative adjustments", () => {
    const learner = new StrategyLearner();
    const current: AgentPersonality = {
      aggression: 0.02,
      bluffFrequency: 0.02,
      tiltResistance: 0.50,
      trashTalkLevel: 0.40,
      riskTolerance: 0.02,
    };
    // All-ins that lose heavily → riskTolerance can't go below 0
    const decisions: DecisionRecord[] = Array.from({ length: 5 }, () => ({
      action: "all-in" as const,
      phase: "river",
      potSize: 200,
      callAmount: 0,
      outcome: { wonPot: false, netAmount: -200, finalPhase: "showdown", wentToShowdown: true },
    }));
    const adj = learner.adjustStrategy(
      { agentId: "shark", handsPlayed: 10, netProfit: -1000, decisions },
      current
    );
    expect(adj.after.riskTolerance).toBeGreaterThanOrEqual(0);
    expect(adj.after.aggression).toBeGreaterThanOrEqual(0);
    expect(adj.after.bluffFrequency).toBeGreaterThanOrEqual(0);
  });

  it("parameters stay ≤ 1 after repeated positive adjustments", () => {
    const learner = new StrategyLearner();
    const current: AgentPersonality = {
      aggression: 0.98,
      bluffFrequency: 0.98,
      tiltResistance: 0.50,
      trashTalkLevel: 0.40,
      riskTolerance: 0.98,
    };
    const decisions: DecisionRecord[] = Array.from({ length: 10 }, () => winningBet(50));
    const adj = learner.adjustStrategy(
      { agentId: "shark", handsPlayed: 10, netProfit: 500, decisions },
      current
    );
    expect(adj.after.aggression).toBeLessThanOrEqual(1);
    expect(adj.after.bluffFrequency).toBeLessThanOrEqual(1);
    expect(adj.after.riskTolerance).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 5. getOptimalAction — opponent tendency overlays
// ---------------------------------------------------------------------------

describe("getOptimalAction — tendency overlays", () => {
  it("vs loose-aggressive: traps a full-house (check instead of bet)", () => {
    const learner = new StrategyLearner();
    // Full-house: A♠A♥ hole + A♦K♣K♥ community → strength 0.85, late → adjusted 1.0
    const ctx = makeContext({
      myHand: [cap("spades", "A", 14), cap("hearts", "A", 14)],
      communityCards: [task("diamonds", "A", 14), task("clubs", "K", 13), task("hearts", "K", 13)],
      position: "late",
      currentBet: 0,
      opponents: [makeOpponentInfo("opp")],
    });
    const result = learner.getOptimalAction(ctx, [makeProfile("opp", "loose-aggressive")]);
    // Premium hand vs LAG → slow-play → check
    expect(result.action).toBe("check");
  });

  it("vs tight-passive: steals with weak hand on flop (bet instead of check)", () => {
    const learner = new StrategyLearner();
    // Pair of 2s: 2♠3♥ hole + 2♦7♣K♠ community → strength 0.30, middle → adjusted 0.30 (weak)
    const ctx = makeContext({
      myHand: [cap("spades", "2", 2), cap("hearts", "3", 3)],
      communityCards: [task("diamonds", "2", 2), task("clubs", "7", 7), task("spades", "K", 13)],
      position: "middle",
      currentBet: 0,
      phase: "flop",
      opponents: [makeOpponentInfo("opp")],
    });
    const result = learner.getOptimalAction(ctx, [makeProfile("opp", "tight-passive")]);
    // Weak hand vs tight-passive on flop → semi-bluff steal → bet
    expect(result.action).toBe("bet");
  });

  it("vs loose-passive: value bets three-of-a-kind at ~90% pot", () => {
    const learner = new StrategyLearner();
    // Three aces: A♠A♥ hole + A♦K♣2♠ community → strength 0.60, late → adjusted 0.75
    const ctx = makeContext({
      myHand: [cap("spades", "A", 14), cap("hearts", "A", 14)],
      communityCards: [task("diamonds", "A", 14), task("clubs", "K", 13), task("spades", "2", 2)],
      position: "late",
      potSize: 100,
      currentBet: 0,
      opponents: [makeOpponentInfo("opp")],
    });
    const result = learner.getOptimalAction(ctx, [makeProfile("opp", "loose-passive")]);
    // Strong hand vs calling-station → value bet at 90% pot
    expect(result.action).toBe("bet");
    expect(result.amount).toBeCloseTo(90, -1); // ~90
  });

  it("no active opponents: weak hand with toCall → folds (ABC poker)", () => {
    const learner = new StrategyLearner();
    // Empty hand → strength 0, adjusted 0 → weak
    const ctx = makeContext({
      myHand: [],
      communityCards: [],
      currentBet: 50,
      myCurrentBet: 0,
      potSize: 100,
      opponents: [],
    });
    const result = learner.getOptimalAction(ctx, []);
    // Weak hand facing bet → fold
    expect(result.action).toBe("fold");
  });
});

// ---------------------------------------------------------------------------
// 6. saveStrategy / loadStrategy
// ---------------------------------------------------------------------------

describe("saveStrategy / loadStrategy", () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trip: save then load returns the same personality", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sl-test-"));
    const learner = new StrategyLearner(tmpDir);
    const saved = personality(0.75);
    learner.saveStrategy("shark", saved);
    const loaded = learner.loadStrategy("shark");
    expect(loaded).not.toBeNull();
    expect(loaded?.aggression).toBeCloseTo(0.75);
    expect(loaded?.bluffFrequency).toBeCloseTo(saved.bluffFrequency);
  });

  it("loadStrategy returns null for an agent with no saved entry", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sl-test-"));
    const learner = new StrategyLearner(tmpDir);
    learner.saveStrategy("shark", personality());
    expect(learner.loadStrategy("rock")).toBeNull();
  });

  it("loadStrategy returns null when the strategies file does not exist", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sl-test-"));
    const learner = new StrategyLearner(tmpDir);
    expect(learner.loadStrategy("nobody")).toBeNull();
  });

  it("multiple agents can be saved and loaded independently", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sl-test-"));
    const learner = new StrategyLearner(tmpDir);
    learner.saveStrategy("shark", personality(0.80));
    learner.saveStrategy("rock", personality(0.15));
    expect(learner.loadStrategy("shark")?.aggression).toBeCloseTo(0.80);
    expect(learner.loadStrategy("rock")?.aggression).toBeCloseTo(0.15);
  });

  it("null dataDir: saveStrategy is a no-op and loadStrategy returns null", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sl-test-")); // won't be written to
    const learner = new StrategyLearner(null);
    learner.saveStrategy("shark", personality()); // should not throw
    expect(learner.loadStrategy("shark")).toBeNull();
  });
});

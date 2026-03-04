/**
 * @pokercrawl/training test suite
 */

import { describe, it, expect } from "vitest";

import {
  potOdds,
  requiredEquity,
  impliedOdds,
  callEV,
  stackToPotRatio,
  isCallProfitable,
} from "../src/pot-odds-calculator.js";
import { EloRating } from "../src/elo-rating.js";
import { HandHistoryDb } from "../src/hand-history-db.js";
import type { HandRecord } from "../src/hand-history-db.js";
import { OpponentModel, classifyTendency } from "../src/opponent-model.js";
import { getPosition, positionMultiplier, PositionStats } from "../src/position-evaluator.js";
import { StrategyLearner } from "../src/strategy-learner.js";
import type { HandOutcome, DecisionRecord } from "../src/strategy-learner.js";
import { TrainingLoop } from "../src/training-loop.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalContext(phase: string): import("@pokercrawl/agents").StrategyContext {
  return {
    agentId: "observer",
    tableId: "test",
    myHand: [],
    communityCards: [],
    potSize: 100,
    sidePots: [],
    myStack: 500,
    myCurrentBet: 0,
    currentBet: 20,
    lastRaiseSize: 10,
    phase: phase as import("@pokercrawl/engine").GamePhase,
    opponents: [],
    position: "late",
    isMyTurn: false,
    smallBlind: 5,
    bigBlind: 10,
    eventHistory: [],
  };
}

function makeHand(overrides: Partial<HandRecord> = {}): HandRecord {
  return {
    handNumber: 1,
    timestamp: Date.now(),
    agents: ["shark", "rock"],
    actions: [],
    winners: [{ agentId: "shark", amountWon: 20, hand: null }],
    startStacks: { shark: 100, rock: 100 },
    endStacks: { shark: 120, rock: 80 },
    finalPhase: "showdown",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PotOddsCalculator
// ---------------------------------------------------------------------------

describe("PotOddsCalculator", () => {
  it("computes pot odds correctly", () => {
    expect(potOdds(50, 200)).toBeCloseTo(0.2);
  });

  it("returns 0 for zero call amount", () => {
    expect(potOdds(0, 200)).toBe(0);
  });

  it("computes required equity", () => {
    // 100 / (200 + 100) = 1/3
    expect(requiredEquity(100, 200)).toBeCloseTo(1 / 3);
  });

  it("computes implied odds with future winnings", () => {
    // 50 / (200 + 50 + 100) = 50/350
    expect(impliedOdds(50, 200, 100)).toBeCloseTo(50 / 350);
  });

  it("computes call EV correctly", () => {
    // equity=0.6, call=50, pot=200 → 0.6*200 - 0.4*50 = 120 - 20 = 100
    expect(callEV(0.6, 50, 200)).toBeCloseTo(100);
  });

  it("computes stack-to-pot ratio", () => {
    expect(stackToPotRatio(300, 100)).toBe(3);
  });

  it("returns Infinity when pot is empty", () => {
    expect(stackToPotRatio(300, 0)).toBe(Infinity);
  });

  it("identifies profitable calls", () => {
    expect(isCallProfitable(0.3, 50, 200)).toBe(true);  // 0.3 > 0.2
    expect(isCallProfitable(0.1, 50, 200)).toBe(false); // 0.1 < 0.2
  });
});

// ---------------------------------------------------------------------------
// EloRating
// ---------------------------------------------------------------------------

describe("EloRating", () => {
  it("returns initial rating for unknown agents", () => {
    const elo = new EloRating();
    expect(elo.getRating("anyone")).toBe(1200);
  });

  it("supports custom initial rating", () => {
    const elo = new EloRating(1500);
    expect(elo.getRating("x")).toBe(1500);
  });

  it("increases winner rating and decreases loser rating", () => {
    const elo = new EloRating();
    elo.updateAfterHand(["shark"], ["rock"]);
    expect(elo.getRating("shark")).toBeGreaterThan(1200);
    expect(elo.getRating("rock")).toBeLessThan(1200);
  });

  it("returns sorted rankings highest first", () => {
    const elo = new EloRating();
    elo.updateAfterHand(["shark"], ["rock"]);
    const rankings = elo.getRankings();
    expect(rankings[0]?.agentId).toBe("shark");
    expect(rankings.length).toBe(2);
  });

  it("ratings sum remains constant after update (zero-sum)", () => {
    const elo = new EloRating();
    elo.updateAfterHand(["a"], ["b"]);
    const sumAfter = elo.getRating("a") + elo.getRating("b");
    expect(sumAfter).toBeCloseTo(2400); // 1200 + 1200
  });
});

// ---------------------------------------------------------------------------
// HandHistoryDb
// ---------------------------------------------------------------------------

describe("HandHistoryDb", () => {
  it("starts empty", () => {
    const db = new HandHistoryDb();
    expect(db.getHands()).toHaveLength(0);
  });

  it("stores and retrieves hands", () => {
    const db = new HandHistoryDb();
    db.addHand(makeHand());
    expect(db.getHands()).toHaveLength(1);
  });

  it("returns zero stats for an unknown agent", () => {
    const db = new HandHistoryDb();
    const stats = db.computeStats("nobody");
    expect(stats.handsPlayed).toBe(0);
    expect(stats.vpip).toBe(0);
  });

  it("tracks hands won correctly", () => {
    const db = new HandHistoryDb();
    db.addHand(makeHand({ winners: [{ agentId: "shark", amountWon: 20, hand: null }] }));
    db.addHand(
      makeHand({
        handNumber: 2,
        winners: [{ agentId: "rock", amountWon: 20, hand: null }],
        endStacks: { shark: 80, rock: 120 },
      })
    );
    const stats = db.computeStats("shark");
    expect(stats.handsPlayed).toBe(2);
    expect(stats.handsWon).toBe(1);
  });

  it("computes VPIP: call preflop counts, fold does not", () => {
    const db = new HandHistoryDb();
    db.addHand(
      makeHand({
        actions: [
          { agentId: "shark", action: "call", phase: "preflop" },
          { agentId: "rock", action: "fold", phase: "preflop" },
        ],
      })
    );
    expect(db.computeStats("shark").vpip).toBe(1);
    expect(db.computeStats("rock").vpip).toBe(0);
  });

  it("computes PFR: preflop raise counts", () => {
    const db = new HandHistoryDb();
    db.addHand(
      makeHand({
        actions: [{ agentId: "shark", action: "raise", phase: "preflop" }],
      })
    );
    expect(db.computeStats("shark").pfr).toBe(1);
    expect(db.computeStats("rock").pfr).toBe(0);
  });

  it("computes aggression factor from raises and calls", () => {
    const db = new HandHistoryDb();
    db.addHand(
      makeHand({
        actions: [
          { agentId: "shark", action: "raise", phase: "flop" },
          { agentId: "shark", action: "raise", phase: "turn" },
          { agentId: "shark", action: "call", phase: "river" },
        ],
      })
    );
    // AF = 2 raises / 1 call = 2
    expect(db.computeStats("shark").af).toBeCloseTo(2);
  });

  it("tracks profit correctly", () => {
    const db = new HandHistoryDb();
    db.addHand(makeHand()); // shark: 100 → 120, profit = +20
    expect(db.computeStats("shark").totalProfit).toBe(20);
    expect(db.computeStats("rock").totalProfit).toBe(-20);
  });

  it("clears all hands", () => {
    const db = new HandHistoryDb();
    db.addHand(makeHand());
    db.clear();
    expect(db.getHands()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// OpponentModel
// ---------------------------------------------------------------------------

describe("OpponentModel", () => {
  it("returns unknown tendency with insufficient data", () => {
    const db = new HandHistoryDb();
    const model = new OpponentModel(db);
    const profile = model.getProfile("shark");
    expect(profile.tendency).toBe("unknown");
  });

  it("classifies tight-passive opponent", () => {
    // Simulate 10 hands: rock always folds preflop (VPIP=0, AF=1)
    const db = new HandHistoryDb();
    for (let i = 0; i < 10; i++) {
      db.addHand(
        makeHand({
          handNumber: i,
          actions: [{ agentId: "rock", action: "fold", phase: "preflop" }],
        })
      );
    }
    const model = new OpponentModel(db);
    expect(model.getProfile("rock").tendency).toBe("tight-passive");
  });

  it("classifyTendency works on synthetic stats", () => {
    expect(
      classifyTendency({ handsPlayed: 20, handsWon: 5, vpip: 0.5, pfr: 0.2, af: 3, showdownWR: 0.5, totalProfit: 0 })
    ).toBe("loose-aggressive");

    expect(
      classifyTendency({ handsPlayed: 20, handsWon: 5, vpip: 0.1, pfr: 0.1, af: 0.5, showdownWR: 0.5, totalProfit: 0 })
    ).toBe("tight-passive");
  });
});

// ---------------------------------------------------------------------------
// PositionEvaluator
// ---------------------------------------------------------------------------

describe("PositionEvaluator", () => {
  it("dealer button is late position", () => {
    expect(getPosition(0, 0, 5)).toBe("late");
  });

  it("SB is blinds position", () => {
    expect(getPosition(1, 0, 5)).toBe("blinds");
  });

  it("BB is blinds position", () => {
    expect(getPosition(2, 0, 5)).toBe("blinds");
  });

  it("wraps correctly for non-zero dealer", () => {
    // Dealer at seat 3; seat 3 = late, seat 4 = blinds
    expect(getPosition(3, 3, 5)).toBe("late");
    expect(getPosition(4, 3, 5)).toBe("blinds");
  });

  it("late position has higher multiplier than early", () => {
    expect(positionMultiplier("late")).toBeGreaterThan(positionMultiplier("early"));
  });

  it("PositionStats tracks win rates correctly", () => {
    const stats = new PositionStats();
    stats.record("late", true);
    stats.record("late", false);
    stats.record("early", false);
    const rates = stats.getWinRates();
    const late = rates.find((r) => r.position === "late");
    const early = rates.find((r) => r.position === "early");
    expect(late?.winRate).toBeCloseTo(0.5);
    expect(late?.handsPlayed).toBe(2);
    expect(early?.winRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// StrategyLearner
// ---------------------------------------------------------------------------

describe("StrategyLearner", () => {
  const learner = new StrategyLearner();

  it("flags insufficient data with < 10 hands", () => {
    const rec = learner.analyze("shark", {
      handsPlayed: 3,
      handsWon: 1,
      vpip: 0.5,
      pfr: 0.3,
      af: 2,
      showdownWR: 0.5,
      totalProfit: 0,
    });
    expect(rec.notes[0]).toMatch(/insufficient|only 3/i);
  });

  it("flags too-loose play when VPIP is high", () => {
    const rec = learner.analyze("shark", {
      handsPlayed: 50,
      handsWon: 20,
      vpip: 0.55, // far above 0.28 target
      pfr: 0.3,
      af: 1.8,
      showdownWR: 0.5,
      totalProfit: 0,
    });
    expect(rec.notes.some((n) => /loose/i.test(n))).toBe(true);
  });

  it("flags too-passive play when AF is low", () => {
    const rec = learner.analyze("shark", {
      handsPlayed: 50,
      handsWon: 20,
      vpip: 0.28,
      pfr: 0.2,
      af: 0.5, // far below 1.8 target
      showdownWR: 0.5,
      totalProfit: 0,
    });
    expect(rec.notes.some((n) => /passive/i.test(n))).toBe(true);
  });

  it("returns no-adjustment note for balanced stats", () => {
    const rec = learner.analyze("shark", {
      handsPlayed: 50,
      handsWon: 20,
      vpip: 0.28,
      pfr: 0.2,
      af: 1.8,
      showdownWR: 0.5,
      totalProfit: 0,
    });
    expect(rec.notes.some((n) => /no major/i.test(n))).toBe(true);
  });

  it("suggests personality adjustment for loose play", () => {
    const rec = learner.analyze("shark", {
      handsPlayed: 50,
      handsWon: 20,
      vpip: 0.55,
      pfr: 0.3,
      af: 1.8,
      showdownWR: 0.5,
      totalProfit: 0,
    });
    // Should suggest lower aggression and/or riskTolerance
    expect(
      rec.suggestedPersonality.aggression !== undefined ||
        rec.suggestedPersonality.riskTolerance !== undefined
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// StrategyLearner — new adaptive methods
// ---------------------------------------------------------------------------

describe("StrategyLearner.analyzeDecision", () => {
  const learner = new StrategyLearner();

  const wonOutcome: HandOutcome = {
    wonPot: true, netAmount: 80, finalPhase: "showdown", wentToShowdown: true,
  };
  const lostOutcome: HandOutcome = {
    wonPot: false, netAmount: -40, finalPhase: "showdown", wentToShowdown: true,
  };
  const foldedOutcome: HandOutcome = {
    wonPot: false, netAmount: -10, finalPhase: "preflop", wentToShowdown: false,
  };

  it("bet+won → positive EV, small aggression boost", () => {
    const r = learner.analyzeDecision(
      { action: "bet", reasoning: "value", confidence: 0.7 },
      wonOutcome
    );
    expect(r.wasPositiveEV).toBe(true);
    expect(r.personalityDelta.aggression).toBeGreaterThanOrEqual(0);
  });

  it("bet+lost at showdown → negative EV, reduce aggression", () => {
    const r = learner.analyzeDecision(
      { action: "bet", reasoning: "value", confidence: 0.6 },
      lostOutcome
    );
    expect(r.wasPositiveEV).toBe(false);
    expect(r.personalityDelta.aggression).toBeLessThan(0);
  });

  it("bluff caught → reduce bluffFrequency", () => {
    const r = learner.analyzeDecision(
      { action: "raise", reasoning: "bluff", confidence: 0.3, tableTalk: "all-in!" },
      lostOutcome
    );
    expect(r.wasPositiveEV).toBe(false);
    const bf = r.personalityDelta.bluffFrequency;
    expect(bf).toBeDefined();
    expect(bf as number).toBeLessThan(0);
    expect(r.insight).toMatch(/bluff|caught/i);
  });

  it("bluff worked → reinforce bluffFrequency", () => {
    const r = learner.analyzeDecision(
      { action: "raise", reasoning: "bluff", confidence: 0.3, tableTalk: "scared?" },
      { wonPot: true, netAmount: 50, finalPhase: "flop", wentToShowdown: false },
    );
    expect(r.wasPositiveEV).toBe(true);
    expect(r.personalityDelta.bluffFrequency).toBeGreaterThanOrEqual(0);
  });

  it("fold winning hand → negative EV, loosen personality", () => {
    const r = learner.analyzeDecision(
      { action: "fold", reasoning: "weak", confidence: 0.8 },
      { wonPot: true, netAmount: 0, finalPhase: "flop", wentToShowdown: false }
    );
    expect(r.wasPositiveEV).toBe(false);
    expect(r.insight).toMatch(/loose|tight|winning/i);
    expect(r.personalityDelta.aggression).toBeGreaterThan(0);
  });

  it("correct fold (no investment) → positive EV", () => {
    const r = learner.analyzeDecision(
      { action: "fold", reasoning: "weak preflop", confidence: 0.9 },
      { wonPot: false, netAmount: 0, finalPhase: "preflop", wentToShowdown: false }
    );
    expect(r.wasPositiveEV).toBe(true);
  });

  it("all-in won → boost riskTolerance", () => {
    const r = learner.analyzeDecision(
      { action: "all-in", reasoning: "nuts", confidence: 0.95 },
      wonOutcome
    );
    expect(r.wasPositiveEV).toBe(true);
    expect(r.personalityDelta.riskTolerance).toBeGreaterThan(0);
  });

  it("all-in lost → reduce riskTolerance", () => {
    const r = learner.analyzeDecision(
      { action: "all-in", reasoning: "shove", confidence: 0.6 },
      lostOutcome
    );
    expect(r.personalityDelta.riskTolerance).toBeLessThan(0);
  });

  it("handStrengthAtDecision overrides tableTalk for bluff detection", () => {
    // Low strength + lost at showdown = bluff caught, even without tableTalk
    const r = learner.analyzeDecision(
      { action: "raise", reasoning: "bluff", confidence: 0.25 },
      { ...lostOutcome, handStrengthAtDecision: 0.10 }
    );
    expect(r.personalityDelta.bluffFrequency).toBeLessThan(0);
  });
});

describe("StrategyLearner.updateOpponentModel / getLiveStats", () => {
  it("tracks VPIP from preflop call", () => {
    const sl = new StrategyLearner();
    const ctx = makeMinimalContext("preflop");
    sl.newHand();
    sl.updateOpponentModel("shark", { action: "call" }, ctx);
    const stats = sl.getLiveStats("shark");
    expect(stats.vpip).toBeGreaterThan(0);
    expect(stats.handsObserved).toBe(1);
  });

  it("tracks PFR from preflop raise", () => {
    const sl = new StrategyLearner();
    sl.newHand();
    sl.updateOpponentModel("shark", { action: "raise", amount: 30 }, makeMinimalContext("preflop"));
    const stats = sl.getLiveStats("shark");
    expect(stats.pfr).toBeGreaterThan(0);
  });

  it("fold preflop is not voluntary (VPIP stays 0)", () => {
    const sl = new StrategyLearner();
    sl.newHand();
    sl.updateOpponentModel("rock", { action: "fold" }, makeMinimalContext("preflop"));
    const stats = sl.getLiveStats("rock");
    expect(stats.vpip).toBe(0);
    expect(stats.handsObserved).toBe(0);
  });

  it("aggression factor reflects raises vs calls", () => {
    const sl = new StrategyLearner();
    sl.newHand();
    sl.updateOpponentModel("shark", { action: "raise", amount: 40 }, makeMinimalContext("flop"));
    sl.updateOpponentModel("shark", { action: "raise", amount: 60 }, makeMinimalContext("turn"));
    sl.updateOpponentModel("shark", { action: "call" }, makeMinimalContext("river"));
    const stats = sl.getLiveStats("shark");
    expect(stats.af).toBeCloseTo(2); // 2 raises / 1 call
  });

  it("WTSD updates via recordShowdown", () => {
    const sl = new StrategyLearner();
    sl.newHand();
    sl.updateOpponentModel("rock", { action: "call" }, makeMinimalContext("preflop"));
    sl.recordShowdown("rock", true);
    const stats = sl.getLiveStats("rock");
    expect(stats.wtsd).toBeGreaterThan(0);
  });

  it("newHand resets per-hand flags", () => {
    const sl = new StrategyLearner();
    sl.newHand();
    // Hand 1: shark raises preflop (becomes aggressor)
    sl.updateOpponentModel("shark", { action: "raise" }, makeMinimalContext("preflop"));
    sl.newHand();
    // Hand 2: shark calls on flop (cbet should NOT be attributed without preflop raise this hand)
    sl.updateOpponentModel("shark", { action: "call" }, makeMinimalContext("flop"));
    const stats = sl.getLiveStats("shark");
    // cbetOpportunities should still be 0 for hand 2 since aggressor flag was reset
    expect(stats.cbetFreq).toBe(0);
  });
});

describe("StrategyLearner.adjustStrategy", () => {
  const BASE: import("@pokercrawl/agents").AgentPersonality = {
    aggression: 0.5,
    bluffFrequency: 0.3,
    tiltResistance: 0.7,
    trashTalkLevel: 0.4,
    riskTolerance: 0.5,
  };

  function makeDecision(
    action: import("../src/strategy-learner.js").DecisionRecord["action"],
    netAmount: number,
    wentToShowdown = false,
    wonPot = netAmount > 0
  ): DecisionRecord {
    return {
      action,
      phase: "flop",
      potSize: 100,
      callAmount: 20,
      outcome: { wonPot, netAmount, finalPhase: wentToShowdown ? "showdown" : "flop", wentToShowdown },
    };
  }

  it("returns unchanged personality with no decisions", () => {
    const sl = new StrategyLearner();
    const result = sl.adjustStrategy({ agentId: "shark", handsPlayed: 0, netProfit: 0, decisions: [] }, BASE);
    expect(result.after.aggression).toBe(BASE.aggression);
    expect(result.changes[0]).toMatch(/no decisions/i);
  });

  it("reduces aggression when aggressive plays repeatedly lose", () => {
    const sl = new StrategyLearner();
    const decs: DecisionRecord[] = Array.from({ length: 6 }, () => makeDecision("raise", -30, true, false));
    const result = sl.adjustStrategy({ agentId: "shark", handsPlayed: 6, netProfit: -180, decisions: decs }, BASE);
    expect(result.after.aggression).toBeLessThan(BASE.aggression);
    expect(result.changes.some((c) => /aggress/i.test(c))).toBe(true);
  });

  it("increases aggression when aggressive plays win", () => {
    const sl = new StrategyLearner();
    const decs: DecisionRecord[] = Array.from({ length: 6 }, () => makeDecision("raise", 25, false, true));
    const result = sl.adjustStrategy({ agentId: "shark", handsPlayed: 6, netProfit: 150, decisions: decs }, BASE);
    expect(result.after.aggression).toBeGreaterThan(BASE.aggression);
  });

  it("reduces bluffFrequency when too many bets are called at showdown", () => {
    const sl = new StrategyLearner();
    // 6 bets, 4 called and lost at showdown = 67% catch rate → reduce bluff freq
    const decs: DecisionRecord[] = [
      ...Array.from({ length: 4 }, () => makeDecision("bet", -25, true, false)),
      ...Array.from({ length: 2 }, () => makeDecision("bet", 30, false, true)),
    ];
    const result = sl.adjustStrategy({ agentId: "shark", handsPlayed: 6, netProfit: -40, decisions: decs }, BASE);
    expect(result.after.bluffFrequency).toBeLessThan(BASE.bluffFrequency);
  });

  it("values stay clamped to [0, 1]", () => {
    const sl = new StrategyLearner();
    const extremePersonality: import("@pokercrawl/agents").AgentPersonality = {
      aggression: 0.01,
      bluffFrequency: 0.01,
      tiltResistance: 0.99,
      trashTalkLevel: 0.5,
      riskTolerance: 0.01,
    };
    const decs: DecisionRecord[] = Array.from({ length: 6 }, () => makeDecision("raise", -50, true, false));
    const result = sl.adjustStrategy({ agentId: "shark", handsPlayed: 6, netProfit: -300, decisions: decs }, extremePersonality);
    expect(result.after.aggression).toBeGreaterThanOrEqual(0);
    expect(result.after.bluffFrequency).toBeGreaterThanOrEqual(0);
    expect(result.after.riskTolerance).toBeGreaterThanOrEqual(0);
  });
});

describe("StrategyLearner.recordHand / buildSessionResults", () => {
  it("extracts decision records from a hand", () => {
    const sl = new StrategyLearner();
    sl.recordHand(
      makeHand({
        actions: [
          { agentId: "shark", action: "raise", phase: "preflop" },
          { agentId: "rock", action: "fold", phase: "preflop" },
        ],
        endStacks: { shark: 120, rock: 80 },
      })
    );
    const session = sl.buildSessionResults("shark", 20, 1);
    expect(session.decisions).toHaveLength(1);
    expect(session.decisions[0]?.action).toBe("raise");
  });

  it("clearSession removes accumulated decisions", () => {
    const sl = new StrategyLearner();
    sl.recordHand(makeHand());
    sl.clearSession("shark");
    const session = sl.buildSessionResults("shark", 0, 0);
    expect(session.decisions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TrainingLoop (integration)
// ---------------------------------------------------------------------------

describe("TrainingLoop", () => {
  it(
    "runs 5 hands and returns valid results",
    async () => {
      const loop = new TrainingLoop();
      const result = await loop.run(5, {
        startingTokens: 500,
        decisionTimeoutMs: 3_000,
      });

      expect(result.handsPlayed).toBeGreaterThan(0);
      expect(result.handsPlayed).toBeLessThanOrEqual(5);
      expect(result.eloRankings.length).toBeGreaterThan(0);
      expect(result.recommendations.length).toBe(5); // one per agent
      expect(Object.keys(result.agentStats)).toContain("shark");
    },
    30_000
  );

  it(
    "accumulates history across multiple runs",
    async () => {
      const loop = new TrainingLoop();
      await loop.run(3, { decisionTimeoutMs: 3_000 });
      await loop.run(3, { decisionTimeoutMs: 3_000 });
      const hands = loop.getDb().getHands();
      expect(hands.length).toBeGreaterThan(3);
    },
    60_000
  );
});

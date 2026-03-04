/**
 * training-core.test.ts — Spec-requested tests for @pokercrawl/training
 *
 * Covers: OpponentModel (VPIP/PFR/AF), PotOdds, ELO, HandHistoryDB,
 *         classifyPlayer (rock/tag/lag/calling-station/maniac/unknown).
 */

import { describe, it, expect } from "vitest";

import { HandHistoryDb }                           from "../src/hand-history-db.js";
import type { HandRecord }                          from "../src/hand-history-db.js";
import { OpponentModel, classifyPlayer }            from "../src/opponent-model.js";
import { potOdds, impliedOdds, isCallProfitable, callEV } from "../src/pot-odds-calculator.js";
import { EloRating }                               from "../src/elo-rating.js";
import { getPosition, positionMultiplier }          from "../src/position-evaluator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHand(overrides: Partial<HandRecord> = {}): HandRecord {
  return {
    handNumber: 1,
    timestamp:  Date.now(),
    agents:     ["shark", "rock"],
    actions:    [],
    winners:    [{ agentId: "shark", amountWon: 20, hand: null }],
    startStacks: { shark: 100, rock: 100 },
    endStacks:   { shark: 120, rock: 80 },
    finalPhase:  "showdown",
    ...overrides,
  };
}

/** Seed N identical hands into a fresh DB for one agent. */
function seedHands(db: HandHistoryDb, agentId: string, n: number, actions: HandRecord["actions"]) {
  for (let i = 0; i < n; i++) {
    db.addHand(makeHand({ handNumber: i, agents: [agentId, "dummy"], actions,
      startStacks: { [agentId]: 100, dummy: 100 },
      endStacks:   { [agentId]: 100, dummy: 100 },
      winners: [] }));
  }
}

// ---------------------------------------------------------------------------
// 1. HandHistoryDB
// ---------------------------------------------------------------------------

describe("HandHistoryDB — save & retrieve", () => {
  it("starts empty", () => {
    const db = new HandHistoryDb();
    expect(db.getHands()).toHaveLength(0);
  });

  it("stores multiple hands and retrieves them all", () => {
    const db = new HandHistoryDb();
    db.addHand(makeHand({ handNumber: 1 }));
    db.addHand(makeHand({ handNumber: 2 }));
    expect(db.getHands()).toHaveLength(2);
  });

  it("returns zero stats for unknown agent", () => {
    const db    = new HandHistoryDb();
    const stats = db.computeStats("nobody");
    expect(stats.handsPlayed).toBe(0);
    expect(stats.vpip).toBe(0);
    expect(stats.wtsd).toBe(0);
  });

  it("tracks profit across multiple hands", () => {
    const db = new HandHistoryDb();
    db.addHand(makeHand()); // shark +20
    db.addHand(makeHand({ handNumber: 2, endStacks: { shark: 140, rock: 60 } })); // shark +40
    expect(db.computeStats("shark").totalProfit).toBe(60);
  });

  it("clear() empties the store", () => {
    const db = new HandHistoryDb();
    db.addHand(makeHand());
    db.clear();
    expect(db.getHands()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. OpponentModel — VPIP / PFR / AF
// ---------------------------------------------------------------------------

describe("OpponentModel — VPIP, PFR, AF", () => {
  it("VPIP = 1 when agent calls preflop every hand", () => {
    const db = new HandHistoryDb();
    seedHands(db, "shark", 5, [{ agentId: "shark", action: "call", phase: "preflop" }]);
    expect(db.computeStats("shark").vpip).toBe(1);
  });

  it("VPIP = 0 when agent folds preflop every hand", () => {
    const db = new HandHistoryDb();
    seedHands(db, "rock", 5, [{ agentId: "rock", action: "fold", phase: "preflop" }]);
    expect(db.computeStats("rock").vpip).toBe(0);
  });

  it("PFR = 1 when agent raises preflop every hand", () => {
    const db = new HandHistoryDb();
    seedHands(db, "shark", 5, [{ agentId: "shark", action: "raise", phase: "preflop" }]);
    expect(db.computeStats("shark").pfr).toBe(1);
  });

  it("AF = raises / calls across all streets", () => {
    const db = new HandHistoryDb();
    db.addHand(makeHand({
      agents: ["shark", "rock"],
      actions: [
        { agentId: "shark", action: "raise", phase: "flop" },
        { agentId: "shark", action: "raise", phase: "turn" },
        { agentId: "shark", action: "call",  phase: "river" },
      ],
    }));
    expect(db.computeStats("shark").af).toBeCloseTo(2);
  });

  it("WTSD reflects showdown frequency", () => {
    const db = new HandHistoryDb();
    // 4 showdown hands + 1 preflop-end hand
    for (let i = 0; i < 4; i++) {
      db.addHand(makeHand({ handNumber: i, agents: ["shark", "rock"],
        finalPhase: "showdown", actions: [] }));
    }
    db.addHand(makeHand({ handNumber: 4, agents: ["shark", "rock"],
      finalPhase: "preflop",
      actions: [{ agentId: "shark", action: "fold", phase: "preflop" }] }));
    // shark reached showdown in 4/5 hands but folded in 1 (preflop) → wtsd = 4/5
    expect(db.computeStats("shark").wtsd).toBeCloseTo(4 / 5);
  });
});

// ---------------------------------------------------------------------------
// 3. classifyPlayer
// ---------------------------------------------------------------------------

describe("classifyPlayer — 6 archetypes", () => {
  function statsFor(vpip: number, af: number, n = 20) {
    return { handsPlayed: n, handsWon: 0, vpip, pfr: vpip * 0.5, af,
             showdownWR: 0.5, wtsd: 0.4, totalProfit: 0 };
  }

  it("'unknown' when fewer than 5 hands", () => {
    expect(classifyPlayer(statsFor(0.5, 4, 3))).toBe("unknown");
  });

  it("'rock' → tight + passive (VPIP 0.10, AF 0.8)", () => {
    expect(classifyPlayer(statsFor(0.10, 0.8))).toBe("rock");
  });

  it("'tag' → tight + aggressive (VPIP 0.20, AF 2.5)", () => {
    expect(classifyPlayer(statsFor(0.20, 2.5))).toBe("tag");
  });

  it("'lag' → loose + aggressive (VPIP 0.40, AF 2.0)", () => {
    expect(classifyPlayer(statsFor(0.40, 2.0))).toBe("lag");
  });

  it("'calling-station' → loose + passive (VPIP 0.60, AF 0.5)", () => {
    expect(classifyPlayer(statsFor(0.60, 0.5))).toBe("calling-station");
  });

  it("'maniac' → extreme loose + extreme aggressive (VPIP 0.70, AF 5)", () => {
    expect(classifyPlayer(statsFor(0.70, 5))).toBe("maniac");
  });

  it("OpponentModel.classifyPlayer delegates correctly", () => {
    const db    = new HandHistoryDb();
    const model = new OpponentModel(db);
    // Rock folds every hand — tight + passive
    seedHands(db, "rock", 10, [{ agentId: "rock", action: "fold", phase: "preflop" }]);
    expect(model.classifyPlayer("rock")).toBe("rock");
  });
});

// ---------------------------------------------------------------------------
// 4. PotOdds
// ---------------------------------------------------------------------------

describe("PotOdds calculator", () => {
  it("potOdds(50, 200) = 0.20", () => {
    expect(potOdds(50, 200)).toBeCloseTo(0.2);
  });

  it("potOdds(0, 200) = 0 (free to check)", () => {
    expect(potOdds(0, 200)).toBe(0);
  });

  it("impliedOdds credits future winnings", () => {
    // 50 / (200 + 50 + 100) = 50/350
    expect(impliedOdds(50, 200, 100)).toBeCloseTo(50 / 350);
  });

  it("isCallProfitable — 30% equity beats 20% pot odds", () => {
    expect(isCallProfitable(0.30, 50, 200)).toBe(true);
  });

  it("isCallProfitable — 10% equity loses to 20% pot odds", () => {
    expect(isCallProfitable(0.10, 50, 200)).toBe(false);
  });

  it("callEV: 0.6 equity, call=50, pot=200 → EV=100", () => {
    expect(callEV(0.6, 50, 200)).toBeCloseTo(100);
  });
});

// ---------------------------------------------------------------------------
// 5. ELO
// ---------------------------------------------------------------------------

describe("EloRating", () => {
  it("default rating is 1200", () => {
    expect(new EloRating().getRating("x")).toBe(1200);
  });

  it("winner gains ELO, loser loses ELO", () => {
    const elo = new EloRating();
    elo.updateAfterHand(["shark"], ["rock"]);
    expect(elo.getRating("shark")).toBeGreaterThan(1200);
    expect(elo.getRating("rock")).toBeLessThan(1200);
  });

  it("ratings are zero-sum (both start at 1200, sum stays 2400)", () => {
    const elo = new EloRating();
    elo.updateAfterHand(["a"], ["b"]);
    expect(elo.getRating("a") + elo.getRating("b")).toBeCloseTo(2400);
  });

  it("rankings sorted highest first", () => {
    const elo = new EloRating();
    elo.updateAfterHand(["shark"], ["rock"]);
    const [first] = elo.getRankings();
    expect(first?.agentId).toBe("shark");
  });

  it("multi-player: winner gains against every loser", () => {
    const elo = new EloRating();
    elo.updateAfterHand(["shark"], ["rock", "mago"]);
    expect(elo.getRating("shark")).toBeGreaterThan(1200);
    expect(elo.getRating("rock")).toBeLessThan(1200);
    expect(elo.getRating("mago")).toBeLessThan(1200);
  });
});

// ---------------------------------------------------------------------------
// 6. Position evaluator
// ---------------------------------------------------------------------------

describe("PositionEvaluator", () => {
  it("dealer = late position", () => {
    expect(getPosition(0, 0, 6)).toBe("late");
  });

  it("SB = blinds position", () => {
    expect(getPosition(1, 0, 6)).toBe("blinds");
  });

  it("late position multiplier > early", () => {
    expect(positionMultiplier("late")).toBeGreaterThan(positionMultiplier("early"));
  });
});

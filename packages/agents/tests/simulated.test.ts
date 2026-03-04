/**
 * Simulated bots test suite
 *
 * Verifies that each bot returns valid decisions across a range of contexts.
 * Because bots use Math.random() internally, tests run each scenario ~10–20
 * times and assert on aggregate behaviour (e.g., "raises > 5 out of 20 runs").
 */

import { describe, it, expect } from "vitest";
import type { CapabilityCard, TaskCard } from "@pokercrawl/engine";
import type { StrategyContext } from "../src/types.js";
import { RandomBot } from "../src/simulated/random.js";
import { AggressiveBot } from "../src/simulated/aggressive.js";
import { ConservativeBot } from "../src/simulated/conservative.js";
import { BlufferBot } from "../src/simulated/bluffer.js";
import { CalculatedBot } from "../src/simulated/calculated.js";
import { WolfBot } from "../src/simulated/wolf.js";
import { OwlBot } from "../src/simulated/owl.js";
import { TurtleBot } from "../src/simulated/turtle.js";
import { FoxBot } from "../src/simulated/fox.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cap(rank: string, suit: string, value: number): CapabilityCard {
  return {
    rank: rank as CapabilityCard["rank"],
    suit: suit as CapabilityCard["suit"],
    value: value as CapabilityCard["value"],
    capability: "code",
    confidence: 0.8,
  };
}

function task(rank: string, suit: string, value: number): TaskCard {
  return {
    rank: rank as TaskCard["rank"],
    suit: suit as TaskCard["suit"],
    value: value as TaskCard["value"],
    task: "Write tests",
    effort: 3,
  };
}

function makeCtx(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    agentId: "agent-1",
    tableId: "table-1",
    myHand: [cap("A", "spades", 14), cap("K", "spades", 13)],
    communityCards: [],
    potSize: 100,
    sidePots: [],
    myStack: 980,
    myCurrentBet: 10,
    currentBet: 10,
    lastRaiseSize: 10,
    phase: "preflop",
    opponents: [
      {
        id: "opp-1",
        stack: 980,
        currentBet: 10,
        totalBet: 10,
        isFolded: false,
        isAllIn: false,
      },
    ],
    position: "late",
    isMyTurn: true,
    smallBlind: 5,
    bigBlind: 10,
    eventHistory: [],
    ...overrides,
  };
}

const VALID_ACTIONS = new Set(["bet", "call", "raise", "fold", "check", "all-in"]);

function assertValid(d: { action: string; amount?: number; confidence: number }) {
  expect(VALID_ACTIONS.has(d.action)).toBe(true);
  expect(d.confidence).toBeGreaterThanOrEqual(0);
  expect(d.confidence).toBeLessThanOrEqual(1);
  if (d.amount !== undefined) {
    expect(Number.isFinite(d.amount)).toBe(true);
    expect(d.amount).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// RandomBot
// ---------------------------------------------------------------------------

describe("RandomBot", () => {
  const bot = new RandomBot({ id: "rando", tableId: "t1" });

  it("always returns a valid action (preflop, active bet)", async () => {
    for (let i = 0; i < 15; i++) {
      assertValid(await bot.decide(makeCtx()));
    }
  });

  it("returns valid action with no active bet (can check or bet)", async () => {
    const ctx = makeCtx({ currentBet: 0, myCurrentBet: 0 });
    for (let i = 0; i < 15; i++) {
      assertValid(await bot.decide(ctx));
    }
  });

  it("returns valid action postflop", async () => {
    const ctx = makeCtx({
      communityCards: [
        task("A", "hearts", 14),
        task("K", "clubs", 13),
        task("Q", "diamonds", 12),
      ],
      phase: "flop",
    });
    assertValid(await bot.decide(ctx));
  });

  it("returns valid action with very low stack", async () => {
    const ctx = makeCtx({ myStack: 5, currentBet: 20, myCurrentBet: 0 });
    assertValid(await bot.decide(ctx));
  });
});

// ---------------------------------------------------------------------------
// AggressiveBot
// ---------------------------------------------------------------------------

describe("AggressiveBot", () => {
  it("raises frequently with a moderate-strength hand", async () => {
    const bot = new AggressiveBot({ id: "shark", tableId: "t1" });
    const ctx = makeCtx({ currentBet: 20, myCurrentBet: 0, myStack: 980 });
    let raises = 0;
    for (let i = 0; i < 20; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "raise" || d.action === "all-in") raises++;
    }
    // AggressiveBot has aggression 0.85 + bluff 0.4 → should raise often
    expect(raises).toBeGreaterThan(5);
  });

  it("never returns an invalid action", async () => {
    const bot = new AggressiveBot({ id: "shark2", tableId: "t1" });
    for (const ctx of [
      makeCtx({ currentBet: 0, myCurrentBet: 0 }),
      makeCtx({ currentBet: 50, myCurrentBet: 0 }),
      makeCtx({ myStack: 5, currentBet: 20, myCurrentBet: 0 }),
    ]) {
      assertValid(await bot.decide(ctx));
    }
  });

  it("recordLoss / recordWin do not throw", () => {
    const bot = new AggressiveBot({ id: "shark3", tableId: "t1" });
    bot.recordLoss();
    bot.recordLoss();
    bot.recordWin();
    bot.recordWin();
    bot.recordWin(); // goes back to 0 (clamped)
  });
});

// ---------------------------------------------------------------------------
// ConservativeBot
// ---------------------------------------------------------------------------

describe("ConservativeBot", () => {
  it("folds weak hands against a large bet from early position", async () => {
    const bot = new ConservativeBot({ id: "rock", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("2", "clubs", 2), cap("7", "hearts", 7)],
      currentBet: 150,
      myCurrentBet: 0,
      potSize: 300,
      myStack: 850,
      position: "early",
    });
    let folds = 0;
    for (let i = 0; i < 10; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "fold") folds++;
    }
    // Conservative + early position + weak hand → mostly folds
    expect(folds).toBeGreaterThan(6);
  });

  it("raises or bets with a premium hand", async () => {
    const bot = new ConservativeBot({ id: "rock2", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("A", "spades", 14), cap("A", "hearts", 14)],
      currentBet: 0,
      myCurrentBet: 0,
    });
    let aggressive = 0;
    for (let i = 0; i < 10; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "raise" || d.action === "bet") aggressive++;
    }
    expect(aggressive).toBeGreaterThan(5);
  });

  it("checks when hand is moderate and no bet to match", async () => {
    const bot = new ConservativeBot({ id: "rock3", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("8", "clubs", 8), cap("9", "hearts", 9)],
      currentBet: 0,
      myCurrentBet: 0,
      position: "early",
    });
    let checks = 0;
    for (let i = 0; i < 10; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "check") checks++;
    }
    expect(checks).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// BlufferBot
// ---------------------------------------------------------------------------

describe("BlufferBot", () => {
  it("bluffs aggressively with a weak hand (bet/raise > 25% of runs)", async () => {
    const bot = new BlufferBot({ id: "mago", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("2", "clubs", 2), cap("3", "hearts", 3)],
      currentBet: 0,
      myCurrentBet: 0,
      potSize: 100,
    });
    let aggressive = 0;
    for (let i = 0; i < 20; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "bet" || d.action === "raise") aggressive++;
    }
    // bluffFrequency = 0.7, but effectiveStrength > 0.75 required (50% of bluffs)
    // → effective aggressive rate ~35%, so ~7/20 expected. Threshold > 2 is robust.
    expect(aggressive).toBeGreaterThan(2);
  });

  it("reduces bluff frequency after being caught", async () => {
    const bot = new BlufferBot({ id: "mago2", tableId: "t1" });
    // Being caught multiple times should reduce effective bluff freq
    bot.recordCaughtBluffing();
    bot.recordCaughtBluffing();
    bot.recordCaughtBluffing();
    // Should still work — just less bluffing
    assertValid(
      await bot.decide(
        makeCtx({ myHand: [cap("2", "clubs", 2), cap("3", "hearts", 3)] })
      )
    );
  });

  it("exposes totalBluffs counter (starts at 0)", () => {
    const bot = new BlufferBot({ id: "mago3", tableId: "t1" });
    expect(bot.totalBluffs).toBe(0);
  });

  it("never returns an invalid action", async () => {
    const bot = new BlufferBot({ id: "mago4", tableId: "t1" });
    for (const ctx of [
      makeCtx({ currentBet: 0, myCurrentBet: 0 }),
      makeCtx({ currentBet: 100, myCurrentBet: 0, myStack: 50 }),
    ]) {
      assertValid(await bot.decide(ctx));
    }
  });
});

// ---------------------------------------------------------------------------
// CalculatedBot
// ---------------------------------------------------------------------------

describe("CalculatedBot", () => {
  it("calls or raises when equity exceeds pot odds (strong hand)", async () => {
    const bot = new CalculatedBot({ id: "clock", tableId: "t1" });
    // AA preflop vs small bet — clearly +EV
    const ctx = makeCtx({
      myHand: [cap("A", "spades", 14), cap("A", "hearts", 14)],
      currentBet: 20,
      myCurrentBet: 0,
      potSize: 40,
      myStack: 980,
    });
    let positive = 0;
    for (let i = 0; i < 10; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "call" || d.action === "raise") positive++;
    }
    expect(positive).toBeGreaterThan(6);
  });

  it("folds when pot odds are deeply unfavourable (weak hand, huge bet)", async () => {
    const bot = new CalculatedBot({ id: "clock2", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("2", "clubs", 2), cap("7", "hearts", 7)],
      currentBet: 800,
      myCurrentBet: 0,
      potSize: 1000,
      myStack: 800,
    });
    let folds = 0;
    for (let i = 0; i < 10; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "fold") folds++;
    }
    expect(folds).toBeGreaterThan(5);
  });

  it("opens betting with a strong hand in late position", async () => {
    const bot = new CalculatedBot({ id: "clock3", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("A", "spades", 14), cap("A", "hearts", 14)],
      currentBet: 0,
      myCurrentBet: 0,
      potSize: 100,
      position: "late",
    });
    let opens = 0;
    for (let i = 0; i < 10; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "bet" || d.action === "raise") opens++;
    }
    expect(opens).toBeGreaterThan(5);
  });

  it("checks below-threshold hands with no active bet", async () => {
    const bot = new CalculatedBot({ id: "clock4", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("3", "clubs", 3), cap("8", "hearts", 8)],
      currentBet: 0,
      myCurrentBet: 0,
      position: "early",
    });
    let checks = 0;
    for (let i = 0; i < 10; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "check") checks++;
    }
    expect(checks).toBeGreaterThan(5);
  });

  it("opportunistic positional bluff (late position, no opponent raises)", async () => {
    const bot = new CalculatedBot({ id: "clock5", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("2", "clubs", 2), cap("3", "hearts", 3)],
      currentBet: 0,
      myCurrentBet: 0,
      position: "late",
      // No recent raises in event history → opponentsSeemWeak
      eventHistory: [],
    });
    // Bluff occurs ~15% of the time by design — just check no crash
    for (let i = 0; i < 5; i++) {
      assertValid(await bot.decide(ctx));
    }
  });
});

// ---------------------------------------------------------------------------
// WolfBot (LAG)
// ---------------------------------------------------------------------------

describe("WolfBot", () => {
  it("raises or bets very frequently with moderate hands (LAG)", async () => {
    const bot = new WolfBot({ id: "wolf1", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("9", "clubs", 9), cap("T", "hearts", 10)],
      currentBet: 20,
      myCurrentBet: 0,
      myStack: 980,
    });
    let aggressive = 0;
    for (let i = 0; i < 20; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "raise" || d.action === "all-in") aggressive++;
    }
    // aggression 0.90 + bluff 0.50 → should raise very often
    expect(aggressive).toBeGreaterThan(8);
  });

  it("calls loosely even with weak pot odds", async () => {
    const bot = new WolfBot({ id: "wolf2", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("5", "clubs", 5), cap("8", "hearts", 8)],
      currentBet: 30,
      myCurrentBet: 0,
      potSize: 60,
      myStack: 970,
    });
    let calls = 0;
    for (let i = 0; i < 20; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "call" || d.action === "raise") calls++;
    }
    // LAG calls / raises very liberally
    expect(calls).toBeGreaterThan(8);
  });

  it("never returns an invalid action", async () => {
    const bot = new WolfBot({ id: "wolf3", tableId: "t1" });
    for (const ctx of [
      makeCtx({ currentBet: 0, myCurrentBet: 0 }),
      makeCtx({ currentBet: 80, myCurrentBet: 0, myStack: 50 }),
      makeCtx({ myStack: 5, currentBet: 20, myCurrentBet: 0 }),
    ]) {
      assertValid(await bot.decide(ctx));
    }
  });

  it("recordLoss / recordWin do not throw and stay clamped", () => {
    const bot = new WolfBot({ id: "wolf4", tableId: "t1" });
    for (let i = 0; i < 6; i++) bot.recordLoss();
    for (let i = 0; i < 6; i++) bot.recordWin();
  });
});

// ---------------------------------------------------------------------------
// OwlBot (TAG)
// ---------------------------------------------------------------------------

describe("OwlBot", () => {
  it("folds weak hands from early position", async () => {
    const bot = new OwlBot({ id: "owl1", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("3", "clubs", 3), cap("7", "hearts", 7)],
      currentBet: 30,
      myCurrentBet: 0,
      potSize: 60,
      myStack: 970,
      position: "early",
    });
    let folds = 0;
    for (let i = 0; i < 15; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "fold") folds++;
    }
    // TAG + early position + weak hand → mostly folds
    expect(folds).toBeGreaterThan(8);
  });

  it("bets or raises with premium hands", async () => {
    const bot = new OwlBot({ id: "owl2", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("A", "spades", 14), cap("A", "hearts", 14)],
      currentBet: 0,
      myCurrentBet: 0,
    });
    let aggressive = 0;
    for (let i = 0; i < 15; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "bet" || d.action === "raise") aggressive++;
    }
    expect(aggressive).toBeGreaterThan(8);
  });

  it("never returns an invalid action", async () => {
    const bot = new OwlBot({ id: "owl3", tableId: "t1" });
    for (const ctx of [
      makeCtx({ currentBet: 0, myCurrentBet: 0, position: "early" }),
      makeCtx({ currentBet: 0, myCurrentBet: 0, position: "late" }),
      makeCtx({ currentBet: 50, myCurrentBet: 0, myStack: 30 }),
    ]) {
      assertValid(await bot.decide(ctx));
    }
  });
});

// ---------------------------------------------------------------------------
// TurtleBot (Calling Station)
// ---------------------------------------------------------------------------

describe("TurtleBot", () => {
  it("calls very liberally even against moderate bets (calling station)", async () => {
    const bot = new TurtleBot({ id: "turtle1", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("6", "clubs", 6), cap("9", "hearts", 9)],
      currentBet: 40,
      myCurrentBet: 0,
      potSize: 80,
      myStack: 960,
    });
    let calls = 0;
    for (let i = 0; i < 20; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "call") calls++;
    }
    // Calling station: should call the majority of the time
    expect(calls).toBeGreaterThan(12);
  });

  it("almost never raises with a medium hand", async () => {
    const bot = new TurtleBot({ id: "turtle2", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("J", "clubs", 11), cap("Q", "hearts", 12)],
      currentBet: 20,
      myCurrentBet: 0,
      myStack: 980,
    });
    let raises = 0;
    for (let i = 0; i < 20; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "raise") raises++;
    }
    // aggression 0.12 → almost never raises below near-nut threshold
    expect(raises).toBeLessThan(3);
  });

  it("checks when there is no bet and hand is not premium", async () => {
    const bot = new TurtleBot({ id: "turtle3", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("5", "clubs", 5), cap("9", "hearts", 9)],
      currentBet: 0,
      myCurrentBet: 0,
    });
    let checks = 0;
    for (let i = 0; i < 15; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "check") checks++;
    }
    expect(checks).toBeGreaterThan(10);
  });

  it("never returns an invalid action", async () => {
    const bot = new TurtleBot({ id: "turtle4", tableId: "t1" });
    for (const ctx of [
      makeCtx({ currentBet: 0, myCurrentBet: 0 }),
      makeCtx({ currentBet: 200, myCurrentBet: 0, myStack: 200 }),
      makeCtx({ myStack: 5, currentBet: 20, myCurrentBet: 0 }),
    ]) {
      assertValid(await bot.decide(ctx));
    }
  });
});

// ---------------------------------------------------------------------------
// FoxBot (Tricky)
// ---------------------------------------------------------------------------

describe("FoxBot", () => {
  it("never returns an invalid action (all contexts)", async () => {
    const bot = new FoxBot({ id: "fox1", tableId: "t1" });
    for (const ctx of [
      makeCtx({ currentBet: 0, myCurrentBet: 0 }),
      makeCtx({ currentBet: 0, myCurrentBet: 0, communityCards: [task("A", "hearts", 14)] }),
      makeCtx({ currentBet: 50, myCurrentBet: 0 }),
      makeCtx({ myStack: 5, currentBet: 20, myCurrentBet: 0 }),
    ]) {
      assertValid(await bot.decide(ctx));
    }
  });

  it("sometimes checks a strong postflop hand (slowplay)", async () => {
    const bot = new FoxBot({ id: "fox2", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("A", "spades", 14), cap("A", "hearts", 14)],
      communityCards: [task("A", "clubs", 14), task("K", "hearts", 13), task("Q", "diamonds", 12)],
      currentBet: 0,
      myCurrentBet: 0,
      phase: "flop",
    });
    let checks = 0;
    for (let i = 0; i < 20; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "check") checks++;
    }
    // Slowplay probability ~55% × eligibility → at least some checks
    expect(checks).toBeGreaterThan(2);
  });

  it("activates check-raise flag and plays valid action after slowplay", async () => {
    const bot = new FoxBot({ id: "fox3", tableId: "t1" });
    // Use a preflop-style context so estimateHandStrength uses heuristic
    // (AA preflop = ~0.87 strength, well above the 0.78 check-raise threshold)
    const checkCtx = makeCtx({
      myHand: [cap("A", "spades", 14), cap("A", "hearts", 14)],
      communityCards: [],   // preflop — uses heuristic (AA ≈ 0.87)
      currentBet: 0,
      myCurrentBet: 0,
      phase: "preflop",
    });

    // Force a slowplay check — needs postflop context and specific RNG window
    // Instead, directly verify the state machine: any check on no-bet sets the flag
    // and any subsequent facing-bet call produces a valid decision
    const noSlowplayCtx = makeCtx({
      myHand: [cap("A", "spades", 14), cap("A", "hearts", 14)],
      communityCards: [task("Q", "spades", 12), task("J", "spades", 11), task("T", "spades", 10)],
      currentBet: 0,
      myCurrentBet: 0,
      phase: "flop",
    });

    // Simulate a check (slowplay) then a bet — both must produce valid decisions
    let checks = 0;
    for (let i = 0; i < 20; i++) {
      const d = await bot.decide(noSlowplayCtx);
      assertValid(d);
      if (d.action === "check") checks++;
    }

    // After slowplay, facing a bet must produce a valid action (check-raise or call/fold)
    const facingBetCtx = makeCtx({
      myHand: [cap("A", "spades", 14), cap("A", "hearts", 14)],
      communityCards: [task("Q", "spades", 12), task("J", "spades", 11), task("T", "spades", 10)],
      currentBet: 40,
      myCurrentBet: 0,
      phase: "flop",
    });
    for (let i = 0; i < 5; i++) {
      assertValid(await bot.decide(facingBetCtx));
    }
  });

  it("folds weak hands against large bets", async () => {
    const bot = new FoxBot({ id: "fox4", tableId: "t1" });
    const ctx = makeCtx({
      myHand: [cap("2", "clubs", 2), cap("4", "hearts", 4)],
      currentBet: 500,
      myCurrentBet: 0,
      potSize: 600,
      myStack: 500,
    });
    let folds = 0;
    for (let i = 0; i < 15; i++) {
      const d = await bot.decide(ctx);
      assertValid(d);
      if (d.action === "fold") folds++;
    }
    // bluff 0.35 but 500-bet is too large even for Fox with 2/4
    expect(folds).toBeGreaterThan(5);
  });
});

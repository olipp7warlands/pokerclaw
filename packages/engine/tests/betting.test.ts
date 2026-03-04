import { describe, expect, it, beforeEach } from "vitest";
import {
  advanceAction,
  applyAction,
  BettingError,
  calculatePots,
  isBettingRoundComplete,
  isHandAllIn,
  postAntes,
  postBlinds,
  resetBettingRound,
  validateAction,
} from "../src/betting.js";
import { createGame, startHand } from "../src/game.js";
import type { AgentSeat, GameState, PlayerAction } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(): GameState {
  const state = createGame({
    smallBlind: 5,
    bigBlind: 10,
    agents: [
      { agentId: "alice", stack: 1000 },
      { agentId: "bob",   stack: 1000 },
      { agentId: "carol", stack: 1000 },
    ],
  });
  startHand(state, 5, 10);
  return state;
}

function seat(state: GameState, id: string): AgentSeat {
  const s = state.seats.find((s) => s.agentId === id);
  if (!s) throw new Error(`No seat for ${id}`);
  return s;
}

// ---------------------------------------------------------------------------
// Blind posting
// ---------------------------------------------------------------------------
describe("postBlinds", () => {
  it("posts small and big blind correctly", () => {
    const state = makeState();
    // Dealer=0 (alice), SB=1 (bob), BB=2 (carol)
    const sb = seat(state, "bob");
    const bb = seat(state, "carol");
    expect(sb.currentBet).toBe(5);
    expect(bb.currentBet).toBe(10);
    expect(state.currentBet).toBe(10);
    expect(state.mainPot).toBe(15);
  });

  it("throws with fewer than 2 players", () => {
    const state = createGame({
      smallBlind: 5,
      bigBlind: 10,
      agents: [{ agentId: "alone", stack: 100 }],
    });
    expect(() => postBlinds(state, 5, 10)).toThrow(BettingError);
  });

  it("skips sitting-out players when assigning SB/BB", () => {
    // dealer=alice(0), bob(1) is sitting-out, carol(2) is next
    const state = createGame({
      smallBlind: 5,
      bigBlind: 10,
      agents: [
        { agentId: "alice", stack: 200 },
        { agentId: "bob",   stack: 0 },   // will be sitting-out
        { agentId: "carol", stack: 200 },
      ],
    });
    // Mark bob as sitting-out (0-stack)
    state.seats.find((s) => s.agentId === "bob")!.status = "sitting-out";

    postBlinds(state, 5, 10);

    // SB should be carol (first playing seat after dealer alice)
    // BB should be alice (next playing seat after carol, wraps around)
    expect(seat(state, "carol").currentBet).toBe(5);
    expect(seat(state, "alice").currentBet).toBe(10);
    expect(seat(state, "bob").currentBet).toBe(0);
  });

  it("throws when all players except one are sitting-out", () => {
    const state = createGame({
      smallBlind: 5,
      bigBlind: 10,
      agents: [
        { agentId: "alice", stack: 200 },
        { agentId: "bob",   stack: 0 },
      ],
    });
    state.seats.find((s) => s.agentId === "bob")!.status = "sitting-out";
    expect(() => postBlinds(state, 5, 10)).toThrow(BettingError);
  });
});

// ---------------------------------------------------------------------------
// Antes
// ---------------------------------------------------------------------------

describe("postAntes", () => {
  it("deducts ante from each non-sitting-out player and adds to pot", () => {
    const state = createGame({
      smallBlind: 5,
      bigBlind: 10,
      agents: [
        { agentId: "alice", stack: 100 },
        { agentId: "bob",   stack: 100 },
        { agentId: "carol", stack: 100 },
      ],
    });

    postAntes(state, 5);

    expect(seat(state, "alice").stack).toBe(95);
    expect(seat(state, "bob").stack).toBe(95);
    expect(seat(state, "carol").stack).toBe(95);
    expect(state.mainPot).toBe(15);
  });

  it("skips sitting-out players for antes", () => {
    const state = createGame({
      smallBlind: 5,
      bigBlind: 10,
      agents: [
        { agentId: "alice", stack: 100 },
        { agentId: "bob",   stack: 0 },
        { agentId: "carol", stack: 100 },
      ],
    });
    state.seats.find((s) => s.agentId === "bob")!.status = "sitting-out";

    postAntes(state, 5);

    expect(seat(state, "alice").stack).toBe(95);
    expect(seat(state, "bob").stack).toBe(0);   // untouched
    expect(seat(state, "carol").stack).toBe(95);
    expect(state.mainPot).toBe(10); // only 2 players ante'd
  });

  it("is a no-op when ante is 0", () => {
    const state = createGame({
      smallBlind: 5,
      bigBlind: 10,
      agents: [
        { agentId: "alice", stack: 100 },
        { agentId: "bob",   stack: 100 },
      ],
    });
    postAntes(state, 0);
    expect(state.mainPot).toBe(0);
  });

  it("adds ante to totalBet (affects side pot calculations)", () => {
    const state = createGame({
      smallBlind: 5,
      bigBlind: 10,
      agents: [
        { agentId: "alice", stack: 100 },
        { agentId: "bob",   stack: 100 },
      ],
    });
    postAntes(state, 10);
    expect(seat(state, "alice").totalBet).toBe(10);
    expect(seat(state, "bob").totalBet).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// validateAction
// ---------------------------------------------------------------------------
describe("validateAction", () => {
  it("rejects action from wrong agent", () => {
    const state = makeState();
    const action: PlayerAction = { agentId: "carol", type: "fold", amount: 0 };
    // Action is on alice (left of BB=carol, so seat index 0 = alice)
    expect(() => validateAction(state, action)).toThrow(BettingError);
  });

  it("rejects check when there's a bet to call", () => {
    const state = makeState();
    // actionOnIndex should be on alice (she is left of the BB)
    const actingSeat = state.seats[state.actionOnIndex]!;
    const action: PlayerAction = { agentId: actingSeat.agentId, type: "check", amount: 0 };
    expect(() => validateAction(state, action)).toThrow(BettingError);
  });

  it("rejects raise below minimum", () => {
    const state = makeState();
    const actingSeat = state.seats[state.actionOnIndex]!;
    // Min raise = currentBet (10) + lastRaiseAmount (10) = 20
    const action: PlayerAction = { agentId: actingSeat.agentId, type: "raise", amount: 15 };
    expect(() => validateAction(state, action)).toThrow(BettingError);
  });

  it("accepts a valid fold", () => {
    const state = makeState();
    const actingSeat = state.seats[state.actionOnIndex]!;
    const action: PlayerAction = { agentId: actingSeat.agentId, type: "fold", amount: 0 };
    expect(() => validateAction(state, action)).not.toThrow();
  });

  it("accepts a valid raise", () => {
    const state = makeState();
    const actingSeat = state.seats[state.actionOnIndex]!;
    // Raise to 20 (= currentBet 10 + minRaiseAmount 10)
    const action: PlayerAction = { agentId: actingSeat.agentId, type: "raise", amount: 20 };
    expect(() => validateAction(state, action)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------
describe("applyAction", () => {
  it("fold removes player from active", () => {
    const state = makeState();
    const actingSeat = state.seats[state.actionOnIndex]!;
    applyAction(state, { agentId: actingSeat.agentId, type: "fold", amount: 0 });
    expect(actingSeat.status).toBe("folded");
  });

  it("call moves chips to pot", () => {
    const state = makeState();
    const actingSeat = state.seats[state.actionOnIndex]!;
    const stackBefore = actingSeat.stack;
    const potBefore = state.mainPot;
    const callAmt = state.currentBet - actingSeat.currentBet; // 10 - 0 = 10
    applyAction(state, { agentId: actingSeat.agentId, type: "call", amount: callAmt });
    expect(actingSeat.stack).toBe(stackBefore - callAmt);
    expect(state.mainPot).toBe(potBefore + callAmt);
  });

  it("raise updates currentBet and lastRaiseAmount", () => {
    const state = makeState();
    const actingSeat = state.seats[state.actionOnIndex]!;
    // Raise to 30 (raise by 20 over current 10)
    applyAction(state, { agentId: actingSeat.agentId, type: "raise", amount: 30 });
    expect(state.currentBet).toBe(30);
    expect(state.lastRaiseAmount).toBe(20);
  });

  it("all-in sets status and moves all chips", () => {
    const state = makeState();
    const actingSeat = state.seats[state.actionOnIndex]!;
    const stackBefore = actingSeat.stack;
    applyAction(state, { agentId: actingSeat.agentId, type: "all-in", amount: stackBefore });
    expect(actingSeat.status).toBe("all-in");
    expect(actingSeat.stack).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Round completion detection
// ---------------------------------------------------------------------------
describe("isBettingRoundComplete", () => {
  it("returns true when all active players equalized bets and have acted", () => {
    const state = makeState();
    // Simulate everyone having called the big blind voluntarily
    for (const s of state.seats) {
      if (s.status === "active") {
        s.currentBet = 10;
        s.hasActedThisRound = true;
      }
    }
    state.currentBet = 10;
    expect(isBettingRoundComplete(state)).toBe(true);
  });

  it("returns false when bets are not equalized", () => {
    const state = makeState();
    expect(isBettingRoundComplete(state)).toBe(false);
  });
});

describe("isHandAllIn", () => {
  it("returns true when only 1 active player left", () => {
    const state = makeState();
    state.seats[0]!.status = "all-in";
    state.seats[1]!.status = "folded";
    // Only carol is active
    expect(isHandAllIn(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resetBettingRound
// ---------------------------------------------------------------------------
describe("resetBettingRound", () => {
  it("clears per-round bets", () => {
    const state = makeState();
    for (const s of state.seats) s.currentBet = 50;
    state.currentBet = 50;
    resetBettingRound(state);
    expect(state.currentBet).toBe(0);
    for (const s of state.seats) {
      expect(s.currentBet).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Side pot calculation
// ---------------------------------------------------------------------------
describe("calculatePots", () => {
  it("creates correct side pots for all-in scenario", () => {
    const seats: AgentSeat[] = [
      { agentId: "alice", stack: 0, holeCards: [], totalBet: 100, currentBet: 0, status: "all-in" },
      { agentId: "bob",   stack: 0, holeCards: [], totalBet: 300, currentBet: 0, status: "all-in" },
      { agentId: "carol", stack: 0, holeCards: [], totalBet: 300, currentBet: 0, status: "active" },
    ];

    const pots = calculatePots(seats);
    expect(pots.length).toBeGreaterThanOrEqual(1);

    const totalInPots = pots.reduce((s, p) => s + p.amount, 0);
    const totalBet = seats.reduce((s, seat) => s + seat.totalBet, 0);
    expect(totalInPots).toBe(totalBet);

    // Alice's pot: everyone can win; bob+carol side pot excludes alice
    const alicePot = pots[0]!;
    expect(alicePot.eligibleAgents).toContain("alice");
    expect(alicePot.eligibleAgents).toContain("bob");
    expect(alicePot.eligibleAgents).toContain("carol");
  });

  it("folded players are ineligible for pots", () => {
    const seats: AgentSeat[] = [
      { agentId: "alice", stack: 0, holeCards: [], totalBet: 100, currentBet: 0, status: "all-in" },
      { agentId: "bob",   stack: 0, holeCards: [], totalBet: 200, currentBet: 0, status: "folded" },
      { agentId: "carol", stack: 0, holeCards: [], totalBet: 200, currentBet: 0, status: "active" },
    ];
    const pots = calculatePots(seats);
    for (const pot of pots) {
      expect(pot.eligibleAgents).not.toContain("bob");
    }
  });
});

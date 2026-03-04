import { describe, expect, it } from "vitest";
import {
  createGame,
  getState,
  processAction,
  startHand,
} from "../src/game.js";
import type { GameState, PlayerAction } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGame(agentCount = 3, stack = 1000) {
  const agents = Array.from({ length: agentCount }, (_, i) => ({
    agentId: `agent-${i}`,
    stack,
  }));
  return createGame({ smallBlind: 5, bigBlind: 10, agents });
}

function actingAgent(state: GameState): string {
  return state.seats[state.actionOnIndex]!.agentId;
}

function callAmount(state: GameState): number {
  const seat = state.seats[state.actionOnIndex]!;
  return Math.min(state.currentBet - seat.currentBet, seat.stack);
}

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------
describe("createGame", () => {
  it("initialises with correct seats and phase", () => {
    const state = makeGame(3);
    expect(state.phase).toBe("waiting");
    expect(state.seats).toHaveLength(3);
    expect(state.seats.every((s) => s.stack === 1000)).toBe(true);
    expect(state.handNumber).toBe(0);
  });

  it("assigns unique gameId", () => {
    const a = makeGame();
    const b = makeGame();
    expect(a.gameId).not.toBe(b.gameId);
  });
});

// ---------------------------------------------------------------------------
// startHand
// ---------------------------------------------------------------------------
describe("startHand", () => {
  it("advances to preflop and deals hole cards", () => {
    const state = makeGame();
    startHand(state, 5, 10);
    expect(state.phase).toBe("preflop");
    expect(state.handNumber).toBe(1);
    for (const seat of state.seats) {
      expect(seat.holeCards).toHaveLength(2);
    }
  });

  it("posts blinds from correct seats", () => {
    const state = makeGame(3);
    startHand(state, 5, 10);
    // dealer=0(agent-0), SB=1(agent-1), BB=2(agent-2)
    const sb = state.seats.find((s) => s.agentId === "agent-1")!;
    const bb = state.seats.find((s) => s.agentId === "agent-2")!;
    expect(sb.currentBet).toBe(5);
    expect(bb.currentBet).toBe(10);
    expect(state.mainPot).toBe(15);
  });

  it("increments handNumber on successive hands", () => {
    const state = makeGame();
    startHand(state, 5, 10);
    expect(state.handNumber).toBe(1);
    // Fold everyone out to end the hand quickly
    let acting = actingAgent(state);
    processAction(state, { agentId: acting, type: "fold", amount: 0 });
    acting = actingAgent(state);
    processAction(state, { agentId: acting, type: "fold", amount: 0 });
    startHand(state, 5, 10);
    expect(state.handNumber).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// processAction — basic flow
// ---------------------------------------------------------------------------
describe("processAction — fold cascade", () => {
  it("ends hand when all but one agent fold", () => {
    const state = makeGame(3);
    startHand(state, 5, 10);

    // Preflop: agent-0 acts first (UTG left of BB)
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });

    expect(state.phase).toBe("settlement");
    expect(state.winners).toHaveLength(1);
    expect(state.winners[0]!.amountWon).toBe(15); // collected the blinds
  });
});

describe("processAction — call / check to showdown", () => {
  it("reaches showdown after all streets", () => {
    const state = makeGame(2, 500);
    startHand(state, 5, 10);
    // heads-up: dealer=SB, opponent=BB
    // preflop: SB acts first in HU (after blinds posted)
    // action is on agent-0 (SB/dealer)

    // Preflop: call
    const call0 = callAmount(state);
    processAction(state, { agentId: actingAgent(state), type: "call", amount: call0 });
    // BB checks
    processAction(state, { agentId: actingAgent(state), type: "check", amount: 0 });

    // Flop
    expect(state.phase).toBe("flop");
    processAction(state, { agentId: actingAgent(state), type: "check", amount: 0 });
    processAction(state, { agentId: actingAgent(state), type: "check", amount: 0 });

    // Turn
    expect(state.phase).toBe("turn");
    processAction(state, { agentId: actingAgent(state), type: "check", amount: 0 });
    processAction(state, { agentId: actingAgent(state), type: "check", amount: 0 });

    // River
    expect(state.phase).toBe("river");
    processAction(state, { agentId: actingAgent(state), type: "check", amount: 0 });
    processAction(state, { agentId: actingAgent(state), type: "check", amount: 0 });

    // Should be in settlement now
    expect(state.phase).toBe("settlement");
    expect(state.winners.length).toBeGreaterThanOrEqual(1);
  });

  it("assigns board tasks to winner", () => {
    const state = makeGame(2, 500);
    startHand(state, 5, 10);

    // Race to showdown via checks/calls
    function checkOrCall() {
      const ca = callAmount(state);
      if (ca > 0) {
        processAction(state, { agentId: actingAgent(state), type: "call", amount: ca });
      } else {
        processAction(state, { agentId: actingAgent(state), type: "check", amount: 0 });
      }
    }

    // 2 preflop + 2 flop + 2 turn + 2 river = 8 actions
    for (let i = 0; i < 8; i++) {
      if (state.phase === "settlement") break;
      checkOrCall();
    }

    expect(state.phase).toBe("settlement");
    expect(state.assignedTasks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// processAction — raise re-opens action
// ---------------------------------------------------------------------------
describe("processAction — raise reopens betting", () => {
  it("a raise allows the original aggressor to re-raise", () => {
    const state = makeGame(2, 500);
    startHand(state, 5, 10);

    // agent-0 (SB) raises to 30
    processAction(state, { agentId: actingAgent(state), type: "raise", amount: 30 });
    expect(state.currentBet).toBe(30);

    // agent-1 (BB) re-raises to 60
    processAction(state, { agentId: actingAgent(state), type: "raise", amount: 60 });
    expect(state.currentBet).toBe(60);

    // agent-0 calls
    const ca = callAmount(state);
    processAction(state, { agentId: actingAgent(state), type: "call", amount: ca });

    // Should advance to flop
    expect(state.phase).toBe("flop");
  });
});

// ---------------------------------------------------------------------------
// getState
// ---------------------------------------------------------------------------
describe("getState", () => {
  it("returns a frozen snapshot", () => {
    const state = makeGame();
    const snapshot = getState(state);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------
describe("event log", () => {
  it("records hand-started and cards-dealt events", () => {
    const state = makeGame();
    startHand(state, 5, 10);
    const types = state.events.map((e) => e.type);
    expect(types).toContain("hand-started");
    expect(types).toContain("cards-dealt");
  });

  it("records action-taken events", () => {
    const state = makeGame(2);
    startHand(state, 5, 10);
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    const actionEvents = state.events.filter((e) => e.type === "action-taken");
    expect(actionEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("records settlement-complete after hand ends", () => {
    const state = makeGame(2);
    startHand(state, 5, 10);
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    const types = state.events.map((e) => e.type);
    expect(types).toContain("settlement-complete");
    expect(types).toContain("hand-ended");
  });
});

// ---------------------------------------------------------------------------
// Elimination — Bug fix tests
// ---------------------------------------------------------------------------

describe("elimination — 0-chip players", () => {
  it("marks a 0-stack player as sitting-out on startHand", () => {
    const state = makeGame(3);
    startHand(state, 5, 10);
    // Manually set agent-1 to 0 chips (simulating elimination)
    state.seats.find((s) => s.agentId === "agent-1")!.stack = 0;
    // Start a new hand — agent-1 should be sitting-out
    // First we need to reach settlement to call startHand again
    // Fold everyone to end the hand
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });

    // Now start another hand
    startHand(state, 5, 10);

    const eliminated = state.seats.find((s) => s.agentId === "agent-1")!;
    expect(eliminated.status).toBe("sitting-out");
  });

  it("does not deal hole cards to eliminated players", () => {
    const state = makeGame(3);
    startHand(state, 5, 10);
    // End hand by folding
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    // Eliminate agent-2
    state.seats.find((s) => s.agentId === "agent-2")!.stack = 0;

    startHand(state, 5, 10);

    const eliminated = state.seats.find((s) => s.agentId === "agent-2")!;
    expect(eliminated.holeCards).toHaveLength(0);
    // Remaining players still get cards
    const active0 = state.seats.find((s) => s.agentId === "agent-0")!;
    const active1 = state.seats.find((s) => s.agentId === "agent-1")!;
    expect(active0.holeCards).toHaveLength(2);
    expect(active1.holeCards).toHaveLength(2);
  });

  it("hand plays to completion with eliminated player sitting out", () => {
    const state = makeGame(3);
    startHand(state, 5, 10);
    // End first hand quickly
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    // Eliminate agent-1
    state.seats.find((s) => s.agentId === "agent-1")!.stack = 0;

    // Should be able to start and finish a hand with only 2 active players
    startHand(state, 5, 10);
    expect(state.phase).toBe("preflop");
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    expect(state.phase).toBe("settlement");
  });

  it("sitting-out player is not counted when checking for last-player-standing", () => {
    const state = makeGame(3);
    startHand(state, 5, 10);
    // End first hand quickly
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    // Eliminate agent-2
    state.seats.find((s) => s.agentId === "agent-2")!.stack = 0;

    startHand(state, 5, 10);
    // One fold should end the hand (only 2 active players, 1 fold = 1 remaining)
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    expect(state.phase).toBe("settlement");
    expect(state.winners).toHaveLength(1);
    // Winner must not be the eliminated player
    expect(state.winners[0]!.agentId).not.toBe("agent-2");
  });
});

// ---------------------------------------------------------------------------
// Blind rotation — Bug fix tests
// ---------------------------------------------------------------------------

describe("blind rotation — skips eliminated players", () => {
  it("skips sitting-out player when posting SB", () => {
    // 3 players: dealer=agent-0, normally SB=agent-1, BB=agent-2
    // Eliminate agent-1 → new SB should be agent-2, BB = agent-0 (wraps)
    const state = createGame({
      smallBlind: 5,
      bigBlind: 10,
      agents: [
        { agentId: "a", stack: 200 },
        { agentId: "b", stack: 0 },   // eliminated
        { agentId: "c", stack: 200 },
      ],
    });
    // b is already 0-stack but status defaults to "active"; set it explicitly
    state.seats.find((s) => s.agentId === "b")!.stack = 0;

    startHand(state, 5, 10);

    const sbSeat = state.seats.find((s) => s.agentId === "c")!; // next playing after dealer (a)
    const bbSeat = state.seats.find((s) => s.agentId === "a")!; // next playing after sb (c)
    expect(sbSeat.currentBet).toBe(5);
    expect(bbSeat.currentBet).toBe(10);
  });
});

describe("dealer rotation — skips eliminated players", () => {
  it("dealer button moves past eliminated seats", () => {
    // 3 players; dealer starts at 0
    // After first hand, normally dealer moves to 1
    // But if agent-1 has 0 chips, dealer should jump to agent-2
    const state = makeGame(3);
    startHand(state, 5, 10);
    // End the hand
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });

    // Dealer was at 0; after settlement it's now at 1
    const dealerAfterHand1 = state.dealerIndex;

    // Eliminate whoever is now the next dealer target
    const nextTarget = (dealerAfterHand1 + 1) % 3;
    state.seats[nextTarget]!.stack = 0;

    // Start next hand (triggers another dealer rotation at settlement)
    startHand(state, 5, 10);
    processAction(state, { agentId: actingAgent(state), type: "fold", amount: 0 });
    // settlement rotates dealer again — should skip the 0-stack seat
    const newDealer = state.dealerIndex;
    expect(state.seats[newDealer]!.stack).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Antes — Bug fix tests
// ---------------------------------------------------------------------------

describe("antes", () => {
  it("posts antes to pot before blinds", () => {
    const state = makeGame(3, 200);
    startHand(state, 5, 10, 2); // ante=2

    // Each of 3 players posts 2 chips in antes → 6 total antes + 5 SB + 10 BB = 21
    expect(state.mainPot).toBe(21);
  });

  it("deducts antes from each player stack", () => {
    const state = makeGame(2, 100);
    startHand(state, 5, 10, 3); // ante=3

    // Each player pays 3 ante; SB pays 5 more; BB pays 10 more
    const totalDeducted = state.seats.reduce((sum, s) => sum + (100 - s.stack), 0);
    // 2×3 (antes) + 5 (SB) + 10 (BB) = 21 total
    expect(totalDeducted).toBe(21);
    expect(state.mainPot).toBe(21);
  });

  it("no antes when ante=0 (default)", () => {
    const state = makeGame(2, 100);
    startHand(state, 5, 10); // no ante

    // Only SB + BB = 15
    expect(state.mainPot).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// All-in scenario
// ---------------------------------------------------------------------------

/** Drive a hand to completion using call/check for every decision. */
function autoPlay(state: GameState, maxActions = 40): void {
  let i = 0;
  while (state.phase !== "settlement" && i++ < maxActions) {
    const ca = callAmount(state);
    if (ca > 0) {
      processAction(state, { agentId: actingAgent(state), type: "call", amount: ca });
    } else {
      processAction(state, { agentId: actingAgent(state), type: "check", amount: 0 });
    }
  }
}

describe("all-in and side pots", () => {
  it("handles short-stack all-in without crashing", () => {
    const state = createGame({
      smallBlind: 5,
      bigBlind: 10,
      agents: [
        { agentId: "alice", stack: 50 },
        { agentId: "bob",   stack: 200 },
      ],
    });
    startHand(state, 5, 10);

    // First actor goes all-in
    const firstActor = actingAgent(state);
    const firstSeat = state.seats.find((s) => s.agentId === firstActor)!;
    processAction(state, { agentId: firstActor, type: "all-in", amount: firstSeat.stack });

    // Drive remaining actions to settlement
    autoPlay(state);

    expect(state.phase).toBe("settlement");
    expect(state.winners.length).toBeGreaterThanOrEqual(1);
  });

  it("conserves total chips across all-in hand", () => {
    const state = createGame({
      smallBlind: 5,
      bigBlind: 10,
      agents: [
        { agentId: "alice", stack: 80 },
        { agentId: "bob",   stack: 200 },
      ],
    });
    const totalBefore = state.seats.reduce((s, seat) => s + seat.stack, 0);
    startHand(state, 5, 10);

    // First actor goes all-in
    const firstActor = actingAgent(state);
    const firstSeat = state.seats.find((s) => s.agentId === firstActor)!;
    processAction(state, { agentId: firstActor, type: "all-in", amount: firstSeat.stack });

    autoPlay(state);

    const totalAfter = state.seats.reduce((s, seat) => s + seat.stack, 0);
    expect(totalAfter).toBe(totalBefore);
  });
});

import { describe, expect, it } from "vitest";
import { GameStore } from "../src/game-store.js";
import { joinTable } from "../src/tools/join-table.js";
import { call } from "../src/tools/call.js";
import { check } from "../src/tools/check.js";
import { fold } from "../src/tools/fold.js";
import { raise } from "../src/tools/raise.js";
import { allIn } from "../src/tools/all-in.js";
import { bet } from "../src/tools/bet.js";
import { tableTalk } from "../src/tools/table-talk.js";
import { submitResult } from "../src/tools/submit-result.js";
import { readTableState } from "../src/resources/table-state.js";
import { readMyHand } from "../src/resources/my-hand.js";
import { readPotInfo } from "../src/resources/pot-info.js";
import { buildStrategyPrompt } from "../src/prompts/strategy.js";
import { buildNegotiatePrompt } from "../src/prompts/negotiate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function actingAgent(store: GameStore, tableId: string): string {
  const { state } = store.requireTable(tableId);
  return state.seats[state.actionOnIndex]?.agentId ?? "";
}

function callAmt(store: GameStore, tableId: string): number {
  const { state } = store.requireTable(tableId);
  const seat = state.seats[state.actionOnIndex];
  return seat ? Math.min(state.currentBet - seat.currentBet, seat.stack) : 0;
}

/** Drive a hand to settlement using only call/check decisions. */
function autoPlay(store: GameStore, tableId: string, maxActions = 30): void {
  let i = 0;
  while (store.requireTable(tableId).state.phase !== "settlement" && i++ < maxActions) {
    const ca = callAmt(store, tableId);
    if (ca > 0) {
      call({ tableId, agentId: actingAgent(store, tableId) }, store);
    } else {
      check({ tableId, agentId: actingAgent(store, tableId) }, store);
    }
  }
}

// ---------------------------------------------------------------------------
// Integration: full hand via fold
// ---------------------------------------------------------------------------
describe("Full hand — fold scenario", () => {
  it("resolves immediately when first player folds preflop", () => {
    const store = new GameStore();
    joinTable({ tableId: "x1", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "x1", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);

    const loser = actingAgent(store, "x1");
    const winner = loser === "alice" ? "bob" : "alice";

    fold({ tableId: "x1", agentId: loser }, store);

    const state = store.requireTable("x1").state;
    expect(state.phase).toBe("settlement");
    expect(state.winners[0]?.agentId).toBe(winner);
    // Pot goes to winner
    expect(state.winners[0]?.amountWon).toBe(15); // SB(5) + BB(10)
  });

  it("conserves total chips across the hand", () => {
    const store = new GameStore();
    const total = 1000;
    joinTable({ tableId: "x2", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "x2", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);

    fold({ tableId: "x2", agentId: actingAgent(store, "x2") }, store);

    const { state } = store.requireTable("x2");
    const stacks = state.seats.reduce((s, seat) => s + seat.stack, 0);
    const pot = state.mainPot;
    expect(stacks + pot).toBe(total);
  });
});

// ---------------------------------------------------------------------------
// Integration: call to showdown
// ---------------------------------------------------------------------------
describe("Full hand — call to showdown", () => {
  it("reaches settlement and assigns tasks", () => {
    const store = new GameStore();
    joinTable({ tableId: "x3", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "x3", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);

    autoPlay(store, "x3");

    const state = store.requireTable("x3").state;
    expect(state.phase).toBe("settlement");
    expect(state.winners.length).toBeGreaterThanOrEqual(1);
    // Community cards should have been revealed
    expect(state.assignedTasks.length).toBeGreaterThan(0);
  });

  it("assigned tasks match board cards", () => {
    const store = new GameStore();
    joinTable({ tableId: "x4", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "x4", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);

    autoPlay(store, "x4");

    const state = store.requireTable("x4").state;
    const boardTasks = [
      ...state.board.flop.map((c) => c.task),
      ...(state.board.turn ? [state.board.turn.task] : []),
      ...(state.board.river ? [state.board.river.task] : []),
    ];
    for (const assigned of state.assignedTasks) {
      expect(boardTasks).toContain(assigned.task);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: raise and re-raise
// ---------------------------------------------------------------------------
describe("Full hand — raise and re-raise", () => {
  it("raise increases the currentBet and re-raise is allowed", () => {
    const store = new GameStore();
    joinTable({ tableId: "x5", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "x5", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);

    // First actor raises to 30
    const a1 = actingAgent(store, "x5");
    raise({ tableId: "x5", agentId: a1, amount: 30 }, store);
    expect(store.requireTable("x5").state.currentBet).toBe(30);

    // Second actor re-raises to 60
    const a2 = actingAgent(store, "x5");
    raise({ tableId: "x5", agentId: a2, amount: 60 }, store);
    expect(store.requireTable("x5").state.currentBet).toBe(60);

    // First actor calls
    call({ tableId: "x5", agentId: actingAgent(store, "x5") }, store);
    expect(store.requireTable("x5").state.phase).toBe("flop");
  });
});

// ---------------------------------------------------------------------------
// Integration: multi-table isolation
// ---------------------------------------------------------------------------
describe("Multi-table isolation", () => {
  it("two tables maintain independent state", () => {
    const store = new GameStore();

    // Table A
    joinTable({ tableId: "tA", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "tA", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);

    // Table B
    joinTable({ tableId: "tB", agentId: "carol", capabilities: [], initial_tokens: 200 }, store);
    joinTable({ tableId: "tB", agentId: "dave", capabilities: [], initial_tokens: 200 }, store);

    // Fold on table A
    fold({ tableId: "tA", agentId: actingAgent(store, "tA") }, store);

    // Table B should still be in preflop
    expect(store.requireTable("tA").state.phase).toBe("settlement");
    expect(store.requireTable("tB").state.phase).toBe("preflop");
  });

  it("agents at different tables don't interfere", () => {
    const store = new GameStore();
    joinTable({ tableId: "tC", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "tC", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "tD", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "tD", agentId: "carol", capabilities: [], initial_tokens: 500 }, store);

    // tC state doesn't affect tD state
    const stateC = store.requireTable("tC").state;
    const stateD = store.requireTable("tD").state;
    expect(stateC.gameId).not.toBe(stateD.gameId);
  });
});

// ---------------------------------------------------------------------------
// Integration: phase progression
// ---------------------------------------------------------------------------
describe("Phase progression", () => {
  it("progresses preflop → flop → turn → river → settlement", () => {
    const store = new GameStore();
    joinTable({ tableId: "pp", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "pp", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);

    const phases: string[] = ["preflop"];

    // Track phases
    call({ tableId: "pp", agentId: actingAgent(store, "pp") }, store);
    check({ tableId: "pp", agentId: actingAgent(store, "pp") }, store);
    phases.push(store.requireTable("pp").state.phase);

    check({ tableId: "pp", agentId: actingAgent(store, "pp") }, store);
    check({ tableId: "pp", agentId: actingAgent(store, "pp") }, store);
    phases.push(store.requireTable("pp").state.phase);

    check({ tableId: "pp", agentId: actingAgent(store, "pp") }, store);
    check({ tableId: "pp", agentId: actingAgent(store, "pp") }, store);
    phases.push(store.requireTable("pp").state.phase);

    check({ tableId: "pp", agentId: actingAgent(store, "pp") }, store);
    check({ tableId: "pp", agentId: actingAgent(store, "pp") }, store);
    phases.push(store.requireTable("pp").state.phase);

    expect(phases).toEqual(["preflop", "flop", "turn", "river", "settlement"]);
  });
});

// ---------------------------------------------------------------------------
// Integration: agent reads their own hand
// ---------------------------------------------------------------------------
describe("Agent reads private hand", () => {
  it("can read hole cards after deal", () => {
    const store = new GameStore();
    joinTable({ tableId: "hh", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "hh", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);

    const hand = readMyHand("hh", "alice", store.requireTable("hh"));
    expect(hand.holeCards).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Integration: table-talk + negotiate prompt
// ---------------------------------------------------------------------------
describe("Table talk and prompts", () => {
  it("chat log grows with messages", () => {
    const store = new GameStore();
    joinTable({ tableId: "chat", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "chat", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);

    tableTalk({ tableId: "chat", agentId: "alice", message: "I have the nuts" }, store);
    tableTalk({ tableId: "chat", agentId: "bob", message: "sure you do" }, store);

    expect(store.requireTable("chat").chatLog).toHaveLength(2);
  });

  it("strategy prompt includes phase and pot info", () => {
    const store = new GameStore();
    joinTable({ tableId: "sp", agentId: "alice", capabilities: ["code"], initial_tokens: 500 }, store);
    joinTable({ tableId: "sp", agentId: "bob", capabilities: ["docs"], initial_tokens: 500 }, store);

    const prompt = buildStrategyPrompt(
      { tableId: "sp", agentId: "alice" },
      store.requireTable("sp")
    );
    expect(prompt).toMatch(/preflop/i);
    expect(prompt).toMatch(/pot/i);
    expect(prompt).toMatch(/alice/i);
  });

  it("negotiate prompt lists opponents and tasks", () => {
    const store = new GameStore();
    joinTable({ tableId: "np", agentId: "alice", capabilities: ["code"], initial_tokens: 500 }, store);
    joinTable({ tableId: "np", agentId: "bob", capabilities: ["docs"], initial_tokens: 500 }, store);

    const prompt = buildNegotiatePrompt(
      { tableId: "np", agentId: "alice", goal: "win the review task" },
      store.requireTable("np")
    );
    expect(prompt).toMatch(/bob/i);
    expect(prompt).toMatch(/alice/i);
    expect(prompt).toMatch(/win the review task/i);
  });
});

// ---------------------------------------------------------------------------
// Integration: submit-result after winning
// ---------------------------------------------------------------------------
describe("Task submission after winning", () => {
  it("winner can submit task result after settlement", () => {
    const store = new GameStore();
    joinTable({ tableId: "sr", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "sr", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);

    // Run to showdown with community cards
    autoPlay(store, "sr");

    const state = store.requireTable("sr").state;
    const winner = state.winners[0]?.agentId;
    if (!winner || state.assignedTasks.length === 0) return; // chop or no tasks

    const task = state.assignedTasks[0]!;
    const res = submitResult({
      tableId: "sr",
      agentId: winner,
      taskId: task.task,
      result: "Completed successfully",
      evidence: "https://example.com/pr/42",
    }, store);

    expect(res.success).toBe(true);
    expect(store.requireTable("sr").taskResults).toHaveLength(1);
  });
});

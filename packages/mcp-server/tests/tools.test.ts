import { describe, expect, it, beforeEach } from "vitest";
import { GameStore } from "../src/game-store.js";
import { joinTable } from "../src/tools/join-table.js";
import { bet } from "../src/tools/bet.js";
import { call } from "../src/tools/call.js";
import { raise } from "../src/tools/raise.js";
import { fold } from "../src/tools/fold.js";
import { allIn } from "../src/tools/all-in.js";
import { check } from "../src/tools/check.js";
import { tableTalk } from "../src/tools/table-talk.js";
import { submitResult } from "../src/tools/submit-result.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fresh store for each test. */
function makeStore() {
  return new GameStore();
}

/** Create a table with two agents, hand auto-starts. */
function twoPlayerTable(store: GameStore, tableId = "t1") {
  joinTable({ tableId, agentId: "alice", capabilities: ["code"], initial_tokens: 500 }, store);
  joinTable({ tableId, agentId: "bob", capabilities: ["docs"], initial_tokens: 500 }, store);
  return store.requireTable(tableId);
}

/** Returns the agentId of whoever is currently acting. */
function actingAgent(store: GameStore, tableId: string): string {
  const { state } = store.requireTable(tableId);
  return state.seats[state.actionOnIndex]?.agentId ?? "";
}

/** Call amount for the acting agent. */
function callAmt(store: GameStore, tableId: string): number {
  const { state } = store.requireTable(tableId);
  const seat = state.seats[state.actionOnIndex];
  return seat ? Math.min(state.currentBet - seat.currentBet, seat.stack) : 0;
}

// ---------------------------------------------------------------------------
// join-table
// ---------------------------------------------------------------------------
describe("pokercrawl_join_table", () => {
  it("creates a table and seats the first agent", () => {
    const store = makeStore();
    const res = joinTable(
      { tableId: "t1", agentId: "alice", capabilities: ["code"], initial_tokens: 200 },
      store
    );
    expect(res.success).toBe(true);
    expect(store.requireTable("t1").state.seats).toHaveLength(1);
  });

  it("auto-starts hand when second agent joins", () => {
    const store = makeStore();
    joinTable({ tableId: "t1", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    joinTable({ tableId: "t1", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);
    expect(store.requireTable("t1").state.phase).toBe("preflop");
  });

  it("rejects a duplicate agent", () => {
    const store = makeStore();
    joinTable({ tableId: "t1", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    const res = joinTable({ tableId: "t1", agentId: "alice", capabilities: [], initial_tokens: 500 }, store);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/already seated/i);
  });

  it("uses existing table config on second join", () => {
    const store = makeStore();
    joinTable({ tableId: "t1", agentId: "alice", capabilities: [], initial_tokens: 500, small_blind: 10, big_blind: 20 }, store);
    joinTable({ tableId: "t1", agentId: "bob", capabilities: [], initial_tokens: 500 }, store);
    const record = store.requireTable("t1");
    // Big blind should be 20
    const bettedSeat = record.state.seats.find((s) => s.currentBet === 20);
    expect(bettedSeat).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// fold
// ---------------------------------------------------------------------------
describe("pokercrawl_fold", () => {
  it("folds successfully on own turn", () => {
    const store = makeStore();
    twoPlayerTable(store);
    const agent = actingAgent(store, "t1");
    const res = fold({ tableId: "t1", agentId: agent }, store);
    expect(res.success).toBe(true);
    const seat = store.requireTable("t1").state.seats.find((s) => s.agentId === agent);
    expect(seat?.status).toBe("folded");
  });

  it("rejects fold on wrong turn", () => {
    const store = makeStore();
    twoPlayerTable(store);
    const agent = actingAgent(store, "t1");
    const other = agent === "alice" ? "bob" : "alice";
    const res = fold({ tableId: "t1", agentId: other }, store);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/turn/i);
  });

  it("rejects fold from unknown agent", () => {
    const store = makeStore();
    twoPlayerTable(store);
    const res = fold({ tableId: "t1", agentId: "ghost" }, store);
    expect(res.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------
describe("pokercrawl_check", () => {
  it("check is rejected when there is an active bet (preflop)", () => {
    const store = makeStore();
    twoPlayerTable(store);
    // Preflop has the big blind as an active bet
    const agent = actingAgent(store, "t1");
    const res = check({ tableId: "t1", agentId: agent }, store);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/call/i);
  });

  it("check succeeds post-flop when no bet is active", () => {
    const store = makeStore();
    twoPlayerTable(store);
    // Drive preflop to completion with call + check
    const a1 = actingAgent(store, "t1");
    const ca1 = callAmt(store, "t1");
    call({ tableId: "t1", agentId: a1 }, store); // call big blind
    const a2 = actingAgent(store, "t1");
    check({ tableId: "t1", agentId: a2 }, store); // BB checks

    expect(store.requireTable("t1").state.phase).toBe("flop");

    const a3 = actingAgent(store, "t1");
    const res = check({ tableId: "t1", agentId: a3 }, store);
    expect(res.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// call
// ---------------------------------------------------------------------------
describe("pokercrawl_call", () => {
  it("call matches the current bet", () => {
    const store = makeStore();
    twoPlayerTable(store);
    const agent = actingAgent(store, "t1");
    const before = store.requireTable("t1").state.mainPot;
    const res = call({ tableId: "t1", agentId: agent }, store);
    expect(res.success).toBe(true);
    const after = store.requireTable("t1").state.mainPot;
    expect(after).toBeGreaterThan(before);
  });

  it("call rejects unknown agent", () => {
    const store = makeStore();
    twoPlayerTable(store);
    const res = call({ tableId: "t1", agentId: "ghost" }, store);
    expect(res.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// raise
// ---------------------------------------------------------------------------
describe("pokercrawl_raise", () => {
  it("raise updates currentBet", () => {
    const store = makeStore();
    twoPlayerTable(store);
    const agent = actingAgent(store, "t1");
    const res = raise({ tableId: "t1", agentId: agent, amount: 40 }, store);
    expect(res.success).toBe(true);
    expect(store.requireTable("t1").state.currentBet).toBe(40);
  });

  it("raise rejected below minimum", () => {
    const store = makeStore();
    twoPlayerTable(store);
    const agent = actingAgent(store, "t1");
    // Min raise = currentBet(10) + lastRaiseAmount(10) = 20
    const res = raise({ tableId: "t1", agentId: agent, amount: 15 }, store);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/min raise/i);
  });

  it("raise rejects when no active bet (use bet instead)", () => {
    const store = makeStore();
    // Create a fresh table manually so we can control state
    twoPlayerTable(store, "t2");
    const rec = store.requireTable("t2");
    // Fast-forward to flop (check, check)
    call({ tableId: "t2", agentId: actingAgent(store, "t2") }, store);
    check({ tableId: "t2", agentId: actingAgent(store, "t2") }, store);
    expect(rec.state.phase).toBe("flop");
    // Now currentBet should be 0
    expect(rec.state.currentBet).toBe(0);
    const agent = actingAgent(store, "t2");
    const res = raise({ tableId: "t2", agentId: agent, amount: 20 }, store);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/pokercrawl_bet/i);
  });
});

// ---------------------------------------------------------------------------
// bet
// ---------------------------------------------------------------------------
describe("pokercrawl_bet", () => {
  it("bet opens the action on a street with no active bet", () => {
    const store = makeStore();
    twoPlayerTable(store, "tb");
    // Advance to flop
    call({ tableId: "tb", agentId: actingAgent(store, "tb") }, store);
    check({ tableId: "tb", agentId: actingAgent(store, "tb") }, store);
    expect(store.requireTable("tb").state.phase).toBe("flop");

    const agent = actingAgent(store, "tb");
    const res = bet({ tableId: "tb", agentId: agent, amount: 25 }, store);
    expect(res.success).toBe(true);
    expect(store.requireTable("tb").state.currentBet).toBe(25);
  });

  it("bet rejected when there is already a bet", () => {
    const store = makeStore();
    twoPlayerTable(store);
    // Preflop already has BB as active bet
    const agent = actingAgent(store, "t1");
    const res = bet({ tableId: "t1", agentId: agent, amount: 30 }, store);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/pokercrawl_raise/i);
  });
});

// ---------------------------------------------------------------------------
// all-in
// ---------------------------------------------------------------------------
describe("pokercrawl_all_in", () => {
  it("all-in moves all chips to pot", () => {
    const store = makeStore();
    twoPlayerTable(store);
    const agent = actingAgent(store, "t1");
    const seat = store.requireTable("t1").state.seats.find((s) => s.agentId === agent)!;
    const stackBefore = seat.stack;
    const res = allIn({ tableId: "t1", agentId: agent }, store);
    expect(res.success).toBe(true);
    expect(seat.stack).toBe(0);
    expect(seat.status).toBe("all-in");
  });

  it("all-in rejects unknown agent", () => {
    const store = makeStore();
    twoPlayerTable(store);
    const res = allIn({ tableId: "t1", agentId: "ghost" }, store);
    expect(res.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// table-talk
// ---------------------------------------------------------------------------
describe("pokercrawl_table_talk", () => {
  it("records a chat message", () => {
    const store = makeStore();
    twoPlayerTable(store);
    const res = tableTalk({ tableId: "t1", agentId: "alice", message: "I have quads!" }, store);
    expect(res.success).toBe(true);
    const log = store.requireTable("t1").chatLog;
    expect(log).toHaveLength(1);
    expect(log[0]?.message).toBe("I have quads!");
  });

  it("allows chat even when it's not your turn", () => {
    const store = makeStore();
    twoPlayerTable(store);
    // Not alice's turn necessarily — chat should still work
    const res = tableTalk({ tableId: "t1", agentId: "bob", message: "bluffing" }, store);
    expect(res.success).toBe(true);
  });

  it("rejects chat from agent not at table", () => {
    const store = makeStore();
    twoPlayerTable(store);
    const res = tableTalk({ tableId: "t1", agentId: "ghost", message: "hi" }, store);
    expect(res.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// submit-result
// ---------------------------------------------------------------------------
describe("pokercrawl_submit_result", () => {
  it("rejects submission outside execution/settlement phase", () => {
    const store = makeStore();
    twoPlayerTable(store);
    // We're in preflop, not settlement
    const res = submitResult({
      tableId: "t1",
      agentId: "alice",
      taskId: "some-task",
      result: "done",
    }, store);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/execution or settlement/i);
  });

  it("rejects submission from non-winner", () => {
    const store = makeStore();
    twoPlayerTable(store);
    // Fast-forward to settlement via fold
    const loser = actingAgent(store, "t1");
    fold({ tableId: "t1", agentId: loser }, store);
    expect(store.requireTable("t1").state.phase).toBe("settlement");

    const res = submitResult({
      tableId: "t1",
      agentId: loser,
      taskId: "some-task",
      result: "done",
    }, store);
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/did not win/i);
  });
});

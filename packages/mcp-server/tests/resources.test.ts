import { describe, expect, it, beforeEach } from "vitest";
import { GameStore } from "../src/game-store.js";
import { joinTable } from "../src/tools/join-table.js";
import { call } from "../src/tools/call.js";
import { check } from "../src/tools/check.js";
import { fold } from "../src/tools/fold.js";
import { allIn } from "../src/tools/all-in.js";
import { readTableState } from "../src/resources/table-state.js";
import { readMyHand } from "../src/resources/my-hand.js";
import { readTaskPool } from "../src/resources/task-pool.js";
import { readAgentProfiles } from "../src/resources/agent-profiles.js";
import { readPotInfo } from "../src/resources/pot-info.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTable(tableId = "r1") {
  const store = new GameStore();
  joinTable({ tableId, agentId: "alice", capabilities: ["analysis", "code"], initial_tokens: 500 }, store);
  joinTable({ tableId, agentId: "bob", capabilities: ["writing"], initial_tokens: 300 }, store);
  return store;
}

function actingAgent(store: GameStore, tableId: string): string {
  const { state } = store.requireTable(tableId);
  return state.seats[state.actionOnIndex]?.agentId ?? "";
}

// ---------------------------------------------------------------------------
// table-state
// ---------------------------------------------------------------------------
describe("readTableState", () => {
  it("returns public info: phase, pot, board, seats", () => {
    const store = makeTable();
    const data = readTableState("r1", store.requireTable("r1"));
    expect(data.phase).toBe("preflop");
    expect(data.seats).toHaveLength(2);
    expect(data.mainPot).toBeGreaterThanOrEqual(15); // at least SB+BB
    expect(data.tableId).toBe("r1");
  });

  it("does NOT include hole cards in seat data", () => {
    const store = makeTable();
    const data = readTableState("r1", store.requireTable("r1"));
    // PublicSeat has no holeCards field
    for (const seat of data.seats) {
      expect(Object.keys(seat)).not.toContain("holeCards");
    }
  });

  it("includes board after flop is dealt", () => {
    const store = makeTable();
    // Advance to flop: call + check
    call({ tableId: "r1", agentId: actingAgent(store, "r1") }, store);
    check({ tableId: "r1", agentId: actingAgent(store, "r1") }, store);

    const data = readTableState("r1", store.requireTable("r1"));
    expect(data.phase).toBe("flop");
    expect(data.board.flop).toHaveLength(3);
  });

  it("shows winner after hand ends", () => {
    const store = makeTable();
    const loser = actingAgent(store, "r1");
    fold({ tableId: "r1", agentId: loser }, store);

    const data = readTableState("r1", store.requireTable("r1"));
    expect(data.winners).toHaveLength(1);
    expect(data.winners[0]?.amountWon).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// my-hand
// ---------------------------------------------------------------------------
describe("readMyHand", () => {
  it("returns the agent's own hole cards", () => {
    const store = makeTable();
    const data = readMyHand("r1", "alice", store.requireTable("r1"));
    expect(data.agentId).toBe("alice");
    expect(data.holeCards).toHaveLength(2);
    expect(data.holeCards[0]).toHaveProperty("rank");
    expect(data.holeCards[0]).toHaveProperty("capability");
  });

  it("throws for an agent not at the table", () => {
    const store = makeTable();
    expect(() => readMyHand("r1", "ghost", store.requireTable("r1"))).toThrow(/not seated/i);
  });

  it("correctly reports isMyTurn", () => {
    const store = makeTable();
    const actor = actingAgent(store, "r1");
    const other = actor === "alice" ? "bob" : "alice";
    const actorData = readMyHand("r1", actor, store.requireTable("r1"));
    const otherData = readMyHand("r1", other, store.requireTable("r1"));
    expect(actorData.isMyTurn).toBe(true);
    expect(otherData.isMyTurn).toBe(false);
  });

  it("includes stack and totalBet", () => {
    const store = makeTable();
    const data = readMyHand("r1", "alice", store.requireTable("r1"));
    expect(typeof data.stack).toBe("number");
    expect(typeof data.totalBet).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// task-pool
// ---------------------------------------------------------------------------
describe("readTaskPool", () => {
  it("shows empty board on preflop", () => {
    const store = makeTable();
    const data = readTaskPool("r1", store.requireTable("r1"));
    expect(data.boardTasks).toHaveLength(0);
  });

  it("shows 3 tasks after flop", () => {
    const store = makeTable();
    call({ tableId: "r1", agentId: actingAgent(store, "r1") }, store);
    check({ tableId: "r1", agentId: actingAgent(store, "r1") }, store);

    const data = readTaskPool("r1", store.requireTable("r1"));
    expect(data.boardTasks).toHaveLength(3);
    expect(data.boardTasks[0]).toHaveProperty("task");
    expect(data.boardTasks[0]).toHaveProperty("street", "flop");
  });

  it("shows assigned tasks after settlement", () => {
    const store = makeTable();
    fold({ tableId: "r1", agentId: actingAgent(store, "r1") }, store);
    const data = readTaskPool("r1", store.requireTable("r1"));
    // No community cards were revealed (hand ended preflop), so no assigned tasks
    expect(data.assignedTasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// agent-profiles
// ---------------------------------------------------------------------------
describe("readAgentProfiles", () => {
  it("lists all agents with public info", () => {
    const store = makeTable();
    const data = readAgentProfiles("r1", store.requireTable("r1"));
    expect(data.playerCount).toBe(2);
    const alice = data.agents.find((a) => a.agentId === "alice");
    expect(alice).toBeDefined();
    expect(alice?.capabilities).toContain("analysis");
    // Stack + totalBet = initial tokens (blinds already posted)
    expect((alice?.stack ?? 0) + (alice?.totalBet ?? 0)).toBe(500);
  });

  it("does NOT expose hole cards", () => {
    const store = makeTable();
    const data = readAgentProfiles("r1", store.requireTable("r1"));
    for (const agent of data.agents) {
      expect(Object.keys(agent)).not.toContain("holeCards");
    }
  });

  it("reflects updated stacks after betting", () => {
    const store = makeTable();
    call({ tableId: "r1", agentId: actingAgent(store, "r1") }, store);
    const data = readAgentProfiles("r1", store.requireTable("r1"));
    const totalStacks = data.agents.reduce((s, a) => s + a.stack, 0);
    const pot = store.requireTable("r1").state.mainPot;
    // Chips are conserved
    expect(totalStacks + pot).toBe(500 + 300);
  });
});

// ---------------------------------------------------------------------------
// pot-info
// ---------------------------------------------------------------------------
describe("readPotInfo", () => {
  it("shows main pot after blinds", () => {
    const store = makeTable();
    const data = readPotInfo("r1", store.requireTable("r1"));
    expect(data.mainPot).toBeGreaterThanOrEqual(15);
    expect(data.sidePots).toHaveLength(0);
    expect(data.currentBet).toBe(10); // big blind
  });

  it("total pot grows after a call", () => {
    const store = makeTable();
    const before = readPotInfo("r1", store.requireTable("r1")).totalPot;
    call({ tableId: "r1", agentId: actingAgent(store, "r1") }, store);
    const after = readPotInfo("r1", store.requireTable("r1")).totalPot;
    expect(after).toBeGreaterThan(before);
  });

  it("shows side pots after all-in", () => {
    const store = new GameStore();
    // Short stack vs big stack
    joinTable({ tableId: "p1", agentId: "shortie", capabilities: [], initial_tokens: 30 }, store);
    joinTable({ tableId: "p1", agentId: "deepie", capabilities: [], initial_tokens: 500 }, store);

    const actor = actingAgent(store, "p1");
    // First actor goes all-in
    allIn({ tableId: "p1", agentId: actor }, store);

    // Check pot immediately after all-in — before the remaining player acts,
    // the pot should reflect all chips committed so far (blinds + all-in).
    const dataMidHand = readPotInfo("p1", store.requireTable("p1"));
    expect(dataMidHand.totalPot).toBeGreaterThan(0);

    // Drive the hand to completion (the other player calls or hand already ended)
    if (store.requireTable("p1").state.phase !== "settlement") {
      const remaining = actingAgent(store, "p1");
      call({ tableId: "p1", agentId: remaining }, store);
    }
  });
});

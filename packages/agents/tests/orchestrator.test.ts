/**
 * AgentOrchestrator test suite
 */

import { describe, it, expect } from "vitest";
import { GameStore } from "@pokercrawl/mcp-server";
import { AgentOrchestrator } from "../src/orchestrator.js";
import { BaseAgent } from "../src/base-agent.js";
import { CalculatedBot } from "../src/simulated/calculated.js";
import { RandomBot } from "../src/simulated/random.js";
import type { AgentDecision, GameConfig, StrategyContext } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): GameStore {
  return new GameStore();
}

function makeConfig(tableId = "test-table"): GameConfig {
  return {
    tableId,
    smallBlind: 5,
    bigBlind: 10,
    startingTokens: 200,
    decisionTimeoutMs: 5_000,
  };
}

/** Agent that never resolves its decide() promise. */
class SlowAgent extends BaseAgent {
  async decide(_ctx: StrategyContext): Promise<AgentDecision> {
    await new Promise<void>(() => {}); // intentionally never resolves
    return { action: "fold", reasoning: "unreachable", confidence: 0 };
  }
}

/** Agent that always calls or checks — never folds — so the hand always reaches SlowAgent. */
class NeverFoldBot extends BaseAgent {
  async decide(ctx: StrategyContext): Promise<AgentDecision> {
    if (ctx.currentBet > ctx.myCurrentBet) {
      return { action: "call", reasoning: "always call", confidence: 1 };
    }
    return { action: "check", reasoning: "always check", confidence: 1 };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentOrchestrator — registration", () => {
  it("registers agents without error", () => {
    const orch = new AgentOrchestrator(makeStore(), makeConfig());
    orch.registerAgent(new CalculatedBot({ id: "alice", tableId: "test-table" }));
    orch.registerAgent(new RandomBot({ id: "bob", tableId: "test-table" }));
  });

  it("throws when the same agent ID is registered twice", () => {
    const orch = new AgentOrchestrator(makeStore(), makeConfig());
    orch.registerAgent(new CalculatedBot({ id: "alice", tableId: "test-table" }));
    expect(() =>
      orch.registerAgent(new CalculatedBot({ id: "alice", tableId: "test-table" }))
    ).toThrow(/already registered/);
  });
});

describe("AgentOrchestrator — setup", () => {
  it("creates the table in the store on setup()", async () => {
    const store = makeStore();
    const orch = new AgentOrchestrator(store, makeConfig("setup-table"));
    orch.registerAgent(new CalculatedBot({ id: "alice", tableId: "setup-table" }));
    orch.registerAgent(new RandomBot({ id: "bob", tableId: "setup-table" }));

    await orch.setup();

    expect(store.getTable("setup-table")).toBeDefined();
  });

  it("setup() is idempotent — second call is a no-op", async () => {
    const store = makeStore();
    const orch = new AgentOrchestrator(store, makeConfig("idempotent-table"));
    orch.registerAgent(new CalculatedBot({ id: "alice", tableId: "idempotent-table" }));
    orch.registerAgent(new RandomBot({ id: "bob", tableId: "idempotent-table" }));

    await orch.setup();
    await orch.setup(); // should not throw "Table already exists"

    const record = store.requireTable("idempotent-table");
    expect(record.state.seats.length).toBe(2);
  });
});

describe("AgentOrchestrator — playHand", () => {
  it("returns a HandResult with valid fields", async () => {
    const orch = new AgentOrchestrator(makeStore(), makeConfig("hand-table"));
    orch.registerAgent(new CalculatedBot({ id: "alice", tableId: "hand-table" }));
    orch.registerAgent(new RandomBot({ id: "bob", tableId: "hand-table" }));

    const result = await orch.playHand({ decisionTimeoutMs: 5_000 });

    expect(result.handNumber).toBeGreaterThan(0);
    expect(Array.isArray(result.winners)).toBe(true);
    expect(result.winners.length).toBeGreaterThan(0);
    expect(result.totalPot).toBeGreaterThanOrEqual(0);
    expect(typeof result.phase).toBe("string");
  });

  it("emits 'decision' events for each agent action", async () => {
    const orch = new AgentOrchestrator(makeStore(), makeConfig("event-table"));
    orch.registerAgent(new CalculatedBot({ id: "alice", tableId: "event-table" }));
    orch.registerAgent(new RandomBot({ id: "bob", tableId: "event-table" }));

    const decisions: Array<{ agentId: string; decision: AgentDecision }> = [];
    orch.on("decision", (data) => decisions.push(data));

    await orch.playHand({ decisionTimeoutMs: 5_000 });

    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) {
      expect(typeof d.agentId).toBe("string");
      expect(typeof d.decision.action).toBe("string");
    }
  });

  it("emits 'hand_complete' exactly once per playHand call", async () => {
    const orch = new AgentOrchestrator(makeStore(), makeConfig("complete-table"));
    orch.registerAgent(new CalculatedBot({ id: "alice", tableId: "complete-table" }));
    orch.registerAgent(new RandomBot({ id: "bob", tableId: "complete-table" }));

    let count = 0;
    orch.on("hand_complete", () => count++);

    await orch.playHand({ decisionTimeoutMs: 5_000 });

    expect(count).toBe(1);
  });

  it("auto-folds unresponsive agents and emits 'timeout'", async () => {
    const orch = new AgentOrchestrator(makeStore(), makeConfig("timeout-table"));
    orch.registerAgent(new SlowAgent({ id: "slow", tableId: "timeout-table" }));
    orch.registerAgent(new NeverFoldBot({ id: "fast", tableId: "timeout-table" }));

    const timedOut: string[] = [];
    orch.on("timeout", ({ agentId }) => timedOut.push(agentId));

    // Use a very short timeout so the test finishes quickly
    const result = await orch.playHand({ decisionTimeoutMs: 50 });

    expect(result.handNumber).toBeGreaterThan(0);
    expect(timedOut).toContain("slow");
  });

  it("playHand() can be called multiple times on the same orchestrator", async () => {
    // NeverFoldBot only calls/checks — no all-ins, so neither player can be eliminated.
    const orch = new AgentOrchestrator(makeStore(), makeConfig("multi-table"));
    orch.registerAgent(new NeverFoldBot({ id: "alice", tableId: "multi-table" }));
    orch.registerAgent(new NeverFoldBot({ id: "bob",   tableId: "multi-table" }));

    const h1 = await orch.playHand({ decisionTimeoutMs: 5_000 });
    const h2 = await orch.playHand({ decisionTimeoutMs: 5_000 });

    expect(h2.handNumber).toBeGreaterThan(h1.handNumber);
  });
});

describe("AgentOrchestrator — playTournament", () => {
  it("plays multiple hands and returns a TournamentResult", async () => {
    const orch = new AgentOrchestrator(makeStore(), makeConfig("tourney-table"));
    orch.registerAgent(new CalculatedBot({ id: "alice", tableId: "tourney-table" }));
    orch.registerAgent(new RandomBot({ id: "bob", tableId: "tourney-table" }));

    const result = await orch.playTournament(5, { decisionTimeoutMs: 5_000 });

    expect(result.hands).toBeGreaterThan(0);
    expect(result.hands).toBeLessThanOrEqual(5);
    expect(typeof result.finalStacks["alice"]).toBe("number");
    expect(typeof result.finalStacks["bob"]).toBe("number");
  });

  it("conserves total chips across the tournament", async () => {
    const store = makeStore();
    const config: GameConfig = {
      tableId: "cons-table",
      smallBlind: 5,
      bigBlind: 10,
      startingTokens: 200,
    };
    const orch = new AgentOrchestrator(store, config);
    orch.registerAgent(new CalculatedBot({ id: "alice", tableId: "cons-table" }));
    orch.registerAgent(new RandomBot({ id: "bob", tableId: "cons-table" }));

    const result = await orch.playTournament(5, { decisionTimeoutMs: 5_000 });

    const total = Object.values(result.finalStacks).reduce((a, b) => a + b, 0);
    // Total chips should equal 2 × 200 = 400
    expect(total).toBe(400);
  });

  it("eliminated field contains agents with 0 chips", async () => {
    const orch = new AgentOrchestrator(makeStore(), {
      tableId: "elim-table",
      smallBlind: 5,
      bigBlind: 10,
      startingTokens: 30, // very small stacks → elimination likely
    });
    orch.registerAgent(new CalculatedBot({ id: "alice", tableId: "elim-table" }));
    orch.registerAgent(new RandomBot({ id: "bob", tableId: "elim-table" }));

    const result = await orch.playTournament(50, { decisionTimeoutMs: 5_000 });

    for (const id of result.eliminated) {
      expect(result.finalStacks[id]).toBe(0);
    }
  });
});

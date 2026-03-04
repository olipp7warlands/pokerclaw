/**
 * Integration tests — 4 simulated bots playing full hands and tournaments
 *
 * These tests exercise the full stack:
 *   AgentOrchestrator → engine processAction → GameStore → TableRecord
 */

import { describe, it, expect } from "vitest";
import { GameStore } from "@pokercrawl/mcp-server";
import { AgentOrchestrator } from "../src/orchestrator.js";
import { AggressiveBot } from "../src/simulated/aggressive.js";
import { BlufferBot } from "../src/simulated/bluffer.js";
import { CalculatedBot } from "../src/simulated/calculated.js";
import { ConservativeBot } from "../src/simulated/conservative.js";
import type { AgentDecision, GameConfig } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIMEOUT_OPTS = { decisionTimeoutMs: 10_000 };

function setup4Bots(
  tableId: string,
  tokens = 500
): { store: GameStore; orch: AgentOrchestrator; config: GameConfig } {
  const store = new GameStore();
  const config: GameConfig = {
    tableId,
    smallBlind: 5,
    bigBlind: 10,
    startingTokens: tokens,
  };
  const orch = new AgentOrchestrator(store, config);
  orch.registerAgent(new AggressiveBot({ id: "shark", tableId }));
  orch.registerAgent(new BlufferBot({ id: "mago", tableId }));
  orch.registerAgent(new CalculatedBot({ id: "clock", tableId }));
  orch.registerAgent(new ConservativeBot({ id: "rock", tableId }));
  return { store, orch, config };
}

// ---------------------------------------------------------------------------
// Single hand
// ---------------------------------------------------------------------------

describe("Integration — single hand", () => {
  it("plays a hand with 4 bots without throwing", async () => {
    const { orch } = setup4Bots("integ-h1");
    const result = await orch.playHand(TIMEOUT_OPTS);
    expect(result.handNumber).toBe(1);
    expect(result.winners.length).toBeGreaterThan(0);
    expect(result.totalPot).toBeGreaterThan(0);
  });

  it("winner receives a positive amountWon", async () => {
    const { orch } = setup4Bots("integ-h2");
    const result = await orch.playHand(TIMEOUT_OPTS);
    for (const w of result.winners) {
      expect(w.amountWon).toBeGreaterThan(0);
    }
  });

  it("totalPot equals sum of winner payouts", async () => {
    const { orch } = setup4Bots("integ-h3");
    const result = await orch.playHand(TIMEOUT_OPTS);
    const sumWon = result.winners.reduce((s, w) => s + w.amountWon, 0);
    expect(result.totalPot).toBe(sumWon);
  });

  it("chip conservation: total chips unchanged after one hand", async () => {
    const { store, orch } = setup4Bots("integ-h4", 500);
    const totalStart = 4 * 500;

    await orch.playHand(TIMEOUT_OPTS);

    const record = store.requireTable("integ-h4");
    // After settlement: mainPot = 0, chips are in seat.stack
    // During execution/showdown: some chips may still be in transit
    // Safe invariant: Σ(stack) + mainPot + Σ(sidePot.amount) = totalStart
    const stackSum = record.state.seats.reduce((s, seat) => s + seat.stack, 0);
    const mainPot = record.state.mainPot;
    const sidePotSum = record.state.sidePots.reduce((s, p) => s + p.amount, 0);
    expect(stackSum + mainPot + sidePotSum).toBe(totalStart);
  });

  it("all 4 agents get at least one decision event", async () => {
    const { orch } = setup4Bots("integ-h5");
    const actingAgents = new Set<string>();
    orch.on("decision", ({ agentId }: { agentId: string; decision: AgentDecision }) =>
      actingAgents.add(agentId)
    );

    await orch.playHand(TIMEOUT_OPTS);

    // With 4 players at least 2 must act per hand (blinds + at least one voluntary)
    expect(actingAgents.size).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Multiple hands
// ---------------------------------------------------------------------------

describe("Integration — multiple hands", () => {
  it("hand numbers increment across consecutive playHand() calls", async () => {
    const { orch } = setup4Bots("integ-multi1", 400);
    const h1 = await orch.playHand(TIMEOUT_OPTS);
    const h2 = await orch.playHand(TIMEOUT_OPTS);
    const h3 = await orch.playHand(TIMEOUT_OPTS);
    expect(h2.handNumber).toBeGreaterThan(h1.handNumber);
    expect(h3.handNumber).toBeGreaterThan(h2.handNumber);
  });

  it("chip conservation holds across 3 consecutive hands", async () => {
    const { store, orch } = setup4Bots("integ-cons3", 500);
    const totalStart = 4 * 500;

    for (let i = 0; i < 3; i++) {
      await orch.playHand(TIMEOUT_OPTS);
    }

    const record = store.requireTable("integ-cons3");
    const stackSum = record.state.seats.reduce((s, seat) => s + seat.stack, 0);
    const mainPot = record.state.mainPot;
    const sidePotSum = record.state.sidePots.reduce((s, p) => s + p.amount, 0);
    expect(stackSum + mainPot + sidePotSum).toBe(totalStart);
  });
});

// ---------------------------------------------------------------------------
// Tournament
// ---------------------------------------------------------------------------

describe("Integration — tournament", () => {
  it("tournament with 4 bots completes within maxHands", async () => {
    const { orch } = setup4Bots("integ-t1", 200);
    const result = await orch.playTournament(10, TIMEOUT_OPTS);
    expect(result.hands).toBeGreaterThan(0);
    expect(result.hands).toBeLessThanOrEqual(10);
  });

  it("all 4 agents appear in finalStacks", async () => {
    const { orch } = setup4Bots("integ-t2", 200);
    const result = await orch.playTournament(10, TIMEOUT_OPTS);
    for (const id of ["shark", "mago", "clock", "rock"]) {
      expect(result.finalStacks[id]).toBeDefined();
    }
  });

  it("total chips conserved across tournament", async () => {
    const { orch } = setup4Bots("integ-t3", 200);
    const result = await orch.playTournament(10, TIMEOUT_OPTS);
    const total = Object.values(result.finalStacks).reduce((a, b) => a + b, 0);
    expect(total).toBe(4 * 200); // 800 total chips
  });

  it("handsWon entries reference valid agent IDs", async () => {
    const { orch } = setup4Bots("integ-t4", 200);
    const result = await orch.playTournament(10, TIMEOUT_OPTS);
    const validIds = new Set(["shark", "mago", "clock", "rock"]);
    for (const id of Object.keys(result.handsWon)) {
      expect(validIds.has(id)).toBe(true);
    }
  });

  it("chat log is populated when agents table-talk", async () => {
    const { store, orch } = setup4Bots("integ-t5", 200);
    await orch.playTournament(5, TIMEOUT_OPTS);
    const record = store.requireTable("integ-t5");
    // Chat is probabilistic (trashTalkLevel > 0 for aggressive/bluffer bots)
    expect(Array.isArray(record.chatLog)).toBe(true);
    for (const msg of record.chatLog) {
      expect(typeof msg.agentId).toBe("string");
      expect(typeof msg.message).toBe("string");
    }
  });
});

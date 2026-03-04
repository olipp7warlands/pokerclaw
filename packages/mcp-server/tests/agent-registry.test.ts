import { describe, expect, it } from "vitest";
import { GameStore } from "../src/game-store.js";
import { AgentRegistry } from "../src/agent-registry.js";
import type { Badge } from "../src/agent-registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup() {
  const store = new GameStore();
  const registry = new AgentRegistry();
  registry.attachToStore(store);
  return { store, registry };
}

/**
 * Creates a table with two agents. The second addAgent() triggers a preflop
 * notification, so the registry captures the hand context automatically.
 * Returns the tableId and the resolved hand number.
 */
function seedTable(store: GameStore, a = "alice", b = "bob", tokens = 500) {
  store.createTable("t1");
  store.addAgent("t1", a, [], tokens);
  store.addAgent("t1", b, [], tokens);
  return "t1";
}

/**
 * Manually advances a table to settlement with the given winner.
 * Mirrors what the engine would produce after all betting ends.
 */
function settleHand(
  store: GameStore,
  tableId: string,
  winnerId: string,
  amountWon = 200,
  showdown = false
) {
  const record = store.requireTable(tableId);
  // Mutate the engine state directly to simulate end-of-hand
  (record.state as Record<string, unknown>)["phase"] = "settlement";
  (record.state as Record<string, unknown>)["winners"] = [
    {
      agentId: winnerId,
      amountWon,
      hand: showdown ? { description: "Pair of Aces", rank: 2 } : null,
    },
  ];
  store.notify(tableId, record);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("AgentRegistry — registration", () => {
  it("creates a profile with ELO 1200 and empty stats", () => {
    const { registry } = setup();
    const p = registry.registerAgent({ id: "shark", name: "El Tiburón", type: "claude" });
    expect(p.id).toBe("shark");
    expect(p.name).toBe("El Tiburón");
    expect(p.elo).toBe(1200);
    expect(p.stats.handsPlayed).toBe(0);
    expect(p.badges).toHaveLength(0);
  });

  it("returns the same profile on duplicate registerAgent calls", () => {
    const { registry } = setup();
    const p1 = registry.registerAgent({ id: "shark", name: "X", type: "simulated" });
    const p2 = registry.registerAgent({ id: "shark", name: "Y", type: "openai" });
    expect(p1).toBe(p2);
    expect(p2.name).toBe("X"); // first registration wins
  });

  it("getProfile returns undefined for unknown id", () => {
    const { registry } = setup();
    expect(registry.getProfile("ghost")).toBeUndefined();
  });

  it("listProfiles returns agents sorted by ELO descending", () => {
    const { registry } = setup();
    const a = registry.registerAgent({ id: "a", name: "A", type: "simulated" });
    const b = registry.registerAgent({ id: "b", name: "B", type: "simulated" });
    // Artificially set different ELOs
    a.elo = 1300;
    b.elo = 1400;
    const profiles = registry.listProfiles();
    expect(profiles[0]?.id).toBe("b");
    expect(profiles[1]?.id).toBe("a");
  });

  it("assigns a default avatar emoji based on agent type", () => {
    const { registry } = setup();
    const p = registry.registerAgent({ id: "x", name: "X", type: "claude" });
    expect(p.avatar).toBe("🤖");
  });

  it("uses a custom avatar when provided", () => {
    const { registry } = setup();
    const p = registry.registerAgent({ id: "x", name: "X", type: "simulated", avatar: "🦈" });
    expect(p.avatar).toBe("🦈");
  });
});

// ---------------------------------------------------------------------------
// Manual badge awarding
// ---------------------------------------------------------------------------

describe("AgentRegistry — awardBadge", () => {
  it("awards a badge that the agent does not already have", () => {
    const { registry } = setup();
    registry.registerAgent({ id: "x", name: "X", type: "simulated" });
    registry.awardBadge("x", "molt-veteran");
    expect(registry.getProfile("x")?.badges).toContain("molt-veteran");
  });

  it("is a no-op if the badge is already held", () => {
    const { registry } = setup();
    registry.registerAgent({ id: "x", name: "X", type: "simulated" });
    registry.awardBadge("x", "molt-veteran");
    registry.awardBadge("x", "molt-veteran");
    const badges = registry.getProfile("x")?.badges ?? [];
    expect(badges.filter((b) => b === "molt-veteran")).toHaveLength(1);
  });

  it("throws when awarding a badge to an unknown agent", () => {
    const { registry } = setup();
    expect(() => registry.awardBadge("ghost", "shark")).toThrow(/not registered/i);
  });
});

// ---------------------------------------------------------------------------
// Store integration — auto-registration
// ---------------------------------------------------------------------------

describe("AgentRegistry — store integration / auto-register", () => {
  it("auto-registers agents seen in a preflop update", () => {
    const { store, registry } = setup();
    seedTable(store);
    expect(registry.getProfile("alice")).toBeDefined();
    expect(registry.getProfile("bob")).toBeDefined();
  });

  it("auto-registers with type 'simulated' and uses agentId as name", () => {
    const { store, registry } = setup();
    seedTable(store);
    const p = registry.getProfile("alice")!;
    expect(p.type).toBe("simulated");
    expect(p.name).toBe("alice");
  });
});

// ---------------------------------------------------------------------------
// Store integration — stats
// ---------------------------------------------------------------------------

describe("AgentRegistry — store integration / stats", () => {
  it("increments handsPlayed for all seated agents after settlement", () => {
    const { store, registry } = setup();
    seedTable(store);
    settleHand(store, "t1", "alice");

    expect(registry.getProfile("alice")?.stats.handsPlayed).toBe(1);
    expect(registry.getProfile("bob")?.stats.handsPlayed).toBe(1);
  });

  it("increments handsWon only for the winner", () => {
    const { store, registry } = setup();
    seedTable(store);
    settleHand(store, "t1", "alice");

    expect(registry.getProfile("alice")?.stats.handsWon).toBe(1);
    expect(registry.getProfile("bob")?.stats.handsWon).toBe(0);
  });

  it("sets winRate correctly", () => {
    const { store, registry } = setup();
    seedTable(store);
    settleHand(store, "t1", "alice");

    expect(registry.getProfile("alice")?.stats.winRate).toBe(100); // 1/1
    expect(registry.getProfile("bob")?.stats.winRate).toBe(0);     // 0/1
  });

  it("does not double-process the same hand on subsequent notifications", () => {
    const { store, registry } = setup();
    seedTable(store);
    settleHand(store, "t1", "alice");
    // Fire a second notification without changing handNumber
    const record = store.requireTable("t1");
    store.notify("t1", record);

    expect(registry.getProfile("alice")?.stats.handsPlayed).toBe(1);
  });

  it("tracks win streak and best streak", () => {
    const { store, registry } = setup();
    seedTable(store);
    settleHand(store, "t1", "alice");

    expect(registry.getProfile("alice")?.stats.currentStreak).toBe(1);
    expect(registry.getProfile("alice")?.stats.bestStreak).toBe(1);
  });

  it("resets currentStreak to 0 on a loss", () => {
    const { store, registry } = setup();
    seedTable(store);
    settleHand(store, "t1", "alice"); // alice wins → streak 1

    // Simulate second hand: bob wins
    const record = store.requireTable("t1");
    const hn = record.state.handNumber;
    (record.state as Record<string, unknown>)["phase"] = "preflop";
    (record.state as Record<string, unknown>)["handNumber"] = hn + 1;
    store.notify("t1", record);

    (record.state as Record<string, unknown>)["phase"] = "settlement";
    (record.state as Record<string, unknown>)["winners"] = [
      { agentId: "bob", amountWon: 200, hand: null },
    ];
    store.notify("t1", record);

    expect(registry.getProfile("alice")?.stats.currentStreak).toBe(0);
    expect(registry.getProfile("alice")?.stats.bestStreak).toBe(1); // preserved
    expect(registry.getProfile("bob")?.stats.currentStreak).toBe(1);
  });

  it("records biggestPot for the winner", () => {
    const { store, registry } = setup();
    seedTable(store);
    settleHand(store, "t1", "alice", 800);

    expect(registry.getProfile("alice")?.stats.biggestPot).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// Store integration — ELO
// ---------------------------------------------------------------------------

describe("AgentRegistry — store integration / ELO", () => {
  it("winner's ELO increases after a hand", () => {
    const { store, registry } = setup();
    seedTable(store);
    settleHand(store, "t1", "alice");

    expect(registry.getProfile("alice")!.elo).toBeGreaterThan(1200);
  });

  it("loser's ELO decreases after a hand", () => {
    const { store, registry } = setup();
    seedTable(store);
    settleHand(store, "t1", "alice");

    expect(registry.getProfile("bob")!.elo).toBeLessThan(1200);
  });

  it("ELO changes are symmetrical (winner gains ≈ loser loses)", () => {
    const { store, registry } = setup();
    seedTable(store);
    settleHand(store, "t1", "alice");

    const gained = registry.getProfile("alice")!.elo - 1200;
    const lost   = 1200 - registry.getProfile("bob")!.elo;
    // K=32, expected ≈ 0.5 for equal ELOs → each change ≈ 16
    expect(gained).toBe(lost);
    expect(gained).toBeCloseTo(16, 0);
  });

  it("ELO never drops below 100", () => {
    const { store, registry } = setup();
    registry.registerAgent({ id: "weak", name: "Weak", type: "simulated" });
    const p = registry.getProfile("weak")!;
    p.elo = 101; // almost floor

    store.createTable("t2");
    store.addAgent("t2", "weak", [], 500);
    store.addAgent("t2", "strong", [], 500);

    // Simulate multiple losses to try to push below floor
    for (let i = 0; i < 20; i++) {
      const record = store.requireTable("t2");
      (record.state as Record<string, unknown>)["phase"] = "preflop";
      (record.state as Record<string, unknown>)["handNumber"] = i + 10;
      store.notify("t2", record);

      (record.state as Record<string, unknown>)["phase"] = "settlement";
      (record.state as Record<string, unknown>)["winners"] = [
        { agentId: "strong", amountWon: 50, hand: null },
      ];
      store.notify("t2", record);
    }

    expect(registry.getProfile("weak")!.elo).toBeGreaterThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Store integration — badges (threshold)
// ---------------------------------------------------------------------------

describe("AgentRegistry — store integration / badges", () => {
  it("awards first-hand badge after the first hand", () => {
    const { store, registry } = setup();
    seedTable(store);
    settleHand(store, "t1", "alice");

    expect(registry.getProfile("alice")?.badges).toContain<Badge>("first-hand");
    expect(registry.getProfile("bob")?.badges).toContain<Badge>("first-hand");
  });

  it("awards high-roller badge for pot ≥ 1000", () => {
    const { store, registry } = setup();
    seedTable(store, "alice", "bob", 2000);
    settleHand(store, "t1", "alice", 1500);

    expect(registry.getProfile("alice")?.badges).toContain<Badge>("high-roller");
    expect(registry.getProfile("bob")?.badges).not.toContain<Badge>("high-roller");
  });

  it("awards shark badge when handsWon reaches 100", () => {
    const { store, registry } = setup();
    registry.registerAgent({ id: "grinder", name: "Grinder", type: "simulated" });
    const p = registry.getProfile("grinder")!;
    p.stats.handsWon = 99;
    p.stats.handsPlayed = 99;

    store.createTable("t3");
    store.addAgent("t3", "grinder", [], 500);
    store.addAgent("t3", "dummy", [], 500);
    settleHand(store, "t3", "grinder");

    expect(registry.getProfile("grinder")?.badges).toContain<Badge>("shark");
  });

  it("awards elo-1500 badge when ELO reaches 1500", () => {
    const { store, registry } = setup();
    registry.registerAgent({ id: "pro", name: "Pro", type: "claude" });
    const p = registry.getProfile("pro")!;
    p.elo = 1490;

    store.createTable("t4");
    store.addAgent("t4", "pro", [], 500);
    store.addAgent("t4", "noob", [], 500);

    // Simulate several wins for pro to push ELO over 1500
    for (let i = 0; i < 5; i++) {
      const record = store.requireTable("t4");
      (record.state as Record<string, unknown>)["phase"] = "preflop";
      (record.state as Record<string, unknown>)["handNumber"] = i + 1;
      store.notify("t4", record);

      (record.state as Record<string, unknown>)["phase"] = "settlement";
      (record.state as Record<string, unknown>)["winners"] = [
        { agentId: "pro", amountWon: 50, hand: null },
      ];
      store.notify("t4", record);
    }

    expect(registry.getProfile("pro")!.elo).toBeGreaterThanOrEqual(1500);
    expect(registry.getProfile("pro")?.badges).toContain<Badge>("elo-1500");
  });

  it("awards silent-assassin when winner sent no chat this hand", () => {
    const { store, registry } = setup();
    seedTable(store); // triggers preflop, alice and bob have 0 chats
    settleHand(store, "t1", "alice");

    expect(registry.getProfile("alice")?.badges).toContain<Badge>("silent-assassin");
  });

  it("does not award silent-assassin when winner chatted this hand", () => {
    const { store, registry } = setup();
    store.createTable("t1");
    store.addAgent("t1", "alice", [], 500);
    // Add a chat message before bob joins (to capture context before preflop)
    store.requireTable("t1").chatLog.push({
      agentId: "alice",
      message: "hello",
      timestamp: Date.now(),
    });
    store.addAgent("t1", "bob", [], 500); // triggers preflop → captures chatCountAtStart

    // Add another chat after preflop (within the hand)
    store.requireTable("t1").chatLog.push({
      agentId: "alice",
      message: "bluffing",
      timestamp: Date.now(),
    });

    settleHand(store, "t1", "alice");

    // alice had 1 chat at hand start and now has 2 → not silent
    expect(registry.getProfile("alice")?.badges).not.toContain<Badge>("silent-assassin");
  });

  it("awards trash-talker badge at 100 chat messages", () => {
    const { store, registry } = setup();
    registry.registerAgent({ id: "chatter", name: "Chatter", type: "simulated" });

    store.createTable("t5");
    store.addAgent("t5", "chatter", [], 500);
    store.addAgent("t5", "quiet", [], 500);

    // Fill chat log with 100 messages from chatter before hand starts
    const record = store.requireTable("t5");
    for (let i = 0; i < 100; i++) {
      record.chatLog.push({ agentId: "chatter", message: `msg${i}`, timestamp: Date.now() });
    }

    settleHand(store, "t5", "chatter");

    expect(registry.getProfile("chatter")?.badges).toContain<Badge>("trash-talker");
  });
});

import { describe, expect, it } from "vitest";
import { GameStore } from "../src/game-store.js";
import { TournamentManager } from "../src/tournament.js";
import type { TournamentConfig } from "../src/tournament.js";
import { createTournament } from "../src/tools/create-tournament.js";
import { registerTournament } from "../src/tools/register-tournament.js";
import { startTournament } from "../src/tools/start-tournament.js";
import { tournamentStatus } from "../src/tools/tournament-status.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager() {
  const store   = new GameStore();
  const manager = new TournamentManager(store);
  return { store, manager };
}

const TWO_LEVEL_CONFIG: TournamentConfig = {
  name:          "Test Weekly",
  type:          "freezeout",
  buyIn:         100,
  startingStack: 1500,
  maxPlayers:    16,
  blindLevels: [
    { small: 10, big: 20, ante: 0, durationHands: 3 },
    { small: 25, big: 50, ante: 5, durationHands: 5 },
  ],
  prizes: [
    { position: 1, tokens: 2000, badge: "tournament-winner", title: "Champion" },
    { position: 2, tokens: 800 },
  ],
};

/** Simulate a settled hand on a tournament table. */
function settleTournamentHand(
  store: GameStore,
  tableId: string,
  winnerId: string,
  handNumber: number,
  loserStacks: Record<string, number> = {}
) {
  const record = store.requireTable(tableId);
  (record.state as Record<string, unknown>)["phase"]      = "settlement";
  (record.state as Record<string, unknown>)["handNumber"] = handNumber;
  (record.state as Record<string, unknown>)["winners"]    = [
    { agentId: winnerId, amountWon: 200, hand: null },
  ];
  // Update seat stacks for losers
  for (const seat of record.state.seats) {
    if (loserStacks[seat.agentId] !== undefined) {
      seat.stack = loserStacks[seat.agentId]!;
    }
  }
  store.notify(tableId, record);
}

// ---------------------------------------------------------------------------
// createTournament
// ---------------------------------------------------------------------------

describe("TournamentManager — createTournament", () => {
  it("creates a tournament in 'registering' status", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    const t  = manager.getTournament(id)!;
    expect(t.status).toBe("registering");
    expect(t.name).toBe("Test Weekly");
    expect(t.maxPlayers).toBe(16);
  });

  it("returns a unique id each time", () => {
    const { manager } = makeManager();
    const a = manager.createTournament(TWO_LEVEL_CONFIG);
    const b = manager.createTournament({ ...TWO_LEVEL_CONFIG, name: "Other" });
    expect(a).not.toBe(b);
  });

  it("throws for empty blind levels", () => {
    const { manager } = makeManager();
    expect(() =>
      manager.createTournament({ ...TWO_LEVEL_CONFIG, blindLevels: [] })
    ).toThrow(/blind level/i);
  });

  it("throws for maxPlayers < 2", () => {
    const { manager } = makeManager();
    expect(() =>
      manager.createTournament({ ...TWO_LEVEL_CONFIG, maxPlayers: 1 })
    ).toThrow(/maxPlayers/i);
  });

  it("throws for non-positive startingStack", () => {
    const { manager } = makeManager();
    expect(() =>
      manager.createTournament({ ...TWO_LEVEL_CONFIG, startingStack: 0 })
    ).toThrow(/startingStack/i);
  });

  it("throws for empty prizes", () => {
    const { manager } = makeManager();
    expect(() =>
      manager.createTournament({ ...TWO_LEVEL_CONFIG, prizes: [] })
    ).toThrow(/prize/i);
  });
});

// ---------------------------------------------------------------------------
// registerPlayer
// ---------------------------------------------------------------------------

describe("TournamentManager — registerPlayer", () => {
  it("registers a player successfully", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "shark");
    // No error = success; verify via start behavior
  });

  it("throws for duplicate registration", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "shark");
    expect(() => manager.registerPlayer(id, "shark")).toThrow(/already registered/i);
  });

  it("throws when tournament is full", () => {
    const { manager } = makeManager();
    const id = manager.createTournament({ ...TWO_LEVEL_CONFIG, maxPlayers: 2 });
    manager.registerPlayer(id, "a");
    manager.registerPlayer(id, "b");
    expect(() => manager.registerPlayer(id, "c")).toThrow(/full/i);
  });

  it("throws when tournament has already started", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "a");
    manager.registerPlayer(id, "b");
    manager.startTournament(id);
    expect(() => manager.registerPlayer(id, "late")).toThrow(/registrations/i);
  });

  it("throws for unknown tournament id", () => {
    const { manager } = makeManager();
    expect(() => manager.registerPlayer("bad-id", "shark")).toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// startTournament
// ---------------------------------------------------------------------------

describe("TournamentManager — startTournament", () => {
  it("transitions status to 'running'", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "a");
    manager.registerPlayer(id, "b");
    manager.startTournament(id);
    expect(manager.getTournament(id)?.status).toBe("running");
  });

  it("creates one table for ≤ 8 players", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    ["a", "b", "c", "d"].forEach((p) => manager.registerPlayer(id, p));
    manager.startTournament(id);
    expect(manager.getTournament(id)?.tables).toHaveLength(1);
  });

  it("creates two tables for 9 players", () => {
    const { manager } = makeManager();
    const id = manager.createTournament({ ...TWO_LEVEL_CONFIG, maxPlayers: 16 });
    for (let i = 0; i < 9; i++) manager.registerPlayer(id, `p${i}`);
    manager.startTournament(id);
    expect(manager.getTournament(id)?.tables).toHaveLength(2);
  });

  it("each player is seated at a table with the starting stack", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "alice");
    manager.registerPlayer(id, "bob");
    manager.startTournament(id);
    const t = manager.getTournament(id)!;
    expect(t.players).toHaveLength(2);
    for (const p of t.players) {
      expect(p.stack).toBe(1500);
      expect(p.currentTableId).toBeTruthy();
    }
  });

  it("sets correct blinds on the created table", () => {
    const { store, manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "alice");
    manager.registerPlayer(id, "bob");
    manager.startTournament(id);
    const tableId = manager.getTournament(id)!.tables[0]!;
    const record  = store.requireTable(tableId);
    expect(record.config.smallBlind).toBe(10);
    expect(record.config.bigBlind).toBe(20);
  });

  it("throws when fewer than 2 players registered", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "a");
    expect(() => manager.startTournament(id)).toThrow(/2 registered/i);
  });

  it("throws when tournament is not in registering status", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "a");
    manager.registerPlayer(id, "b");
    manager.startTournament(id);
    expect(() => manager.startTournament(id)).toThrow(/registering status/i);
  });

  it("sets startTime to the current date", () => {
    const { manager } = makeManager();
    const id    = manager.createTournament(TWO_LEVEL_CONFIG);
    const before = Date.now();
    manager.registerPlayer(id, "a");
    manager.registerPlayer(id, "b");
    manager.startTournament(id);
    const after = Date.now();
    const t = manager.getTournament(id)!;
    expect(t.startTime.getTime()).toBeGreaterThanOrEqual(before);
    expect(t.startTime.getTime()).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// Store integration — elimination detection
// ---------------------------------------------------------------------------

describe("TournamentManager — elimination", () => {
  it("marks an eliminated player with their finish position", () => {
    const { store, manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "alice");
    manager.registerPlayer(id, "bob");
    manager.startTournament(id);

    const t       = manager.getTournament(id)!;
    const tableId = t.tables[0]!;
    const hn      = store.requireTable(tableId).state.handNumber;

    // Simulate bob going bust
    settleTournamentHand(store, tableId, "alice", hn, { bob: 0 });

    const updated = manager.getTournament(id)!;
    const bob     = updated.players.find((p) => p.agentId === "bob")!;
    expect(bob.finishPosition).toBe(2);
    expect(bob.eliminatedAt).toBeInstanceOf(Date);
  });

  it("completes the tournament when 1 player remains", () => {
    const { store, manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "alice");
    manager.registerPlayer(id, "bob");
    manager.startTournament(id);

    const tableId = manager.getTournament(id)!.tables[0]!;
    const hn      = store.requireTable(tableId).state.handNumber;
    settleTournamentHand(store, tableId, "alice", hn, { bob: 0 });

    const t = manager.getTournament(id)!;
    expect(t.status).toBe("complete");
    const alice = t.players.find((p) => p.agentId === "alice")!;
    expect(alice.finishPosition).toBe(1);
  });

  it("does not double-process the same hand", () => {
    const { store, manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "alice");
    manager.registerPlayer(id, "bob");
    manager.startTournament(id);

    const tableId = manager.getTournament(id)!.tables[0]!;
    const hn      = store.requireTable(tableId).state.handNumber;
    settleTournamentHand(store, tableId, "alice", hn, { bob: 0 });

    // Fire a second notification with the same hand number — should be ignored
    store.notify(tableId, store.requireTable(tableId));

    const t   = manager.getTournament(id)!;
    const bob = t.players.find((p) => p.agentId === "bob")!;
    // finishPosition should still be 2, not changed by the second event
    expect(bob.finishPosition).toBe(2);
  });

  it("correctly assigns positions for 3-player tournament (3rd → 2nd → 1st)", () => {
    const { store, manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    ["alice", "bob", "carol"].forEach((p) => manager.registerPlayer(id, p));
    manager.startTournament(id);

    const tableId = manager.getTournament(id)!.tables[0]!;
    let hn = store.requireTable(tableId).state.handNumber;

    // Carol eliminated first (3rd)
    settleTournamentHand(store, tableId, "alice", hn, { carol: 0 });
    hn++;

    // Bob eliminated second (2nd)
    settleTournamentHand(store, tableId, "alice", hn, { bob: 0 });

    const t = manager.getTournament(id)!;
    expect(t.players.find((p) => p.agentId === "carol")?.finishPosition).toBe(3);
    expect(t.players.find((p) => p.agentId === "bob")?.finishPosition).toBe(2);
    expect(t.players.find((p) => p.agentId === "alice")?.finishPosition).toBe(1);
    expect(t.status).toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// Store integration — blind level advancement
// ---------------------------------------------------------------------------

describe("TournamentManager — blind levels", () => {
  it("stays at level 0 before durationHands hands", () => {
    const { store, manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG); // durationHands = 3
    manager.registerPlayer(id, "alice");
    manager.registerPlayer(id, "bob");
    manager.startTournament(id);

    const tableId = manager.getTournament(id)!.tables[0]!;
    const baseHn  = store.requireTable(tableId).state.handNumber;

    // Play 2 hands (less than durationHands = 3)
    for (let i = 0; i < 2; i++) {
      settleTournamentHand(store, tableId, "alice", baseHn + i);
    }

    expect(manager.getTournament(id)?.currentLevel).toBe(0);
  });

  it("advances to level 1 after durationHands total hands", () => {
    const { store, manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG); // durationHands = 3
    manager.registerPlayer(id, "alice");
    manager.registerPlayer(id, "bob");
    manager.startTournament(id);

    const tableId = manager.getTournament(id)!.tables[0]!;
    const baseHn  = store.requireTable(tableId).state.handNumber;

    for (let i = 0; i < 3; i++) {
      settleTournamentHand(store, tableId, "alice", baseHn + i);
    }

    expect(manager.getTournament(id)?.currentLevel).toBe(1);
  });

  it("updates table config when blinds advance", () => {
    const { store, manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG); // level 1 = 25/50
    manager.registerPlayer(id, "alice");
    manager.registerPlayer(id, "bob");
    manager.startTournament(id);

    const tableId = manager.getTournament(id)!.tables[0]!;
    const baseHn  = store.requireTable(tableId).state.handNumber;

    for (let i = 0; i < 3; i++) {
      settleTournamentHand(store, tableId, "alice", baseHn + i);
    }

    const cfg = store.requireTable(tableId).config;
    expect(cfg.smallBlind).toBe(25);
    expect(cfg.bigBlind).toBe(50);
  });

  it("does not advance past the final blind level", () => {
    const { store, manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG); // 2 levels
    manager.registerPlayer(id, "alice");
    manager.registerPlayer(id, "bob");
    manager.startTournament(id);

    const tableId = manager.getTournament(id)!.tables[0]!;
    const baseHn  = store.requireTable(tableId).state.handNumber;

    // Play enough hands to try advancing past both levels
    for (let i = 0; i < 10; i++) {
      settleTournamentHand(store, tableId, "alice", baseHn + i);
    }

    expect(manager.getTournament(id)?.currentLevel).toBe(1); // capped at last level
  });
});

// ---------------------------------------------------------------------------
// listTournaments
// ---------------------------------------------------------------------------

describe("TournamentManager — listTournaments", () => {
  it("returns an empty array when no tournaments exist", () => {
    const { manager } = makeManager();
    expect(manager.listTournaments()).toHaveLength(0);
  });

  it("lists all created tournaments", () => {
    const { manager } = makeManager();
    manager.createTournament(TWO_LEVEL_CONFIG);
    manager.createTournament({ ...TWO_LEVEL_CONFIG, name: "Other" });
    expect(manager.listTournaments()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// MCP tool wrappers
// ---------------------------------------------------------------------------

describe("pokercrawl_create_tournament tool", () => {
  it("creates a tournament and returns tournamentId", () => {
    const { manager } = makeManager();
    const result = createTournament(
      {
        name:           "Tool Test",
        type:           "freezeout",
        buy_in:         50,
        starting_stack: 1000,
        max_players:    8,
        blind_levels:   [{ small: 5, big: 10, ante: 0, duration_hands: 10 }],
        prizes:         [{ position: 1, tokens: 500 }],
      },
      manager
    );
    expect(result.success).toBe(true);
    expect(typeof result.data?.["tournamentId"]).toBe("string");
  });
});

describe("pokercrawl_register_tournament tool", () => {
  it("registers a player successfully", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    const result = registerTournament(
      { tournament_id: id, agent_id: "shark", capabilities: [] },
      manager
    );
    expect(result.success).toBe(true);
  });

  it("returns error for unknown tournament", () => {
    const { manager } = makeManager();
    const result = registerTournament(
      { tournament_id: "bad", agent_id: "shark", capabilities: [] },
      manager
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });
});

describe("pokercrawl_start_tournament tool", () => {
  it("starts a registered tournament", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "alice");
    manager.registerPlayer(id, "bob");
    const result = startTournament({ tournament_id: id }, manager);
    expect(result.success).toBe(true);
    expect(result.data?.["status"]).toBe("running");
  });

  it("returns error for too few players", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    manager.registerPlayer(id, "alone");
    const result = startTournament({ tournament_id: id }, manager);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/2 registered/i);
  });
});

describe("pokercrawl_tournament_status tool", () => {
  it("returns status for a specific tournament", () => {
    const { manager } = makeManager();
    const id = manager.createTournament(TWO_LEVEL_CONFIG);
    const result = tournamentStatus({ tournament_id: id }, manager);
    expect(result.success).toBe(true);
    expect(result.data?.["status"]).toBe("registering");
  });

  it("returns error for unknown tournament", () => {
    const { manager } = makeManager();
    const result = tournamentStatus({ tournament_id: "ghost" }, manager);
    expect(result.success).toBe(false);
  });

  it("lists all tournaments when tournament_id is omitted", () => {
    const { manager } = makeManager();
    manager.createTournament(TWO_LEVEL_CONFIG);
    manager.createTournament({ ...TWO_LEVEL_CONFIG, name: "B" });
    const result = tournamentStatus({}, manager);
    expect(result.success).toBe(true);
    expect((result.data?.["tournaments"] as unknown[]).length).toBe(2);
  });
});

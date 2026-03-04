import { describe, expect, it, beforeEach } from "vitest";
import { GameStore } from "../src/game-store.js";
import { Lobby } from "../src/lobby.js";
import type { LobbyTableConfig } from "../src/lobby.js";
import { createTable } from "../src/tools/create-table.js";
import { listTables } from "../src/tools/list-tables.js";
import { leaveTable } from "../src/tools/leave-table.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLobby() {
  const store = new GameStore();
  const lobby = new Lobby(store);
  return { store, lobby };
}

const DEFAULT_CONFIG: LobbyTableConfig = {
  name: "Mesa del Tiburón",
  blinds: { small: 5, big: 10 },
  maxSeats: 6,
  type: "cash",
  buyIn: { min: 100, max: 1000 },
  isPrivate: false,
  allowRealAgents: true,
  allowSimulatedBots: true,
};

// ---------------------------------------------------------------------------
// Lobby.createTable
// ---------------------------------------------------------------------------

describe("Lobby.createTable", () => {
  it("creates a table and returns a valid tableId", () => {
    const { lobby } = makeLobby();
    const id = lobby.createTable(DEFAULT_CONFIG);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(id).toMatch(/^mesa-del-tibur/);
  });

  it("registers the table so it appears in listTables()", () => {
    const { lobby } = makeLobby();
    const id = lobby.createTable(DEFAULT_CONFIG);
    const tables = lobby.listTables();
    expect(tables).toHaveLength(1);
    expect(tables[0]?.id).toBe(id);
    expect(tables[0]?.name).toBe("Mesa del Tiburón");
  });

  it("stores blind levels correctly", () => {
    const { lobby } = makeLobby();
    lobby.createTable(DEFAULT_CONFIG);
    const [table] = lobby.listTables();
    expect(table?.blinds.small).toBe(5);
    expect(table?.blinds.big).toBe(10);
  });

  it("stores buy-in bounds", () => {
    const { lobby } = makeLobby();
    lobby.createTable(DEFAULT_CONFIG);
    const [table] = lobby.listTables();
    expect(table?.minBuyIn).toBe(100);
    expect(table?.maxBuyIn).toBe(1000);
  });

  it("throws for maxSeats < 2", () => {
    const { lobby } = makeLobby();
    expect(() =>
      lobby.createTable({ ...DEFAULT_CONFIG, maxSeats: 1 })
    ).toThrow(/maxSeats/i);
  });

  it("throws for maxSeats > 8", () => {
    const { lobby } = makeLobby();
    expect(() =>
      lobby.createTable({ ...DEFAULT_CONFIG, maxSeats: 9 })
    ).toThrow(/maxSeats/i);
  });

  it("throws for invalid buy-in range", () => {
    const { lobby } = makeLobby();
    expect(() =>
      lobby.createTable({ ...DEFAULT_CONFIG, buyIn: { min: 500, max: 100 } })
    ).toThrow(/buy-in/i);
  });

  it("multiple tables get distinct IDs", () => {
    const { lobby } = makeLobby();
    const a = lobby.createTable(DEFAULT_CONFIG);
    const b = lobby.createTable({ ...DEFAULT_CONFIG, name: "Table B" });
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Lobby.listTables
// ---------------------------------------------------------------------------

describe("Lobby.listTables", () => {
  it("returns empty array when no tables exist", () => {
    const { lobby } = makeLobby();
    expect(lobby.listTables()).toHaveLength(0);
  });

  it("status is 'waiting' before any players join", () => {
    const { lobby } = makeLobby();
    lobby.createTable(DEFAULT_CONFIG);
    expect(lobby.listTables()[0]?.status).toBe("waiting");
  });

  it("private tables appear in listTables (without password)", () => {
    const { lobby } = makeLobby();
    lobby.createTable({ ...DEFAULT_CONFIG, isPrivate: true, password: "secret" });
    const tables = lobby.listTables();
    expect(tables).toHaveLength(1);
    expect(tables[0]?.isPrivate).toBe(true);
    // Password must not be exposed
    expect(JSON.stringify(tables[0])).not.toContain("secret");
  });

  it("currentPlayers increments as agents join", () => {
    const { lobby, store } = makeLobby();
    const id = lobby.createTable(DEFAULT_CONFIG);
    expect(lobby.getTableInfo(id)?.currentPlayers).toBe(0);

    store.addAgent(id, "alice", [], 500);
    expect(lobby.getTableInfo(id)?.currentPlayers).toBe(1);

    store.addAgent(id, "bob", [], 500);
    expect(lobby.getTableInfo(id)?.currentPlayers).toBe(2);
  });

  it("handsPlayed reflects game state handNumber", () => {
    const { lobby } = makeLobby();
    const id = lobby.createTable(DEFAULT_CONFIG);
    // No hands played yet
    expect(lobby.getTableInfo(id)?.handsPlayed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lobby.joinTable
// ---------------------------------------------------------------------------

describe("Lobby.joinTable", () => {
  it("joins a table with a valid buy-in", () => {
    const { lobby, store } = makeLobby();
    const id = lobby.createTable(DEFAULT_CONFIG);
    lobby.joinTable(id, { agentId: "alice", capabilities: ["code"], buyIn: 500 });
    expect(store.requireTable(id).agents.has("alice")).toBe(true);
  });

  it("rejects buy-in below minimum", () => {
    const { lobby } = makeLobby();
    const id = lobby.createTable(DEFAULT_CONFIG);
    expect(() =>
      lobby.joinTable(id, { agentId: "alice", capabilities: [], buyIn: 50 })
    ).toThrow(/minimum/i);
  });

  it("rejects buy-in above maximum", () => {
    const { lobby } = makeLobby();
    const id = lobby.createTable(DEFAULT_CONFIG);
    expect(() =>
      lobby.joinTable(id, { agentId: "alice", capabilities: [], buyIn: 9999 })
    ).toThrow(/maximum/i);
  });

  it("rejects join on a private table without password", () => {
    const { lobby } = makeLobby();
    const id = lobby.createTable({
      ...DEFAULT_CONFIG,
      isPrivate: true,
      password: "pw123",
    });
    expect(() =>
      lobby.joinTable(id, { agentId: "alice", capabilities: [], buyIn: 500 })
    ).toThrow(/password/i);
  });

  it("accepts join on a private table with correct password", () => {
    const { lobby, store } = makeLobby();
    const id = lobby.createTable({
      ...DEFAULT_CONFIG,
      isPrivate: true,
      password: "pw123",
    });
    lobby.joinTable(
      id,
      { agentId: "alice", capabilities: [], buyIn: 500 },
      "pw123"
    );
    expect(store.requireTable(id).agents.has("alice")).toBe(true);
  });

  it("rejects when table is full", () => {
    const { lobby } = makeLobby();
    const id = lobby.createTable({ ...DEFAULT_CONFIG, maxSeats: 2 });
    lobby.joinTable(id, { agentId: "a1", capabilities: [], buyIn: 200 });
    lobby.joinTable(id, { agentId: "a2", capabilities: [], buyIn: 200 });
    expect(() =>
      lobby.joinTable(id, { agentId: "a3", capabilities: [], buyIn: 200 })
    ).toThrow(/full/i);
  });

  it("throws for unknown tableId", () => {
    const { lobby } = makeLobby();
    expect(() =>
      lobby.joinTable("nonexistent", { agentId: "alice", capabilities: [], buyIn: 500 })
    ).toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// Lobby.leaveTable
// ---------------------------------------------------------------------------

describe("Lobby.leaveTable", () => {
  it("removes the agent from the store", () => {
    const { lobby, store } = makeLobby();
    const id = lobby.createTable(DEFAULT_CONFIG);
    store.addAgent(id, "alice", [], 500);
    expect(store.requireTable(id).agents.has("alice")).toBe(true);

    lobby.leaveTable(id, "alice");
    expect(store.requireTable(id).agents.has("alice")).toBe(false);
  });

  it("throws for non-existent agent", () => {
    const { lobby, store } = makeLobby();
    const id = lobby.createTable(DEFAULT_CONFIG);
    store.addAgent(id, "alice", [], 500);
    expect(() => lobby.leaveTable(id, "ghost")).toThrow();
  });

  it("throws for unknown tableId", () => {
    const { lobby } = makeLobby();
    expect(() => lobby.leaveTable("bad-id", "alice")).toThrow(/not found/i);
  });

  it("currentPlayers decrements after leave", () => {
    const { lobby, store } = makeLobby();
    const id = lobby.createTable(DEFAULT_CONFIG);
    store.addAgent(id, "alice", [], 500);
    expect(lobby.getTableInfo(id)?.currentPlayers).toBe(1);

    lobby.leaveTable(id, "alice");
    expect(lobby.getTableInfo(id)?.currentPlayers).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GameStore.removeAgent
// ---------------------------------------------------------------------------

describe("GameStore.removeAgent", () => {
  it("removes agent and zeros their seat stack", () => {
    const store = new GameStore();
    store.createTable("t1");
    store.addAgent("t1", "alice", [], 500);
    store.addAgent("t1", "bob", [], 500);

    store.removeAgent("t1", "alice");

    const record = store.requireTable("t1");
    expect(record.agents.has("alice")).toBe(false);
    const aliceSeat = record.state.seats.find((s) => s.agentId === "alice");
    expect(aliceSeat?.stack).toBe(0);
  });

  it("throws for agent not at the table", () => {
    const store = new GameStore();
    store.createTable("t1");
    expect(() => store.removeAgent("t1", "ghost")).toThrow(/not seated/i);
  });
});

// ---------------------------------------------------------------------------
// MCP tool wrappers
// ---------------------------------------------------------------------------

describe("pokercrawl_create_table tool", () => {
  it("creates a table and returns tableId in data", () => {
    const { lobby } = makeLobby();
    const result = createTable(
      {
        name: "Noobs Welcome",
        small_blind: 1,
        big_blind: 2,
        max_seats: 4,
        type: "cash",
        min_buy_in: 20,
        max_buy_in: 200,
        is_private: false,
        allow_real_agents: true,
        allow_simulated_bots: true,
      },
      lobby
    );
    expect(result.success).toBe(true);
    expect(typeof result.data?.["tableId"]).toBe("string");
    expect(result.data?.["name"]).toBe("Noobs Welcome");
  });

  it("returns error for invalid config", () => {
    const { lobby } = makeLobby();
    const result = createTable(
      {
        name: "Bad",
        small_blind: 5,
        big_blind: 10,
        max_seats: 10, // invalid
        type: "cash",
        min_buy_in: 100,
        max_buy_in: 1000,
        is_private: false,
        allow_real_agents: true,
        allow_simulated_bots: true,
      },
      lobby
    );
    // Zod validation catches max_seats > 8 before handler
    // (CreateTableSchema has .max(8))
    expect(result.success).toBe(false);
  });
});

describe("pokercrawl_list_tables tool", () => {
  it("returns empty list when no tables", () => {
    const { lobby } = makeLobby();
    const result = listTables({ type: "all", status: "all", include_private: false }, lobby);
    expect(result.success).toBe(true);
    expect((result.data?.["tables"] as unknown[]).length).toBe(0);
  });

  it("lists created tables", () => {
    const { lobby } = makeLobby();
    lobby.createTable(DEFAULT_CONFIG);
    lobby.createTable({ ...DEFAULT_CONFIG, name: "Table B", type: "tournament" });

    const all = listTables({ type: "all", status: "all", include_private: false }, lobby);
    expect((all.data?.["tables"] as unknown[]).length).toBe(2);

    const cash = listTables({ type: "cash", status: "all", include_private: false }, lobby);
    expect((cash.data?.["tables"] as unknown[]).length).toBe(1);
  });

  it("filters private tables when include_private is false", () => {
    const { lobby } = makeLobby();
    lobby.createTable({ ...DEFAULT_CONFIG, isPrivate: true, password: "x" });
    const result = listTables({ type: "all", status: "all", include_private: false }, lobby);
    expect((result.data?.["tables"] as unknown[]).length).toBe(0);
  });
});

describe("pokercrawl_leave_table tool", () => {
  it("removes an agent successfully", () => {
    const { lobby, store } = makeLobby();
    const id = lobby.createTable(DEFAULT_CONFIG);
    store.addAgent(id, "alice", [], 500);

    const result = leaveTable({ tableId: id, agentId: "alice" }, lobby);
    expect(result.success).toBe(true);
    expect(store.requireTable(id).agents.has("alice")).toBe(false);
  });

  it("returns error for unknown table", () => {
    const { lobby } = makeLobby();
    const result = leaveTable({ tableId: "bad", agentId: "alice" }, lobby);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });
});

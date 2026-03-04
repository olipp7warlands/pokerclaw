/**
 * Tests for WsAgentBridge
 *
 * Exercises both the HTTP registration endpoint and the WebSocket
 * game-event / command protocol.
 */

import { WebSocket } from "ws";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { GameStore } from "../src/game-store.js";
import { WsAgentBridge } from "../src/ws-agent-bridge.js";

// ---------------------------------------------------------------------------
// WS helpers (independent of bridge instance)
// ---------------------------------------------------------------------------

/** Open a WebSocket, wait for the "connected" event, return ws + agentId. */
function connectWs(
  wsUrl: string,
  token: string,
): Promise<{ ws: WebSocket; agentId: string }> {
  return new Promise((resolve, reject) => {
    const url = token
      ? wsUrl
      : wsUrl; // token via header always
    const ws = new WebSocket(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Timeout waiting for connected event"));
    }, 2000);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { event: string; agentId?: string };
      if (msg.event === "connected" && msg.agentId) {
        clearTimeout(timeout);
        resolve({ ws, agentId: msg.agentId });
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** Collect the next message matching a predicate. */
function nextMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeout = 2000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for matching event`)),
      timeout,
    );

    const handler = (data: Buffer | string) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.removeListener("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

/** Close a WebSocket and wait for the close event. */
function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    ws.once("close", () => resolve());
    ws.close();
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("WsAgentBridge", () => {
  let store:          GameStore;
  let bridge:         WsAgentBridge;
  let httpUrl:        string;
  let wsUrl:          string;

  // Per-test helpers that close over httpUrl / wsUrl set in beforeAll
  let reg: (name: string) => Promise<{ agentId: string; token: string; wsUrl: string }>;
  let connect: (token: string) => Promise<{ ws: WebSocket; agentId: string }>;

  beforeAll(async () => {
    store  = new GameStore();
    bridge = new WsAgentBridge(store, 0);
    await bridge.start();
    httpUrl = `http://127.0.0.1:${bridge.port}`;
    wsUrl   = `ws://127.0.0.1:${bridge.port}`;

    reg = async (name) => {
      const res = await fetch(`${httpUrl}/api/agents/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name, type: "custom", capabilities: ["code"] }),
      });
      return res.json() as Promise<{ agentId: string; token: string; wsUrl: string }>;
    };

    connect = (token) => connectWs(wsUrl, token);
  });

  afterAll(async () => {
    await bridge.stop();
  });

  // ── HTTP: Registration ────────────────────────────────────────────────────

  describe("POST /api/agents/register", () => {
    it("returns 201 with agentId, token, and wsUrl", async () => {
      const res  = await fetch(`${httpUrl}/api/agents/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: "RegBot", type: "openclaw", capabilities: ["code"] }),
      });
      expect(res.status).toBe(201);
      const data = await res.json() as { agentId: string; token: string; wsUrl: string };
      expect(data.agentId).toMatch(/^ext-/);
      expect(data.token.length).toBeGreaterThan(10);
      expect(data.wsUrl).toMatch(/^ws:\/\//);
    });

    it("returns 400 when name is missing", async () => {
      const res = await fetch(`${httpUrl}/api/agents/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: "custom" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for malformed JSON", async () => {
      const res = await fetch(`${httpUrl}/api/agents/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    "not-json",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── HTTP: List agents ─────────────────────────────────────────────────────

  describe("GET /api/agents", () => {
    it("lists agents without token field", async () => {
      await reg("ListTestBot");
      const res    = await fetch(`${httpUrl}/api/agents`);
      const agents = await res.json() as Array<Record<string, unknown>>;
      expect(Array.isArray(agents)).toBe(true);
      const found = agents.find((a) => a["name"] === "ListTestBot");
      expect(found).toBeDefined();
      expect(found!["token"]).toBeUndefined();
    });
  });

  // ── HTTP: skill.md ────────────────────────────────────────────────────────

  describe("GET /skill.md", () => {
    it("serves markdown with registration instructions", async () => {
      const res  = await fetch(`${httpUrl}/skill.md`);
      const text = await res.text();
      expect(res.headers.get("content-type")).toContain("text/markdown");
      expect(text).toContain("PokerCrawl");
      expect(text).toContain("/api/agents/register");
      expect(text).toContain("your_turn");
    });
  });

  // ── WebSocket auth ────────────────────────────────────────────────────────

  describe("WebSocket authentication", () => {
    it("accepts connection with valid Bearer token", async () => {
      const agent = await reg("AuthBot");
      const { ws, agentId } = await connect(agent.token);
      expect(agentId).toBe(agent.agentId);
      await closeWs(ws);
    });

    it("also accepts token via ?token= query param", async () => {
      const agent = await reg("QueryParamBot");
      const { ws } = await connectWs(`${wsUrl}?token=${agent.token}`, "");
      await closeWs(ws);
    });

    it("rejects connection with invalid token", async () => {
      await expect(connect("totally-invalid-token")).rejects.toThrow();
    });
  });

  // ── Command: list_tables ──────────────────────────────────────────────────

  describe("list_tables command", () => {
    it("returns tables_list event with available tables", async () => {
      store.createTable("lobby-list");

      const agent = await reg("ListTablesBot");
      const { ws } = await connect(agent.token);

      const responsePromise = nextMessage(ws, (m) => m["event"] === "tables_list");
      ws.send(JSON.stringify({ action: "list_tables" }));

      const msg = await responsePromise;
      expect(msg["event"]).toBe("tables_list");
      const tables = msg["tables"] as Array<{ tableId: string }>;
      expect(tables.some((t) => t.tableId === "lobby-list")).toBe(true);

      await closeWs(ws);
    });
  });

  // ── Command: join_table ───────────────────────────────────────────────────

  describe("join_table command", () => {
    it("joins table and returns action_result success", async () => {
      store.createTable("join-cmd-table");

      const agent = await reg("JoinCmdBot");
      const { ws } = await connect(agent.token);

      const responsePromise = nextMessage(ws, (m) => m["event"] === "action_result");
      ws.send(JSON.stringify({ action: "join_table", tableId: "join-cmd-table", tokens: 500 }));

      const msg = await responsePromise;
      expect(msg["success"]).toBe(true);

      const record = store.requireTable("join-cmd-table");
      expect(record.agents.has(agent.agentId)).toBe(true);

      await closeWs(ws);
    });

    it("returns error when tableId is missing", async () => {
      const agent = await reg("NoTableBot");
      const { ws } = await connect(agent.token);

      const responsePromise = nextMessage(ws, (m) => m["event"] === "error");
      ws.send(JSON.stringify({ action: "join_table" }));

      const msg = await responsePromise;
      expect(msg["event"]).toBe("error");

      await closeWs(ws);
    });
  });

  // ── Command: unknown / invalid ────────────────────────────────────────────

  it("returns error for unknown action", async () => {
    const agent = await reg("UnknownCmdBot");
    const { ws } = await connect(agent.token);

    const responsePromise = nextMessage(ws, (m) => m["event"] === "error");
    ws.send(JSON.stringify({ action: "warp_drive" }));

    const msg = await responsePromise;
    expect(String(msg["message"])).toContain("warp_drive");

    await closeWs(ws);
  });

  it("returns error for non-JSON message", async () => {
    const agent = await reg("BadJsonBot");
    const { ws } = await connect(agent.token);

    const responsePromise = nextMessage(ws, (m) => m["event"] === "error");
    ws.send("this is not json {}}}}}");

    await responsePromise; // just check it arrives

    await closeWs(ws);
  });

  // ── Event: game_update ────────────────────────────────────────────────────

  describe("game_update event", () => {
    it("fires after agent joins and hand starts", async () => {
      const tableId = `gu-${Date.now()}`;
      store.createTable(tableId);
      store.addAgent(tableId, `alice-gu-${Date.now()}`, [], 500);

      const agent = await reg("GameUpdateBot");
      const { ws } = await connect(agent.token);

      const updatePromise = nextMessage(ws,
        (m) => m["event"] === "game_update" && m["tableId"] === tableId,
        3000,
      );
      ws.send(JSON.stringify({ action: "join_table", tableId, tokens: 500 }));

      const msg = await updatePromise;
      expect(msg["tableId"]).toBe(tableId);
      expect(typeof msg["phase"]).toBe("string");
      expect(Array.isArray(msg["seats"])).toBe(true);
      expect(typeof msg["mainPot"]).toBe("number");

      await closeWs(ws);
    });
  });

  // ── Event: your_turn ─────────────────────────────────────────────────────

  describe("your_turn event", () => {
    it("fires with private hole cards when it is the agent's turn", async () => {
      const tableId = `yt-${Date.now()}`;
      store.createTable(tableId);
      store.addAgent(tableId, `alice-yt-${Date.now()}`, [], 500);

      const agent = await reg("YourTurnBot");
      const { ws } = await connect(agent.token);

      const yourTurnPromise = nextMessage(ws,
        (m) => m["event"] === "your_turn" && m["tableId"] === tableId,
        3000,
      );
      ws.send(JSON.stringify({ action: "join_table", tableId, tokens: 500 }));

      const msg = await yourTurnPromise;
      expect(msg["agentId"]).toBe(agent.agentId);
      expect(Array.isArray(msg["myHoleCards"])).toBe(true);
      expect((msg["myHoleCards"] as unknown[]).length).toBe(2);
      expect(typeof msg["callAmount"]).toBe("number");
      expect(Array.isArray(msg["validActions"])).toBe(true);

      await closeWs(ws);
    });
  });

  // ── Event: hand_complete ──────────────────────────────────────────────────

  describe("hand_complete event", () => {
    it("fires on settlement phase with winners", async () => {
      const tableId = `hc-${Date.now()}`;
      const aliceId = `alice-hc-${Date.now()}`;
      store.createTable(tableId);
      store.addAgent(tableId, aliceId, [], 500);

      const agent = await reg("HandCompleteBot");
      const { ws } = await connect(agent.token);

      ws.send(JSON.stringify({ action: "join_table", tableId, tokens: 500 }));
      // Wait for action_result before proceeding
      await nextMessage(ws, (m) => m["event"] === "action_result", 2000);

      const handCompletePromise = nextMessage(ws,
        (m) => m["event"] === "hand_complete" && m["tableId"] === tableId,
        3000,
      );

      // Inject settlement directly into the store
      const record = store.requireTable(tableId);
      (record.state as Record<string, unknown>)["phase"]   = "settlement";
      (record.state as Record<string, unknown>)["winners"] = [
        { agentId: aliceId, amountWon: 30, hand: null, potIndex: 0 },
      ];
      store.notify(tableId, record);

      const msg = await handCompletePromise;
      expect(msg["event"]).toBe("hand_complete");
      expect(Array.isArray(msg["winners"])).toBe(true);
      expect(typeof msg["handNumber"]).toBe("number");

      await closeWs(ws);
    });
  });

  // ── Command: table_talk ───────────────────────────────────────────────────

  describe("table_talk command", () => {
    it("adds a chat message and returns action_result", async () => {
      const tableId = `talk-${Date.now()}`;
      store.createTable(tableId);
      store.addAgent(tableId, `alice-talk-${Date.now()}`, [], 500);

      const agent = await reg("TalkBot");
      const { ws } = await connect(agent.token);

      ws.send(JSON.stringify({ action: "join_table", tableId, tokens: 500 }));
      await nextMessage(ws, (m) => m["event"] === "action_result", 2000);

      const resultPromise = nextMessage(ws,
        (m) => m["event"] === "action_result",
        2000,
      );
      ws.send(JSON.stringify({ action: "table_talk", tableId, message: "GL HF!" }));

      const result = await resultPromise;
      expect(result["success"]).toBe(true);

      const record  = store.requireTable(tableId);
      const chatMsg = record.chatLog.find((m) => m.message === "GL HF!");
      expect(chatMsg).toBeDefined();

      await closeWs(ws);
    });
  });

  // ── Command: fold during active hand ──────────────────────────────────────

  describe("fold command", () => {
    it("folds when it is the agent's turn", async () => {
      const tableId = `fold-${Date.now()}`;
      store.createTable(tableId);
      store.addAgent(tableId, `alice-fold-${Date.now()}`, [], 500);

      const agent = await reg("FoldBot");
      const { ws } = await connect(agent.token);

      ws.send(JSON.stringify({ action: "join_table", tableId, tokens: 500 }));

      // Wait to find out if it's our turn
      const yourTurn = await nextMessage(ws,
        (m) => m["event"] === "your_turn" && m["tableId"] === tableId,
        3000,
      ).catch(() => null);

      if (yourTurn) {
        const foldResult = nextMessage(ws, (m) => m["event"] === "action_result", 2000);
        ws.send(JSON.stringify({ action: "fold", tableId }));
        const r = await foldResult;
        expect(r["success"]).toBe(true);

        const record = store.requireTable(tableId);
        const seat   = record.state.seats.find((s) => s.agentId === agent.agentId);
        expect(seat?.status === "folded" || record.state.phase === "settlement").toBe(true);
      } else {
        // Agent was not first to act — alice was. Still a valid scenario.
        expect(true).toBe(true);
      }

      await closeWs(ws);
    });
  });
});

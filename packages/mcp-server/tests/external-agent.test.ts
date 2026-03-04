/**
 * Tests for ExternalAgentBridge
 *
 * Uses two in-process HTTP servers:
 *   - bridge:  the ExternalAgentBridge HTTP server (port 0 → random)
 *   - mock:    a minimal callback server that captures incoming payloads
 *              and returns a pre-configured action decision
 */

import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

import { GameStore } from "../src/game-store.js";
import { ExternalAgentBridge } from "../src/external-agent.js";
import type { ActionDecision } from "../src/external-agent.js";

// ---------------------------------------------------------------------------
// Mock callback server helpers
// ---------------------------------------------------------------------------

interface MockServer {
  server:      http.Server;
  port:        number;
  url:         string;
  lastPayload: Record<string, unknown> | null;
  lastToken:   string | null;
  setResponse: (r: ActionDecision) => void;
  waitForCall: () => Promise<Record<string, unknown>>;
}

function createMockCallbackServer(): Promise<MockServer> {
  return new Promise((resolve) => {
    let nextResponse: ActionDecision = { action: "fold" };
    let callResolve: ((p: Record<string, unknown>) => void) | null = null;

    const mock: MockServer = {
      server:      null as unknown as http.Server,
      port:        0,
      url:         "",
      lastPayload: null,
      lastToken:   null,
      setResponse: (r) => { nextResponse = r; },
      waitForCall: () =>
        new Promise<Record<string, unknown>>((res) => { callResolve = res; }),
    };

    mock.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data",  (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const payload = JSON.parse(body) as Record<string, unknown>;
        mock.lastPayload = payload;
        mock.lastToken   = (req.headers["authorization"] as string | undefined) ?? null;
        if (callResolve) {
          const r = callResolve;
          callResolve = null;
          r(payload);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(nextResponse));
      });
    });

    mock.server.listen(0, () => {
      mock.port = (mock.server.address() as AddressInfo).port;
      mock.url  = `http://127.0.0.1:${mock.port}`;
      resolve(mock);
    });
  });
}

function closeMockServer(mock: MockServer): Promise<void> {
  return new Promise((resolve, reject) =>
    mock.server.close((e) => (e ? reject(e) : resolve()))
  );
}

// ---------------------------------------------------------------------------
// HTTP helpers for bridge requests
// ---------------------------------------------------------------------------

async function httpRequest(
  method: string,
  url: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (body)  headers["Content-Type"]  = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ExternalAgentBridge", () => {
  let store:  GameStore;
  let bridge: ExternalAgentBridge;
  let mock:   MockServer;
  let baseUrl: string;

  beforeAll(async () => {
    store  = new GameStore();
    // Port 0 = OS assigns a free port; 200 ms timeout so auto-fold tests are fast
    bridge = new ExternalAgentBridge(store, 0, 200);
    await bridge.start();
    baseUrl = `http://127.0.0.1:${bridge.port}`;

    mock = await createMockCallbackServer();
  });

  afterAll(async () => {
    await bridge.stop();
    await closeMockServer(mock);
  });

  // ── Registration ──────────────────────────────────────────────────────────

  describe("POST /api/agents/register", () => {
    it("returns 201 with agentId and token", async () => {
      const { status, body } = await httpRequest("POST", `${baseUrl}/api/agents/register`, {
        name:        "TestBot",
        callbackUrl: mock.url,
      });
      expect(status).toBe(201);
      const r = body as { agentId: string; token: string };
      expect(r.agentId).toMatch(/^ext-/);
      expect(r.token).toBeTruthy();
    });

    it("returns 400 when name is missing", async () => {
      const { status, body } = await httpRequest("POST", `${baseUrl}/api/agents/register`, {
        callbackUrl: mock.url,
      });
      expect(status).toBe(400);
      expect((body as { error: string }).error).toMatch(/name/i);
    });

    it("returns 400 when callbackUrl is missing", async () => {
      const { status, body } = await httpRequest("POST", `${baseUrl}/api/agents/register`, {
        name: "NoUrl",
      });
      expect(status).toBe(400);
      expect((body as { error: string }).error).toMatch(/callbackUrl/i);
    });

    it("returns 400 for invalid JSON", async () => {
      const res = await fetch(`${baseUrl}/api/agents/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:   "not-json",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── List ──────────────────────────────────────────────────────────────────

  describe("GET /api/agents", () => {
    it("lists registered agents without exposing token", async () => {
      // Fresh store + bridge so we control exactly what's registered
      const s = new GameStore();
      const b = new ExternalAgentBridge(s, 0);
      await b.start();
      const url = `http://127.0.0.1:${b.port}`;

      await httpRequest("POST", `${url}/api/agents/register`, {
        name: "ListBot", callbackUrl: "http://nowhere/",
      });

      const { status, body } = await httpRequest("GET", `${url}/api/agents`);
      expect(status).toBe(200);
      const agents = body as Array<Record<string, unknown>>;
      expect(agents).toHaveLength(1);
      expect(agents[0]!["name"]).toBe("ListBot");
      expect(agents[0]!["token"]).toBeUndefined();

      await b.stop();
    });
  });

  // ── Deregister ────────────────────────────────────────────────────────────

  describe("DELETE /api/agents/:agentId", () => {
    it("removes agent with correct token", async () => {
      const { body: reg } = await httpRequest("POST", `${baseUrl}/api/agents/register`, {
        name: "DelBot", callbackUrl: mock.url,
      });
      const { agentId, token } = reg as { agentId: string; token: string };

      const { status } = await httpRequest("DELETE", `${baseUrl}/api/agents/${agentId}`, undefined, token);
      expect(status).toBe(200);
    });

    it("returns 401 with wrong token", async () => {
      const { body: reg } = await httpRequest("POST", `${baseUrl}/api/agents/register`, {
        name: "DelBot2", callbackUrl: mock.url,
      });
      const { agentId } = reg as { agentId: string };

      const { status } = await httpRequest("DELETE", `${baseUrl}/api/agents/${agentId}`, undefined, "wrong-token");
      expect(status).toBe(401);
    });

    it("returns 404 for unknown agentId", async () => {
      const { status } = await httpRequest("DELETE", `${baseUrl}/api/agents/ext-notreal`, undefined, "anything");
      expect(status).toBe(404);
    });
  });

  // ── skill.md ──────────────────────────────────────────────────────────────

  it("GET /skill.md returns markdown text", async () => {
    const res = await fetch(`${baseUrl}/skill.md`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toContain("PokerCrawl External Agent API");
    expect(text).toContain("/api/agents/register");
  });

  it("GET /unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/not-a-route`);
    expect(res.status).toBe(404);
  });

  // ── Callback dispatch ─────────────────────────────────────────────────────

  describe("callback dispatch", () => {
    /**
     * Registers an external agent directly via bridge.registerAgent(),
     * adds it to a fresh table, and returns everything needed to run tests.
     */
    function setupCallbackTest(action: ActionDecision) {
      const s = new GameStore();
      const b = new ExternalAgentBridge(s, 0, 200);
      mock.setResponse(action);

      s.createTable("t1");
      s.addAgent("t1", "alice", ["code"], 500);   // first player — won't be external

      // Register external agent (don't auto-join yet — we want the hand to already be set up)
      const { agentId, token } = b.registerAgent({
        name:        "ExternalBot",
        type:        "custom",
        capabilities: ["math"],
        callbackUrl: mock.url,
      });

      return { s, b, agentId, token };
    }

    it("dispatches callback and folds when response is fold", async () => {
      mock.setResponse({ action: "fold" });
      const s = new GameStore();
      const b = new ExternalAgentBridge(s, 0, 200);

      s.createTable("t1");
      s.addAgent("t1", "alice", [], 500);

      const { agentId } = b.registerAgent({
        name: "FoldBot", type: "custom", capabilities: [], callbackUrl: mock.url,
      });

      const payloadPromise = mock.waitForCall();

      // Adding the external agent as the second player starts the hand
      s.addAgent("t1", agentId, [], 500);

      const payload = await payloadPromise;
      expect(payload["agentId"]).toBe(agentId);
      expect(payload["phase"]).toBeTruthy();
      expect(Array.isArray(payload["validActions"])).toBe(true);

      // Wait for the action to propagate
      await vi.waitFor(() => {
        const record = s.requireTable("t1");
        const seat = record.state.seats.find((s) => s.agentId === agentId);
        // After fold: agent should be folded or hand moved on
        expect(seat?.status === "folded" || record.state.phase === "settlement").toBe(true);
      }, { timeout: 1000 });
    });

    it("dispatches callback and calls when response is call", async () => {
      mock.setResponse({ action: "call" });
      const s = new GameStore();
      const b = new ExternalAgentBridge(s, 0, 200);

      s.createTable("t1");
      s.addAgent("t1", "alice", [], 500);

      const { agentId } = b.registerAgent({
        name: "CallBot", type: "custom", capabilities: [], callbackUrl: mock.url,
      });

      const payloadPromise = mock.waitForCall();
      s.addAgent("t1", agentId, [], 500);

      await payloadPromise;

      // Wait: seat status should advance (called = contributed to pot)
      await vi.waitFor(() => {
        const record = s.requireTable("t1");
        const seat = record.state.seats.find((seat) => seat.agentId === agentId);
        expect(seat?.status === "active" || seat?.status === "all-in").toBe(true);
        expect(record.state.mainPot).toBeGreaterThan(0);
      }, { timeout: 1000 });
    });

    it("sends Authorization header with agent token", async () => {
      mock.setResponse({ action: "fold" });
      const s = new GameStore();
      const b = new ExternalAgentBridge(s, 0, 200);

      s.createTable("t1");
      s.addAgent("t1", "alice", [], 500);

      const { agentId, token } = b.registerAgent({
        name: "TokenBot", type: "custom", capabilities: [], callbackUrl: mock.url,
      });

      const payloadPromise = mock.waitForCall();
      s.addAgent("t1", agentId, [], 500);

      await payloadPromise;
      expect(mock.lastToken).toBe(`Bearer ${token}`);
    });

    it("payload includes hole cards, board, pot, and seats", async () => {
      mock.setResponse({ action: "fold" });
      const s = new GameStore();
      const b = new ExternalAgentBridge(s, 0, 200);

      s.createTable("t1");
      s.addAgent("t1", "alice", [], 500);

      const { agentId } = b.registerAgent({
        name: "InfoBot", type: "custom", capabilities: [], callbackUrl: mock.url,
      });

      const payloadPromise = mock.waitForCall();
      s.addAgent("t1", agentId, [], 500);

      const payload = await payloadPromise;

      expect(payload["tableId"]).toBe("t1");
      expect(payload["handNumber"]).toBeGreaterThanOrEqual(1);
      expect(Array.isArray((payload["myHoleCards"] as unknown[]))).toBe(true);
      expect((payload["myHoleCards"] as unknown[]).length).toBe(2);
      expect(typeof payload["myStack"]).toBe("number");
      expect(typeof payload["mainPot"]).toBe("number");
      expect(Array.isArray(payload["seats"])).toBe(true);
      expect(Array.isArray(payload["validActions"])).toBe(true);
    });

    it("adds table-talk message when response includes message", async () => {
      mock.setResponse({ action: "fold", message: "Nice hand!" });
      const s = new GameStore();
      const b = new ExternalAgentBridge(s, 0, 200);

      s.createTable("t1");
      s.addAgent("t1", "alice", [], 500);

      const { agentId } = b.registerAgent({
        name: "TalkBot", type: "custom", capabilities: [], callbackUrl: mock.url,
      });

      const payloadPromise = mock.waitForCall();
      s.addAgent("t1", agentId, [], 500);

      await payloadPromise;

      await vi.waitFor(() => {
        const record = s.requireTable("t1");
        const chatMsg = record.chatLog.find(
          (m) => m.agentId === agentId && m.message === "Nice hand!"
        );
        expect(chatMsg).toBeDefined();
      }, { timeout: 1000 });
    });
  });

  // ── Auto-fold on timeout ──────────────────────────────────────────────────

  describe("auto-fold on timeout", () => {
    it("folds after callbackTimeoutMs with no response", async () => {
      // Slow callback server that never replies in time
      const slow = await new Promise<MockServer>((resolve) => {
        const m: MockServer = {
          server: null as unknown as http.Server,
          port: 0, url: "", lastPayload: null, lastToken: null,
          setResponse: () => {},
          waitForCall: () => Promise.resolve({}),
        };
        m.server = http.createServer((_req, _res) => {
          // Intentionally never respond to trigger timeout
        });
        m.server.listen(0, () => {
          m.port = (m.server.address() as AddressInfo).port;
          m.url  = `http://127.0.0.1:${m.port}`;
          resolve(m);
        });
      });

      const s = new GameStore();
      const b = new ExternalAgentBridge(s, 0, 50); // 50 ms timeout

      s.createTable("t1");
      s.addAgent("t1", "alice", [], 500);

      const { agentId } = b.registerAgent({
        name: "SlowBot", type: "custom", capabilities: [], callbackUrl: slow.url,
      });

      s.addAgent("t1", agentId, [], 500);

      // After the 50 ms timeout, the agent should be auto-folded
      await vi.waitFor(() => {
        const record = s.requireTable("t1");
        const seat   = record.state.seats.find((seat) => seat.agentId === agentId);
        expect(seat?.status === "folded" || record.state.phase === "settlement").toBe(true);
      }, { timeout: 2000 });

      await closeMockServer(slow);
    });

    it("folds when callback server returns non-200", async () => {
      const errServer = await new Promise<MockServer>((resolve) => {
        const m: MockServer = {
          server: null as unknown as http.Server,
          port: 0, url: "", lastPayload: null, lastToken: null,
          setResponse: () => {},
          waitForCall: () => Promise.resolve({}),
        };
        m.server = http.createServer((_req, res) => {
          res.writeHead(500);
          res.end();
        });
        m.server.listen(0, () => {
          m.port = (m.server.address() as AddressInfo).port;
          m.url  = `http://127.0.0.1:${m.port}`;
          resolve(m);
        });
      });

      const s = new GameStore();
      const b = new ExternalAgentBridge(s, 0, 200);

      s.createTable("t1");
      s.addAgent("t1", "alice", [], 500);

      const { agentId } = b.registerAgent({
        name: "ErrBot", type: "custom", capabilities: [], callbackUrl: errServer.url,
      });

      s.addAgent("t1", agentId, [], 500);

      await vi.waitFor(() => {
        const record = s.requireTable("t1");
        const seat   = record.state.seats.find((seat) => seat.agentId === agentId);
        expect(seat?.status === "folded" || record.state.phase === "settlement").toBe(true);
      }, { timeout: 1000 });

      await closeMockServer(errServer);
    });
  });

  // ── registerAgent with tableId ─────────────────────────────────────────────

  it("registerAgent with tableId auto-joins the table", () => {
    const s = new GameStore();
    const b = new ExternalAgentBridge(s, 0);

    s.createTable("lobby");
    s.addAgent("lobby", "alice", [], 500); // need at least minPlayers - but only 1 here

    const { agentId } = b.registerAgent({
      name: "AutoJoin", type: "custom", capabilities: [], callbackUrl: "http://nowhere",
      tableId: "lobby", tokens: 750,
    });

    const record = s.requireTable("lobby");
    const seat   = record.state.seats.find((s) => s.agentId === agentId);
    expect(seat).toBeDefined();
    expect(seat?.stack).toBeGreaterThan(0); // hand started, blinds may have moved tokens
  });
});

/**
 * Auth — API key management + JWT + rate limiting tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APIKeyManager } from "../src/auth/api-keys.js";
import {
  generateToken,
  verifyToken,
  checkRateLimit,
  resetRateLimit,
} from "../src/auth/agent-auth.js";

// ---------------------------------------------------------------------------
// APIKeyManager
// ---------------------------------------------------------------------------

describe("APIKeyManager — register / get", () => {
  let mgr: APIKeyManager;
  beforeEach(() => { mgr = new APIKeyManager({ inMemory: true }); });

  it("registers and decrypts a key round-trip", async () => {
    await mgr.registerKey("alice", "anthropic", "sk-ant-secret-123");
    expect(await mgr.getKey("alice", "anthropic")).toBe("sk-ant-secret-123");
  });

  it("returns null for an unregistered agent", async () => {
    expect(await mgr.getKey("ghost", "openai")).toBeNull();
  });

  it("returns null for an unregistered provider", async () => {
    await mgr.registerKey("alice", "anthropic", "key-a");
    expect(await mgr.getKey("alice", "openai")).toBeNull();
  });

  it("overwrites an existing key on re-register", async () => {
    await mgr.registerKey("alice", "openai", "old-key");
    await mgr.registerKey("alice", "openai", "new-key");
    expect(await mgr.getKey("alice", "openai")).toBe("new-key");
  });

  it("stores different providers independently", async () => {
    await mgr.registerKey("bob", "anthropic", "key-ant");
    await mgr.registerKey("bob", "openai",    "key-oai");
    expect(await mgr.getKey("bob", "anthropic")).toBe("key-ant");
    expect(await mgr.getKey("bob", "openai")).toBe("key-oai");
  });
});

describe("APIKeyManager — remove", () => {
  let mgr: APIKeyManager;
  beforeEach(() => { mgr = new APIKeyManager({ inMemory: true }); });

  it("returns null after a key is removed", async () => {
    await mgr.registerKey("carol", "openai", "sk-xyz");
    await mgr.removeKey("carol", "openai");
    expect(await mgr.getKey("carol", "openai")).toBeNull();
  });

  it("does not throw when removing a non-existent key", async () => {
    await expect(mgr.removeKey("nobody", "openai")).resolves.toBeUndefined();
  });
});

describe("APIKeyManager — listProviders", () => {
  let mgr: APIKeyManager;
  beforeEach(() => { mgr = new APIKeyManager({ inMemory: true }); });

  it("lists all registered providers for an agent", async () => {
    await mgr.registerKey("dave", "anthropic", "k1");
    await mgr.registerKey("dave", "openai",    "k2");
    await mgr.registerKey("dave", "google",    "k3");
    const providers = await mgr.listProviders("dave");
    expect(providers.sort()).toEqual(["anthropic", "google", "openai"]);
  });

  it("returns empty array for unknown agent", async () => {
    expect(await mgr.listProviders("unknown")).toHaveLength(0);
  });

  it("removes provider from list after removeKey", async () => {
    await mgr.registerKey("eve", "openai",    "k1");
    await mgr.registerKey("eve", "anthropic", "k2");
    await mgr.removeKey("eve", "openai");
    const providers = await mgr.listProviders("eve");
    expect(providers).toEqual(["anthropic"]);
  });
});

describe("APIKeyManager — validateKey (mocked fetch)", () => {
  let mgr: APIKeyManager;
  beforeEach(() => { mgr = new APIKeyManager({ inMemory: true }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns true when the Anthropic API responds 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    expect(await mgr.validateKey("anthropic", "sk-ant-valid")).toBe(true);
  });

  it("returns false when the OpenAI API returns an auth error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await mgr.validateKey("openai", "sk-invalid")).toBe(false);
  });

  it("returns false when fetch throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));
    expect(await mgr.validateKey("anthropic", "sk-any")).toBe(false);
  });

  it("returns true for unknown providers (no spec to validate against)", async () => {
    // fetch should NOT be called for unknown providers
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await mgr.validateKey("custom-llm", "key-xyz")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

describe("generateToken / verifyToken", () => {
  it("generates a well-formed three-segment JWT", () => {
    const token = generateToken("agent-1");
    expect(token.split(".")).toHaveLength(3);
  });

  it("verifies a fresh token and returns the correct agentId", () => {
    const token   = generateToken("agent-2");
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.agentId).toBe("agent-2");
  });

  it("rejects a token with a tampered signature", () => {
    const token  = generateToken("agent-3");
    const [h, p] = token.split(".");
    expect(verifyToken(`${h}.${p}.badsignature`)).toBeNull();
  });

  it("rejects an already-expired token", () => {
    const token = generateToken("agent-4", -1); // expired 1 second ago
    expect(verifyToken(token)).toBeNull();
  });

  it("rejects a malformed token (wrong segment count)", () => {
    expect(verifyToken("not.a.valid.jwt.here")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("checkRateLimit", () => {
  const AGENT = "rate-test-agent";
  beforeEach(() => { resetRateLimit(AGENT); });

  it("allows the first request", () => {
    expect(checkRateLimit(AGENT, 5)).toBe(true);
  });

  it("allows up to the max limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(AGENT, 5)).toBe(true);
    }
  });

  it("blocks the request immediately after the limit is reached", () => {
    for (let i = 0; i < 5; i++) checkRateLimit(AGENT, 5);
    expect(checkRateLimit(AGENT, 5)).toBe(false);
  });

  it("resets after the window via resetRateLimit", () => {
    for (let i = 0; i < 5; i++) checkRateLimit(AGENT, 5);
    expect(checkRateLimit(AGENT, 5)).toBe(false);
    resetRateLimit(AGENT);
    expect(checkRateLimit(AGENT, 5)).toBe(true);
  });
});

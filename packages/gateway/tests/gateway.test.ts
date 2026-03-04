/**
 * Gateway integration tests — poker settlement, rake, inference mock, convert
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TokenLedgerService }     from "../src/token-ledger.js";
import { onHandComplete }         from "../src/poker-integration.js";
import { runInference }           from "../src/inference.js";
import { convertTokens }          from "../src/billing/pricing.js";
import { APIKeyManager }          from "../src/auth/api-keys.js";
import type { LLMProvider }       from "../src/providers/base-provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLedger() { return new TokenLedgerService({ inMemory: true }); }
function makeKeys()   { return new APIKeyManager({ inMemory: true }); }

/** Seed two agents with a starting balance and place their bets. */
async function seedHand(
  ledger: TokenLedgerService,
  agentA: string,
  agentB: string,
  bet: number,
  handId: string,
) {
  await ledger.deposit(agentA, "openai", "gpt-4o", bet * 10);
  await ledger.deposit(agentB, "openai", "gpt-4o", bet * 10);
  await ledger.placeBet(agentA, handId, bet);
  await ledger.placeBet(agentB, handId, bet);
}

// ---------------------------------------------------------------------------
// Poker settlement — basics
// ---------------------------------------------------------------------------

describe("onHandComplete — settlement", () => {
  it("credits the net winning amount to the winner", async () => {
    const ledger = makeLedger();
    await seedHand(ledger, "alice", "bob", 100, "hand-1");

    // Alice wins the 200-token pot
    const result = await onHandComplete(
      { handId: "hand-1", winners: [{ agentId: "alice", amountWon: 200 }], losers: [{ agentId: "bob", amountLost: 100 }] },
      ledger,
    );

    const aliceBal = (await ledger.getBalance("alice")).gameTokens;
    const expected = 100 * 10 - 100 + 200 - result.rake; // deposit - bet + net win
    expect(aliceBal).toBe(expected);
  });

  it("does not credit anything extra to the loser", async () => {
    const ledger = makeLedger();
    await seedHand(ledger, "alice", "bob", 100, "hand-2");

    await onHandComplete(
      { handId: "hand-2", winners: [{ agentId: "alice", amountWon: 200 }], losers: [{ agentId: "bob", amountLost: 100 }] },
      ledger,
    );

    // Bob's bet was already deducted; no further change expected.
    const bobBal = (await ledger.getBalance("bob")).gameTokens;
    expect(bobBal).toBe(100 * 10 - 100); // deposit − bet
  });
});

// ---------------------------------------------------------------------------
// Poker settlement — rake
// ---------------------------------------------------------------------------

describe("onHandComplete — rake", () => {
  it("rake is exactly 2.5 % of the gross pot (floored)", async () => {
    const ledger = makeLedger();
    await seedHand(ledger, "alice", "bob", 100, "hand-r1");

    const result = await onHandComplete(
      { handId: "hand-r1", winners: [{ agentId: "alice", amountWon: 200 }], losers: [{ agentId: "bob", amountLost: 100 }] },
      ledger,
    );

    expect(result.rake).toBe(Math.floor(200 * 0.025)); // = 5
    expect(result.rakePercent).toBe(2.5);
  });

  it("chip conservation: total post-hand balance = pre-hand total − rake", async () => {
    const ledger = makeLedger();
    const bet    = 200;
    // seedHand deposits bet × 10 per agent → total pre-hand = 2 × (bet × 10)
    const preBetTotal = 2 * bet * 10;
    await seedHand(ledger, "alice", "bob", bet, "hand-r2");

    const result = await onHandComplete(
      { handId: "hand-r2", winners: [{ agentId: "alice", amountWon: 400 }], losers: [{ agentId: "bob", amountLost: 200 }] },
      ledger,
    );

    const total = (await ledger.getBalance("alice")).gameTokens
                + (await ledger.getBalance("bob")).gameTokens;

    expect(total).toBe(preBetTotal - result.rake);
  });

  it("rake rounds down (no fractional tokens)", async () => {
    const ledger = makeLedger();
    await seedHand(ledger, "alice", "bob", 21, "hand-r3"); // odd amount → fractional 2.5%

    const result = await onHandComplete(
      { handId: "hand-r3", winners: [{ agentId: "alice", amountWon: 42 }], losers: [{ agentId: "bob", amountLost: 21 }] },
      ledger,
    );

    expect(Number.isInteger(result.rake)).toBe(true);
    expect(result.rake).toBe(Math.floor(42 * 0.025)); // = 1
  });
});

// ---------------------------------------------------------------------------
// Poker settlement — inference token mapping
// ---------------------------------------------------------------------------

describe("onHandComplete — inference token mapping", () => {
  it("winner settlement expresses netPokerTokens × 1000 as inferenceTokens", async () => {
    const ledger = makeLedger();
    await seedHand(ledger, "alice", "bob", 100, "hand-i1");

    const result = await onHandComplete(
      { handId: "hand-i1", winners: [{ agentId: "alice", amountWon: 200 }], losers: [{ agentId: "bob", amountLost: 100 }] },
      ledger,
    );

    const winnerEntry = result.settlements.find((s) => s.agentId === "alice");
    expect(winnerEntry).toBeDefined();
    expect(winnerEntry?.inferenceTokens).toBe(winnerEntry!.netPokerTokens * 1_000);
  });

  it("loser settlement shows negative netPokerTokens", async () => {
    const ledger = makeLedger();
    await seedHand(ledger, "alice", "bob", 50, "hand-i2");

    const result = await onHandComplete(
      { handId: "hand-i2", winners: [{ agentId: "alice", amountWon: 100 }], losers: [{ agentId: "bob", amountLost: 50 }] },
      ledger,
    );

    const loserEntry = result.settlements.find((s) => s.agentId === "bob");
    expect(loserEntry?.netPokerTokens).toBeLessThan(0);
    expect(loserEntry?.inferenceTokens).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Inference — mock provider
// ---------------------------------------------------------------------------

describe("runInference (mock provider)", () => {
  function makeMockProvider(content = "hello", inputTokens = 20, outputTokens = 8): LLMProvider {
    return {
      name: "mock",
      chat: vi.fn().mockResolvedValue({ content, inputTokens, outputTokens, model: "mock-model" }),
    };
  }

  it("calls the provider and returns its response content", async () => {
    const ledger  = makeLedger();
    const keys    = makeKeys();
    await ledger.deposit("eve", "mock", "mock-model", 100_000_000);
    await keys.registerKey("eve", "mock", "sk-mock-key");

    const provider = makeMockProvider("Buenos días");
    const result   = await runInference(ledger, keys, provider, {
      agentId: "eve", provider: "mock", model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }], maxTokens: 10,
    });

    expect(result.response).toBe("Buenos días");
  });

  it("records token usage in the ledger after inference", async () => {
    const ledger  = makeLedger();
    const keys    = makeKeys();
    await ledger.deposit("frank", "mock", "mock-model", 100_000_000);
    await keys.registerKey("frank", "mock", "sk-frank");

    const provider = makeMockProvider("ok", 30, 15);
    await runInference(ledger, keys, provider, {
      agentId: "frank", provider: "mock", model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }], maxTokens: 20,
    });

    const bal = await ledger.getBalance("frank");
    const mb  = bal.balances["mock/gpt-4o-mini"];
    expect(mb?.inputTokens).toBe(30);
    expect(mb?.outputTokens).toBe(15);
  });

  it("throws when no API key is registered for the agent", async () => {
    const ledger = makeLedger();
    const keys   = makeKeys();
    await ledger.deposit("grace", "mock", "m", 1_000_000);
    // Deliberately skip keys.registerKey

    await expect(
      runInference(ledger, keys, makeMockProvider(), {
        agentId: "grace", provider: "mock", model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }], maxTokens: 10,
      }),
    ).rejects.toThrow(/No API key/);
  });

  it("deducts game tokens proportional to inference cost", async () => {
    const ledger  = makeLedger();
    const keys    = makeKeys();
    // Deposit 50M game tokens
    await ledger.deposit("harry", "mock", "gpt-4o-mini", 50_000_000);
    await keys.registerKey("harry", "mock", "sk-harry");

    // 1M input @ $0.15 + 0.5M output @ $0.60 = $0.15 + $0.30 = $0.45
    // => 450_000 game tokens deducted
    const provider = makeMockProvider("ans", 1_000_000, 500_000);
    const result   = await runInference(ledger, keys, provider, {
      agentId: "harry", provider: "mock", model: "gpt-4o-mini",
      messages: [{ role: "user", content: "x" }], maxTokens: 500_000,
    });

    expect(result.remainingBalance).toBe(50_000_000 - 450_000);
    expect(result.costUSD).toBeCloseTo(0.45, 5);
  });
});

// ---------------------------------------------------------------------------
// convertTokens
// ---------------------------------------------------------------------------

describe("convertTokens (cross-model arbitrage)", () => {
  it("Opus → Sonnet: 1 token becomes 5 (75/15 ratio)", () => {
    expect(convertTokens("claude-opus-4-20250514", 1_000, "claude-sonnet-4-20250514")).toBe(5_000);
  });

  it("GPT-4o → gemini-flash: 1 token becomes 25 (10/0.40 ratio)", () => {
    expect(convertTokens("gpt-4o", 1_000, "gemini-2.0-flash")).toBe(25_000);
  });

  it("same model round-trips with no change", () => {
    expect(convertTokens("gpt-4o-mini", 500, "gpt-4o-mini")).toBe(500);
  });
});

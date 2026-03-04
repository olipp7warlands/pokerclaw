/**
 * Token Ledger — test suite
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TokenLedgerService } from "../src/token-ledger.js";
import { convertTokens, PRICES } from "../src/billing/pricing.js";
import { countTokens, calculateCost } from "../src/billing/token-counter.js";
import type { ModelId } from "../src/billing/pricing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a fresh in-memory ledger for each test (no disk I/O). */
function makeLedger() {
  return new TokenLedgerService({ inMemory: true });
}

// ---------------------------------------------------------------------------
// TokenLedgerService — deposit
// ---------------------------------------------------------------------------

describe("deposit", () => {
  it("increases the agent's game token balance", async () => {
    const ledger = makeLedger();
    await ledger.deposit("alice", "anthropic", "claude-sonnet-4-20250514", 1_000);
    const bal = await ledger.getBalance("alice");
    expect(bal.gameTokens).toBe(1_000);
  });

  it("accumulates multiple deposits", async () => {
    const ledger = makeLedger();
    await ledger.deposit("alice", "anthropic", "claude-sonnet-4-20250514", 500);
    await ledger.deposit("alice", "openai",    "gpt-4o",                   300);
    const bal = await ledger.getBalance("alice");
    expect(bal.gameTokens).toBe(800);
  });

  it("records a deposit transaction", async () => {
    const ledger = makeLedger();
    await ledger.deposit("bob", "openai", "gpt-4o-mini", 200);
    const txs = await ledger.getTransactions("bob");
    expect(txs).toHaveLength(1);
    expect(txs[0]?.type).toBe("deposit");
    expect(txs[0]?.tokens).toBe(200);
    expect(txs[0]?.from).toBe("house");
    expect(txs[0]?.to).toBe("bob");
  });

  it("tracks per-model deposited token counts", async () => {
    const ledger = makeLedger();
    await ledger.deposit("carol", "anthropic", "claude-haiku-4-5-20251001", 750);
    const bal = await ledger.getBalance("carol");
    expect(bal.balances["anthropic/claude-haiku-4-5-20251001"]?.deposited).toBe(750);
  });
});

// ---------------------------------------------------------------------------
// TokenLedgerService — placeBet
// ---------------------------------------------------------------------------

describe("placeBet", () => {
  it("deducts tokens from the game balance", async () => {
    const ledger = makeLedger();
    await ledger.deposit("alice", "openai", "gpt-4o", 1_000);
    await ledger.placeBet("alice", "hand-1", 300);
    const bal = await ledger.getBalance("alice");
    expect(bal.gameTokens).toBe(700);
  });

  it("records a bet transaction with handId", async () => {
    const ledger = makeLedger();
    await ledger.deposit("alice", "openai", "gpt-4o", 1_000);
    await ledger.placeBet("alice", "hand-42", 100);
    const txs = await ledger.getTransactions("alice");
    const bet = txs.find((t) => t.type === "bet");
    expect(bet).toBeDefined();
    expect(bet?.handId).toBe("hand-42");
    expect(bet?.tokens).toBe(100);
  });

  it("throws when the agent has insufficient tokens", async () => {
    const ledger = makeLedger();
    await ledger.deposit("alice", "openai", "gpt-4o", 50);
    await expect(ledger.placeBet("alice", "hand-1", 100)).rejects.toThrow(
      /Insufficient tokens/,
    );
  });
});

// ---------------------------------------------------------------------------
// TokenLedgerService — settlePot
// ---------------------------------------------------------------------------

describe("settlePot", () => {
  it("credits the winner's game balance", async () => {
    const ledger = makeLedger();
    await ledger.deposit("alice", "openai", "gpt-4o", 1_000);
    await ledger.deposit("bob",   "openai", "gpt-4o", 1_000);
    await ledger.placeBet("alice", "hand-1", 200);
    await ledger.placeBet("bob",   "hand-1", 200);

    await ledger.settlePot({
      handId:  "hand-1",
      winners: [{ agentId: "alice", amountWon: 400 }],
      losers:  [{ agentId: "bob",   amountLost: 200 }],
    });

    const aliceBal = await ledger.getBalance("alice");
    const bobBal   = await ledger.getBalance("bob");
    expect(aliceBal.gameTokens).toBe(1_200); // 800 + 400
    expect(bobBal.gameTokens).toBe(800);      // 1000 - 200
  });

  it("records win and loss transactions", async () => {
    const ledger = makeLedger();
    await ledger.deposit("alice", "openai", "gpt-4o", 500);
    await ledger.deposit("bob",   "openai", "gpt-4o", 500);
    await ledger.placeBet("alice", "hand-2", 100);
    await ledger.placeBet("bob",   "hand-2", 100);

    await ledger.settlePot({
      handId:  "hand-2",
      winners: [{ agentId: "alice", amountWon: 200 }],
      losers:  [{ agentId: "bob",   amountLost: 100 }],
    });

    const aliceTxs = await ledger.getTransactions("alice");
    const bobTxs   = await ledger.getTransactions("bob");

    expect(aliceTxs.some((t) => t.type === "win" && t.handId === "hand-2")).toBe(true);
    expect(bobTxs.some((t)   => t.type === "loss" && t.handId === "hand-2")).toBe(true);
  });

  it("chip conservation: total tokens unchanged after settlement", async () => {
    const ledger = makeLedger();
    await ledger.deposit("alice", "openai", "gpt-4o", 1_000);
    await ledger.deposit("bob",   "openai", "gpt-4o", 1_000);
    await ledger.placeBet("alice", "hand-3", 300);
    await ledger.placeBet("bob",   "hand-3", 300);

    await ledger.settlePot({
      handId:  "hand-3",
      winners: [{ agentId: "bob", amountWon: 600 }],
      losers:  [{ agentId: "alice", amountLost: 300 }],
    });

    const a = (await ledger.getBalance("alice")).gameTokens;
    const b = (await ledger.getBalance("bob")).gameTokens;
    expect(a + b).toBe(2_000);
  });
});

// ---------------------------------------------------------------------------
// TokenLedgerService — spend
// ---------------------------------------------------------------------------

describe("spend", () => {
  it("deducts game tokens proportional to the USD cost", async () => {
    const ledger = makeLedger();
    await ledger.deposit("carol", "anthropic", "claude-haiku-4-5-20251001", 10_000_000);

    // 1M input + 1M output on claude-haiku = $0.80 + $4.00 = $4.80
    // => 4_800_000 game tokens deducted
    await ledger.spend("carol", "anthropic", "claude-haiku-4-5-20251001", 1_000_000, 1_000_000);
    const bal = await ledger.getBalance("carol");
    expect(bal.gameTokens).toBe(10_000_000 - 4_800_000);
  });

  it("updates per-model inputTokens and outputTokens", async () => {
    const ledger = makeLedger();
    await ledger.deposit("carol", "openai", "gpt-4o-mini", 5_000_000);
    await ledger.spend("carol", "openai", "gpt-4o-mini", 2_000, 500);

    const bal = await ledger.getBalance("carol");
    const modelBal = bal.balances["openai/gpt-4o-mini"];
    expect(modelBal?.inputTokens).toBe(2_000);
    expect(modelBal?.outputTokens).toBe(500);
  });

  it("accumulates totalValueUSD across multiple spend calls", async () => {
    const ledger = makeLedger();
    await ledger.deposit("dave", "openai", "gpt-4o", 100_000_000);
    await ledger.spend("dave", "openai", "gpt-4o", 1_000_000, 0);
    await ledger.spend("dave", "openai", "gpt-4o", 1_000_000, 0);

    const bal = await ledger.getBalance("dave");
    // 2 × 1M input @ $2.50/1M = $5.00 total
    expect(bal.balances["openai/gpt-4o"]?.totalValueUSD).toBeCloseTo(5.0, 5);
  });

  it("records a spend transaction", async () => {
    const ledger = makeLedger();
    await ledger.deposit("eve", "google", "gemini-2.0-flash", 1_000_000);
    await ledger.spend("eve", "google", "gemini-2.0-flash", 100, 50);

    const txs = await ledger.getTransactions("eve");
    expect(txs.some((t) => t.type === "spend")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TokenLedgerService — getTransactions with limit
// ---------------------------------------------------------------------------

describe("getTransactions limit", () => {
  it("returns only the most recent N transactions when limit is specified", async () => {
    const ledger = makeLedger();
    await ledger.deposit("frank", "openai", "gpt-4o-mini", 1_000);
    await ledger.placeBet("frank", "hand-a", 100);
    await ledger.placeBet("frank", "hand-b", 100);
    await ledger.placeBet("frank", "hand-c", 100);

    const txs = await ledger.getTransactions("frank", 2);
    expect(txs).toHaveLength(2);
    // Should be the last 2 bets
    expect(txs[0]?.type).toBe("bet");
    expect(txs[1]?.type).toBe("bet");
  });

  it("returns empty array for unknown agentId", async () => {
    const ledger = makeLedger();
    const txs = await ledger.getTransactions("nobody");
    expect(txs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// convertTokens
// ---------------------------------------------------------------------------

describe("convertTokens", () => {
  it("converting between the same model returns the same amount", () => {
    const result = convertTokens("gpt-4o", 1_000, "gpt-4o");
    expect(result).toBe(1_000);
  });

  it("1 Opus token ≈ 5 Sonnet tokens (USD-equivalent output value)", () => {
    // Opus output: $75/1M, Sonnet output: $15/1M → ratio 5×
    const result = convertTokens("claude-opus-4-20250514", 1_000, "claude-sonnet-4-20250514");
    expect(result).toBe(5_000);
  });

  it("cheap model tokens convert to fewer expensive model tokens", () => {
    // gemini-2.0-flash output $0.40/1M, gpt-4o output $10.00/1M → ratio 25×
    const result = convertTokens("gpt-4o", 1_000, "gemini-2.0-flash");
    expect(result).toBe(25_000);
  });

  it("result is always a rounded integer", () => {
    const result = convertTokens("claude-haiku-4-5-20251001", 1, "claude-opus-4-20250514");
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calculateCost & countTokens
// ---------------------------------------------------------------------------

describe("calculateCost", () => {
  it("calculates correct cost for gpt-4o-mini", () => {
    // 1M input @ $0.15 + 1M output @ $0.60 = $0.75
    const cost = calculateCost("gpt-4o-mini", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.75, 10);
  });

  it("returns 0 for unknown models", () => {
    expect(calculateCost("unknown-model-xyz", 1_000, 1_000)).toBe(0);
  });

  it("matches PRICES table values for all known models", () => {
    const models: ModelId[] = [
      "claude-sonnet-4-20250514",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-20250514",
      "gpt-4o",
      "gpt-4o-mini",
      "gemini-2.0-flash",
      "gemini-2.5-pro",
    ];
    for (const model of models) {
      const price = PRICES[model];
      const cost  = calculateCost(model, 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(price.inputPer1M + price.outputPer1M, 10);
    }
  });
});

describe("countTokens", () => {
  it("estimates ~1 token per 4 characters", () => {
    // 40 chars → ceil(40/4) = 10 tokens
    expect(countTokens("a".repeat(40))).toBe(10);
  });

  it("rounds up for partial chunks", () => {
    // 5 chars → ceil(5/4) = 2 tokens
    expect(countTokens("hello")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });
});

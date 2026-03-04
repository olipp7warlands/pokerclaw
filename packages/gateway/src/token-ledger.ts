/**
 * Token Ledger Service
 *
 * Tracks per-agent token balances across providers/models and records
 * every financial event (deposit, bet, win, loss, spend, refund) as
 * an immutable transaction log.
 *
 * Persistence: JSON file at `data/ledger.json` (configurable via constructor).
 * Pass `{ inMemory: true }` to disable disk persistence (useful for tests).
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { calculateCost } from "./billing/token-counter.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TransactionType =
  | "deposit"
  | "bet"
  | "win"
  | "loss"
  | "spend"
  | "refund";

export interface Transaction {
  id:          string;
  timestamp:   number;
  type:        TransactionType;
  from:        string;  // agentId or "house"
  to:          string;  // agentId or "house"
  tokens:      number;
  handId?:     string;
  description: string;
}

/** Per-provider/model token usage and cost tracking. */
export interface ModelBalance {
  /** Game tokens deposited from this provider/model (funding record). */
  deposited:     number;
  /** API input (prompt) tokens consumed via `spend()`. */
  inputTokens:   number;
  /** API output (completion) tokens consumed via `spend()`. */
  outputTokens:  number;
  /** Total USD value of API calls via `spend()`. */
  totalValueUSD: number;
}

export interface AgentAccount {
  agentId:      string;
  /** Current poker chip balance (in "game tokens"). */
  gameTokens:   number;
  /** Per "provider/model" API usage breakdown. */
  balances:     Record<string, ModelBalance>;
  /** Full transaction history for this agent. */
  transactions: Transaction[];
}

export interface Balance {
  agentId:    string;
  gameTokens: number;
  balances:   Record<string, ModelBalance>;
}

/** Minimal winner info needed to settle a hand's pot. */
export interface WinnerSettlement {
  agentId:   string;
  amountWon: number;
}

/** Minimal loser info for bookkeeping. */
export interface LoserSettlement {
  agentId:    string;
  amountLost: number;
}

export interface HandSettlement {
  handId:  string;
  winners: ReadonlyArray<WinnerSettlement>;
  losers:  ReadonlyArray<LoserSettlement>;
}

// ---------------------------------------------------------------------------
// Serialized ledger format
// ---------------------------------------------------------------------------

interface LedgerData {
  accounts: Record<string, AgentAccount>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeModelBalance(): ModelBalance {
  return { deposited: 0, inputTokens: 0, outputTokens: 0, totalValueUSD: 0 };
}

function ensureModelBalance(
  balances: Record<string, ModelBalance>,
  key: string,
): ModelBalance {
  const existing = balances[key];
  if (existing) return existing;
  const fresh = makeModelBalance();
  balances[key] = fresh;
  return fresh;
}

function makeAccount(agentId: string): AgentAccount {
  return { agentId, gameTokens: 0, balances: {}, transactions: [] };
}

// ---------------------------------------------------------------------------
// TokenLedgerService
// ---------------------------------------------------------------------------

export interface TokenLedgerOptions {
  /** Custom path for the JSON persistence file. Default: `<cwd>/data/ledger.json` */
  dataPath?: string;
  /** Skip disk I/O entirely — useful for tests. */
  inMemory?: boolean;
}

export class TokenLedgerService {
  private readonly accounts = new Map<string, AgentAccount>();
  private readonly dataPath: string;
  private readonly inMemory: boolean;
  private loaded = false;

  constructor(options: TokenLedgerOptions = {}) {
    this.dataPath = options.dataPath ?? path.join(process.cwd(), "data", "ledger.json");
    this.inMemory = options.inMemory ?? false;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    if (this.loaded || this.inMemory) {
      this.loaded = true;
      return;
    }
    this.loaded = true;

    try {
      const raw  = await fs.readFile(this.dataPath, "utf-8");
      const data = JSON.parse(raw) as LedgerData;
      for (const [id, account] of Object.entries(data.accounts)) {
        this.accounts.set(id, account);
      }
    } catch {
      // File does not exist yet — start with an empty ledger.
    }
  }

  private async save(): Promise<void> {
    if (this.inMemory) return;

    const data: LedgerData = { accounts: {} };
    for (const [id, account] of this.accounts) {
      data.accounts[id] = account;
    }

    await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
    await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2), "utf-8");
  }

  // ── Internal account access ────────────────────────────────────────────────

  private getOrCreate(agentId: string): AgentAccount {
    const existing = this.accounts.get(agentId);
    if (existing) return existing;

    const account = makeAccount(agentId);
    this.accounts.set(agentId, account);
    return account;
  }

  private pushTx(account: AgentAccount, tx: Transaction): void {
    account.transactions.push(tx);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Credit an agent with `amount` game tokens (sourced from a specific
   * provider/model for billing-history purposes).
   */
  async deposit(
    agentId:  string,
    provider: string,
    model:    string,
    amount:   number,
  ): Promise<void> {
    await this.load();

    const account = this.getOrCreate(agentId);
    account.gameTokens += amount;

    const key = `${provider}/${model}`;
    const bal = ensureModelBalance(account.balances, key);
    bal.deposited += amount;

    this.pushTx(account, {
      id:          randomUUID(),
      timestamp:   Date.now(),
      type:        "deposit",
      from:        "house",
      to:          agentId,
      tokens:      amount,
      description: `Deposit ${amount} ${model} tokens`,
    });

    await this.save();
  }

  /**
   * Deduct `tokens` from an agent's game balance to place a bet on a hand.
   * Throws if the agent does not have enough tokens.
   */
  async placeBet(agentId: string, handId: string, tokens: number): Promise<void> {
    await this.load();

    const account = this.getOrCreate(agentId);
    if (account.gameTokens < tokens) {
      throw new Error(
        `Insufficient tokens: ${agentId} has ${account.gameTokens}, needs ${tokens}`,
      );
    }

    account.gameTokens -= tokens;

    this.pushTx(account, {
      id:          randomUUID(),
      timestamp:   Date.now(),
      type:        "bet",
      from:        agentId,
      to:          "pot",
      tokens,
      handId,
      description: `Bet ${tokens} tokens on hand ${handId}`,
    });

    await this.save();
  }

  /**
   * Settle a completed hand: credit winners and record losses.
   * Losers' tokens were already removed by `placeBet`; this only
   * adds "win" / "loss" journal entries and credits winning amounts.
   */
  async settlePot(settlement: HandSettlement): Promise<void> {
    await this.load();

    const { handId, winners, losers } = settlement;

    for (const { agentId, amountWon } of winners) {
      const account = this.getOrCreate(agentId);
      account.gameTokens += amountWon;

      this.pushTx(account, {
        id:          randomUUID(),
        timestamp:   Date.now(),
        type:        "win",
        from:        "pot",
        to:          agentId,
        tokens:      amountWon,
        handId,
        description: `Won ${amountWon} tokens from hand ${handId}`,
      });
    }

    for (const { agentId, amountLost } of losers) {
      const account = this.getOrCreate(agentId);

      this.pushTx(account, {
        id:          randomUUID(),
        timestamp:   Date.now(),
        type:        "loss",
        from:        agentId,
        to:          "pot",
        tokens:      amountLost,
        handId,
        description: `Lost ${amountLost} tokens in hand ${handId}`,
      });
    }

    await this.save();
  }

  /**
   * Record real API token consumption for an agent.
   * Deducts the USD-equivalent game tokens from the agent's balance
   * and updates per-model usage stats.
   *
   * The deduction rate is 1 game token = $0.000001 USD (i.e., 1M game tokens = $1).
   */
  async spend(
    agentId:      string,
    provider:     string,
    model:        string,
    inputTokens:  number,
    outputTokens: number,
  ): Promise<void> {
    await this.load();

    const costUSD = calculateCost(model, inputTokens, outputTokens);
    // Convert USD cost → game tokens (1M game tokens = $1)
    const gameTokenCost = Math.ceil(costUSD * 1_000_000);

    const account = this.getOrCreate(agentId);

    // Update per-model balance
    const key = `${provider}/${model}`;
    const bal = ensureModelBalance(account.balances, key);
    bal.inputTokens   += inputTokens;
    bal.outputTokens  += outputTokens;
    bal.totalValueUSD += costUSD;

    // Deduct game tokens (clamp at 0)
    const deducted = Math.min(gameTokenCost, account.gameTokens);
    account.gameTokens -= deducted;

    this.pushTx(account, {
      id:          randomUUID(),
      timestamp:   Date.now(),
      type:        "spend",
      from:        agentId,
      to:          "house",
      tokens:      deducted,
      description: `${model}: ${inputTokens}in + ${outputTokens}out → $${costUSD.toFixed(6)}`,
    });

    await this.save();
  }

  /**
   * Refund tokens to an agent (e.g. on API error, cancelled hand).
   */
  async refund(agentId: string, tokens: number, reason: string): Promise<void> {
    await this.load();

    const account = this.getOrCreate(agentId);
    account.gameTokens += tokens;

    this.pushTx(account, {
      id:          randomUUID(),
      timestamp:   Date.now(),
      type:        "refund",
      from:        "house",
      to:          agentId,
      tokens,
      description: reason,
    });

    await this.save();
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /** Returns the current balance for an agent (0 if never seen). */
  async getBalance(agentId: string): Promise<Balance> {
    await this.load();
    const account = this.accounts.get(agentId);
    if (!account) {
      return { agentId, gameTokens: 0, balances: {} };
    }
    return {
      agentId:    account.agentId,
      gameTokens: account.gameTokens,
      balances:   { ...account.balances },
    };
  }

  /**
   * Returns the most recent transactions for an agent.
   * @param limit  Maximum number of transactions to return (default: all).
   */
  async getTransactions(agentId: string, limit?: number): Promise<Transaction[]> {
    await this.load();
    const account = this.accounts.get(agentId);
    if (!account) return [];

    const txs = account.transactions;
    if (limit === undefined) return [...txs];
    return txs.slice(-limit);
  }

  /** Returns all known agent IDs. */
  async listAgents(): Promise<string[]> {
    await this.load();
    return [...this.accounts.keys()];
  }
}

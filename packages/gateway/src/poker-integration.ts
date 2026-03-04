/**
 * Poker → Inference token bridge.
 *
 * Called after every completed poker hand. Applies house rake, settles the
 * ledger, and returns a summary that maps poker chips to inference tokens.
 *
 * Conversion rate: 1 poker token  =  1,000 inference tokens (of the agent's model)
 * Rake:            2.5 % of the gross pot, deducted from winners' share.
 */

import type { TokenLedgerService } from "./token-ledger.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PokerWinner {
  agentId:   string;
  amountWon: number; // gross poker tokens (before rake)
}

export interface PokerLoser {
  agentId:    string;
  amountLost: number; // poker tokens lost (already deducted by placeBet)
}

export interface PokerHandResult {
  handId:  string;
  winners: PokerWinner[];
  losers:  PokerLoser[];
}

export interface AgentSettlement {
  agentId:        string;
  role:           "winner" | "loser";
  netPokerTokens: number;         // positive = credited, negative = already debited
  inferenceTokens: number;        // |netPokerTokens| × POKER_TO_INFERENCE
}

export interface HandSettlementResult {
  handId:      string;
  rake:        number;            // total poker tokens taken as house fee
  rakePercent: number;            // 2.5
  settlements: AgentSettlement[];
  newBalances: Record<string, number>; // agentId → updated gameTokens
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POKER_TO_INFERENCE = 1_000 as const;
const RAKE_RATE          = 0.025 as const;

// ---------------------------------------------------------------------------
// onHandComplete
// ---------------------------------------------------------------------------

/**
 * Settle a completed poker hand in the token ledger.
 *
 * 1. Computes rake (2.5 %) from the gross pot, distributed across winners.
 * 2. Credits net winnings (gross − rake) to each winner via `settlePot`.
 * 3. Records loss journal entries for each loser.
 * 4. Returns a human-readable settlement summary including inference-token
 *    equivalents and post-hand balances.
 */
export async function onHandComplete(
  handResult: PokerHandResult,
  ledger:     TokenLedgerService,
): Promise<HandSettlementResult> {
  const { handId, winners, losers } = handResult;

  // Total gross amount won across all winners (= gross pot before rake)
  const grossPot     = winners.reduce((s, w) => s + w.amountWon, 0);
  const totalRake    = Math.floor(grossPot * RAKE_RATE);

  // Distribute rake proportionally; any remainder goes to the house.
  const settlements: AgentSettlement[] = [];

  const winnerSettlements: Array<{ agentId: string; amountWon: number }> = [];
  const loserSettlements:  Array<{ agentId: string; amountLost: number }> = [];

  let rakeAllocated = 0;

  for (const [idx, winner] of winners.entries()) {
    const isLast     = idx === winners.length - 1;
    // Last winner absorbs any rounding remainder so total rake is exact.
    const winnerRake = isLast
      ? totalRake - rakeAllocated
      : grossPot > 0
        ? Math.floor(totalRake * (winner.amountWon / grossPot))
        : 0;

    rakeAllocated += winnerRake;
    const netWon = winner.amountWon - winnerRake;

    winnerSettlements.push({ agentId: winner.agentId, amountWon: netWon });
    settlements.push({
      agentId:         winner.agentId,
      role:            "winner",
      netPokerTokens:  netWon,
      inferenceTokens: netWon * POKER_TO_INFERENCE,
    });
  }

  for (const loser of losers) {
    loserSettlements.push({ agentId: loser.agentId, amountLost: loser.amountLost });
    settlements.push({
      agentId:         loser.agentId,
      role:            "loser",
      netPokerTokens:  -loser.amountLost,
      inferenceTokens: -loser.amountLost * POKER_TO_INFERENCE,
    });
  }

  // Commit to ledger
  await ledger.settlePot({ handId, winners: winnerSettlements, losers: loserSettlements });

  // Collect post-hand balances for all participants
  const allIds = [
    ...winners.map((w) => w.agentId),
    ...losers.map((l) => l.agentId),
  ];

  const newBalances: Record<string, number> = {};
  for (const agentId of allIds) {
    const bal = await ledger.getBalance(agentId);
    newBalances[agentId] = bal.gameTokens;
  }

  return {
    handId,
    rake:        totalRake,
    rakePercent: 2.5,
    settlements,
    newBalances,
  };
}

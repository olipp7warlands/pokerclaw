/**
 * Resource: pokercrawl://table/{tableId}/pot
 *
 * Detailed breakdown of the main pot and any side pots.
 * Useful for agents to understand the financial stakes before deciding.
 */

import type { TableRecord } from "../game-store.js";

export interface PotInfoData {
  tableId: string;
  mainPot: number;
  sidePots: Array<{
    index: number;
    amount: number;
    eligibleAgents: readonly string[];
  }>;
  totalPot: number;
  currentBet: number;
  minRaiseAmount: number;
  seatsContributed: Array<{
    agentId: string;
    totalBet: number;
    currentBet: number;
    stack: number;
    status: string;
  }>;
}

export function readPotInfo(tableId: string, record: TableRecord): PotInfoData {
  const { state } = record;

  const totalSidePots = state.sidePots.reduce((s, p) => s + p.amount, 0);
  const totalPot = state.mainPot + totalSidePots;

  return {
    tableId,
    mainPot: state.mainPot,
    sidePots: state.sidePots.map((p, i) => ({
      index: i,
      amount: p.amount,
      eligibleAgents: p.eligibleAgents,
    })),
    totalPot,
    currentBet: state.currentBet,
    minRaiseAmount: state.currentBet + state.lastRaiseAmount,
    seatsContributed: state.seats
      .filter((s) => s.totalBet > 0 || s.currentBet > 0)
      .map((s) => ({
        agentId: s.agentId,
        totalBet: s.totalBet,
        currentBet: s.currentBet,
        stack: s.stack,
        status: s.status,
      })),
  };
}

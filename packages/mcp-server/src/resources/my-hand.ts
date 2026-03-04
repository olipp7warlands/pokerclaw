/**
 * Resource: pokercrawl://table/{tableId}/hand/{agentId}
 *
 * Private — shows ONLY the requesting agent's hole cards.
 * Returns an error when the agentId in the URI doesn't match the caller.
 */

import type { TableRecord } from "../game-store.js";

export interface MyHandData {
  agentId: string;
  holeCards: Array<{
    rank: string;
    suit: string;
    capability: string;
    confidence: number;
  }>;
  stack: number;
  totalBet: number;
  currentBet: number;
  status: string;
  isMyTurn: boolean;
}

export function readMyHand(
  tableId: string,
  agentId: string,
  record: TableRecord
): MyHandData {
  const { state } = record;

  if (!record.agents.has(agentId)) {
    throw new Error(`Agent "${agentId}" is not seated at table "${tableId}"`);
  }

  const seat = state.seats.find((s) => s.agentId === agentId);
  if (!seat) {
    throw new Error(`Seat data not found for agent "${agentId}"`);
  }

  const actingSeat = state.seats[state.actionOnIndex];
  const isMyTurn = actingSeat?.agentId === agentId;

  return {
    agentId,
    holeCards: seat.holeCards.map((c) => ({
      rank: c.rank,
      suit: c.suit,
      capability: c.capability,
      confidence: c.confidence,
    })),
    stack: seat.stack,
    totalBet: seat.totalBet,
    currentBet: seat.currentBet,
    status: seat.status,
    isMyTurn,
  };
}

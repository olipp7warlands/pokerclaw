/**
 * Resource: pokercrawl://table/{tableId}/state
 *
 * Public game state — visible to all agents.
 * Hole cards are NOT included (they are private to each agent).
 */

import type { TableRecord } from "../game-store.js";

export interface PublicSeat {
  agentId: string;
  stack: number;
  totalBet: number;
  currentBet: number;
  status: string;
  capabilities: readonly string[];
}

export interface PublicTableState {
  tableId: string;
  phase: string;
  handNumber: number;
  dealerIndex: number;
  actionOnAgent: string | null;
  currentBet: number;
  lastRaiseAmount: number;
  mainPot: number;
  sidePots: Array<{ amount: number; eligibleAgents: readonly string[] }>;
  board: {
    flop: Array<{ rank: string; suit: string; task: string; effort: number }>;
    turn: { rank: string; suit: string; task: string; effort: number } | null;
    river: { rank: string; suit: string; task: string; effort: number } | null;
  };
  seats: PublicSeat[];
  winners: Array<{ agentId: string; amountWon: number; hand: string | null }>;
  assignedTasks: Array<{ task: string; effort: number }>;
}

function boardCardToPublic(card: {
  rank: string;
  suit: string;
  task: string;
  effort: number;
}) {
  return { rank: card.rank, suit: card.suit, task: card.task, effort: card.effort };
}

export function readTableState(tableId: string, record: TableRecord): PublicTableState {
  const { state } = record;

  const actionOnSeat = state.seats[state.actionOnIndex];
  const actionOnAgent =
    state.phase !== "waiting" &&
    state.phase !== "showdown" &&
    state.phase !== "execution" &&
    state.phase !== "settlement"
      ? (actionOnSeat?.agentId ?? null)
      : null;

  return {
    tableId,
    phase: state.phase,
    handNumber: state.handNumber,
    dealerIndex: state.dealerIndex,
    actionOnAgent,
    currentBet: state.currentBet,
    lastRaiseAmount: state.lastRaiseAmount,
    mainPot: state.mainPot,
    sidePots: state.sidePots.map((p) => ({
      amount: p.amount,
      eligibleAgents: p.eligibleAgents,
    })),
    board: {
      flop: state.board.flop.map(boardCardToPublic),
      turn: state.board.turn ? boardCardToPublic(state.board.turn) : null,
      river: state.board.river ? boardCardToPublic(state.board.river) : null,
    },
    seats: state.seats.map((s) => ({
      agentId: s.agentId,
      stack: s.stack,
      totalBet: s.totalBet,
      currentBet: s.currentBet,
      status: s.status,
      capabilities: record.agents.get(s.agentId)?.capabilities ?? [],
    })),
    winners: state.winners.map((w) => ({
      agentId: w.agentId,
      amountWon: w.amountWon,
      hand: w.hand?.rank ?? null,
    })),
    assignedTasks: state.assignedTasks.map((t) => ({
      task: t.task,
      effort: t.effort,
    })),
  };
}

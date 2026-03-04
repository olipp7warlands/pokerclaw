/**
 * Resource: pokercrawl://table/{tableId}/agents
 *
 * Public profiles of all agents at the table.
 * Includes capabilities, stack, and game status (no hole cards).
 */

import type { TableRecord } from "../game-store.js";

export interface AgentProfile {
  agentId: string;
  capabilities: readonly string[];
  stack: number;
  totalBet: number;
  status: string;
  joinedAt: number;
  handsWon: number;
}

export interface AgentProfilesData {
  tableId: string;
  playerCount: number;
  agents: AgentProfile[];
}

export function readAgentProfiles(tableId: string, record: TableRecord): AgentProfilesData {
  const { state } = record;

  const agents: AgentProfile[] = state.seats.map((seat) => {
    const meta = record.agents.get(seat.agentId);
    const handsWon = state.winners.filter((w) => w.agentId === seat.agentId).length;
    return {
      agentId: seat.agentId,
      capabilities: meta?.capabilities ?? [],
      stack: seat.stack,
      totalBet: seat.totalBet,
      status: seat.status,
      joinedAt: meta?.joinedAt ?? 0,
      handsWon,
    };
  });

  return {
    tableId,
    playerCount: agents.length,
    agents,
  };
}

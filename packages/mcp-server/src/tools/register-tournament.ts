/**
 * Tool: pokercrawl_register_tournament
 *
 * Register an agent for a tournament that is still in "registering" status.
 */

import { z } from "zod";
import type { TournamentManager } from "../tournament.js";
import type { ToolResult } from "./create-tournament.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const RegisterTournamentSchema = z.object({
  tournament_id: z.string().describe("Tournament id returned by pokercrawl_create_tournament"),
  agent_id:      z.string().describe("Agent registering for the tournament"),
  capabilities:  z
    .array(z.string())
    .default([])
    .describe("Agent capabilities (optional, passed through to table seating)"),
});

export type RegisterTournamentInput = z.infer<typeof RegisterTournamentSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function registerTournament(
  input: RegisterTournamentInput,
  manager: TournamentManager
): ToolResult {
  try {
    manager.registerPlayer(input.tournament_id, input.agent_id, input.capabilities);
    const tourn = manager.getTournament(input.tournament_id)!;
    const registered = tourn.players.length + // already started? use players
      (tourn.status === "registering"
        ? /* count via public API */ 0  // manager tracks internally
        : 0);
    return {
      success: true,
      message: `Agent "${input.agent_id}" registered for tournament "${input.tournament_id}".`,
      data: {
        tournamentId: input.tournament_id,
        agentId:      input.agent_id,
        maxPlayers:   tourn.maxPlayers,
        status:       tourn.status,
      },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

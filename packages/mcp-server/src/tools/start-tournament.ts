/**
 * Tool: pokercrawl_start_tournament
 *
 * Start a registered tournament. Creates tables, seats players, and deals
 * the first hand at each table. Requires ≥ 2 registered players.
 */

import { z } from "zod";
import type { TournamentManager } from "../tournament.js";
import type { ToolResult } from "./create-tournament.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const StartTournamentSchema = z.object({
  tournament_id: z.string().describe("Tournament id to start"),
});

export type StartTournamentInput = z.infer<typeof StartTournamentSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function startTournament(
  input: StartTournamentInput,
  manager: TournamentManager
): ToolResult {
  try {
    manager.startTournament(input.tournament_id);
    const tourn = manager.getTournament(input.tournament_id)!;

    return {
      success: true,
      message: `Tournament "${tourn.name}" started with ${tourn.players.length} players across ${tourn.tables.length} table(s). Blinds: ${tourn.blindLevels[0]!.small}/${tourn.blindLevels[0]!.big}.`,
      data: {
        tournamentId: tourn.id,
        name:         tourn.name,
        players:      tourn.players.length,
        tables:       tourn.tables,
        status:       tourn.status,
        currentLevel: tourn.currentLevel,
        blinds:       tourn.blindLevels[tourn.currentLevel],
      },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

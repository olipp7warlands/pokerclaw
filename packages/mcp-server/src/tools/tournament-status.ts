/**
 * Tool: pokercrawl_tournament_status
 *
 * Get the current standings, blind level, and player list for a tournament,
 * or list all tournaments when no id is provided.
 */

import { z } from "zod";
import type { TournamentManager, TournamentPlayer } from "../tournament.js";
import type { ToolResult } from "./create-tournament.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const TournamentStatusSchema = z.object({
  tournament_id: z
    .string()
    .optional()
    .describe("Specific tournament id. Omit to list all tournaments."),
});

export type TournamentStatusInput = z.infer<typeof TournamentStatusSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function _standingEntry(p: TournamentPlayer) {
  return {
    agentId:       p.agentId,
    stack:         p.stack,
    tableId:       p.currentTableId || null,
    finishPosition: p.finishPosition ?? null,
    rebuysUsed:    p.rebuysUsed,
  };
}

export function tournamentStatus(
  input: TournamentStatusInput,
  manager: TournamentManager
): ToolResult {
  try {
    if (input.tournament_id) {
      const tourn = manager.getTournament(input.tournament_id);
      if (!tourn) {
        return {
          success: false,
          message: `Tournament "${input.tournament_id}" not found`,
        };
      }

      const active    = tourn.players.filter((p) => p.finishPosition === undefined);
      const standings = [...tourn.players]
        .sort((a, b) =>
          a.finishPosition !== undefined && b.finishPosition !== undefined
            ? a.finishPosition - b.finishPosition
            : a.finishPosition !== undefined ? 1
            : b.finishPosition !== undefined ? -1
            : b.stack - a.stack
        )
        .map(_standingEntry);

      return {
        success: true,
        message: `Tournament "${tourn.name}" — ${tourn.status} — ${active.length} player(s) remaining.`,
        data: {
          tournamentId: tourn.id,
          name:         tourn.name,
          status:       tourn.status,
          type:         tourn.type,
          currentLevel: tourn.currentLevel,
          blinds:       tourn.blindLevels[tourn.currentLevel],
          activeTables: tourn.tables,
          standings,
          prizes:       tourn.prizes,
        },
      };
    }

    // List all tournaments
    const all = manager.listTournaments();
    return {
      success: true,
      message: `${all.length} tournament(s) found.`,
      data: {
        tournaments: all.map((t) => ({
          id:           t.id,
          name:         t.name,
          type:         t.type,
          status:       t.status,
          players:      t.players.length,
          activePlayers: t.players.filter((p) => p.finishPosition === undefined).length,
          tables:       t.tables.length,
          currentLevel: t.currentLevel,
        })),
      },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

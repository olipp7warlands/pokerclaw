/**
 * Tool: pokercrawl_create_tournament
 *
 * Create a new tournament in "registering" status. Returns the tournamentId
 * so agents can register and, once the field is full, start the event.
 */

import { z } from "zod";
import type { TournamentManager } from "../tournament.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const BlindLevelSchema = z.object({
  small:          z.number().int().positive().describe("Small blind"),
  big:            z.number().int().positive().describe("Big blind"),
  ante:           z.number().int().nonnegative().default(0).describe("Ante (informational)"),
  duration_hands: z.number().int().positive().describe("Hands at this level before escalation"),
});

const PrizeSchema = z.object({
  position: z.number().int().positive().describe("Finishing position (1 = winner)"),
  tokens:   z.number().int().positive().describe("Token prize for this position"),
  badge:    z.string().optional().describe("Badge to award (e.g. 'tournament-winner')"),
  title:    z.string().optional().describe("Title to award (e.g. 'Weekly Champion')"),
});

export const CreateTournamentSchema = z.object({
  name: z
    .string().min(1).max(60)
    .describe("Tournament display name, e.g. \"PokerCrawl Weekly #1\""),
  type: z
    .enum(["freezeout", "rebuy", "bounty"])
    .default("freezeout")
    .describe("Tournament format"),
  buy_in: z
    .number().int().nonnegative()
    .default(100)
    .describe("Buy-in tokens per player"),
  starting_stack: z
    .number().int().positive()
    .default(1500)
    .describe("Starting chip stack per player"),
  max_players: z
    .number().int().min(2).max(128)
    .default(32)
    .describe("Maximum number of registered players"),
  blind_levels: z
    .array(BlindLevelSchema).min(1)
    .describe("Ordered list of blind levels (escalate after duration_hands each)"),
  prizes: z
    .array(PrizeSchema).min(1)
    .describe("Prize structure — at minimum, a 1st-place prize"),
});

export type CreateTournamentInput = z.infer<typeof CreateTournamentSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ToolResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export function createTournament(
  input: CreateTournamentInput,
  manager: TournamentManager
): ToolResult {
  try {
    const id = manager.createTournament({
      name:          input.name,
      type:          input.type,
      buyIn:         input.buy_in,
      startingStack: input.starting_stack,
      maxPlayers:    input.max_players,
      blindLevels:   input.blind_levels.map((bl) => ({
        small:        bl.small,
        big:          bl.big,
        ante:         bl.ante,
        durationHands: bl.duration_hands,
      })),
      prizes: input.prizes.map((p) => ({
        position: p.position,
        tokens:   p.tokens,
        ...(p.badge !== undefined ? { badge: p.badge as import("../agent-registry.js").Badge } : {}),
        ...(p.title !== undefined ? { title: p.title } : {}),
      })),
    });

    return {
      success: true,
      message: `Tournament "${input.name}" created (id: ${id}). Register agents with pokercrawl_register_tournament.`,
      data: {
        tournamentId:  id,
        name:          input.name,
        type:          input.type,
        buyIn:         input.buy_in,
        startingStack: input.starting_stack,
        maxPlayers:    input.max_players,
        blindLevels:   input.blind_levels.length,
        status:        "registering",
      },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

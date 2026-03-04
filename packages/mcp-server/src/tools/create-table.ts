/**
 * Tool: pokercrawl_create_table
 *
 * Create a new named lobby table with custom blinds, buy-in range,
 * game type, and privacy settings.
 */

import { z } from "zod";
import type { Lobby } from "../lobby.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const CreateTableSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .describe("Human-readable table name, e.g. \"Mesa del Tiburón\""),
  small_blind: z.number().int().positive().default(5).describe("Small blind amount"),
  big_blind:   z.number().int().positive().default(10).describe("Big blind amount"),
  max_seats: z
    .number()
    .int()
    .min(2)
    .max(8)
    .default(6)
    .describe("Maximum number of seats (2–8)"),
  type: z
    .enum(["cash", "tournament", "sit-n-go"])
    .default("cash")
    .describe("Game type"),
  min_buy_in: z.number().int().positive().default(100).describe("Minimum buy-in tokens"),
  max_buy_in: z.number().int().positive().default(1000).describe("Maximum buy-in tokens"),
  is_private: z
    .boolean()
    .default(false)
    .describe("If true, a password is required to join"),
  password: z
    .string()
    .optional()
    .describe("Password for private tables"),
  allow_real_agents: z
    .boolean()
    .default(true)
    .describe("Allow real AI agents (via API key) to join"),
  allow_simulated_bots: z
    .boolean()
    .default(true)
    .describe("Allow simulated bots to join"),
});

export type CreateTableInput = z.infer<typeof CreateTableSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ToolResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export function createTable(input: CreateTableInput, lobby: Lobby): ToolResult {
  try {
    const tableId = lobby.createTable({
      name:               input.name,
      blinds:             { small: input.small_blind, big: input.big_blind },
      maxSeats:           input.max_seats,
      type:               input.type,
      buyIn:              { min: input.min_buy_in, max: input.max_buy_in },
      isPrivate:          input.is_private,
      allowRealAgents:    input.allow_real_agents,
      allowSimulatedBots: input.allow_simulated_bots,
      ...(input.password !== undefined ? { password: input.password } : {}),
    });

    const info = lobby.getTableInfo(tableId);
    return {
      success: true,
      message: `Table "${input.name}" created (id: ${tableId}). Waiting for players.`,
      data: {
        tableId,
        name:     input.name,
        blinds:   { small: input.small_blind, big: input.big_blind },
        maxSeats: input.max_seats,
        type:     input.type,
        buyIn:    { min: input.min_buy_in, max: input.max_buy_in },
        status:   info?.status ?? "waiting",
      },
    };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

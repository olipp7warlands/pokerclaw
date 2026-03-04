/**
 * Tool: pokercrawl_join_table
 *
 * An agent joins (or creates) a poker table.
 * If the table doesn't exist it is created with default config.
 * Once ≥ 2 players are seated the first hand is started automatically.
 */

import { z } from "zod";
import type { GameStore } from "../game-store.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const JoinTableSchema = z.object({
  tableId: z.string().min(1).describe("Unique table identifier"),
  agentId: z.string().min(1).describe("Unique agent identifier"),
  capabilities: z
    .array(z.string())
    .default([])
    .describe("List of skills/capabilities this agent offers"),
  initial_tokens: z
    .number()
    .int()
    .positive()
    .default(1000)
    .describe("Starting work-token stack"),
  small_blind: z.number().int().positive().default(5).optional(),
  big_blind: z.number().int().positive().default(10).optional(),
});

export type JoinTableInput = z.infer<typeof JoinTableSchema>;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ToolResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function joinTable(input: JoinTableInput, store: GameStore): ToolResult {
  try {
    // Create the table if it doesn't exist yet
    if (!store.getTable(input.tableId)) {
      store.createTable(input.tableId, {
        smallBlind: input.small_blind ?? 5,
        bigBlind: input.big_blind ?? 10,
      });
    }

    store.addAgent(
      input.tableId,
      input.agentId,
      input.capabilities,
      input.initial_tokens
    );

    const record = store.requireTable(input.tableId);
    return {
      success: true,
      message:
        `${input.agentId} joined table "${input.tableId}" with ` +
        `${input.initial_tokens} tokens. ` +
        `Players at table: ${record.state.seats.length}. ` +
        `Phase: ${record.state.phase}.`,
      data: {
        tableId: input.tableId,
        agentId: input.agentId,
        seatCount: record.state.seats.length,
        phase: record.state.phase,
        stack: input.initial_tokens,
      },
    };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

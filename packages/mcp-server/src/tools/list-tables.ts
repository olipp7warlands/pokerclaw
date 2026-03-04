/**
 * Tool: pokercrawl_list_tables
 *
 * List all public lobby tables with their current status, player count,
 * blind levels, buy-in range, and average pot size.
 */

import { z } from "zod";
import type { Lobby, TableInfo } from "../lobby.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const ListTablesSchema = z.object({
  type: z
    .enum(["cash", "tournament", "sit-n-go", "all"])
    .default("all")
    .optional()
    .describe("Filter by game type, or \"all\" for every table"),
  status: z
    .enum(["waiting", "playing", "all"])
    .default("all")
    .optional()
    .describe("Filter by table status"),
  include_private: z
    .boolean()
    .default(false)
    .optional()
    .describe("Include private tables in the listing (password not exposed)"),
});

export type ListTablesInput = z.infer<typeof ListTablesSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ToolResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export function listTables(input: ListTablesInput, lobby: Lobby): ToolResult {
  try {
    let tables: TableInfo[] = lobby.listTables();

    // Filter private tables unless explicitly requested
    if (!input.include_private) {
      tables = tables.filter((t) => !t.isPrivate);
    }

    // Filter by game type
    if (input.type && input.type !== "all") {
      tables = tables.filter((t) => t.type === input.type);
    }

    // Filter by status
    if (input.status && input.status !== "all") {
      tables = tables.filter((t) => t.status === input.status);
    }

    const summary = tables
      .map((t) =>
        `${t.name} [${t.id}] — ${t.blinds.small}/${t.blinds.big} blinds` +
        ` · ${t.currentPlayers}/${t.maxSeats} seats` +
        ` · ${t.type} · ${t.status}` +
        ` · buy-in ${t.minBuyIn}–${t.maxBuyIn}` +
        (t.handsPlayed > 0 ? ` · ${t.handsPlayed} hands` : "")
      )
      .join("\n");

    return {
      success: true,
      message: tables.length > 0
        ? `${tables.length} table(s) available:\n${summary}`
        : "No tables match the filter criteria.",
      data: { tables, count: tables.length },
    };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

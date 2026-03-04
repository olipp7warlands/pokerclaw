/**
 * Tool: pokercrawl_leave_table
 *
 * An agent voluntarily leaves a lobby table.
 * If a hand is in progress the seat is folded automatically.
 * Best called between hands so chip accounting is clean.
 */

import { z } from "zod";
import type { Lobby } from "../lobby.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const LeaveTableSchema = z.object({
  tableId: z.string().min(1).describe("ID of the table to leave"),
  agentId: z.string().min(1).describe("ID of the agent leaving"),
});

export type LeaveTableInput = z.infer<typeof LeaveTableSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ToolResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export function leaveTable(input: LeaveTableInput, lobby: Lobby): ToolResult {
  try {
    lobby.leaveTable(input.tableId, input.agentId);
    return {
      success: true,
      message: `${input.agentId} has left table "${input.tableId}".`,
      data: { tableId: input.tableId, agentId: input.agentId },
    };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Tool: pokercrawl_table_talk
 *
 * Send a message to all other agents at the table.
 * Can be used at any time (not just on your turn) for negotiation/bluffing.
 */

import { z } from "zod";
import type { GameStore } from "../game-store.js";
import type { ToolResult } from "./join-table.js";

export const TableTalkSchema = z.object({
  tableId: z.string().min(1),
  agentId: z.string().min(1),
  message: z.string().min(1).max(500),
});

export type TableTalkInput = z.infer<typeof TableTalkSchema>;

export function tableTalk(input: TableTalkInput, store: GameStore): ToolResult {
  try {
    const record = store.requireTable(input.tableId);

    // Verify agent is seated
    if (!record.agents.has(input.agentId)) {
      return {
        success: false,
        message: `Agent "${input.agentId}" is not seated at table "${input.tableId}"`,
      };
    }

    const entry = store.addChat(input.tableId, input.agentId, input.message);
    return {
      success: true,
      message: `[${input.agentId}]: "${input.message}"`,
      data: { timestamp: entry.timestamp, logLength: record.chatLog.length },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Tool: pokercrawl_check
 * Check (pass action) when no bet is active in the current round.
 */

import { z } from "zod";
import { processAction } from "@pokercrawl/engine";
import type { GameStore } from "../game-store.js";
import type { ToolResult } from "./join-table.js";

export const CheckSchema = z.object({
  tableId: z.string().min(1),
  agentId: z.string().min(1),
});

export type CheckInput = z.infer<typeof CheckSchema>;

export function check(input: CheckInput, store: GameStore): ToolResult {
  try {
    const record = store.requireTable(input.tableId);
    processAction(record.state, { agentId: input.agentId, type: "check", amount: 0 });
    store.notify(input.tableId, record);
    return {
      success: true,
      message: `${input.agentId} checks. Phase: ${record.state.phase}.`,
      data: { phase: record.state.phase },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

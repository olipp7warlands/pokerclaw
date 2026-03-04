/**
 * Tool: pokercrawl_fold
 * Fold the current hand. Agent forfeits their pot contribution.
 */

import { z } from "zod";
import { processAction, advanceAction } from "@pokercrawl/engine";
import type { GameStore } from "../game-store.js";
import type { ToolResult } from "./join-table.js";

export const FoldSchema = z.object({
  tableId: z.string().min(1),
  agentId: z.string().min(1),
});

export type FoldInput = z.infer<typeof FoldSchema>;

export function fold(input: FoldInput, store: GameStore): ToolResult {
  try {
    const record = store.requireTable(input.tableId);
    processAction(record.state, { agentId: input.agentId, type: "fold", amount: 0 });
    store.notify(input.tableId, record);
    return {
      success: true,
      message: `${input.agentId} folds. Phase: ${record.state.phase}.`,
      data: { phase: record.state.phase, mainPot: record.state.mainPot },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

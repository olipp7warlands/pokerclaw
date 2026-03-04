/**
 * Tool: pokercrawl_all_in
 *
 * Push all remaining tokens into the pot.
 * Creates side pots automatically when the agent's stack is smaller than the
 * current bet (under-call all-in).
 */

import { z } from "zod";
import { processAction } from "@pokercrawl/engine";
import type { GameStore } from "../game-store.js";
import type { ToolResult } from "./join-table.js";

export const AllInSchema = z.object({
  tableId: z.string().min(1),
  agentId: z.string().min(1),
});

export type AllInInput = z.infer<typeof AllInSchema>;

export function allIn(input: AllInInput, store: GameStore): ToolResult {
  try {
    const record = store.requireTable(input.tableId);
    const state = record.state;

    const seat = state.seats.find((s) => s.agentId === input.agentId);
    if (!seat) {
      return { success: false, message: `Agent "${input.agentId}" not found at table` };
    }
    const amount = seat.stack;

    processAction(state, { agentId: input.agentId, type: "all-in", amount });
    store.notify(input.tableId, record);

    return {
      success: true,
      message: `${input.agentId} is ALL-IN for ${amount} tokens.`,
      data: { allInAmount: amount, phase: state.phase, mainPot: state.mainPot },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

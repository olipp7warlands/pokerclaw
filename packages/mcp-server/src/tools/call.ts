/**
 * Tool: pokercrawl_call
 * Match the current bet. Amount is computed automatically from the game state.
 */

import { z } from "zod";
import { processAction } from "@pokercrawl/engine";
import type { GameStore } from "../game-store.js";
import type { ToolResult } from "./join-table.js";

export const CallSchema = z.object({
  tableId: z.string().min(1),
  agentId: z.string().min(1),
});

export type CallInput = z.infer<typeof CallSchema>;

export function call(input: CallInput, store: GameStore): ToolResult {
  try {
    const record = store.requireTable(input.tableId);
    const state = record.state;

    const seat = state.seats.find((s) => s.agentId === input.agentId);
    if (!seat) {
      return { success: false, message: `Agent "${input.agentId}" not found at table` };
    }

    const callAmount = Math.min(state.currentBet - seat.currentBet, seat.stack);
    processAction(state, { agentId: input.agentId, type: "call", amount: callAmount });
    store.notify(input.tableId, record);

    return {
      success: true,
      message: `${input.agentId} calls ${callAmount}. Phase: ${state.phase}.`,
      data: { called: callAmount, phase: state.phase, mainPot: state.mainPot },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

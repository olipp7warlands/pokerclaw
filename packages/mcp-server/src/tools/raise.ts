/**
 * Tool: pokercrawl_raise
 *
 * Raise an existing bet. No-Limit rules:
 *   - min raise = current_bet + last_raise_amount
 *   - max raise = current_bet + agent_stack  (go all-in with amount = max)
 *
 * `amount` is the TOTAL bet size for this round, not the additional chips.
 * Example: current bet = 20, you raise to 60 → amount = 60.
 */

import { z } from "zod";
import { processAction } from "@pokercrawl/engine";
import type { GameStore } from "../game-store.js";
import type { ToolResult } from "./join-table.js";

export const RaiseSchema = z.object({
  tableId: z.string().min(1),
  agentId: z.string().min(1),
  amount: z
    .number()
    .int()
    .positive()
    .describe("Total bet amount to raise TO (not the additional increment)"),
});

export type RaiseInput = z.infer<typeof RaiseSchema>;

export function raise(input: RaiseInput, store: GameStore): ToolResult {
  try {
    const record = store.requireTable(input.tableId);
    const state = record.state;

    if (state.currentBet === 0) {
      return {
        success: false,
        message:
          "No active bet to raise. Use pokercrawl_bet to open the betting, " +
          "or pokercrawl_check if you want to pass.",
      };
    }

    const minRaise = state.currentBet + state.lastRaiseAmount;
    const seat = state.seats.find((s) => s.agentId === input.agentId);
    if (!seat) {
      return { success: false, message: `Agent "${input.agentId}" not found at table` };
    }
    const maxRaise = state.currentBet + seat.stack;

    processAction(state, { agentId: input.agentId, type: "raise", amount: input.amount });
    store.notify(input.tableId, record);

    return {
      success: true,
      message: `${input.agentId} raises to ${input.amount} (min was ${minRaise}, max was ${maxRaise}).`,
      data: { raisedTo: input.amount, currentBet: state.currentBet, phase: state.phase },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

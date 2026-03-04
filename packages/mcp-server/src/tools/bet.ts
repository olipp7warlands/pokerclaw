/**
 * Tool: pokercrawl_bet
 *
 * Open the betting in a round where no bet has been placed yet.
 * (When there is already a bet active, use pokercrawl_raise instead.)
 *
 * In the engine this maps to a "raise" action since the engine treats a bet
 * as a raise from zero.
 */

import { z } from "zod";
import { processAction } from "@pokercrawl/engine";
import type { GameStore } from "../game-store.js";
import type { ToolResult } from "./join-table.js";

export const BetSchema = z.object({
  tableId: z.string().min(1),
  agentId: z.string().min(1),
  amount: z.number().int().positive().describe("Total bet amount in work-tokens"),
  confidence_reason: z
    .string()
    .optional()
    .describe("Optional explanation of why this bet represents the agent's confidence"),
});

export type BetInput = z.infer<typeof BetSchema>;

export function bet(input: BetInput, store: GameStore): ToolResult {
  try {
    const record = store.requireTable(input.tableId);
    const state = record.state;

    if (state.currentBet > 0) {
      return {
        success: false,
        message:
          `There is already a bet of ${state.currentBet} tokens. ` +
          `Use pokercrawl_raise, pokercrawl_call, or pokercrawl_fold instead.`,
      };
    }

    processAction(state, { agentId: input.agentId, type: "raise", amount: input.amount });
    store.notify(input.tableId, record);

    return {
      success: true,
      message: `${input.agentId} bets ${input.amount}.`,
      data: { bet: input.amount, currentBet: state.currentBet, phase: state.phase },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

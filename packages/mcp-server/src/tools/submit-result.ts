/**
 * Tool: pokercrawl_submit_result
 *
 * After winning a hand the agent submits the completed task result.
 * Only callable during or after the "execution" / "settlement" phase.
 * Validates that the submitter was actually assigned this task.
 */

import { z } from "zod";
import type { GameStore } from "../game-store.js";
import type { ToolResult } from "./join-table.js";

export const SubmitResultSchema = z.object({
  tableId: z.string().min(1),
  agentId: z.string().min(1),
  taskId: z.string().min(1).describe("The task card identifier (from the board)"),
  result: z
    .string()
    .min(1)
    .describe("Summary of what was accomplished"),
  evidence: z
    .string()
    .optional()
    .describe("Optional: URL, code snippet, or other verifiable evidence"),
});

export type SubmitResultInput = z.infer<typeof SubmitResultSchema>;

export function submitResult(input: SubmitResultInput, store: GameStore): ToolResult {
  try {
    const record = store.requireTable(input.tableId);
    const state = record.state;

    // Must be in execution or settlement phase (or just after)
    const validPhases = ["execution", "settlement"] as const;
    if (!(validPhases as readonly string[]).includes(state.phase)) {
      return {
        success: false,
        message:
          `Task results can only be submitted during execution or settlement phase. ` +
          `Current phase: ${state.phase}.`,
      };
    }

    // Verify the agent won the hand and was assigned this task
    const isWinner = state.winners.some((w) => w.agentId === input.agentId);
    if (!isWinner) {
      return {
        success: false,
        message: `${input.agentId} did not win this hand and is not responsible for task execution.`,
      };
    }

    const taskCard = state.assignedTasks.find(
      (t) =>
        t.metadata?.["id"] === input.taskId ||
        t.task === input.taskId
    );
    if (!taskCard) {
      const available = state.assignedTasks.map((t) => t.metadata?.["id"] ?? t.task).join(", ");
      return {
        success: false,
        message: `Task "${input.taskId}" not found in assigned tasks. Available: ${available || "none"}`,
      };
    }

    const result = store.submitTaskResult(
      input.tableId,
      input.agentId,
      input.taskId,
      input.result,
      input.evidence
    );

    return {
      success: true,
      message: `Task "${input.taskId}" submitted successfully by ${input.agentId}.`,
      data: { taskId: input.taskId, submittedAt: result.submittedAt },
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

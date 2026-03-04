/**
 * Resource: pokercrawl://tasks/pool
 *
 * Lists all task cards currently visible on the board (community cards).
 * Also lists tasks that have been assigned to winners.
 */

import type { TableRecord } from "../game-store.js";

export interface TaskPoolData {
  tableId: string;
  boardTasks: Array<{
    rank: string;
    suit: string;
    task: string;
    effort: number;
    street: "flop" | "turn" | "river";
  }>;
  assignedTasks: Array<{
    task: string;
    effort: number;
    assignedTo: string | null;
    completed: boolean;
  }>;
  pendingResults: number;
}

export function readTaskPool(tableId: string, record: TableRecord): TaskPoolData {
  const { state } = record;

  const boardTasks: TaskPoolData["boardTasks"] = [
    ...state.board.flop.map((c) => ({
      rank: c.rank,
      suit: c.suit,
      task: c.task,
      effort: c.effort,
      street: "flop" as const,
    })),
    ...(state.board.turn
      ? [
          {
            rank: state.board.turn.rank,
            suit: state.board.turn.suit,
            task: state.board.turn.task,
            effort: state.board.turn.effort,
            street: "turn" as const,
          },
        ]
      : []),
    ...(state.board.river
      ? [
          {
            rank: state.board.river.rank,
            suit: state.board.river.suit,
            task: state.board.river.task,
            effort: state.board.river.effort,
            street: "river" as const,
          },
        ]
      : []),
  ];

  const winner = state.winners[0]?.agentId ?? null;

  const assignedTasks = state.assignedTasks.map((t) => ({
    task: t.task,
    effort: t.effort,
    assignedTo: winner,
    completed: record.taskResults.some(
      (r) => r.agentId === winner && (r.taskId === t.task || r.taskId === String(t.metadata?.["id"]))
    ),
  }));

  return {
    tableId,
    boardTasks,
    assignedTasks,
    pendingResults: assignedTasks.filter((t) => !t.completed).length,
  };
}

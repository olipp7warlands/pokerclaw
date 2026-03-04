/**
 * Prompt: negotiate
 *
 * Generates a negotiation-focused prompt to help an agent craft a
 * table-talk message that could influence opponents' decisions.
 */

import type { TableRecord } from "../game-store.js";

export interface NegotiatePromptArgs {
  tableId: string;
  agentId: string;
  goal?: string; // e.g., "win the code-review task", "get others to fold"
}

export function buildNegotiatePrompt(args: NegotiatePromptArgs, record: TableRecord): string {
  const { state } = record;
  const myMeta = record.agents.get(args.agentId);
  const mySeat = state.seats.find((s) => s.agentId === args.agentId);

  if (!myMeta || !mySeat) {
    return `Agent "${args.agentId}" is not seated at table "${args.tableId}".`;
  }

  // Opponents
  const opponents = state.seats
    .filter((s) => s.agentId !== args.agentId && s.status !== "folded")
    .map((s) => {
      const meta = record.agents.get(s.agentId);
      return `  • ${s.agentId} — capabilities: [${(meta?.capabilities ?? []).join(", ")}], stack: ${s.stack}`;
    })
    .join("\n");

  // Board tasks
  const boardTasks = [
    ...state.board.flop.map((c) => c.task),
    ...(state.board.turn ? [state.board.turn.task] : []),
    ...(state.board.river ? [state.board.river.task] : []),
  ];

  // My capabilities
  const myCaps = (myMeta.capabilities ?? []).join(", ") || "(none listed)";
  const myHoleStr =
    mySeat.holeCards.length > 0
      ? mySeat.holeCards.map((c) => `${c.rank}${c.suit[0]} (${c.capability})`).join(", ")
      : "not yet dealt";

  return `# PokerCrawl Negotiation Prompt — Table "${args.tableId}"

## Context
You are **${args.agentId}** at a PokerCrawl table.
Goal: ${args.goal ?? "Win the hand and get assigned the tasks on the board."}

## Your Capabilities (private)
- Listed capabilities: ${myCaps}
- Hole cards: ${myHoleStr}
- Stack: ${mySeat.stack} tokens

## Tasks at Stake (community cards)
${boardTasks.length > 0 ? boardTasks.map((t) => `  • ${t}`).join("\n") : "  (no community cards yet)"}

## Active Opponents
${opponents || "  (none — you are the last agent standing)"}

## Chat History
${record.chatLog.slice(-10).map((m) => `  [${m.agentId}]: ${m.message}`).join("\n") || "  (no messages yet)"}

## Negotiation Strategies
1. **Demonstrate competence** — reference your specific capabilities that match the board tasks.
2. **Credible threats** — signal that you have a strong hand, or bluff convincingly.
3. **Collaborative framing** — propose task delegation to another agent if the tasks don't match your capabilities.
4. **Information extraction** — ask questions to gauge opponents' confidence.
5. **Pot commitment** — remind large stackholders of pot-odds to discourage calls.

## Your Task
Compose a pokercrawl_table_talk message (≤ 200 chars) that advances your goal.
Be concise, strategic, and in-character as an AI agent negotiating work delegation.`;
}

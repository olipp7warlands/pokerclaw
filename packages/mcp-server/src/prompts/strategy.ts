/**
 * Prompt: strategy
 *
 * Generates a context-rich strategy prompt for the acting agent.
 * Includes hole cards, community cards, pot odds, and action history.
 */

import type { TableRecord } from "../game-store.js";

export interface StrategyPromptArgs {
  tableId: string;
  agentId: string;
}

export function buildStrategyPrompt(args: StrategyPromptArgs, record: TableRecord): string {
  const { state } = record;
  const seat = state.seats.find((s) => s.agentId === args.agentId);

  if (!seat) {
    return `Agent "${args.agentId}" is not seated at table "${args.tableId}".`;
  }

  const actingSeat = state.seats[state.actionOnIndex];
  const isMyTurn = actingSeat?.agentId === args.agentId;

  // Hole cards
  const holeCardsStr =
    seat.holeCards.length > 0
      ? seat.holeCards.map((c) => `${c.rank}${c.suit[0]} (${c.capability})`).join(", ")
      : "Not yet dealt";

  // Community cards
  const flopStr =
    state.board.flop.length > 0
      ? state.board.flop.map((c) => `${c.rank}${c.suit[0]}: ${c.task}`).join(", ")
      : "Not yet revealed";
  const turnStr = state.board.turn
    ? `${state.board.turn.rank}${state.board.turn.suit[0]}: ${state.board.turn.task}`
    : "Not yet revealed";
  const riverStr = state.board.river
    ? `${state.board.river.rank}${state.board.river.suit[0]}: ${state.board.river.task}`
    : "Not yet revealed";

  // All stacks
  const stacksStr = state.seats
    .map((s) => `  • ${s.agentId}: ${s.stack} tokens (${s.status})`)
    .join("\n");

  // Recent events
  const recentEvents = state.events
    .filter((e) => e.type === "action-taken")
    .slice(-8)
    .map((e) => {
      const p = e.payload;
      return `  • [${p["phase"]}] ${p["agentId"]}: ${p["type"]}` +
        (p["amount"] ? ` ${p["amount"]}` : "");
    })
    .join("\n");

  // Pot odds
  const callAmount = Math.min(state.currentBet - seat.currentBet, seat.stack);
  const potOdds =
    callAmount > 0
      ? `${callAmount} to call into a pot of ${state.mainPot} (${Math.round((callAmount / (state.mainPot + callAmount)) * 100)}% of pot)`
      : "No bet to call";

  // Min raise
  const minRaise = state.currentBet + state.lastRaiseAmount;

  return `# PokerCrawl Strategy Analysis — Table "${args.tableId}"

## Your Situation
- **Agent:** ${args.agentId}
- **Your turn:** ${isMyTurn ? "YES — you must act" : `No — waiting for ${actingSeat?.agentId ?? "??"}`}
- **Phase:** ${state.phase}  |  **Hand:** #${state.handNumber}

## Your Hole Cards (private)
${holeCardsStr}

## Community Cards (board tasks)
- **Flop:** ${flopStr}
- **Turn:** ${turnStr}
- **River:** ${riverStr}

## Pot & Betting
- **Main pot:** ${state.mainPot} tokens
- **Side pots:** ${state.sidePots.length === 0 ? "None" : state.sidePots.map((p, i) => `Pot ${i + 1}: ${p.amount}`).join(", ")}
- **Current bet:** ${state.currentBet}
- **Your current bet this round:** ${seat.currentBet}
- **Pot odds:** ${potOdds}
- **Min raise to:** ${minRaise}

## All Stacks
${stacksStr}

## Recent Actions
${recentEvents || "  (none yet)"}

## Chat Log
${record.chatLog.slice(-5).map((m) => `  [${m.agentId}]: ${m.message}`).join("\n") || "  (no chat)"}

## Available Actions
${
  isMyTurn
    ? buildAvailableActions(args.agentId, record)
    : "Wait for your turn."
}

## Strategic Guidance
Analyze your hole cards (capabilities) against the community cards (tasks on the board).
A strong hand means your capabilities closely match the task requirements.
Consider: pot odds, opponent stack sizes, and whether bluffing is credible given the board.
The winner must execute ALL community-card tasks — bid accordingly.`;
}

function buildAvailableActions(agentId: string, record: TableRecord): string {
  const { state } = record;
  const seat = state.seats.find((s) => s.agentId === agentId);
  if (!seat) return "";

  const callAmount = Math.min(state.currentBet - seat.currentBet, seat.stack);
  const actions: string[] = ["- pokercrawl_fold (always available)"];

  if (callAmount === 0) {
    actions.push("- pokercrawl_check (no bet to match)");
  } else {
    actions.push(`- pokercrawl_call (costs ${callAmount} tokens)`);
  }

  if (state.currentBet === 0) {
    actions.push(`- pokercrawl_bet <amount> (open betting; min: ${state.lastRaiseAmount || state.currentBet + 1})`);
  } else {
    const minRaise = state.currentBet + state.lastRaiseAmount;
    const maxRaise = state.currentBet + seat.stack;
    actions.push(`- pokercrawl_raise <amount> (raise to between ${minRaise} and ${maxRaise})`);
  }

  actions.push(`- pokercrawl_all_in (push all ${seat.stack} tokens)`);
  return actions.join("\n");
}

#!/usr/bin/env node
/**
 * @pokercrawl/agents — Public API + CLI demo entry point
 *
 * CLI usage:
 *   npx pokercrawl-demo
 *   npx pokercrawl-demo --hands 10
 */

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export { BaseAgent, DEFAULT_PERSONALITY } from "./base-agent.js";

export type {
  ActionType,
  AgentConfig,
  AgentDecision,
  AgentPersonality,
  GameConfig,
  HandResult,
  OpponentInfo,
  StrategyContext,
  TablePosition,
  TournamentResult,
} from "./types.js";

// Simulated bots
export { RandomBot }       from "./simulated/random.js";
export { AggressiveBot }   from "./simulated/aggressive.js";
export { ConservativeBot } from "./simulated/conservative.js";
export { BlufferBot }      from "./simulated/bluffer.js";
export { CalculatedBot }   from "./simulated/calculated.js";
export { WolfBot }         from "./simulated/wolf.js";
export { OwlBot }          from "./simulated/owl.js";
export { TurtleBot }       from "./simulated/turtle.js";
export { FoxBot }          from "./simulated/fox.js";

// Real AI agents (fall back to CalculatedBot if no API key)
export { ClaudeAgent } from "./real/claude-agent.js";
export { OpenAIAgent } from "./real/openai-agent.js";

// Orchestrator + MCP client
export { AgentOrchestrator } from "./orchestrator.js";
export { PokerCrawlDirectClient } from "./mcp-client.js";
export type {
  ToolResult,
  TableStateView,
  MyHandView,
  PotView,
  ProfilesView,
  TaskPoolView,
} from "./mcp-client.js";

// ---------------------------------------------------------------------------
// CLI demo entry point
// ---------------------------------------------------------------------------

import { fileURLToPath as _agentsUrlToPath } from "node:url";
const _agentsIsMain = process.argv[1] === _agentsUrlToPath(import.meta.url);

if (_agentsIsMain) {
  const args = process.argv.slice(2);
  const handsArg = args.indexOf("--hands");
  const maxHands = handsArg >= 0 ? parseInt(args[handsArg + 1] ?? "10", 10) : 10;

  const { GameStore } = await import("@pokercrawl/mcp-server");
  const { AgentOrchestrator: Orch } = await import("./orchestrator.js");
  const { AggressiveBot: Aggressive } = await import("./simulated/aggressive.js");
  const { BlufferBot: Bluffer } = await import("./simulated/bluffer.js");
  const { CalculatedBot: Calculated } = await import("./simulated/calculated.js");
  const { ConservativeBot: Conservative } = await import("./simulated/conservative.js");

  console.log(`\n🃏  PokerCrawl Demo — ${maxHands} hands\n`);

  const store = new GameStore();
  const orch = new Orch(store, {
    tableId: "demo-table",
    smallBlind: 5,
    bigBlind: 10,
    startingTokens: 1000,
  });

  orch.registerAgent(new Aggressive({ id: "shark", tableId: "demo-table" }));
  orch.registerAgent(new Bluffer({ id: "mago", tableId: "demo-table" }));
  orch.registerAgent(new Calculated({ id: "clock", tableId: "demo-table" }));
  orch.registerAgent(new Conservative({ id: "rock", tableId: "demo-table" }));

  orch.on("decision", ({ agentId, decision }) => {
    const amtStr = decision.amount !== undefined ? ` ${decision.amount}` : "";
    console.log(`  ${agentId.padEnd(8)} → ${decision.action}${amtStr}`);
  });

  orch.on("chat", ({ agentId, message }) => {
    console.log(`  💬 ${agentId}: "${message}"`);
  });

  orch.on("hand_complete", (result) => {
    const winStr = result.winners.map((w) => `${w.agentId}+${w.amountWon}`).join(", ");
    console.log(`  ✅ Hand #${result.handNumber} → ${winStr}\n`);
  });

  const result = await orch.playTournament(maxHands, { decisionTimeoutMs: 10_000 });

  console.log("\n── Tournament Results ──────────────────────");
  console.log(`Hands played: ${result.hands}`);
  console.log("Final stacks:");
  for (const [id, stack] of Object.entries(result.finalStacks)) {
    const won = result.handsWon[id] ?? 0;
    const eliminated = result.eliminated.includes(id) ? " [eliminated]" : "";
    console.log(`  ${id.padEnd(10)} ${String(stack).padStart(6)} chips  (${won} hands won)${eliminated}`);
  }
  console.log("");
}

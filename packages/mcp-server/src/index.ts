#!/usr/bin/env node
/**
 * @pokercrawl/mcp-server — Public API + CLI entry point
 *
 * CLI usage:
 *   npx pokercrawl-server
 *   npx pokercrawl-server --ws-port 3001
 */

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export { GameStore, globalStore } from "./game-store.js";
export type { TableConfig, TableRecord, AgentMeta, TaskResult, ChatMessage } from "./game-store.js";

export { Lobby } from "./lobby.js";
export type { TableInfo, LobbyTableConfig, AgentJoinRequest, GameType, TableStatus } from "./lobby.js";

export { AgentRegistry } from "./agent-registry.js";
export type { AgentProfile, AgentStats, AgentType, Badge } from "./agent-registry.js";

export { TournamentManager } from "./tournament.js";
export type {
  Tournament,
  TournamentConfig,
  TournamentPlayer,
  TournamentType,
  TournamentStatus,
  BlindLevel,
  Prize,
} from "./tournament.js";

export { WsBridge } from "./ws-bridge.js";
export type { WSEvent, WSEventType, LiveSnapshot, SeatSnapshot, CardSnapshot } from "./ws-bridge.js";

export { ExternalAgentBridge } from "./external-agent.js";
export type { ExternalAgentConfig, ExternalAgentRecord, ActionDecision } from "./external-agent.js";

export { WsAgentBridge } from "./ws-agent-bridge.js";
export type { WsAgentConfig, WsAgentRecord, WsCommand, WsEvent } from "./ws-agent-bridge.js";

export { HttpAgentBridge } from "./http-agent-bridge.js";

export { createMcpServer, runStdioServer } from "./server.js";

// Tools
export { joinTable, JoinTableSchema } from "./tools/join-table.js";
export { createTable, CreateTableSchema } from "./tools/create-table.js";
export { listTables, ListTablesSchema } from "./tools/list-tables.js";
export { leaveTable, LeaveTableSchema } from "./tools/leave-table.js";
export { createTournament, CreateTournamentSchema } from "./tools/create-tournament.js";
export { registerTournament, RegisterTournamentSchema } from "./tools/register-tournament.js";
export { startTournament, StartTournamentSchema } from "./tools/start-tournament.js";
export { tournamentStatus, TournamentStatusSchema } from "./tools/tournament-status.js";
export { bet, BetSchema } from "./tools/bet.js";
export { call, CallSchema } from "./tools/call.js";
export { raise, RaiseSchema } from "./tools/raise.js";
export { fold, FoldSchema } from "./tools/fold.js";
export { allIn, AllInSchema } from "./tools/all-in.js";
export { check, CheckSchema } from "./tools/check.js";
export { tableTalk, TableTalkSchema } from "./tools/table-talk.js";
export { submitResult, SubmitResultSchema } from "./tools/submit-result.js";

// Resources
export { readTableState } from "./resources/table-state.js";
export { readMyHand } from "./resources/my-hand.js";
export { readTaskPool } from "./resources/task-pool.js";
export { readAgentProfiles } from "./resources/agent-profiles.js";
export { readPotInfo } from "./resources/pot-info.js";

// Prompts
export { buildStrategyPrompt } from "./prompts/strategy.js";
export { buildNegotiatePrompt } from "./prompts/negotiate.js";

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// Only run CLI when this file is executed directly (compare against own URL, not just endsWith)
import { fileURLToPath } from "node:url";
const _mcpMain = process.argv[1] === fileURLToPath(import.meta.url);
if (_mcpMain) {
  const args = process.argv.slice(2);
  const wsPortArg = args.indexOf("--ws-port");
  const wsPort = wsPortArg >= 0 ? parseInt(args[wsPortArg + 1] ?? "3001", 10) : 3001;

  const { globalStore: store } = await import("./game-store.js");
  const { WsBridge: Bridge } = await import("./ws-bridge.js");
  const { runStdioServer } = await import("./server.js");

  const bridge = new Bridge(wsPort);
  await bridge.start();

  await runStdioServer(store, bridge);
}

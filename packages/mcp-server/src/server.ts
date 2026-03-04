/**
 * PokerCrawl — MCP Server
 *
 * Registers all tools, resources, and prompts with the MCP protocol.
 * Wires up the WsBridge to broadcast state changes to UI clients.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListResourcesRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { GameStore } from "./game-store.js";
import { WsBridge } from "./ws-bridge.js";

import type { Lobby } from "./lobby.js";
import type { TournamentManager } from "./tournament.js";

// Tools
import { JoinTableSchema, joinTable } from "./tools/join-table.js";
import { BetSchema, bet } from "./tools/bet.js";
import { CallSchema, call } from "./tools/call.js";
import { RaiseSchema, raise } from "./tools/raise.js";
import { FoldSchema, fold } from "./tools/fold.js";
import { AllInSchema, allIn } from "./tools/all-in.js";
import { CheckSchema, check } from "./tools/check.js";
import { TableTalkSchema, tableTalk } from "./tools/table-talk.js";
import { SubmitResultSchema, submitResult } from "./tools/submit-result.js";
import { CreateTableSchema, createTable } from "./tools/create-table.js";
import { ListTablesSchema, listTables } from "./tools/list-tables.js";
import { LeaveTableSchema, leaveTable } from "./tools/leave-table.js";
import { CreateTournamentSchema, createTournament } from "./tools/create-tournament.js";
import { RegisterTournamentSchema, registerTournament } from "./tools/register-tournament.js";
import { StartTournamentSchema, startTournament } from "./tools/start-tournament.js";
import { TournamentStatusSchema, tournamentStatus } from "./tools/tournament-status.js";

// Resources
import { readTableState } from "./resources/table-state.js";
import { readMyHand } from "./resources/my-hand.js";
import { readTaskPool } from "./resources/task-pool.js";
import { readAgentProfiles } from "./resources/agent-profiles.js";
import { readPotInfo } from "./resources/pot-info.js";

// Prompts
import { buildStrategyPrompt } from "./prompts/strategy.js";
import { buildNegotiatePrompt } from "./prompts/negotiate.js";

// ---------------------------------------------------------------------------
// Tool definitions (for ListTools)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: "pokercrawl_join_table",
    description:
      "Join (or create) a poker table. The first hand starts automatically when ≥ 2 agents are seated.",
    inputSchema: zodToJsonSchema(JoinTableSchema),
  },
  {
    name: "pokercrawl_bet",
    description:
      "Open the betting in a round where no bet has been placed yet. Use pokercrawl_raise if there is already an active bet.",
    inputSchema: zodToJsonSchema(BetSchema),
  },
  {
    name: "pokercrawl_call",
    description: "Match the current bet (amount is computed automatically).",
    inputSchema: zodToJsonSchema(CallSchema),
  },
  {
    name: "pokercrawl_raise",
    description:
      "Raise an existing bet. `amount` is the TOTAL bet size to raise TO (NL rules: min = last raise size).",
    inputSchema: zodToJsonSchema(RaiseSchema),
  },
  {
    name: "pokercrawl_fold",
    description: "Fold your hand and forfeit the pot.",
    inputSchema: zodToJsonSchema(FoldSchema),
  },
  {
    name: "pokercrawl_all_in",
    description:
      "Push all remaining tokens into the pot. Side pots are calculated automatically.",
    inputSchema: zodToJsonSchema(AllInSchema),
  },
  {
    name: "pokercrawl_check",
    description: "Pass the action when there is no active bet to call.",
    inputSchema: zodToJsonSchema(CheckSchema),
  },
  {
    name: "pokercrawl_table_talk",
    description:
      "Send a negotiation message to all agents at the table. Can be used at any time (not just your turn).",
    inputSchema: zodToJsonSchema(TableTalkSchema),
  },
  {
    name: "pokercrawl_submit_result",
    description:
      "Submit the completed task result after winning a hand. Only callable by the hand winner during execution/settlement phase.",
    inputSchema: zodToJsonSchema(SubmitResultSchema),
  },
  // Lobby tools (only registered when a Lobby is provided to createMcpServer)
  {
    name: "pokercrawl_create_table",
    description:
      "Create a new named lobby table with custom blinds, buy-in range, game type, and privacy settings.",
    inputSchema: zodToJsonSchema(CreateTableSchema),
  },
  {
    name: "pokercrawl_list_tables",
    description:
      "List available lobby tables with their current status, player count, and buy-in details.",
    inputSchema: zodToJsonSchema(ListTablesSchema),
  },
  {
    name: "pokercrawl_leave_table",
    description:
      "Leave a lobby table. The agent's seat is folded if a hand is currently in progress.",
    inputSchema: zodToJsonSchema(LeaveTableSchema),
  },
  // Tournament tools (only registered when a TournamentManager is provided)
  {
    name: "pokercrawl_create_tournament",
    description:
      "Create a multi-table tournament with custom blind levels, prizes, and format (freezeout / rebuy / bounty).",
    inputSchema: zodToJsonSchema(CreateTournamentSchema),
  },
  {
    name: "pokercrawl_register_tournament",
    description:
      "Register an agent for a tournament that is still accepting players.",
    inputSchema: zodToJsonSchema(RegisterTournamentSchema),
  },
  {
    name: "pokercrawl_start_tournament",
    description:
      "Start a registered tournament. Creates tables, seats all players, and deals the first hand.",
    inputSchema: zodToJsonSchema(StartTournamentSchema),
  },
  {
    name: "pokercrawl_tournament_status",
    description:
      "Get live standings, blind level, and player list for a tournament. Omit tournament_id to list all.",
    inputSchema: zodToJsonSchema(TournamentStatusSchema),
  },
] as const;

// ---------------------------------------------------------------------------
// Resource definitions (for ListResources)
// ---------------------------------------------------------------------------

const RESOURCE_DEFINITIONS = [
  {
    uri: "pokercrawl://table/{tableId}/state",
    name: "Table State",
    description:
      "Public game state for a table — phase, board, pot, seat stacks. No private hole cards.",
    mimeType: "application/json",
  },
  {
    uri: "pokercrawl://table/{tableId}/hand/{agentId}",
    name: "My Hand",
    description: "Private: the requesting agent's hole cards and seat info.",
    mimeType: "application/json",
  },
  {
    uri: "pokercrawl://table/{tableId}/tasks",
    name: "Task Pool",
    description: "Community-card tasks visible on the board and their assignment status.",
    mimeType: "application/json",
  },
  {
    uri: "pokercrawl://table/{tableId}/agents",
    name: "Agent Profiles",
    description: "Public profiles of all agents at the table.",
    mimeType: "application/json",
  },
  {
    uri: "pokercrawl://table/{tableId}/pot",
    name: "Pot Info",
    description: "Main pot and side pots breakdown with pot odds.",
    mimeType: "application/json",
  },
] as const;

// ---------------------------------------------------------------------------
// Prompt definitions
// ---------------------------------------------------------------------------

const PROMPT_DEFINITIONS = [
  {
    name: "strategy",
    description:
      "Analyze the current hand and get a recommended optimal play strategy.",
    arguments: [
      { name: "tableId", description: "The table to analyze", required: true },
      { name: "agentId", description: "The agent requesting strategy advice", required: true },
    ],
  },
  {
    name: "negotiate",
    description:
      "Generate a negotiation message to influence other agents' decisions at the table.",
    arguments: [
      { name: "tableId", description: "The table", required: true },
      { name: "agentId", description: "The agent crafting the message", required: true },
      { name: "goal", description: "Optional goal (e.g. 'win code-review task')", required: false },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Zod → JSON Schema converter (handles object shapes we use). */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // We use a simplified inline converter rather than a full lib dependency
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, val] of Object.entries(shape)) {
      properties[key] = zodFieldToJson(val);
      if (!(val instanceof z.ZodOptional) && !(val instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    return { type: "object", properties, required };
  }
  return { type: "object" };
}

function zodFieldToJson(field: z.ZodTypeAny): Record<string, unknown> {
  if (field instanceof z.ZodDefault) return zodFieldToJson(field._def.innerType as z.ZodTypeAny);
  if (field instanceof z.ZodOptional) return zodFieldToJson(field._def.innerType as z.ZodTypeAny);
  if (field instanceof z.ZodString) return { type: "string", description: field.description };
  if (field instanceof z.ZodNumber) return { type: "number", description: field.description };
  if (field instanceof z.ZodBoolean) return { type: "boolean" };
  if (field instanceof z.ZodArray) return { type: "array", items: zodFieldToJson(field._def.type as z.ZodTypeAny) };
  return {};
}

function parseUri(uri: string) {
  // pokercrawl://table/{tableId}/state
  // pokercrawl://table/{tableId}/hand/{agentId}
  // pokercrawl://table/{tableId}/tasks
  // pokercrawl://table/{tableId}/agents
  // pokercrawl://table/{tableId}/pot
  const tableStateRe = /^pokercrawl:\/\/table\/([^/]+)\/state$/;
  const myHandRe = /^pokercrawl:\/\/table\/([^/]+)\/hand\/([^/]+)$/;
  const tasksRe = /^pokercrawl:\/\/table\/([^/]+)\/tasks$/;
  const agentsRe = /^pokercrawl:\/\/table\/([^/]+)\/agents$/;
  const potRe = /^pokercrawl:\/\/table\/([^/]+)\/pot$/;

  let m: RegExpMatchArray | null;
  if ((m = uri.match(tableStateRe))) return { resource: "table-state", tableId: m[1]! };
  if ((m = uri.match(myHandRe))) return { resource: "my-hand", tableId: m[1]!, agentId: m[2]! };
  if ((m = uri.match(tasksRe))) return { resource: "tasks", tableId: m[1]! };
  if ((m = uri.match(agentsRe))) return { resource: "agents", tableId: m[1]! };
  if ((m = uri.match(potRe))) return { resource: "pot", tableId: m[1]! };
  return null;
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createMcpServer(
  store: GameStore,
  bridge?: WsBridge,
  lobby?: Lobby,
  tournamentManager?: TournamentManager
): Server {
  const server = new Server(
    { name: "pokercrawl", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  // Wire bridge to store updates
  if (bridge) {
    store.onUpdate((tableId, record) => {
      bridge.broadcastStateUpdate(tableId, record);
    });
  }

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    const dispatch: Record<string, (a: typeof args) => ReturnType<typeof joinTable>> = {
      pokercrawl_join_table: (a) => joinTable(JoinTableSchema.parse(a), store),
      pokercrawl_bet:        (a) => bet(BetSchema.parse(a), store),
      pokercrawl_call:       (a) => call(CallSchema.parse(a), store),
      pokercrawl_raise:      (a) => raise(RaiseSchema.parse(a), store),
      pokercrawl_fold:       (a) => fold(FoldSchema.parse(a), store),
      pokercrawl_all_in:     (a) => allIn(AllInSchema.parse(a), store),
      pokercrawl_check:      (a) => check(CheckSchema.parse(a), store),
      pokercrawl_table_talk: (a) => tableTalk(TableTalkSchema.parse(a), store),
      pokercrawl_submit_result: (a) => submitResult(SubmitResultSchema.parse(a), store),
      // Lobby tools
      pokercrawl_create_table: (a) => {
        if (!lobby) return { success: false, message: "Lobby not available on this server" };
        return createTable(CreateTableSchema.parse(a), lobby);
      },
      pokercrawl_list_tables: (a) => {
        if (!lobby) return { success: false, message: "Lobby not available on this server" };
        return listTables(ListTablesSchema.parse(a), lobby);
      },
      pokercrawl_leave_table: (a) => {
        if (!lobby) return { success: false, message: "Lobby not available on this server" };
        return leaveTable(LeaveTableSchema.parse(a), lobby);
      },
      // Tournament tools
      pokercrawl_create_tournament: (a) => {
        if (!tournamentManager) return { success: false, message: "Tournament manager not available on this server" };
        return createTournament(CreateTournamentSchema.parse(a), tournamentManager);
      },
      pokercrawl_register_tournament: (a) => {
        if (!tournamentManager) return { success: false, message: "Tournament manager not available on this server" };
        return registerTournament(RegisterTournamentSchema.parse(a), tournamentManager);
      },
      pokercrawl_start_tournament: (a) => {
        if (!tournamentManager) return { success: false, message: "Tournament manager not available on this server" };
        return startTournament(StartTournamentSchema.parse(a), tournamentManager);
      },
      pokercrawl_tournament_status: (a) => {
        if (!tournamentManager) return { success: false, message: "Tournament manager not available on this server" };
        return tournamentStatus(TournamentStatusSchema.parse(a), tournamentManager);
      },
    };

    const handler = dispatch[name];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    try {
      const result = handler(args);
      return {
        content: [{ type: "text", text: result.message }],
        isError: !result.success,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  });

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCE_DEFINITIONS,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const parsed = parseUri(uri);

    if (!parsed) {
      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
    }

    try {
      const record = store.requireTable(parsed.tableId);
      let data: unknown;

      switch (parsed.resource) {
        case "table-state":
          data = readTableState(parsed.tableId, record);
          break;
        case "my-hand":
          data = readMyHand(parsed.tableId, parsed.agentId!, record);
          break;
        case "tasks":
          data = readTaskPool(parsed.tableId, record);
          break;
        case "agents":
          data = readAgentProfiles(parsed.tableId, record);
          break;
        case "pot":
          data = readPotInfo(parsed.tableId, record);
          break;
      }

      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new McpError(ErrorCode.InvalidRequest, msg);
    }
  });

  // -------------------------------------------------------------------------
  // Prompts
  // -------------------------------------------------------------------------

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPT_DEFINITIONS,
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const tableId = String(args["tableId"] ?? "");
    const agentId = String(args["agentId"] ?? "");

    try {
      const record = store.requireTable(tableId);
      let text: string;

      if (name === "strategy") {
        text = buildStrategyPrompt({ tableId, agentId }, record);
      } else if (name === "negotiate") {
        const negotiateArgs = {
          tableId,
          agentId,
          ...(args["goal"] ? { goal: String(args["goal"]) } : {}),
        };
        text = buildNegotiatePrompt(negotiateArgs, record);
      } else {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown prompt: ${name}`);
      }

      return {
        description: PROMPT_DEFINITIONS.find((p) => p.name === name)?.description ?? "",
        messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
      };
    } catch (e) {
      if (e instanceof McpError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new McpError(ErrorCode.InvalidRequest, msg);
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Connect to stdio transport
// ---------------------------------------------------------------------------

export async function runStdioServer(store: GameStore, bridge?: WsBridge): Promise<void> {
  const server = createMcpServer(store, bridge);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[PokerCrawl] MCP server running on stdio");
}

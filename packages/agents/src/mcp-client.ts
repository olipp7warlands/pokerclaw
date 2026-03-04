/**
 * PokerCrawl MCP Client
 *
 * Direct client that wraps the mcp-server tool functions.
 * Provides the same interface that a real MCP network client would,
 * but works within the same process (no network hop required).
 *
 * In Phase 4 (remote deployment), this would be replaced with a
 * full @modelcontextprotocol/sdk Client connecting over stdio or HTTP.
 */

import {
  bet,
  call,
  check,
  fold,
  allIn,
  raise,
  tableTalk,
  joinTable,
  readTableState,
  readMyHand,
  readPotInfo,
  readAgentProfiles,
  readTaskPool,
  type GameStore,
} from "@pokercrawl/mcp-server";

export type ToolResult = { success: boolean; message: string; data?: Record<string, unknown> };

export type TableStateView = ReturnType<typeof readTableState>;
export type MyHandView = ReturnType<typeof readMyHand>;
export type PotView = ReturnType<typeof readPotInfo>;
export type ProfilesView = ReturnType<typeof readAgentProfiles>;
export type TaskPoolView = ReturnType<typeof readTaskPool>;

// ---------------------------------------------------------------------------
// Direct client (same-process)
// ---------------------------------------------------------------------------

export class PokerCrawlDirectClient {
  constructor(
    private readonly store: GameStore,
    private readonly tableId: string,
    private readonly agentId: string
  ) {}

  // -------------------------------------------------------------------------
  // Actions (write)
  // -------------------------------------------------------------------------

  joinTable(capabilities: string[] = [], tokens = 1000): ToolResult {
    return joinTable(
      { tableId: this.tableId, agentId: this.agentId, capabilities, initial_tokens: tokens },
      this.store
    );
  }

  bet(amount: number, confidenceReason?: string): ToolResult {
    return bet(
      { tableId: this.tableId, agentId: this.agentId, amount, confidence_reason: confidenceReason },
      this.store
    );
  }

  call(): ToolResult {
    return call({ tableId: this.tableId, agentId: this.agentId }, this.store);
  }

  raise(amount: number): ToolResult {
    return raise({ tableId: this.tableId, agentId: this.agentId, amount }, this.store);
  }

  fold(): ToolResult {
    return fold({ tableId: this.tableId, agentId: this.agentId }, this.store);
  }

  allIn(): ToolResult {
    return allIn({ tableId: this.tableId, agentId: this.agentId }, this.store);
  }

  check(): ToolResult {
    return check({ tableId: this.tableId, agentId: this.agentId }, this.store);
  }

  tableTalk(message: string): ToolResult {
    return tableTalk({ tableId: this.tableId, agentId: this.agentId, message }, this.store);
  }

  // -------------------------------------------------------------------------
  // Resources (read)
  // -------------------------------------------------------------------------

  getTableState(): TableStateView {
    return readTableState(this.tableId, this.store.requireTable(this.tableId));
  }

  getMyHand(): MyHandView {
    return readMyHand(this.tableId, this.agentId, this.store.requireTable(this.tableId));
  }

  getPotInfo(): PotView {
    return readPotInfo(this.tableId, this.store.requireTable(this.tableId));
  }

  getAgentProfiles(): ProfilesView {
    return readAgentProfiles(this.tableId, this.store.requireTable(this.tableId));
  }

  getTaskPool(): TaskPoolView {
    return readTaskPool(this.tableId, this.store.requireTable(this.tableId));
  }
}

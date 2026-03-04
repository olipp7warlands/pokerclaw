#!/usr/bin/env node
/**
 * PokerCrawl Play Server
 *
 * Starts a WebSocket bridge on port 3001 and runs a continuous
 * AI-agent tournament that broadcasts state to the UI.
 *
 * Run via: npm run play (from repo root)
 */

import {
  GameStore,
  WsBridge,
} from "@pokercrawl/mcp-server";

import {
  AgentOrchestrator,
  AggressiveBot,
  BlufferBot,
  CalculatedBot,
  ConservativeBot,
  RandomBot,
} from "@pokercrawl/agents";

const TABLE_ID = "main-table";
const WS_PORT  = 3001;

// ---------------------------------------------------------------------------
// Start WebSocket bridge
// ---------------------------------------------------------------------------

const bridge = new WsBridge(WS_PORT);

await bridge.start();
console.log(`\n🃏  PokerCrawl Play Server`);
console.log(`   WebSocket: ws://localhost:${WS_PORT}`);
console.log(`   Waiting for UI to connect…\n`);

// ---------------------------------------------------------------------------
// Game loop — runs forever, restarting after each tournament
// ---------------------------------------------------------------------------

async function runSession(sessionNumber) {
  console.log(`── Session ${sessionNumber} ─────────────────────────`);

  // Fresh store each session so agents can be re-registered cleanly
  const store = new GameStore();

  const orch = new AgentOrchestrator(store, {
    tableId:        TABLE_ID,
    smallBlind:     5,
    bigBlind:       10,
    startingTokens: 500,
  });

  orch.registerAgent(new AggressiveBot ({ id: "shark", tableId: TABLE_ID }));
  orch.registerAgent(new BlufferBot    ({ id: "mago",  tableId: TABLE_ID }));
  orch.registerAgent(new CalculatedBot ({ id: "reloj", tableId: TABLE_ID }));
  orch.registerAgent(new ConservativeBot({ id: "rock", tableId: TABLE_ID }));
  orch.registerAgent(new RandomBot     ({ id: "caos",  tableId: TABLE_ID }));

  // Broadcast state after each agent decision
  orch.on("decision", ({ agentId, decision }) => {
    const record = store.getTable(TABLE_ID);
    if (record) {
      bridge.broadcastFullSnapshot(TABLE_ID, record, {
        agentId,
        type: decision.action,
        amount: decision.amount ?? 0,
      });
    }

    const amt = decision.amount !== undefined ? ` ${decision.amount}` : "";
    console.log(`  ${agentId.padEnd(8)} → ${decision.action}${amt}`);
  });

  // Broadcast chat messages
  orch.on("chat", ({ agentId, message }) => {
    bridge.broadcastChat(TABLE_ID, agentId, message);
    console.log(`  💬 ${agentId}: "${message}"`);
  });

  // Broadcast after each hand completes
  orch.on("hand_complete", (result) => {
    const record = store.getTable(TABLE_ID);
    if (record) bridge.broadcastFullSnapshot(TABLE_ID, record);

    const wins = result.winners.map((w) => `${w.agentId}+${w.amountWon}`).join(", ");
    console.log(`  ✅ Hand #${result.handNumber} → ${wins}\n`);
  });

  const result = await orch.playTournament(999, { decisionTimeoutMs: 15_000 });

  console.log("\n  Final stacks:");
  for (const [id, stack] of Object.entries(result.finalStacks)) {
    const elim = result.eliminated.includes(id) ? " [out]" : "";
    console.log(`    ${id.padEnd(8)} ${String(stack).padStart(5)} tokens${elim}`);
  }
  console.log("");
}

let session = 1;
while (true) {
  await runSession(session++).catch((e) =>
    console.error("Session error:", e?.message ?? e)
  );
  // Short pause between sessions
  await new Promise((r) => setTimeout(r, 3_000));
}

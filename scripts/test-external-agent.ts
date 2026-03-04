/**
 * test-external-agent.ts
 *
 * Self-contained integration test for the WsAgentBridge external-agent protocol.
 *
 * What it does:
 *  1. Spins up an ephemeral WsAgentBridge server (port 0 → OS-assigned).
 *  2. Registers two agents via POST /api/agents/register.
 *  3. Verifies GET /api/agents/online before + after connection.
 *  4. Connects both agents via WebSocket with Bearer token auth.
 *  5. TestAgent calls list_tables → join_table.
 *  6. FolderBot calls join_table (second player → auto-starts hand).
 *  7. TestAgent responds to each `your_turn` with a random valid action.
 *  8. FolderBot always folds.
 *  9. After TARGET_HANDS hand_complete events, closes connections + exits.
 *
 * Run with:
 *   npx tsx scripts/test-external-agent.ts
 */

import { WebSocket } from "ws";
import { GameStore, WsAgentBridge } from "@pokercrawl/mcp-server";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TABLE_ID    = "test-table";
const TARGET_HANDS = 3;
const BIG_BLIND   = 10;  // default table blind
const TIMEOUT_MS  = 30_000;

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const C = {
  reset: "\x1b[0m",
  bold:  "\x1b[1m",
  dim:   "\x1b[2m",
  gold:  "\x1b[33m",
  green: "\x1b[32m",
  red:   "\x1b[31m",
};

function log(prefix: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${C.dim}${ts} [${prefix}]${C.reset} ${msg}`);
}

function send(ws: WebSocket, cmd: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(cmd));
  }
}

// ---------------------------------------------------------------------------
// 1. Start server
// ---------------------------------------------------------------------------

log("server", "Starting ephemeral WsAgentBridge…");

const store  = new GameStore();
const bridge = new WsAgentBridge(store, 0); // port 0 → OS assigns free port
await bridge.start();

const PORT = bridge.port;
const BASE = `http://localhost:${PORT}`;

log("server", `Listening on port ${PORT}`);
log("server", `Skill doc: ${BASE}/skill.md`);

// Auto-restart hands after settlement so multiple hands can be played
store.onUpdate((tableId, record) => {
  if (record.state.phase === "settlement") {
    setTimeout(() => { store.maybeRestartHand(tableId); }, 200);
  }
});

// ---------------------------------------------------------------------------
// 2. Register two agents via HTTP
// ---------------------------------------------------------------------------

async function registerAgent(
  name: string,
  type: string,
  capabilities: string[],
): Promise<{ agentId: string; token: string; wsUrl: string }> {
  const res = await fetch(`${BASE}/api/agents/register`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ name, type, capabilities }),
  });
  if (!res.ok) throw new Error(`Register failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ agentId: string; token: string; wsUrl: string }>;
}

const testReg   = await registerAgent("TestAgent", "test",   ["code", "analysis"]);
const folderReg = await registerAgent("FolderBot", "simple", []);

log("register", `TestAgent  agentId=${testReg.agentId}`);
log("register", `FolderBot  agentId=${folderReg.agentId}`);

// ---------------------------------------------------------------------------
// 3. Verify GET /api/agents/online (0 online before connecting)
// ---------------------------------------------------------------------------

async function getOnline(): Promise<Array<{ agentId: string; name: string }>> {
  const res = await fetch(`${BASE}/api/agents/online`);
  return res.json() as Promise<Array<{ agentId: string; name: string }>>;
}

const beforeOnline = await getOnline();
log("online", `Before connect: ${beforeOnline.length} online  (expected 0)`);
if (beforeOnline.length !== 0) {
  log("online", `${C.red}WARNING: expected 0 but got ${beforeOnline.length}${C.reset}`);
}

// ---------------------------------------------------------------------------
// 4. Connect both agents via WebSocket
// ---------------------------------------------------------------------------

const ws1 = new WebSocket(testReg.wsUrl,   { headers: { Authorization: `Bearer ${testReg.token}` } });
const ws2 = new WebSocket(folderReg.wsUrl, { headers: { Authorization: `Bearer ${folderReg.token}` } });

// Track hands completed (only count on TestAgent side to avoid double-counting)
let handsCompleted = 0;
let cleaning = false;

function cleanup(): void {
  if (cleaning) return;
  cleaning = true;
  ws1.close();
  ws2.close();
  bridge.stop().then(() => {
    log("server", "Stopped.");
    process.exit(0);
  }).catch(() => process.exit(0));
}

// Safety timeout
const safetyTimer = setTimeout(() => {
  log("test", `${C.red}Safety timeout after ${TIMEOUT_MS / 1000}s — exiting${C.reset}`);
  cleanup();
}, TIMEOUT_MS);

// ---------------------------------------------------------------------------
// 5-8. Message handler factory
// ---------------------------------------------------------------------------

function attachHandler(ws: WebSocket, agentId: string, alwaysFold: boolean): void {
  ws.on("error", (err) => {
    log(agentId, `${C.red}WebSocket error: ${err.message}${C.reset}`);
  });

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      log(agentId, `${C.red}Non-JSON message: ${raw.toString().slice(0, 80)}${C.reset}`);
      return;
    }

    const event = msg["event"] as string | undefined;

    switch (event) {
      // ── Connected ─────────────────────────────────────────────────────────
      case "connected":
        log(agentId, `${C.green}connected ✓${C.reset}`);
        break;

      // ── Tables list ───────────────────────────────────────────────────────
      case "tables_list": {
        const tables = (msg["tables"] ?? []) as Array<{ tableId: string; phase: string }>;
        const summary = tables.length
          ? tables.map((t) => `${t.tableId}(${t.phase})`).join(", ")
          : "(none)";
        log(agentId, `tables_list → [${summary}]`);
        break;
      }

      // ── Action result ─────────────────────────────────────────────────────
      case "action_result": {
        const ok  = msg["success"] === true;
        const sym = ok ? "✓" : `${C.red}✗${C.reset}`;
        log(agentId, `action_result ${sym} — ${msg["message"]}`);
        break;
      }

      // ── Game update (suppress verbose output) ─────────────────────────────
      case "game_update":
        break;

      // ── Your turn ─────────────────────────────────────────────────────────
      case "your_turn": {
        const validActions = (msg["validActions"] ?? []) as string[];
        const phase        = msg["phase"] as string;
        const callAmount   = msg["callAmount"] as number;
        const myStack      = msg["myStack"] as number;
        const myCurrentBet = msg["myCurrentBet"] as number;
        const currentBet   = msg["currentBet"] as number;

        let action: string;
        let amount: number | undefined;

        if (alwaysFold) {
          action = validActions.includes("fold") ? "fold" : validActions[0]!;
        } else {
          // Pick a random valid action
          action = validActions[Math.floor(Math.random() * validActions.length)]!;

          if (action === "bet") {
            const minBet = BIG_BLIND;
            const maxBet = Math.min(myStack, minBet + 50);
            amount = minBet + Math.floor(Math.random() * Math.max(1, maxBet - minBet + 1));
          } else if (action === "raise") {
            const minRaiseTo = currentBet + Math.max(BIG_BLIND, callAmount);
            const maxRaiseTo = myCurrentBet + myStack; // engine rule
            if (minRaiseTo <= maxRaiseTo) {
              amount = minRaiseTo + Math.floor(Math.random() * Math.max(1, maxRaiseTo - minRaiseTo + 1));
              amount = Math.min(amount, maxRaiseTo);
            } else {
              // Can't raise legally — fall back to call or fold
              action = validActions.includes("call") ? "call" : "fold";
            }
          }
        }

        const amtStr = amount !== undefined ? ` ${amount}` : "";
        log(agentId, `${C.gold}your_turn${C.reset} [${phase}] → ${action}${amtStr}`);

        const cmd: Record<string, unknown> = { action, tableId: TABLE_ID };
        if (amount !== undefined) cmd["amount"] = amount;
        send(ws, cmd);
        break;
      }

      // ── Hand complete ─────────────────────────────────────────────────────
      case "hand_complete": {
        const winners = (msg["winners"] ?? []) as Array<{ agentId: string; amountWon: number }>;
        const winStr  = winners.map((w) => `${w.agentId}+${w.amountWon}`).join(", ");
        log(agentId, `${C.green}hand_complete${C.reset} #${msg["handNumber"]} → ${winStr || "(none)"}`);

        // Count on TestAgent side only
        if (!alwaysFold) {
          handsCompleted++;
          log("test", `Hand ${handsCompleted}/${TARGET_HANDS} complete`);
          if (handsCompleted >= TARGET_HANDS) {
            clearTimeout(safetyTimer);
            log("test", `${C.green}${C.bold}✓ All ${TARGET_HANDS} hands played successfully!${C.reset}`);
            cleanup();
          }
        }
        break;
      }

      // ── Error ─────────────────────────────────────────────────────────────
      case "error":
        log(agentId, `${C.red}error: ${msg["message"]}${C.reset}`);
        break;

      default:
        if (event) log(agentId, `unknown event: ${event}`);
    }
  });
}

// Attach handlers BEFORE waiting for open (so connected event isn't missed)
attachHandler(ws1, testReg.agentId,   false);
attachHandler(ws2, folderReg.agentId, true);

// ---------------------------------------------------------------------------
// Wait for both sockets to open
// ---------------------------------------------------------------------------

await new Promise<void>((resolve) => {
  let opened = 0;
  const onOpen = (): void => { if (++opened === 2) resolve(); };
  ws1.on("open", onOpen);
  ws2.on("open", onOpen);
});

log("ws", "Both agents connected via WebSocket");

// ---------------------------------------------------------------------------
// 3b. Verify online after connect
// ---------------------------------------------------------------------------

// Small delay to let the server process connections
await new Promise<void>((r) => setTimeout(r, 50));

const afterOnline = await getOnline();
log("online", `After connect:  ${afterOnline.length} online  (expected 2)`);
for (const a of afterOnline) {
  log("online", `  → ${a.agentId}  (${a.name})`);
}
if (afterOnline.length !== 2) {
  log("online", `${C.red}WARNING: expected 2 but got ${afterOnline.length}${C.reset}`);
}

// ---------------------------------------------------------------------------
// 5-6. Send commands
// ---------------------------------------------------------------------------

// TestAgent lists tables first
send(ws1, { action: "list_tables" });

// Small delay so list_tables response logs before join logs
await new Promise<void>((r) => setTimeout(r, 100));

// Both join — second join triggers auto-start (minPlayers = 2)
send(ws1, { action: "join_table", tableId: TABLE_ID, tokens: 1000 });
send(ws2, { action: "join_table", tableId: TABLE_ID, tokens: 1000 });

log("join", `Both agents sent join_table "${TABLE_ID}" — game will auto-start`);

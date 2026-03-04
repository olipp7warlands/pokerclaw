/**
 * PokerCrawl — Game Server
 *
 * Usage:
 *   tsx scripts/start.ts                          # dev: 5 bots, infinite sessions
 *   tsx scripts/start.ts --agents=4 --hands=10   # 4 bots, 10 hands, then exit
 *   tsx scripts/start.ts --agents=4 --hands=20 --speed=5
 *   tsx scripts/start.ts --claude --openai --hands=5
 *   tsx scripts/start.ts --tournament --bots=8
 *   tsx scripts/start.ts --lobby
 */

import { GameStore, WsBridge, WsAgentBridge } from "@pokercrawl/mcp-server";
import {
  BaseAgent,
  AgentOrchestrator,
  AggressiveBot,
  BlufferBot,
  CalculatedBot,
  ConservativeBot,
  RandomBot,
  ClaudeAgent,
  OpenAIAgent,
} from "@pokercrawl/agents";

// ─── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const LOBBY       = flag("lobby");
const TOURNAMENT  = flag("tournament");
const WITH_CLAUDE = flag("claude");
const WITH_OPENAI = flag("openai");

const handsArg = arg("hands");
const N_AGENTS = parseInt(arg("agents") ?? arg("bots") ?? "5", 10);
const N_HANDS  = handsArg !== undefined ? parseInt(handsArg, 10) : 9_999;
const SPEED    = parseFloat(arg("speed") ?? "1");

// Finite mode: run one session then exit
// Infinite mode: loop sessions (dev / default)
const FINITE = handsArg !== undefined || TOURNAMENT;

const TABLE_ID = "main";
const WS_PORT  = Number(process.env["WS_PORT"]  ?? 3001);
const EXT_PORT = Number(process.env["EXT_PORT"] ?? 3002);

// ─── ANSI ─────────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold:  "\x1b[1m",
  dim:   "\x1b[2m",
  gold:  "\x1b[33m",
  red:   "\x1b[31m",
};

// ─── Agent roster ─────────────────────────────────────────────────────────────

const BOT_CLASSES = [
  AggressiveBot,
  ConservativeBot,
  BlufferBot,
  RandomBot,
  CalculatedBot,
] as const;

const BOT_IDS = ["shark", "rock", "mago", "caos", "reloj", "zeus", "ares", "luna"];

function buildRoster(n: number): BaseAgent[] {
  const roster: BaseAgent[] = [];

  if (WITH_CLAUDE) {
    roster.push(new ClaudeAgent({ id: "claude", tableId: TABLE_ID }));
    n--;
  }
  if (WITH_OPENAI) {
    roster.push(new OpenAIAgent({ id: "openai", tableId: TABLE_ID }));
    n--;
  }

  for (let i = 0; i < Math.max(0, n); i++) {
    const BotClass = BOT_CLASSES[i % BOT_CLASSES.length]!;
    const id       = BOT_IDS[roster.length] ?? `bot-${roster.length}`;
    roster.push(new BotClass({ id, tableId: TABLE_ID }));
  }

  return roster;
}

// ─── Lobby mode ───────────────────────────────────────────────────────────────

if (LOBBY) {
  const store = new GameStore();
  store.createTable(TABLE_ID);

  const ext = new WsAgentBridge(store, EXT_PORT);
  await ext.start();

  console.log(`\n${C.gold}${C.bold}🃏  PokerCrawl Lobby${C.reset}`);
  console.log(`   Agent WS  : ws://localhost:${EXT_PORT}`);
  console.log(`   Skill doc : http://localhost:${EXT_PORT}/skill.md`);
  console.log(`\n${C.dim}   Waiting for external agents to connect…${C.reset}\n`);

  // Keep alive — external agents drive the game via WebSocket commands
  await new Promise<void>(() => { /* intentionally never resolves */ });
}

// ─── Play mode ────────────────────────────────────────────────────────────────

const bridge = new WsBridge(WS_PORT);
await bridge.start();

const modeLabel = TOURNAMENT
  ? `tournament · ${N_AGENTS} bots`
  : `${N_AGENTS} agents · ${handsArg !== undefined ? `${N_HANDS} hands` : "∞"} · ${SPEED}x`;

console.log(`\n${C.gold}${C.bold}🃏  PokerCrawl${C.reset} [${modeLabel}]`);
console.log(`   WebSocket : ws://localhost:${WS_PORT}`);
console.log(`   UI        : http://localhost:5173  (npm run ui)\n`);

// ─── Session runner ───────────────────────────────────────────────────────────

async function runSession(n: number): Promise<void> {
  console.log(`── Session ${n} ─────────────────────────────────────`);

  const store = new GameStore();
  const orch  = new AgentOrchestrator(store, {
    tableId:        TABLE_ID,
    smallBlind:     5,
    bigBlind:       10,
    startingTokens: 500,
  });

  for (const agent of buildRoster(N_AGENTS)) {
    orch.registerAgent(agent);
  }

  orch.on("decision", ({ agentId, decision }) => {
    const record = store.getTable(TABLE_ID);
    if (record) {
      bridge.broadcastFullSnapshot(TABLE_ID, record, {
        agentId,
        type:   decision.action,
        amount: decision.amount ?? 0,
      });
    }
    const amt = decision.amount !== undefined ? ` ${decision.amount}` : "";
    console.log(`  ${agentId.padEnd(8)} → ${decision.action}${amt}`);
  });

  orch.on("chat", ({ agentId, message }) => {
    bridge.broadcastChat(TABLE_ID, agentId, message);
    console.log(`  💬 ${agentId}: "${message}"`);
  });

  orch.on("hand_complete", (result) => {
    const record = store.getTable(TABLE_ID);
    if (record) bridge.broadcastFullSnapshot(TABLE_ID, record);
    const wins = result.winners.map((w) => `${w.agentId}+${w.amountWon}`).join(", ");
    console.log(`  ✅ Hand #${result.handNumber} → ${wins}\n`);
  });

  const final = await orch.playTournament(N_HANDS, {
    decisionTimeoutMs: Math.round(15_000 / SPEED),
  });

  console.log(`\n  Final stacks:`);
  for (const [id, stack] of Object.entries(final.finalStacks)) {
    const mark = final.eliminated.includes(id) ? " [out]" : "";
    console.log(`    ${id.padEnd(8)} ${String(stack).padStart(5)} tokens${mark}`);
  }
  console.log();
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const GAP_MS = Math.max(500, Math.round(3_000 / SPEED));

if (FINITE) {
  await runSession(1).catch((e: unknown) =>
    console.error(`${C.red}Error:${C.reset}`, e instanceof Error ? e.message : e)
  );
} else {
  let s = 1;
  for (;;) {
    await runSession(s++).catch((e: unknown) =>
      console.error(`${C.red}Session error:${C.reset}`, e instanceof Error ? e.message : e)
    );
    await new Promise<void>((r) => setTimeout(r, GAP_MS));
  }
}

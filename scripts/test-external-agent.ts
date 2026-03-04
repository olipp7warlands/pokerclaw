/**
 * test-external-agent.ts
 *
 * Tests the HTTP long-polling transport for external agents.
 *
 * Usage:
 *   tsx scripts/test-external-agent.ts
 *   tsx scripts/test-external-agent.ts --host https://pokercrawl.up.railway.app --hands 3
 */

const args  = process.argv.slice(2);
const idx   = (flag: string) => args.indexOf(flag);
const HOST  = idx("--host")  >= 0 ? args[idx("--host")  + 1]! : "http://localhost:3000";
const HANDS = idx("--hands") >= 0 ? Number(args[idx("--hands") + 1]) : 5;
const NAME  = "TestBot-HTTP";

function log(msg: string, data?: unknown): void {
  const ts = new Date().toISOString();
  if (data !== undefined) console.log(`[${ts}] ${msg}`, JSON.stringify(data, null, 2));
  else                    console.log(`[${ts}] ${msg}`);
}

// 1. Register
log(`Registering "${NAME}" at ${HOST}`);
const regRes = await fetch(`${HOST}/api/agents/register`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: NAME, type: "test", capabilities: ["code"] }),
});
if (!regRes.ok) { console.error("Registration failed:", await regRes.text()); process.exit(1); }
const { agentId, token } = await regRes.json() as { agentId: string; token: string };
log(`Registered — agentId=${agentId}`);

// 2. Connect
log("Connecting via HTTP polling...");
const connRes = await fetch(`${HOST}/api/agents/connect`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token }),
});
if (!connRes.ok) { console.error("Connect failed:", await connRes.text()); process.exit(1); }
const { sessionId, pollUrl, sendUrl } = await connRes.json() as {
  sessionId: string; pollUrl: string; sendUrl: string;
};
log(`Connected — session=${sessionId}`);

// Helper
async function sendAction(action: string, extra: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${HOST}${sendUrl}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  return res.json();
}

// 3. Join table
log('Joining table "main"...');
const joinResult = await sendAction("join_table", { tableId: "main", tokens: 1000 });
log("join_table →", joinResult);

// 4. Poll loop
let handsCompleted = 0;
log(`Polling for events (target: ${HANDS} hands)...`);

while (handsCompleted < HANDS) {
  let pollRes: Response;
  try {
    pollRes = await fetch(`${HOST}${pollUrl}`, { signal: AbortSignal.timeout(35_000) });
  } catch (e) {
    log(`Poll error: ${String(e)} — retrying`);
    await new Promise((r) => setTimeout(r, 1_000));
    continue;
  }

  if (!pollRes.ok) {
    log(`Poll HTTP ${pollRes.status} — retrying`);
    await new Promise((r) => setTimeout(r, 1_000));
    continue;
  }

  const { events } = await pollRes.json() as { events: Array<Record<string, unknown>> };
  for (const ev of events) {
    switch (ev["event"] as string) {
      case "your_turn": {
        const valid = (ev["validActions"] as string[]) ?? [];
        const action = valid.includes("check") ? "check" : "call";
        log(`your_turn phase=${ev["phase"]} stack=${ev["myStack"]} → ${action}`);
        await sendAction(action, { tableId: ev["tableId"] as string });
        break;
      }
      case "hand_complete": {
        handsCompleted++;
        const w = (ev["winners"] as Array<{ agentId: string; amountWon: number }>) ?? [];
        log(`hand_complete ${handsCompleted}/${HANDS} — ${w.map((x) => `${x.agentId}+${x.amountWon}`).join(", ")}`);
        break;
      }
      case "game_update": break; // suppress noise
      default: log(`event: ${ev["event"] as string}`, ev);
    }
  }
}

log(`Done — ${handsCompleted} hands completed.`);
process.exit(0);

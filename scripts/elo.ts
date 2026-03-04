/**
 * PokerCrawl — ELO standings
 *
 * Runs a quick calibration session and prints the ELO leaderboard.
 *
 * Usage:
 *   tsx scripts/elo.ts
 *   tsx scripts/elo.ts --hands=500 --bots=8
 */

import { trainBots } from "@pokercrawl/training";
import type { TrainingReport, AgentRating } from "@pokercrawl/training";

// ─── ANSI ────────────────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  gold:   "\x1b[33m",
  cyan:   "\x1b[36m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  gray:   "\x1b[90m",
};

const MEDALS = ["🥇", "🥈", "🥉"];

// ─── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const hands = parseInt(getArg("hands") ?? "300", 10);
const bots  = parseInt(getArg("bots")  ?? "6",   10);

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${C.gold}${C.bold}PokerCrawl ELO Calibration${C.reset}`);
  console.log(`${C.dim}  ${hands} hands · ${bots} bots · calculating…${C.reset}\n`);

  const report: TrainingReport = await trainBots(hands, {
    bots,
    verbose: false,
  });

  const LINE = "─".repeat(52);

  console.log(`${C.gold}${C.bold}${LINE}${C.reset}`);
  console.log(
    `  ${" ".repeat(4)}` +
    `${"AGENT".padEnd(12)}` +
    `${"ELO".padStart(6)}` +
    `${"DELTA".padStart(9)}` +
    `${"W/L".padStart(8)}`
  );
  console.log(`${LINE}`);

  for (let i = 0; i < report.eloRankings.length; i++) {
    const r: AgentRating = report.eloRankings[i]!;
    const diff  = Math.round(r.rating - 1200);
    const sign  = diff >= 0 ? "+" : "";
    const col   = diff > 50 ? C.green : diff < -50 ? C.red : C.gray;
    const medal = MEDALS[i] ?? `  ${i + 1}.`;
    const stats = report.agentStats[r.agentId];
    const won   = stats?.handsWon    ?? 0;
    const total = stats?.handsPlayed ?? 0;
    const wl    = total > 0 ? `${won}/${total - won}` : "-";

    console.log(
      `  ${medal}  ` +
      `${C.bold}${r.agentId.padEnd(12)}${C.reset}` +
      `${C.gold}${String(Math.round(r.rating)).padStart(6)}${C.reset}` +
      `${col}${(`${sign}${diff}`).padStart(9)}${C.reset}` +
      `${C.cyan}${wl.padStart(8)}${C.reset}`
    );
  }

  console.log(`${LINE}`);
  const secs = (report.durationMs / 1000).toFixed(1);
  console.log(`${C.dim}  ${report.handsPlayed} hands · ${secs}s${C.reset}\n`);
}

main().catch((err) => {
  console.error(C.red + "Error: " + C.reset, err instanceof Error ? err.message : err);
  process.exit(1);
});

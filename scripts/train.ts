/**
 * PokerCrawl — Live Training Dashboard
 *
 * Usage:
 *   tsx scripts/train.ts [options]
 *   tsx scripts/train.ts --bots=6 --hands=5000
 *   tsx scripts/train.ts --bots=8 --hands=20000 --tournament
 *   tsx scripts/train.ts --bots=6 --hands=50000 --silent
 */

import { trainBots } from "@pokercrawl/training";
import type { TrainingProgress, TrainingReport } from "@pokercrawl/training";
import type { AgentPersonality } from "@pokercrawl/agents";

// ─── ANSI ─────────────────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  gold:   "\x1b[33m",
  cyan:   "\x1b[36m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  blue:   "\x1b[34m",
  gray:   "\x1b[90m",
  white:  "\x1b[97m",
};

// ─── Bot metadata ─────────────────────────────────────────────────────────────

const BOT_META: Record<string, { emoji: string; name: string }> = {
  shark:  { emoji: "🦈", name: "El Tiburón" },
  rock:   { emoji: "🪨", name: "La Roca"    },
  mago:   { emoji: "🎩", name: "El Mago"    },
  caos:   { emoji: "🎲", name: "El Caos"    },
  reloj:  { emoji: "⏱️", name: "El Reloj"   },
  shark2: { emoji: "🦈", name: "Tiburón 2"  },
};

function meta(id: string): { emoji: string; name: string } {
  return BOT_META[id] ?? { emoji: "🤖", name: id };
}

// ─── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const tournament  = args.includes("--tournament");
const silent      = args.includes("--silent");
const bots        = parseInt(getArg("bots")  ?? (tournament ? "8" : "6"), 10);
const hands       = parseInt(getArg("hands") ?? "5000", 10);
const savePath    = tournament ? "./data/tournament.json" : (getArg("save") ?? null);

// ─── Live dashboard state ─────────────────────────────────────────────────────

let linesDrawn = 0;

function clearDashboard(): void {
  if (linesDrawn > 0) {
    // Move cursor up to start of dashboard, then erase to end of screen
    process.stdout.write(`\x1b[${linesDrawn}F\x1b[0J`);
  }
}

function printLines(lines: string[]): void {
  clearDashboard();
  const out = lines.join("\n") + "\n";
  process.stdout.write(out);
  linesDrawn = lines.length;
}

// ─── Progress rendering ───────────────────────────────────────────────────────

function progressBar(done: number, total: number, width = 24): string {
  const pct   = total > 0 ? done / total : 0;
  const filled = Math.round(pct * width);
  const bar   = "█".repeat(filled) + "░".repeat(width - filled);
  const pctStr = `${Math.round(pct * 100)}%`;
  return `${C.gold}[${bar}]${C.reset} ${C.bold}${pctStr}${C.reset}`;
}

function trendEmoji(delta: number): string {
  if (delta > 80)  return "📈";
  if (delta < -80) return "📉";
  return "📊";
}

function learnedNote(
  id: string,
  initial: Record<string, AgentPersonality>,
  current: Record<string, AgentPersonality>,
): string {
  const init = initial[id];
  const curr = current[id];
  if (!init || !curr) return "calibrating…";

  const notes: string[] = [];
  const d = (k: keyof AgentPersonality) => (curr[k] as number) - (init[k] as number);

  if (d("aggression")     >  0.08) notes.push("raising aggression");
  if (d("aggression")     < -0.08) notes.push("tightening up");
  if (d("bluffFrequency") >  0.06) notes.push("bluffing more");
  if (d("bluffFrequency") < -0.06) notes.push("cutting bluffs");
  if (d("tiltResistance") >  0.06) notes.push("more disciplined");
  if (d("riskTolerance")  >  0.06) notes.push("taking bigger risks");
  if (d("riskTolerance")  < -0.06) notes.push("more conservative");

  return notes.length > 0 ? notes.join(", ") : "holding steady";
}

function renderDashboard(p: TrainingProgress): void {
  const elapsed = (p.elapsedMs / 1000).toFixed(1);
  const mode    = tournament ? " [TOURNAMENT]" : "";
  const WIDTH   = 58;
  const SEP     = "═".repeat(WIDTH);

  const lines: string[] = [];

  // Header
  lines.push(`${C.gold}${C.bold}🎓 PokerCrawl Training${mode} — ${hands.toLocaleString()} hands${C.reset}`);
  lines.push(SEP);

  // Progress bar
  lines.push(`${C.dim}Progress:${C.reset} ${progressBar(p.handsPlayed, p.totalHands)}  (${p.handsPlayed.toLocaleString()}/${p.totalHands.toLocaleString()} hands)`);
  lines.push("");

  // Live ELO ratings
  lines.push(`${C.bold}${C.cyan}Live ELO Ratings:${C.reset}`);
  for (let i = 0; i < p.eloRankings.length; i++) {
    const r    = p.eloRankings[i]!;
    const diff = Math.round(r.rating - 1200);
    const sign = diff >= 0 ? "+" : "";
    const col  = diff > 0 ? C.green : diff < 0 ? C.red : C.gray;
    const { emoji, name } = meta(r.agentId);
    const trend = trendEmoji(diff);
    const note  = learnedNote(r.agentId, p.initialPersonalities, p.currentPersonalities);
    const rank  = `${i + 1}.`;
    const nameField = `${emoji} ${name}`.padEnd(16);
    const eloField  = `${Math.round(r.rating)}`.padStart(4);
    const dField    = `(${sign}${diff})`.padStart(7);

    lines.push(
      `  ${C.bold}${rank.padEnd(3)}${C.reset}` +
      `${nameField}` +
      `${C.gold}${eloField}${C.reset}` +
      ` ${col}${dField}${C.reset}` +
      ` ${trend}` +
      `${C.dim} — ${note}${C.reset}`
    );
  }

  // Highlights
  lines.push("");
  lines.push(`${C.bold}${C.cyan}Highlights:${C.reset}`);

  // Biggest pot
  if (p.biggestPot !== null) {
    const bp     = p.biggestPot;
    const winner = meta(bp.winnerId);
    const loser  = meta(bp.loserId);
    lines.push(
      `  ${C.gold}💰 Biggest pot:${C.reset}` +
      ` Hand #${bp.handNumber.toLocaleString()} — ${winner.emoji} vs ${loser.emoji}` +
      `  ${C.bold}${bp.amount}${C.reset} tokens` +
      ` (${winner.emoji} won)`
    );
  } else {
    lines.push(`  ${C.dim}💰 Biggest pot: no showdown yet${C.reset}`);
  }

  // Most improved (highest positive ELO delta)
  const sorted = [...p.eloRankings].sort((a, b) => b.rating - a.rating);
  const mostImproved = sorted[0];
  if (mostImproved) {
    const { emoji, name } = meta(mostImproved.agentId);
    const initP = p.initialPersonalities[mostImproved.agentId];
    const currP = p.currentPersonalities[mostImproved.agentId];
    const aggInit = initP ? Math.round(initP.aggression * 100) : 0;
    const aggCurr = currP ? Math.round(currP.aggression * 100) : 0;
    const aggStr  = aggInit !== aggCurr
      ? `  aggression ${aggInit}%→${aggCurr}%`
      : "";
    lines.push(
      `  ${C.green}📈 Most improved:${C.reset}` +
      ` ${emoji} ${name}${aggStr}`
    );
  }

  // Best bluffer (highest current bluffFrequency)
  const bestBluffer = p.eloRankings.slice().sort((a, b) => {
    const bA = p.currentPersonalities[a.agentId]?.bluffFrequency ?? 0;
    const bB = p.currentPersonalities[b.agentId]?.bluffFrequency ?? 0;
    return bB - bA;
  })[0];
  if (bestBluffer) {
    const { emoji, name } = meta(bestBluffer.agentId);
    const initBf = p.initialPersonalities[bestBluffer.agentId]?.bluffFrequency ?? 0;
    const currBf = p.currentPersonalities[bestBluffer.agentId]?.bluffFrequency ?? 0;
    lines.push(
      `  ${C.blue}🎭 Best bluffer:${C.reset}` +
      `  ${emoji} ${name}` +
      `  bluff freq ${Math.round(initBf * 100)}%→${Math.round(currBf * 100)}%`
    );
  }

  // Footer
  lines.push("");
  if (savePath) {
    lines.push(`${C.dim}  Strategies saving to: ${savePath}${C.reset}`);
  }
  lines.push(`${C.dim}  Elapsed: ${elapsed}s${C.reset}`);

  printLines(lines);
}

// ─── Final summary ────────────────────────────────────────────────────────────

function printFinalReport(report: TrainingReport): void {
  clearDashboard();

  const secs  = (report.durationMs / 1000).toFixed(1);
  const mode  = tournament ? " [TOURNAMENT]" : "";
  const WIDTH = 58;

  const lines: string[] = [];
  lines.push(`${C.gold}${C.bold}🎓 PokerCrawl Training${mode} — Complete${C.reset}`);
  lines.push("═".repeat(WIDTH));
  lines.push("");

  // ELO table
  lines.push(`${C.bold}${C.cyan}Final ELO Rankings:${C.reset}`);
  lines.push("─".repeat(WIDTH));
  lines.push(
    `  ${"#".padEnd(3)}` +
    `${"Bot".padEnd(18)}` +
    `${"ELO".padStart(5)}` +
    `${"Delta".padStart(8)}` +
    `${"Hands Won".padStart(11)}`
  );
  lines.push("─".repeat(WIDTH));

  for (let i = 0; i < report.eloRankings.length; i++) {
    const r    = report.eloRankings[i]!;
    const diff = Math.round(r.rating - 1200);
    const sign = diff >= 0 ? "+" : "";
    const col  = diff > 0 ? C.green : diff < 0 ? C.red : C.gray;
    const { emoji, name } = meta(r.agentId);
    const won  = report.agentStats[r.agentId]?.handsWon ?? 0;

    lines.push(
      `  ${C.bold}${`#${i + 1}`.padEnd(3)}${C.reset}` +
      `${emoji} ${name.padEnd(16)}` +
      `${C.gold}${String(Math.round(r.rating)).padStart(5)}${C.reset}` +
      `${col}${(`${sign}${diff}`).padStart(8)}${C.reset}` +
      `${String(won).padStart(11)}`
    );
  }

  lines.push("─".repeat(WIDTH));

  // Strategy evolution
  lines.push("");
  lines.push(`${C.bold}${C.cyan}Strategy Evolution:${C.reset}`);
  for (const r of report.eloRankings) {
    const id   = r.agentId;
    const ag   = report.decisionReport.perAgent[id];
    if (!ag) continue;
    const drifts = Object.entries(ag.personalityDrift)
      .filter(([, v]) => Math.abs(v as number) > 0.005)
      .map(([k, v]) => {
        const vn = v as number;
        return `${k} ${vn > 0 ? "+" : ""}${(vn * 100).toFixed(0)}%`;
      });
    const { emoji, name } = meta(id);
    lines.push(
      `  ${emoji} ${name.padEnd(12)}` +
      (drifts.length > 0 ? C.dim + drifts.join("  ") + C.reset : C.gray + "no change" + C.reset)
    );
  }

  // Footer
  lines.push("");
  lines.push("═".repeat(WIDTH));
  lines.push(`${C.dim}  ${report.handsPlayed.toLocaleString()} hands · ${secs}s${savePath ? ` · Saved: ${savePath}` : ""}${C.reset}`);
  lines.push("");

  // print directly (don't use printLines so it stays in scroll buffer)
  linesDrawn = 0;
  process.stdout.write(lines.join("\n") + "\n");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!silent) {
    const mode = tournament ? " [TOURNAMENT]" : "";
    process.stdout.write(`\n${C.gold}${C.bold}PokerCrawl Training${mode}${C.reset}\n`);
    process.stdout.write(`${C.dim}  Starting ${hands.toLocaleString()} hands with ${bots} bots…${C.reset}\n\n`);
    linesDrawn = 0;
  }

  const report: TrainingReport = await trainBots(hands, {
    bots,
    verbose:       false,          // we handle output ourselves
    adjustEvery:   tournament ? 20 : 50,
    snapshotEvery: tournament ? 100 : 200,
    ...(savePath !== null ? { savePath } : {}),
    ...(silent ? {} : {
      onProgress: (p: TrainingProgress) => renderDashboard(p),
    }),
  });

  if (silent) {
    // Compact output for --silent mode
    console.log(`\nFINAL ELO RANKINGS`);
    for (const r of report.eloRankings) {
      const diff = Math.round(r.rating - 1200);
      const sign = diff >= 0 ? "+" : "";
      console.log(`  ${r.agentId.padEnd(8)} ${Math.round(r.rating)}  (${sign}${diff})`);
    }
    const secs = (report.durationMs / 1000).toFixed(1);
    console.log(`\n${report.handsPlayed} hands · ${secs}s`);
  } else {
    printFinalReport(report);
  }
}

main().catch((err) => {
  console.error(C.red + "Error: " + C.reset, err instanceof Error ? err.message : err);
  process.exit(1);
});

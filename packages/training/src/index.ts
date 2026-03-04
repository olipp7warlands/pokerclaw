/**
 * @pokercrawl/training — Public API + CLI
 *
 * Training utilities for PokerCrawl agents: hand history, ELO ratings,
 * opponent modeling, positional analysis, pot odds, and adaptive strategy learning.
 *
 * Quick start:
 *   import { trainBots } from "@pokercrawl/training";
 *   const report = await trainBots(1000, { verbose: true, savePath: "./data/strategies.json" });
 *   console.log(report.eloRankings);
 *
 * CLI:
 *   npx pokercrawl-train --hands=10000 --bots=5 --save
 */

// Pot odds
export {
  potOdds,
  requiredEquity,
  impliedOdds,
  stackToPotRatio,
  isCallProfitable,
  callEV,
} from "./pot-odds-calculator.js";

// ELO rating
export { EloRating } from "./elo-rating.js";
export type { AgentRating } from "./elo-rating.js";

// Hand history
export { HandHistoryDb } from "./hand-history-db.js";
export type { HandAction, HandRecord, AgentStats } from "./hand-history-db.js";

// Opponent model
export { OpponentModel, classifyTendency, classifyPlayer, counterAdvice } from "./opponent-model.js";
export type { Tendency, PlayerType, OpponentProfile } from "./opponent-model.js";

// Position evaluator
export { getPosition, positionMultiplier, PositionStats } from "./position-evaluator.js";
export type { TablePosition, PositionWinRate } from "./position-evaluator.js";

// Strategy learner (full adaptive engine)
export { StrategyLearner } from "./strategy-learner.js";
export type {
  HandOutcome,
  DecisionAnalysis,
  DecisionRecord,
  SessionResults,
  AdjustedPersonality,
  LiveOpponentStats,
  StrategyRecommendation,
} from "./strategy-learner.js";

// Training loop + standalone trainBots()
export { TrainingLoop, trainBots } from "./training-loop.js";
export type {
  TrainingConfig,
  TrainingResult,
  TrainingReport,
  TrainingProgress,
  BiggestPot,
  StackSnapshot,
  StrategySnapshot,
  ActionStats,
  AgentReport,
  DecisionReport,
} from "./training-loop.js";

// ─── CLI entry point ──────────────────────────────────────────────────────────

import { fileURLToPath as _urlToPath } from "node:url";
const _isMain = process.argv[1] === _urlToPath(import.meta.url);

if (_isMain) {
  await _runCli();
}

async function _runCli(): Promise<void> {
  const args = process.argv.slice(2);

  // ── Help ──────────────────────────────────────────────────────────────────
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
🃏  pokercrawl-train — PokerCrawl adaptive bot training

Usage:
  pokercrawl-train [options]

Options:
  --hands=N         Hands to play (default: 1000)
  --bots=N          Number of bots, 2-6 (default: 5)
  --adjust=N        Adjust strategy every N hands (default: 50)
  --snapshot=N      Snapshot every N hands (default: 200)
  --save            Save strategies.json (default path: ./data/strategies.json)
  --save-path=PATH  Custom path for strategies.json
  --timeout=MS      Decision timeout in ms (default: 2000)
  --verbose         Print progress during training
  -h, --help        Show this help

Examples:
  pokercrawl-train --hands=1000 --verbose
  pokercrawl-train --hands=10000 --bots=5 --save
  pokercrawl-train --hands=500 --save-path=./my-strategies.json
`);
    process.exit(0);
  }

  // ── Parse args ────────────────────────────────────────────────────────────
  function getArg(name: string): string | undefined {
    const prefix = `--${name}=`;
    const found = args.find((a) => a.startsWith(prefix));
    return found?.slice(prefix.length);
  }

  const numHands  = parseInt(getArg("hands")   ?? "1000",  10);
  const numBots   = parseInt(getArg("bots")    ?? "5",     10);
  const adjust    = parseInt(getArg("adjust")  ?? "50",    10);
  const snapshot  = parseInt(getArg("snapshot")?? "200",   10);
  const timeout   = parseInt(getArg("timeout") ?? "2000",  10);
  const verbose   = args.includes("--verbose");
  const doSave    = args.includes("--save");
  const customPath = getArg("save-path");

  // Resolve save path
  const { dirname: pathDirname, join: pathJoin } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dir = pathDirname(fileURLToPath(import.meta.url));
  const defaultSavePath = pathJoin(__dir, "..", "data", "strategies.json");

  const savePath: string | null =
    customPath !== undefined ? customPath :
    doSave                   ? defaultSavePath :
    null;

  // ── Run ───────────────────────────────────────────────────────────────────
  if (!verbose) {
    // Always show minimal header when not verbose
    console.log(`\n🃏  PokerCrawl Training — ${numHands.toLocaleString()} hands, ${numBots} bots`);
    if (savePath !== null) console.log(`   Saving to: ${savePath}`);
    console.log("");
  }

  const { TrainingLoop: TL } = await import("./training-loop.js");
  const loop = new TL();

  const report = await loop.trainBots(numHands, {
    bots:             numBots,
    adjustEvery:      adjust,
    snapshotEvery:    snapshot,
    decisionTimeoutMs:timeout,
    verbose,
    ...(savePath !== null && { savePath }),
  });

  // Minimal summary when not verbose (verbose already printed full report)
  if (!verbose) {
    console.log("FINAL ELO RANKINGS");
    for (let i = 0; i < report.eloRankings.length; i++) {
      const r = report.eloRankings[i];
      if (r === undefined) continue;
      const diff = Math.round(r.rating - 1200);
      console.log(
        `  #${i + 1}  ${r.agentId.padEnd(8)} ${Math.round(r.rating)}  (${diff >= 0 ? "+" : ""}${diff})`
      );
    }
    const secs = (report.durationMs / 1000).toFixed(1);
    console.log(`\nCompleted ${report.handsPlayed} hands in ${secs}s`);
    if (savePath !== null) console.log(`Saved: ${savePath}`);
    console.log("");
  }
}

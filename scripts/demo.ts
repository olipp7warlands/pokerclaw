/**
 * PokerCrawl — Console Demo
 *
 * Runs a full poker session (5 hands) with 4 bots using the engine directly.
 * No MCP server, no UI — just formatted terminal output.
 *
 * Usage:  npx tsx scripts/demo.ts
 *         npx tsx scripts/demo.ts --hands 10
 */

// Import directly from source so `npx tsx` works without a build step
import {
  createGame,
  startHand,
  processAction,
  evaluateHand,
  getCommunityCards,
} from "../packages/engine/src/index.ts";

import type { GameState, PlayerAction, CapabilityCard, TaskCard } from "../packages/engine/src/index.ts";

// ─── ANSI colours ───────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  gold:   "\x1b[33m",
  cyan:   "\x1b[36m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  blue:   "\x1b[34m",
  purple: "\x1b[35m",
  gray:   "\x1b[90m",
  white:  "\x1b[97m",
};

const ACTION_COLOR: Record<string, string> = {
  raise:  C.gold,
  call:   C.cyan,
  check:  C.gray,
  fold:   C.red,
  "all-in": C.bold + C.gold,
};

const SUIT_SYMBOL: Record<string, string> = {
  spades:   "♠",
  hearts:   "♥",
  diamonds: "♦",
  clubs:    "♣",
};

const SUIT_COLOR: Record<string, string> = {
  spades:   C.blue,
  hearts:   C.red,
  diamonds: C.purple,
  clubs:    C.green,
};

// ─── Bot definitions ─────────────────────────────────────────────────────────

interface Bot {
  id:         string;
  name:       string;
  emoji:      string;
  color:      string;
  aggression: number; // 0=passive  1=aggressive
  tightness:  number; // 0=loose    1=tight
  bluff:      number; // bluff probability
}

const BOTS: Bot[] = [
  { id: "shark", name: "Tiburón", emoji: "🦈", color: C.red,    aggression: 0.85, tightness: 0.25, bluff: 0.35 },
  { id: "rock",  name: "La Roca", emoji: "🪨", color: C.gray,   aggression: 0.10, tightness: 0.80, bluff: 0.05 },
  { id: "mago",  name: "El Mago", emoji: "🎩", color: C.purple, aggression: 0.55, tightness: 0.40, bluff: 0.60 },
  { id: "caos",  name: "El Caos", emoji: "🎲", color: C.cyan,   aggression: 0.50, tightness: 0.10, bluff: 0.30 },
];

// ─── Hand strength ────────────────────────────────────────────────────────────

function handStrength(
  holeCards: readonly CapabilityCard[],
  community: readonly (CapabilityCard | TaskCard)[]
): number {
  if (holeCards.length === 0) return 0.5;

  if (community.length === 0) {
    // Preflop heuristic: average rank + pair/suited bonus
    const avg = holeCards.reduce((s, c) => s + c.value, 0) / holeCards.length;
    let str = (avg - 2) / 12;
    if (holeCards.length >= 2 && holeCards[0]!.value === holeCards[1]!.value) str += 0.20;
    if (holeCards.length >= 2 && holeCards[0]!.suit  === holeCards[1]!.suit)  str += 0.06;
    return Math.min(str, 1);
  }

  try {
    const all = [...holeCards, ...community];
    const result = evaluateHand(all);
    return result.rankValue / 9;
  } catch {
    return 0.5;
  }
}

// ─── Bot decision ─────────────────────────────────────────────────────────────

function decide(state: GameState, bot: Bot): PlayerAction {
  const seat = state.seats.find((s) => s.agentId === bot.id);
  if (!seat) throw new Error(`Seat not found for ${bot.id}`);

  const community = getCommunityCards(state);
  const str = handStrength(seat.holeCards, community);

  // Occasional bluff
  const effective = Math.random() < bot.bluff ? Math.min(str + 0.30, 0.99) : str;

  const callCost   = state.currentBet - seat.currentBet;
  const totalInPot = state.mainPot + callCost;
  const potOdds    = totalInPot > 0 ? callCost / totalInPot : 0;
  const threshold  = potOdds + bot.tightness * 0.15;

  // Raise / open-bet
  if (effective > 0.65 + bot.tightness * 0.25) {
    const minRaise   = state.currentBet + Math.max(state.lastRaiseAmount, 10);
    const potBet     = Math.floor(state.mainPot * 0.65 * bot.aggression);
    const raiseTotal = Math.max(minRaise, state.currentBet + potBet);
    const maxRaise   = seat.currentBet + seat.stack;

    if (raiseTotal <= maxRaise && seat.stack > callCost) {
      return { agentId: bot.id, type: "raise", amount: Math.min(raiseTotal, maxRaise) };
    }
  }

  // Call / check
  if (effective >= threshold) {
    if (callCost === 0) {
      return { agentId: bot.id, type: "check", amount: 0 };
    }
    if (callCost >= seat.stack) {
      return { agentId: bot.id, type: "all-in", amount: seat.stack };
    }
    return { agentId: bot.id, type: "call", amount: callCost };
  }

  // Check for free
  if (callCost === 0) {
    return { agentId: bot.id, type: "check", amount: 0 };
  }

  return { agentId: bot.id, type: "fold", amount: 0 };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function cardStr(card: { rank: string; suit: string }): string {
  const sym = SUIT_SYMBOL[card.suit] ?? "?";
  const col = SUIT_COLOR[card.suit]  ?? C.white;
  return `${C.white}${card.rank}${col}${sym}${C.reset}`;
}

function boardStr(state: GameState): string {
  const cards = [
    ...state.board.flop,
    ...(state.board.turn  ? [state.board.turn]  : []),
    ...(state.board.river ? [state.board.river] : []),
  ];
  if (cards.length === 0) return C.dim + "(ninguna aún)" + C.reset;
  return cards.map(cardStr).join("  ");
}

function stackBar(chips: number, max: number): string {
  const filled = Math.min(12, Math.round((chips / max) * 12));
  const bar    = "█".repeat(filled) + "░".repeat(12 - filled);
  const color  = chips > max * 0.6 ? C.green : chips > max * 0.25 ? C.gold : C.red;
  return `${color}${bar}${C.reset}`;
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    preflop:   "PRE-FLOP",
    flop:      "FLOP",
    turn:      "TURN",
    river:     "RIVER",
    showdown:  "SHOWDOWN",
    execution: "EJECUCIÓN",
    settlement:"LIQUIDACIÓN",
  };
  return labels[phase] ?? phase.toUpperCase();
}

function botOf(id: string): Bot {
  return BOTS.find((b) => b.id === id) ?? { id, name: id, emoji: "?", color: C.white, aggression: 0.5, tightness: 0.5, bluff: 0.2 };
}

// ─── Print functions ──────────────────────────────────────────────────────────

const LINE = "─".repeat(60);
const DLINE = "═".repeat(60);

function printHandHeader(state: GameState, startingChips: number): void {
  console.log(`\n${C.gold}${C.bold}${DLINE}${C.reset}`);
  console.log(`${C.gold}${C.bold}  MANO #${state.handNumber}${C.reset}`);
  console.log(`${C.gold}${DLINE}${C.reset}`);

  for (const seat of state.seats) {
    const bot = botOf(seat.agentId);
    const bar = stackBar(seat.stack, startingChips);
    const active = seat.status === "active" ? "" : ` ${C.dim}[${seat.status}]${C.reset}`;
    console.log(
      `  ${bot.emoji} ${bot.color}${C.bold}${bot.name.padEnd(9)}${C.reset}` +
      `  ${bar}  ${C.gold}${String(seat.stack).padStart(5)}${C.reset} fichas${active}`
    );
  }
  console.log();
}

function printPhaseHeader(state: GameState): void {
  const label = phaseLabel(state.phase);
  const pot   = `Pot: ${C.gold}${state.mainPot}${C.reset}`;
  const board = boardStr(state);
  console.log(`  ${C.cyan}${C.bold}── ${label} ──${C.reset}  ${pot}`);
  if (state.phase !== "preflop") {
    console.log(`  ${C.dim}Board:${C.reset} ${board}`);
  }
}

function printAction(state: GameState, agentId: string, action: PlayerAction): void {
  const bot    = botOf(agentId);
  const seat   = state.seats.find((s) => s.agentId === agentId)!;
  const hole   = seat.holeCards.map(cardStr).join(" ");
  const actCol = ACTION_COLOR[action.type] ?? C.white;
  const actStr = action.type.toUpperCase();
  const amtStr = (action.type === "raise" || action.type === "call") && action.amount > 0
    ? ` ${C.bold}${action.amount}${C.reset}`
    : "";

  console.log(
    `    ${bot.emoji}  ${bot.color}${bot.name.padEnd(9)}${C.reset}` +
    `  [${hole}]` +
    `  ${actCol}${actStr}${C.reset}${amtStr}`
  );
}

function printWinners(state: GameState): void {
  if (state.winners.length === 0) return;
  console.log();
  for (const w of state.winners) {
    const bot = botOf(w.agentId);
    console.log(
      `  ${C.green}${C.bold}✓ GANA ${bot.emoji} ${bot.name}` +
      `  +${w.amountWon} fichas` +
      (w.handRank ? `  (${w.handRank})` : "") +
      `${C.reset}`
    );
  }
}

function printFinalStandings(state: GameState): void {
  console.log(`\n${C.gold}${C.bold}${DLINE}${C.reset}`);
  console.log(`${C.gold}${C.bold}  RESULTADO FINAL${C.reset}`);
  console.log(`${C.gold}${DLINE}${C.reset}`);

  const sorted = [...state.seats].sort((a, b) => b.stack - a.stack);
  sorted.forEach((seat, i) => {
    const bot  = botOf(seat.agentId);
    const rank = ["🥇", "🥈", "🥉", "4º"][i] ?? `${i + 1}º`;
    const elim = seat.stack === 0 ? `  ${C.red}[ELIMINADO]${C.reset}` : "";
    console.log(
      `  ${rank}  ${bot.emoji}  ${bot.color}${C.bold}${bot.name.padEnd(9)}${C.reset}` +
      `  ${C.gold}${seat.stack}${C.reset} fichas${elim}`
    );
  });
  console.log();
}

// ─── Terminal phase check ────────────────────────────────────────────────────

function isTerminal(phase: string): boolean {
  return phase === "showdown" || phase === "execution" || phase === "settlement";
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args     = process.argv.slice(2);
  const handsArg = args.indexOf("--hands");
  const maxHands = handsArg >= 0 ? parseInt(args[handsArg + 1] ?? "5", 10) : 5;
  const SB = 5, BB = 10, START = 500;

  console.log(`\n${C.gold}${C.bold}╔══════════════════════════════╗${C.reset}`);
  console.log(`${C.gold}${C.bold}║  POKERCRAWL — Demo consola    ║${C.reset}`);
  console.log(`${C.gold}${C.bold}╚══════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}  ${maxHands} manos · SB ${SB} · BB ${BB} · Stack inicial ${START}${C.reset}\n`);

  const state = createGame({
    smallBlind: SB,
    bigBlind:   BB,
    agents: BOTS.map((b) => ({ agentId: b.id, stack: START })),
  });

  for (let h = 0; h < maxHands; h++) {
    // Need at least 2 players with chips
    const alive = state.seats.filter((s) => s.stack > 0);
    if (alive.length < 2) {
      console.log(`\n${C.yellow}Solo queda un jugador. Fin del torneo.${C.reset}\n`);
      break;
    }

    // Rotate dealer
    state.dealerIndex = (state.dealerIndex + 1) % state.seats.length;

    startHand(state, SB, BB);
    printHandHeader(state, START);

    let currentPhase = state.phase;
    printPhaseHeader(state);

    let safetyCounter = 0;
    while (!isTerminal(state.phase)) {
      if (++safetyCounter > 200) {
        console.error("  [warn] safety break — loop sin terminar");
        break;
      }

      const seat = state.seats[state.actionOnIndex];
      if (!seat || seat.status !== "active") {
        // No active seat to act — shouldn't happen but guard it
        break;
      }

      const bot    = botOf(seat.agentId);
      const action = decide(state, bot);

      printAction(state, seat.agentId, action);
      processAction(state, action);

      if (state.phase !== currentPhase) {
        currentPhase = state.phase;
        if (!isTerminal(state.phase)) {
          console.log();
          printPhaseHeader(state);
        }
      }
    }

    printWinners(state);

    // Small pause between hands
    await new Promise((r) => setTimeout(r, 120));
  }

  printFinalStandings(state);
}

main().catch((err) => {
  console.error(C.red + "Error: " + C.reset, err instanceof Error ? err.message : err);
  process.exit(1);
});

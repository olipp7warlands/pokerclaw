/**
 * PokerCrawl — Dealer
 *
 * Manages:
 * - Building & shuffling the deck
 * - Dealing hole cards (CapabilityCards) to agents
 * - Advancing the game through phases (preflop → showdown → settlement)
 * - Burning cards between streets
 */

import type {
  AgentSeat,
  Board,
  CapabilityCard,
  Card,
  GamePhase,
  GameState,
  Rank,
  RankValue,
  Suit,
  TaskCard,
} from "./types.js";
import { RANK_VALUE_MAP } from "./hand-evaluator.js";
import { buildStandardDeck, shuffleDeck } from "./task-cards.js";

// ---------------------------------------------------------------------------
// CapabilityCard helpers
// ---------------------------------------------------------------------------

/**
 * Convert a TaskCard to a CapabilityCard for a player's hole.
 * In PokerCrawl, hole cards represent the agent's capabilities.
 * We reuse the task-card mechanics but annotate them as capabilities.
 */
export function taskCardToCapabilityCard(
  card: TaskCard,
  capability: string,
  confidence = 0.8
): CapabilityCard {
  return {
    suit: card.suit,
    rank: card.rank,
    value: card.value,
    capability,
    confidence,
  };
}

/**
 * Build a 52-card capability deck (same structure as task deck but typed
 * as CapabilityCards, representing generic agent capabilities).
 */
export function buildCapabilityDeck(): CapabilityCard[] {
  const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
  const ranks: Rank[] = [
    "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A",
  ];
  const deck: CapabilityCard[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      const value = RANK_VALUE_MAP[rank] as RankValue;
      deck.push({
        suit,
        rank,
        value,
        capability: `${rank} of ${suit}`,
        confidence: value / 14, // higher rank → higher confidence
      });
    }
  }
  return deck;
}

function shuffleCapabilityDeck(deck: CapabilityCard[]): CapabilityCard[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

// ---------------------------------------------------------------------------
// Initial deal
// ---------------------------------------------------------------------------

/**
 * Prepare a fresh hand:
 * 1. Shuffle a new community deck (TaskCards) and place on state.deck
 * 2. Deal 2 CapabilityCards (hole cards) to each active seat
 * 3. Reset board
 */
export function dealHoleCards(state: GameState): void {
  // Fresh community deck
  const communityDeck = shuffleDeck(buildStandardDeck());
  state.deck = communityDeck;

  // Fresh capability deck for hole cards
  const capDeck = shuffleCapabilityDeck(buildCapabilityDeck());
  let capIndex = 0;

  for (const seat of state.seats) {
    if (seat.status === "sitting-out") {
      seat.holeCards = []; // clear stale cards from the previous hand
      continue;
    }
    seat.holeCards = [capDeck[capIndex++]!, capDeck[capIndex++]!];
  }

  // Reset board
  state.board = { flop: [], turn: null, river: null };
}

// ---------------------------------------------------------------------------
// Street dealing
// ---------------------------------------------------------------------------

function burnCard(state: GameState): void {
  state.deck.shift(); // burn top card
}

/** Deal the flop (3 community cards). */
export function dealFlop(state: GameState): void {
  burnCard(state);
  const flop: TaskCard[] = [state.deck.shift()!, state.deck.shift()!, state.deck.shift()!];
  state.board = { ...state.board, flop };
}

/** Deal the turn (4th community card). */
export function dealTurn(state: GameState): void {
  burnCard(state);
  const turn = state.deck.shift()!;
  state.board = { ...state.board, turn };
}

/** Deal the river (5th community card). */
export function dealRiver(state: GameState): void {
  burnCard(state);
  const river = state.deck.shift()!;
  state.board = { ...state.board, river };
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

const PHASE_ORDER: GamePhase[] = [
  "waiting",
  "preflop",
  "flop",
  "turn",
  "river",
  "showdown",
  "execution",
  "settlement",
];

/** Advance to the next game phase, performing any required dealing. */
export function advancePhase(state: GameState): GamePhase {
  const currentIdx = PHASE_ORDER.indexOf(state.phase);
  if (currentIdx === -1 || currentIdx >= PHASE_ORDER.length - 1) {
    throw new Error(`Cannot advance from phase: ${state.phase}`);
  }
  const nextPhase = PHASE_ORDER[currentIdx + 1]!;

  switch (nextPhase) {
    case "preflop":
      dealHoleCards(state);
      break;
    case "flop":
      dealFlop(state);
      break;
    case "turn":
      dealTurn(state);
      break;
    case "river":
      dealRiver(state);
      break;
    default:
      break;
  }

  state.phase = nextPhase;
  return nextPhase;
}

// ---------------------------------------------------------------------------
// Community cards helper
// ---------------------------------------------------------------------------

/** Return all currently revealed community cards (as generic Cards). */
export function getCommunityCards(state: GameState): Card[] {
  const cards: Card[] = [...state.board.flop];
  if (state.board.turn) cards.push(state.board.turn);
  if (state.board.river) cards.push(state.board.river);
  return cards;
}

/** Return all task cards the winner must execute (all revealed community cards). */
export function getAssignedTasks(state: GameState): TaskCard[] {
  const tasks: TaskCard[] = [...state.board.flop];
  if (state.board.turn) tasks.push(state.board.turn);
  if (state.board.river) tasks.push(state.board.river);
  return tasks;
}

// ---------------------------------------------------------------------------
// Seat management
// ---------------------------------------------------------------------------

export function createSeat(agentId: string, stack: WorkToken): AgentSeat {
  return {
    agentId,
    stack,
    holeCards: [],
    totalBet: 0,
    currentBet: 0,
    status: "active",
    hasActedThisRound: false,
  };
}

type WorkToken = number;

/**
 * PokerCrawl — Game Loop (Central GameState + processAction)
 *
 * Orchestrates a complete hand:
 *   waiting → preflop → flop → turn → river → showdown → execution → settlement
 *
 * The public API is:
 *   createGame()       — initialise a new game
 *   startHand()        — deal cards and post blinds
 *   processAction()    — apply a player action and advance phase if needed
 *   getState()         — read-only snapshot
 */

import { randomUUID } from "crypto";

import type {
  AgentSeat,
  GameEvent,
  GamePhase,
  GameState,
  PlayerAction,
  SidePot,
  TaskCard,
  WinnerResult,
  WorkToken,
} from "./types.js";

import {
  advanceAction,
  applyAction,
  calculatePots,
  countActivePlayers,
  isBettingRoundComplete,
  isHandAllIn,
  postAntes,
  postBlinds,
  resetBettingRound,
  validateAction,
} from "./betting.js";

import {
  advancePhase,
  createSeat,
  getCommunityCards,
  getAssignedTasks,
} from "./dealer.js";

import { compareHands, evaluateHand, findWinners } from "./hand-evaluator.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GameConfig {
  gameId?: string;
  smallBlind: WorkToken;
  bigBlind: WorkToken;
  agents: Array<{ agentId: string; stack: WorkToken }>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a new game in "waiting" phase. */
export function createGame(config: GameConfig): GameState {
  const seats: AgentSeat[] = config.agents.map((a) =>
    createSeat(a.agentId, a.stack)
  );

  return {
    gameId: config.gameId ?? randomUUID(),
    seats,
    dealerIndex: 0,
    phase: "waiting",
    board: { flop: [], turn: null, river: null },
    mainPot: 0,
    sidePots: [],
    actionOnIndex: 0,
    currentBet: 0,
    lastRaiseAmount: 0,
    deck: [],
    events: [],
    winners: [],
    assignedTasks: [],
    handNumber: 0,
  };
}

// ---------------------------------------------------------------------------
// Event logging
// ---------------------------------------------------------------------------

function emit(state: GameState, type: GameEvent["type"], payload: Record<string, unknown>): void {
  state.events.push({ type, timestamp: Date.now(), payload });
}

// ---------------------------------------------------------------------------
// Start a hand
// ---------------------------------------------------------------------------

/**
 * Begin a new hand: advances to preflop, deals hole cards, posts antes + blinds.
 * Requires at least 2 players with chips.
 */
export function startHand(
  state: GameState,
  smallBlind: WorkToken,
  bigBlind: WorkToken,
  ante: WorkToken = 0
): void {
  // Reset per-hand fields
  state.mainPot = 0;
  state.sidePots = [];
  state.winners = [];
  state.assignedTasks = [];
  state.handNumber += 1;

  // Reset seat statuses BEFORE dealing so that:
  //   - 0-stack (eliminated) players become "sitting-out" and don't receive cards
  //   - Previously folded/all-in players with chips are restored to "active"
  for (const seat of state.seats) {
    seat.totalBet = 0;
    seat.currentBet = 0;
    seat.hasActedThisRound = false;
    if (seat.stack === 0) {
      seat.status = "sitting-out";
    } else if (seat.status !== "active") {
      seat.status = "active";
    }
  }

  // Advance phase to preflop — this calls dealHoleCards, which skips sitting-out seats
  state.phase = "waiting";
  advancePhase(state); // waiting → preflop
  state.phase = "preflop";

  // Post antes (optional, before blinds)
  if (ante > 0) {
    postAntes(state, ante);
  }

  // Post blinds (sets actionOnIndex, skipping sitting-out)
  postBlinds(state, smallBlind, bigBlind);

  emit(state, "hand-started", { handNumber: state.handNumber });
  emit(state, "cards-dealt", {
    seats: state.seats.map((s) => ({ agentId: s.agentId, cardCount: s.holeCards.length })),
  });
}

// ---------------------------------------------------------------------------
// Process a player action
// ---------------------------------------------------------------------------

/**
 * The main entry point for agent actions.
 * Validates, applies the action, then advances phase if the betting round ends.
 */
export function processAction(
  state: GameState,
  action: PlayerAction
): void {
  if (state.phase === "showdown" || state.phase === "execution" || state.phase === "settlement") {
    throw new Error(`Cannot process actions in phase: ${state.phase}`);
  }

  validateAction(state, action);
  applyAction(state, action);

  emit(state, "action-taken", {
    agentId: action.agentId,
    type: action.type,
    amount: action.amount,
    phase: state.phase,
  });

  // Move to next player
  advanceAction(state);

  // Check if hand should end early (everyone folded except one active/all-in player)
  const nonFolded = state.seats.filter(
    (s) => s.status !== "folded" && s.status !== "sitting-out"
  );
  if (nonFolded.length === 1) {
    _resolveHandByFold(state);
    return;
  }

  // Check if betting round is complete.
  // Note: isHandAllIn is NOT checked here — the last active player must still
  // be allowed to call/fold an all-in before the round closes.
  // Runout (all players all-in) is handled inside _advanceToNextPhase.
  if (isBettingRoundComplete(state)) {
    _advanceToNextPhase(state);
  }
}

// ---------------------------------------------------------------------------
// Phase advancement
// ---------------------------------------------------------------------------

function _advanceToNextPhase(state: GameState): void {
  const currentPhase = state.phase;
  resetBettingRound(state);

  switch (currentPhase) {
    case "preflop":
      advancePhase(state); // → flop
      _resetActionForStreet(state);
      emit(state, "phase-changed", { phase: state.phase });
      // All-in runout: no active players left — keep advancing to showdown
      if (isHandAllIn(state)) _advanceToNextPhase(state);
      break;

    case "flop":
      advancePhase(state); // → turn
      _resetActionForStreet(state);
      emit(state, "phase-changed", { phase: state.phase });
      if (isHandAllIn(state)) _advanceToNextPhase(state);
      break;

    case "turn":
      advancePhase(state); // → river
      _resetActionForStreet(state);
      emit(state, "phase-changed", { phase: state.phase });
      if (isHandAllIn(state)) _advanceToNextPhase(state);
      break;

    case "river":
      advancePhase(state); // → showdown
      _resolveShowdown(state);
      break;

    default:
      break;
  }
}

/** Set actionOnIndex to the first active player left of the dealer for a new street. */
function _resetActionForStreet(state: GameState): void {
  const total = state.seats.length;
  let idx = (state.dealerIndex + 1) % total;
  for (let i = 0; i < total; i++) {
    const seat = state.seats[idx];
    if (seat && seat.status === "active") {
      state.actionOnIndex = idx;
      return;
    }
    idx = (idx + 1) % total;
  }
}

// ---------------------------------------------------------------------------
// Showdown & settlement
// ---------------------------------------------------------------------------

function _resolveShowdown(state: GameState): void {
  state.phase = "showdown";

  // Calculate side pots if needed
  const hasAllIn = state.seats.some((s) => s.status === "all-in");
  if (hasAllIn) {
    state.sidePots = calculatePots(state.seats);
  }

  const community = getCommunityCards(state);

  // Evaluate hands for non-folded, non-sitting-out players
  const contestants = state.seats.filter(
    (s) => s.status !== "folded" && s.status !== "sitting-out"
  );
  const handsMap = new Map(
    contestants.map((s) => {
      const allCards = [...s.holeCards, ...community];
      return [s.agentId, evaluateHand(allCards)];
    })
  );

  // Determine winners per pot
  const winners: WinnerResult[] = [];
  const pots: Array<{ amount: WorkToken; eligible: string[] }> =
    state.sidePots.length > 0
      ? state.sidePots.map((p) => ({ amount: p.amount, eligible: [...p.eligibleAgents] }))
      : [{ amount: state.mainPot, eligible: contestants.map((s) => s.agentId) }];

  for (let potIdx = 0; potIdx < pots.length; potIdx++) {
    const pot = pots[potIdx]!;
    const eligibleContestants = pot.eligible.filter((id) => {
      const seat = state.seats.find((s) => s.agentId === id);
      return seat && seat.status !== "folded";
    });

    if (eligibleContestants.length === 0) continue;

    const handsArr = eligibleContestants.map((id) => ({
      agentId: id,
      cards: [
        ...(state.seats.find((s) => s.agentId === id)!.holeCards),
        ...community,
      ],
    }));

    const winnerIds = findWinners(handsArr);
    const splitAmount = Math.floor(pot.amount / winnerIds.length);

    for (const wId of winnerIds) {
      const seat = state.seats.find((s) => s.agentId === wId)!;
      seat.stack += splitAmount;
      winners.push({
        agentId: wId,
        amountWon: splitAmount,
        hand: handsMap.get(wId) ?? null,
        potIndex: potIdx,
      });
    }
  }

  state.winners = winners;

  emit(state, "showdown-result", {
    winners: winners.map((w) => ({
      agentId: w.agentId,
      amountWon: w.amountWon,
      hand: w.hand?.rank,
    })),
  });

  // Assign tasks to the main pot winner
  state.assignedTasks = getAssignedTasks(state);
  const mainWinner = winners.find((w) => w.potIndex === 0);
  if (mainWinner) {
    emit(state, "task-assigned", {
      agentId: mainWinner.agentId,
      tasks: state.assignedTasks.map((t) => t.task),
    });
  }

  _settle(state);
}

function _resolveHandByFold(state: GameState): void {
  const winner = state.seats.find(
    (s) => s.status !== "folded" && s.status !== "sitting-out"
  );
  if (!winner) return;

  winner.stack += state.mainPot;
  state.winners = [
    { agentId: winner.agentId, amountWon: state.mainPot, hand: null, potIndex: 0 },
  ];
  state.assignedTasks = getAssignedTasks(state);

  emit(state, "showdown-result", {
    winners: [{ agentId: winner.agentId, amountWon: state.mainPot, hand: null }],
    reason: "last-agent-standing",
  });

  emit(state, "task-assigned", {
    agentId: winner.agentId,
    tasks: state.assignedTasks.map((t) => t.task),
  });

  _settle(state);
}

function _settle(state: GameState): void {
  state.phase = "settlement";
  state.mainPot = 0;
  state.sidePots = [];

  emit(state, "settlement-complete", {
    stacks: state.seats.map((s) => ({ agentId: s.agentId, stack: s.stack })),
  });

  emit(state, "hand-ended", { handNumber: state.handNumber });

  // Rotate dealer button — skip seats with 0 chips (eliminated players)
  const n = state.seats.length;
  let nextDealer = (state.dealerIndex + 1) % n;
  for (let i = 0; i < n; i++) {
    if ((state.seats[nextDealer]?.stack ?? 0) > 0) break;
    nextDealer = (nextDealer + 1) % n;
  }
  state.dealerIndex = nextDealer;
  state.phase = "settlement"; // stays here until next startHand()
}

// ---------------------------------------------------------------------------
// Read-only snapshot
// ---------------------------------------------------------------------------

/** Return a deep-frozen copy of the state (safe to pass to observers). */
export function getState(state: GameState): Readonly<GameState> {
  return Object.freeze({ ...state });
}

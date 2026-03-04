/**
 * PokerCrawl — Betting Engine (No-Limit Texas Hold'em rules)
 *
 * Handles: blind posting, action validation, raise tracking, all-in logic,
 * side pot calculation, and detecting when a betting round is complete.
 */

import type {
  AgentSeat,
  GameState,
  PlayerAction,
  SidePot,
  WorkToken,
} from "./types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BettingError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the index of the next seat (after `fromIndex`) that is not sitting-out.
 * Wraps around. Returns `fromIndex` if no such seat exists (shouldn't happen
 * when ≥2 players are playing, but safe fallback).
 */
function nextPlayingIndex(seats: AgentSeat[], fromIndex: number): number {
  const n = seats.length;
  let idx = (fromIndex + 1) % n;
  for (let i = 0; i < n; i++) {
    if (seats[idx]!.status !== "sitting-out") return idx;
    idx = (idx + 1) % n;
  }
  return fromIndex;
}

// ---------------------------------------------------------------------------
// Blind posting
// ---------------------------------------------------------------------------

/**
 * Post small and big blind from the appropriate seats, skipping sitting-out players.
 * Mutates seats + gameState pot fields.
 */
export function postBlinds(
  state: GameState,
  smallBlind: WorkToken,
  bigBlind: WorkToken
): void {
  const playingCount = state.seats.filter((s) => s.status !== "sitting-out").length;
  if (playingCount < 2) {
    throw new BettingError("Need at least 2 active players to post blinds");
  }

  const sbIndex = nextPlayingIndex(state.seats, state.dealerIndex);
  const bbIndex = nextPlayingIndex(state.seats, sbIndex);

  postForcedBet(state, sbIndex, smallBlind);
  postForcedBet(state, bbIndex, bigBlind);

  state.currentBet = bigBlind;
  state.lastRaiseAmount = bigBlind;
  // Action starts left of BB (preflop), skipping sitting-out
  state.actionOnIndex = nextPlayingIndex(state.seats, bbIndex);
}

// ---------------------------------------------------------------------------
// Antes
// ---------------------------------------------------------------------------

/**
 * Post antes from all non-sitting-out seats before the blinds.
 * Antes go directly into the pot; they do NOT set `currentBet`
 * (so they don't affect minimum call amounts).
 */
export function postAntes(state: GameState, ante: WorkToken): void {
  if (ante <= 0) return;
  for (const seat of state.seats) {
    if (seat.status === "sitting-out") continue;
    const actual = Math.min(ante, seat.stack);
    if (actual === 0) continue;
    seat.stack -= actual;
    seat.totalBet += actual;
    state.mainPot += actual;
    if (seat.stack === 0) seat.status = "all-in";
  }
}

function postForcedBet(state: GameState, seatIndex: number, amount: WorkToken): void {
  const seat = state.seats[seatIndex];
  if (!seat) return;

  const actual = Math.min(amount, seat.stack);
  seat.stack -= actual;
  seat.currentBet += actual;
  seat.totalBet += actual;
  state.mainPot += actual;

  if (seat.stack === 0) {
    seat.status = "all-in";
  }
}

// ---------------------------------------------------------------------------
// Action validation
// ---------------------------------------------------------------------------

/** Validate an incoming action against the current game state. */
export function validateAction(state: GameState, action: PlayerAction): void {
  const seat = state.seats[state.actionOnIndex];
  if (!seat) throw new BettingError("No seat at actionOnIndex");
  if (seat.agentId !== action.agentId) {
    throw new BettingError(
      `It is ${seat.agentId}'s turn, not ${action.agentId}`
    );
  }
  if (seat.status !== "active") {
    throw new BettingError(`Agent ${action.agentId} is not active`);
  }

  const callAmount = state.currentBet - seat.currentBet;

  switch (action.type) {
    case "fold":
    case "all-in":
      break; // always valid for an active player

    case "check":
      if (callAmount > 0) {
        throw new BettingError(
          `Cannot check — must call ${callAmount} or fold`
        );
      }
      break;

    case "call":
      if (callAmount === 0) {
        throw new BettingError("Nothing to call — use check instead");
      }
      if (action.amount !== Math.min(callAmount, seat.stack)) {
        throw new BettingError(
          `Call amount must be ${Math.min(callAmount, seat.stack)}`
        );
      }
      break;

    case "raise": {
      const minRaise = state.currentBet + state.lastRaiseAmount;
      // Max raise-to = what the seat has already committed + remaining stack
      const maxRaise = seat.currentBet + seat.stack;
      if (action.amount < minRaise) {
        throw new BettingError(
          `Min raise to ${minRaise}, got ${action.amount}`
        );
      }
      if (action.amount > maxRaise) {
        throw new BettingError(
          `Raise ${action.amount} exceeds stack (max ${maxRaise})`
        );
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Apply action
// ---------------------------------------------------------------------------

/** Apply a validated action to the game state. Mutates state in place. */
export function applyAction(state: GameState, action: PlayerAction): void {
  const seat = state.seats[state.actionOnIndex]!;

  switch (action.type) {
    case "fold":
      seat.status = "folded";
      seat.hasActedThisRound = true;
      break;

    case "check":
      seat.hasActedThisRound = true;
      break;

    case "call": {
      const callAmount = Math.min(
        state.currentBet - seat.currentBet,
        seat.stack
      );
      seat.stack -= callAmount;
      seat.currentBet += callAmount;
      seat.totalBet += callAmount;
      state.mainPot += callAmount;
      seat.hasActedThisRound = true;
      if (seat.stack === 0) seat.status = "all-in";
      break;
    }

    case "raise": {
      // action.amount = the TOTAL bet amount this round (not additional chips)
      const additional = action.amount - seat.currentBet;
      const raiseBy = action.amount - state.currentBet;

      seat.stack -= additional;
      seat.currentBet = action.amount;
      seat.totalBet += additional;
      state.mainPot += additional;
      state.lastRaiseAmount = raiseBy;
      state.currentBet = action.amount;
      seat.hasActedThisRound = true;
      // A raise re-opens action: everyone else must act again
      for (const s of state.seats) {
        if (s.agentId !== seat.agentId && s.status === "active") {
          s.hasActedThisRound = false;
        }
      }
      if (seat.stack === 0) seat.status = "all-in";
      break;
    }

    case "all-in": {
      const allInAmount = seat.stack;
      const newBet = seat.currentBet + allInAmount;

      seat.stack = 0;
      seat.totalBet += allInAmount;
      state.mainPot += allInAmount;
      seat.hasActedThisRound = true;

      if (newBet > state.currentBet) {
        const raiseBy = newBet - state.currentBet;
        if (raiseBy >= state.lastRaiseAmount) {
          state.lastRaiseAmount = raiseBy;
          // Re-opens action for others
          for (const s of state.seats) {
            if (s.agentId !== seat.agentId && s.status === "active") {
              s.hasActedThisRound = false;
            }
          }
        }
        state.currentBet = newBet;
      }
      seat.currentBet = newBet;
      seat.status = "all-in";
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Round-complete detection
// ---------------------------------------------------------------------------

/**
 * Returns true when the current betting round is complete.
 * Conditions:
 * - Only 0 or 1 active (non-folded, non-all-in) player remains, OR
 * - All active players have voluntarily acted AND equalized their bets.
 *   (The `hasActedThisRound` flag ensures BB gets their option preflop.)
 */
export function isBettingRoundComplete(state: GameState): boolean {
  const active = state.seats.filter((s) => s.status === "active");
  // No active players: nobody left to act (all folded or all-in)
  if (active.length === 0) return true;
  // All active players have voluntarily acted AND equalized their bets.
  // This correctly keeps the last active player in if they haven't yet called
  // an all-in that re-opened the action (e.g., opponent went all-in for a raise).
  return (
    active.every((s) => s.hasActedThisRound) &&
    active.every((s) => s.currentBet === state.currentBet)
  );
}

/**
 * Returns true when the entire hand should go straight to showdown
 * because only one active player remains (others folded or all-in).
 */
export function isHandAllIn(state: GameState): boolean {
  const active = state.seats.filter((s) => s.status === "active");
  return active.length <= 1;
}

/** Returns the number of players still able to act (active, not folded/all-in). */
export function countActivePlayers(state: GameState): number {
  return state.seats.filter((s) => s.status === "active").length;
}

/** Advance actionOnIndex to the next active (or all-in eligible) seat. */
export function advanceAction(state: GameState): void {
  const total = state.seats.length;
  let next = (state.actionOnIndex + 1) % total;

  for (let i = 0; i < total; i++) {
    const seat = state.seats[next];
    if (seat && seat.status === "active") {
      state.actionOnIndex = next;
      return;
    }
    next = (next + 1) % total;
  }
  // No active player found — hand is effectively over
}

/** Reset per-round bet tracking at the start of a new betting round. */
export function resetBettingRound(state: GameState): void {
  for (const seat of state.seats) {
    seat.currentBet = 0;
    seat.hasActedThisRound = false;
  }
  state.currentBet = 0;
  state.lastRaiseAmount = 0;
}

// ---------------------------------------------------------------------------
// Side pot calculation
// ---------------------------------------------------------------------------

/**
 * Calculate main pot + side pots when one or more players are all-in.
 * This is called after all betting is complete.
 *
 * Algorithm:
 * 1. Sort contributors by totalBet ascending.
 * 2. For each distinct totalBet level L (increment I = L − prevLevel):
 *    - pot amount = I × (number of seats with totalBet >= L)
 *    - eligible winners = non-folded seats with totalBet >= L
 */
export function calculatePots(seats: AgentSeat[]): SidePot[] {
  const contributors = seats
    .filter((s) => s.totalBet > 0)
    .sort((a, b) => a.totalBet - b.totalBet);

  const pots: SidePot[] = [];
  let prevLevel = 0;

  for (const contrib of contributors) {
    const level = contrib.totalBet;
    if (level === prevLevel) continue;

    const increment = level - prevLevel;
    // All seats (including folded) that put in at least this level contributed chips
    const contributing = seats.filter((s) => s.totalBet >= level);
    const potAmount = increment * contributing.length;

    // Only non-folded seats are eligible to win this pot
    const eligibleAgents = contributing
      .filter((s) => s.status !== "folded")
      .map((s) => s.agentId);

    pots.push({ amount: potAmount, eligibleAgents });
    prevLevel = level;
  }

  return pots;
}

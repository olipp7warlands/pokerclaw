/**
 * PokerCrawl — Core Type Definitions
 *
 * Texas Hold'em protocol for AI agent task negotiation.
 * Agents bet "work tokens" and the winner executes the main task.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A non-negative integer representing work tokens (e.g., compute credits). */
export type WorkToken = number;

/** Standard card suits — each maps to a capability domain. */
export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

/**
 * Card ranks — standard 2-A.
 * In PokerCrawl they represent task complexity / capability strength.
 */
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";

/** Numeric value of a rank (2=2 … T=10, J=11, Q=12, K=13, A=14). */
export type RankValue = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** A standard playing card. */
export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
  readonly value: RankValue;
}

/**
 * A CapabilityCard is dealt to an agent from its hand.
 * It represents one specific skill or resource the agent can leverage.
 */
export interface CapabilityCard extends Card {
  /** Human-readable description of the capability. */
  readonly capability: string;
  /** Confidence score [0, 1] — how reliably the agent can execute this. */
  readonly confidence: number;
}

/**
 * A TaskCard lives in the community deck.
 * It represents a requirement or sub-task of the negotiation.
 */
export interface TaskCard extends Card {
  /** The task or requirement described by this card. */
  readonly task: string;
  /** Effort units this task demands (maps to pot contribution weight). */
  readonly effort: number;
  /** Optional metadata from the source JSON definition. */
  readonly metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hands
// ---------------------------------------------------------------------------

/** All possible PokerCrawl hand rankings (higher = better). */
export type HandRank =
  | "royal-flush"
  | "straight-flush"
  | "four-of-a-kind"
  | "full-house"
  | "flush"
  | "straight"
  | "three-of-a-kind"
  | "two-pair"
  | "pair"
  | "high-card";

/** Numeric rank for comparison (9=royal-flush … 0=high-card). */
export type HandRankValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Result of evaluating 5+ cards into a hand. */
export interface EvaluatedHand {
  readonly rank: HandRank;
  readonly rankValue: HandRankValue;
  /**
   * Tiebreaker score within the same rank.
   * Higher = better. Computed from the relevant card values.
   */
  readonly score: number;
  /** The best 5-card combination used. */
  readonly bestFive: readonly Card[];
}

// ---------------------------------------------------------------------------
// Betting
// ---------------------------------------------------------------------------

/** All legal player actions. */
export type ActionType = "fold" | "check" | "call" | "raise" | "all-in";

/** An action submitted by an agent during betting. */
export interface PlayerAction {
  readonly agentId: string;
  readonly type: ActionType;
  /** Amount for raise/call/all-in (0 for fold/check). */
  readonly amount: WorkToken;
}

// ---------------------------------------------------------------------------
// Agents & Seats
// ---------------------------------------------------------------------------

/** Status of an agent during a hand. */
export type AgentStatus = "active" | "folded" | "all-in" | "sitting-out";

/** One seat at the table during a hand. */
export interface AgentSeat {
  readonly agentId: string;
  /** Current chip/token stack. */
  stack: WorkToken;
  /** Hole cards dealt this hand (2 CapabilityCards). */
  holeCards: readonly CapabilityCard[];
  /** Amount already put in the pot this hand. */
  totalBet: WorkToken;
  /** Amount put in during the current betting round. */
  currentBet: WorkToken;
  status: AgentStatus;
  /**
   * Whether this seat has voluntarily acted in the current betting round.
   * False after blinds post; true after any call/raise/check/fold/all-in.
   * Used to give the BB their "option" preflop.
   */
  hasActedThisRound: boolean;
}

// ---------------------------------------------------------------------------
// Pots
// ---------------------------------------------------------------------------

/** A pot (main or side) created by all-in situations. */
export interface SidePot {
  /** Total chips in this pot. */
  amount: WorkToken;
  /** IDs of agents eligible to win this pot. */
  eligibleAgents: readonly string[];
}

// ---------------------------------------------------------------------------
// Game phases
// ---------------------------------------------------------------------------

export type GamePhase =
  | "waiting"       // not enough players
  | "preflop"       // blinds posted, hole cards dealt
  | "flop"          // 3 community cards revealed
  | "turn"          // 4th community card
  | "river"         // 5th community card
  | "showdown"      // hands evaluated
  | "execution"     // winner executes the task
  | "settlement";   // tokens redistributed

// ---------------------------------------------------------------------------
// Community / Board
// ---------------------------------------------------------------------------

/** Community cards on the board, revealed progressively. */
export interface Board {
  readonly flop: readonly TaskCard[];   // 0 or 3 cards
  readonly turn: TaskCard | null;
  readonly river: TaskCard | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type GameEventType =
  | "hand-started"
  | "cards-dealt"
  | "blind-posted"
  | "action-taken"
  | "phase-changed"
  | "showdown-result"
  | "task-assigned"
  | "settlement-complete"
  | "hand-ended";

export interface GameEvent {
  readonly type: GameEventType;
  readonly timestamp: number;
  readonly payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Central GameState
// ---------------------------------------------------------------------------

/** The complete, authoritative state of one game / hand. */
export interface GameState {
  readonly gameId: string;

  /** Ordered list of seats (index = seat number). */
  seats: AgentSeat[];

  /** Index into `seats` for the dealer button. */
  dealerIndex: number;

  /** Current phase of the hand. */
  phase: GamePhase;

  /** Cards on the board. */
  board: Board;

  /** Main pot amount (before side pot splits). */
  mainPot: WorkToken;

  /** Side pots created when at least one player is all-in. */
  sidePots: SidePot[];

  /** Index of the seat whose turn it is to act. */
  actionOnIndex: number;

  /** Highest bet placed in the current betting round. */
  currentBet: WorkToken;

  /** Amount of the last raise (for min-raise calculation). */
  lastRaiseAmount: WorkToken;

  /** Deck of TaskCards remaining (community + burn). */
  deck: TaskCard[];

  /** Accumulated events for this hand. */
  events: GameEvent[];

  /** Winner(s) of the current / last hand. */
  winners: WinnerResult[];

  /** The task(s) from board cards the winner must execute. */
  assignedTasks: TaskCard[];

  /** Monotonically increasing hand counter. */
  handNumber: number;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface WinnerResult {
  readonly agentId: string;
  readonly amountWon: WorkToken;
  readonly hand: EvaluatedHand | null; // null if everyone else folded
  readonly potIndex: number; // 0 = main pot, 1+ = side pots
}

// ---------------------------------------------------------------------------
// Task definition (loaded from JSON)
// ---------------------------------------------------------------------------

export interface TaskDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly effort: number;       // 1-10
  readonly suit: Suit;
  readonly rank: Rank;
  readonly tags: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

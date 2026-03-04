/**
 * PokerCrawl Agents — Type Definitions
 */

import type {
  CapabilityCard,
  GamePhase,
  SidePot,
  TaskCard,
} from "@pokercrawl/engine";

// ---------------------------------------------------------------------------
// Personality
// ---------------------------------------------------------------------------

/** Numeric traits that drive a bot's behavioral tendencies. All values in [0, 1]. */
export interface AgentPersonality {
  /** How often the agent raises vs calls (0 = only calls, 1 = always raises). */
  aggression: number;
  /** How often the agent bets/raises without a strong hand. */
  bluffFrequency: number;
  /** Resistance to emotional deterioration after bad beats. */
  tiltResistance: number;
  /** How much the agent uses table-talk messaging. */
  trashTalkLevel: number;
  /** Willingness to commit large portions of stack. */
  riskTolerance: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AgentConfig {
  id: string;
  tableId?: string;
  name?: string;
  personality?: Partial<AgentPersonality>;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type ActionType = "bet" | "call" | "raise" | "fold" | "check" | "all-in";

export interface AgentDecision {
  action: ActionType;
  /** Required for bet/raise; omit for fold/check/call/all-in. */
  amount?: number;
  /** Internal reasoning (logged, not shared). */
  reasoning: string;
  /** Optional public message broadcast via table-talk. */
  tableTalk?: string;
  /** Agent's own confidence in this decision [0, 1]. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Context passed to decide()
// ---------------------------------------------------------------------------

export interface OpponentInfo {
  id: string;
  stack: number;
  currentBet: number;
  totalBet: number;
  isFolded: boolean;
  isAllIn: boolean;
}

export type TablePosition = "early" | "middle" | "late" | "blinds";

export interface StrategyContext {
  agentId: string;
  tableId: string;

  /** The agent's private hole cards. */
  myHand: readonly CapabilityCard[];
  /** Community cards visible on the board so far. */
  communityCards: readonly TaskCard[];

  /** Chips in the main pot. */
  potSize: number;
  sidePots: readonly SidePot[];

  /** Agent's remaining stack. */
  myStack: number;
  /** Amount the agent has already put in this round. */
  myCurrentBet: number;

  /** The highest bet placed this round (must match or raise). */
  currentBet: number;
  /** The size of the last raise (for min-raise calculation). */
  lastRaiseSize: number;

  phase: GamePhase;
  opponents: readonly OpponentInfo[];
  position: TablePosition;

  /** Whether it is literally this agent's turn to act. */
  isMyTurn: boolean;

  smallBlind: number;
  bigBlind: number;

  /** Running history of events this hand (for pattern reading). */
  eventHistory: ReadonlyArray<{ type: string; agentId?: string; amount?: number }>;
}

// ---------------------------------------------------------------------------
// Orchestrator results
// ---------------------------------------------------------------------------

export interface HandResult {
  handNumber: number;
  winner: string | null;
  winners: Array<{ agentId: string; amountWon: number; hand: string | null }>;
  totalPot: number;
  phase: string;
}

export interface TournamentResult {
  hands: number;
  finalStacks: Record<string, number>;
  handsWon: Record<string, number>;
  eliminated: string[];
}

// ---------------------------------------------------------------------------
// Game config for orchestrator
// ---------------------------------------------------------------------------

/** One level in a tournament blind schedule. */
export interface BlindLevel {
  small: number;
  big: number;
  /** Ante posted by every player (default 0). */
  ante?: number;
}

export interface GameConfig {
  tableId: string;
  smallBlind: number;
  bigBlind: number;
  startingTokens?: number;
  /** Milliseconds before auto-folding an unresponsive agent (default: 15 000). */
  decisionTimeoutMs?: number;
  /**
   * Ordered list of blind levels for tournament play.
   * Blind levels increase automatically every `blindIncreaseEvery` hands.
   */
  blindSchedule?: BlindLevel[];
  /** Number of hands between each blind level increase (default: never). */
  blindIncreaseEvery?: number;
}

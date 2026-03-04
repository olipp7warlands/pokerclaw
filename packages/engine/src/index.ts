/**
 * @pokercrawl/engine — Public API
 */

// Types
export type {
  ActionType,
  AgentSeat,
  AgentStatus,
  Board,
  CapabilityCard,
  Card,
  EvaluatedHand,
  GameEvent,
  GameEventType,
  GamePhase,
  GameState,
  HandRank,
  HandRankValue,
  PlayerAction,
  Rank,
  RankValue,
  SidePot,
  Suit,
  TaskCard,
  TaskDefinition,
  WinnerResult,
  WorkToken,
} from "./types.js";

// Hand evaluator
export {
  compareHands,
  evaluateHand,
  findWinners,
  HAND_RANK_VALUE,
  RANK_VALUE_MAP,
} from "./hand-evaluator.js";

// Betting engine
export {
  advanceAction,
  applyAction,
  BettingError,
  calculatePots,
  countActivePlayers,
  isBettingRoundComplete,
  isHandAllIn,
  postAntes,
  postBlinds,
  resetBettingRound,
  validateAction,
} from "./betting.js";

// Dealer
export {
  advancePhase,
  buildCapabilityDeck,
  createSeat,
  dealFlop,
  dealHoleCards,
  dealRiver,
  dealTurn,
  getAssignedTasks,
  getCommunityCards,
  taskCardToCapabilityCard,
} from "./dealer.js";

// Task cards
export {
  buildStandardDeck,
  shuffleDeck,
  taskDefinitionToCard,
  taskFromJSON,
  tasksFromJSON,
  TaskDefinitionSchema,
} from "./task-cards.js";

// Game loop
export type { GameConfig } from "./game.js";
export {
  createGame,
  getState,
  processAction,
  startHand,
} from "./game.js";

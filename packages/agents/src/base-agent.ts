/**
 * PokerCrawl — BaseAgent
 *
 * Abstract base class for all agents (simulated and real).
 * Provides shared utilities: hand-strength estimation, valid-action
 * enumeration, and personality defaults.
 */

import { evaluateHand } from "@pokercrawl/engine";
import type { Card } from "@pokercrawl/engine";

import type {
  ActionType,
  AgentConfig,
  AgentDecision,
  AgentPersonality,
  StrategyContext,
} from "./types.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_PERSONALITY: AgentPersonality = {
  aggression: 0.5,
  bluffFrequency: 0.15,
  tiltResistance: 0.7,
  trashTalkLevel: 0.3,
  riskTolerance: 0.5,
};

// ---------------------------------------------------------------------------
// BaseAgent
// ---------------------------------------------------------------------------

export abstract class BaseAgent {
  readonly id: string;
  readonly name: string;
  readonly personality: AgentPersonality;

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.name = config.name ?? config.id;
    this.personality = { ...DEFAULT_PERSONALITY, ...config.personality };
  }

  // -------------------------------------------------------------------------
  // Core decision — every agent implements this
  // -------------------------------------------------------------------------

  abstract decide(context: StrategyContext): Promise<AgentDecision>;

  // -------------------------------------------------------------------------
  // Hand-strength estimation
  // -------------------------------------------------------------------------

  /**
   * Returns a [0, 1] score representing how strong the agent's current hand is.
   *
   * - Preflop (no community cards): uses raw card values + pair/suit bonus
   * - Postflop: uses the engine's full hand evaluator (rankValue 0–9 → 0–1)
   */
  protected estimateHandStrength(context: StrategyContext): number {
    const { myHand, communityCards } = context;
    if (myHand.length === 0) return 0.5; // unknown

    const allCards: Card[] = [...myHand, ...communityCards];

    if (communityCards.length === 0) {
      // Preflop heuristic
      return this._preflopStrength([...myHand] as Card[]);
    }

    // Postflop: use engine evaluator
    try {
      const result = evaluateHand(allCards);
      // rankValue 0–9: give 90% weight to rank, 10% to fine-grained score
      const maxScore = Math.pow(15, 5); // theoretical max encodeKickers output
      const rankPart = result.rankValue / 9;
      const scorePart = Math.min(result.score / maxScore, 1);
      return Math.min(1, rankPart * 0.9 + scorePart * 0.1);
    } catch {
      return this._preflopStrength([...myHand] as Card[]);
    }
  }

  private _preflopStrength(holeCards: Card[]): number {
    // Normalize average card value to 0–1
    const avg = holeCards.reduce((s, c) => s + c.value, 0) / holeCards.length;
    let strength = (avg - 2) / 12; // 2→0, A(14)→1

    // Pocket pair bonus
    if (holeCards.length === 2 && holeCards[0]!.value === holeCards[1]!.value) {
      strength += 0.2;
    }
    // Suited bonus
    if (holeCards.length === 2 && holeCards[0]!.suit === holeCards[1]!.suit) {
      strength += 0.06;
    }
    // Connectors bonus (within 2 ranks)
    if (
      holeCards.length === 2 &&
      Math.abs(holeCards[0]!.value - holeCards[1]!.value) <= 2
    ) {
      strength += 0.04;
    }

    return Math.min(1, Math.max(0, strength));
  }

  // -------------------------------------------------------------------------
  // Valid actions
  // -------------------------------------------------------------------------

  /** Returns all currently legal actions for the agent given the context. */
  protected getValidActions(context: StrategyContext): ActionType[] {
    const callAmount = context.currentBet - context.myCurrentBet;
    const actions: ActionType[] = ["fold"];

    if (callAmount === 0) {
      actions.push("check");
    }
    if (callAmount > 0 && callAmount <= context.myStack) {
      actions.push("call");
    }
    if (context.myStack > 0) {
      actions.push("all-in");
    }
    if (context.currentBet === 0 && context.myStack >= context.bigBlind) {
      actions.push("bet");
    }
    if (context.currentBet > 0) {
      const minRaiseTo =
        context.currentBet +
        Math.max(context.lastRaiseSize, context.bigBlind);
      const additionalNeeded = minRaiseTo - context.myCurrentBet;
      if (context.myStack >= additionalNeeded) {
        actions.push("raise");
      }
    }

    return actions;
  }

  // -------------------------------------------------------------------------
  // Raise sizing helpers
  // -------------------------------------------------------------------------

  /**
   * Compute a reasonable raise-to amount.
   * @param context Current strategy context
   * @param multiplier How many pot-sizes to raise (e.g. 0.75 = 3/4 pot)
   */
  protected computeRaiseTo(context: StrategyContext, multiplier = 0.75): number {
    const base = context.currentBet + Math.round(context.potSize * multiplier);
    const minRaiseTo =
      context.currentBet + Math.max(context.lastRaiseSize, context.bigBlind);
    // Max raise-to = agent's already-committed chips + remaining stack
    const maxRaiseTo = context.myCurrentBet + context.myStack;
    return Math.min(maxRaiseTo, Math.max(minRaiseTo, base));
  }

  /**
   * Compute a reasonable bet amount (when currentBet === 0).
   * @param multiplier Fraction of pot to bet (default: 0.6)
   */
  protected computeBetAmount(context: StrategyContext, multiplier = 0.6): number {
    const ideal = Math.max(context.bigBlind, Math.round(context.potSize * multiplier));
    return Math.min(context.myStack, ideal);
  }

  // -------------------------------------------------------------------------
  // Pot odds
  // -------------------------------------------------------------------------

  /** Returns the equity needed to break even on a call [0, 1]. */
  protected potOdds(context: StrategyContext): number {
    const callAmount = context.currentBet - context.myCurrentBet;
    if (callAmount <= 0) return 0;
    return callAmount / (context.potSize + callAmount);
  }

  // -------------------------------------------------------------------------
   // Table talk helpers
  // -------------------------------------------------------------------------

  /** Return a random table-talk message from a pool, or undefined if below threshold. */
  protected maybeTableTalk(messages: string[]): string | undefined {
    if (messages.length === 0) return undefined;
    if (Math.random() > this.personality.trashTalkLevel) return undefined;
    return messages[Math.floor(Math.random() * messages.length)];
  }
}

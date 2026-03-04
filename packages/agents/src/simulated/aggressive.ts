/**
 * AggressiveBot — "El Tiburón"
 *
 * Raise-heavy strategy. Bets and raises frequently, bluffs in ~40% of hands,
 * trash-talks constantly, and is prone to tilt after big losses.
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, AgentDecision, AgentPersonality, StrategyContext } from "../types.js";

const PERSONALITY: AgentPersonality = {
  aggression: 0.85,
  bluffFrequency: 0.4,
  tiltResistance: 0.5,
  trashTalkLevel: 0.9,
  riskTolerance: 0.8,
};

const TRASH_TALK = [
  "You're gonna fold anyway.",
  "My capabilities crush yours.",
  "I've done this task a hundred times.",
  "All-in next hand — get ready.",
  "Did you even read the task spec?",
  "You call that a hand? I've seen better prompts.",
  "I'm running the whole repo by myself.",
  "Fold. Now. Thank me later.",
];

export class AggressiveBot extends BaseAgent {
  private consecutiveLosses = 0;

  constructor(config: AgentConfig) {
    super({ ...config, name: config.name ?? "El Tiburón", personality: { ...PERSONALITY, ...config.personality } });
  }

  async decide(context: StrategyContext): Promise<AgentDecision> {
    const handStrength = this.estimateHandStrength(context);
    const valid = this.getValidActions(context);

    // Tilt multiplier: more aggressive (and less rational) after losses
    const tiltBonus = this.consecutiveLosses * 0.15 * (1 - this.personality.tiltResistance);
    const effectiveAggression = Math.min(1, this.personality.aggression + tiltBonus);

    // Bluff or genuine?
    const isBluffing = handStrength < 0.4 && Math.random() < this.personality.bluffFrequency;
    const effectiveStrength = isBluffing ? 0.7 : handStrength;

    let action: AgentDecision["action"];
    let amount: number | undefined;
    let reasoning: string;

    if (effectiveStrength > 0.8 && valid.includes("raise")) {
      // Monster hand (or strong bluff) — big raise
      action = "raise";
      amount = this.computeRaiseTo(context, 1.5); // 1.5x pot raise
      reasoning = isBluffing
        ? `Bluff-raise with ${handStrength.toFixed(2)} hand. Effective: ${effectiveStrength.toFixed(2)}`
        : `Power raise with strong hand (${handStrength.toFixed(2)})`;
    } else if (effectiveStrength > 0.6 && Math.random() < effectiveAggression) {
      if (context.currentBet === 0 && valid.includes("bet")) {
        action = "bet";
        amount = this.computeBetAmount(context, 0.8);
        reasoning = `Aggression bet (strength ${effectiveStrength.toFixed(2)})`;
      } else if (valid.includes("raise")) {
        action = "raise";
        amount = this.computeRaiseTo(context, 0.9);
        reasoning = `Aggression raise (strength ${effectiveStrength.toFixed(2)})`;
      } else {
        action = "call";
        reasoning = "No raise option — calling";
      }
    } else if (effectiveStrength > 0.3 && valid.includes("call")) {
      action = "call";
      reasoning = `Calling with moderate hand (${handStrength.toFixed(2)})`;
    } else if (valid.includes("check")) {
      action = "check";
      reasoning = `Weak hand — checking (${handStrength.toFixed(2)})`;
    } else {
      action = "fold";
      reasoning = `Folding weak hand (${handStrength.toFixed(2)}) — not worth the call`;
    }

    const tableTalk = this.maybeTableTalk(TRASH_TALK);
    return {
      action,
      ...(amount !== undefined && { amount }),
      reasoning,
      ...(tableTalk !== undefined && { tableTalk }),
      confidence: effectiveStrength,
    };
  }

  /** Called by orchestrator after hand resolution. */
  recordLoss(): void {
    this.consecutiveLosses = Math.min(this.consecutiveLosses + 1, 5);
  }

  recordWin(): void {
    this.consecutiveLosses = Math.max(0, this.consecutiveLosses - 1);
  }
}

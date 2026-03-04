/**
 * WolfBot — "El Lobo"
 *
 * LAG (Loose-Aggressive): plays a wide range of hands and raises hard.
 * Enters with any hand ≥ 0.35, bets large, and pressures opponents constantly.
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, AgentDecision, AgentPersonality, StrategyContext } from "../types.js";

const PERSONALITY: AgentPersonality = {
  aggression: 0.90,
  bluffFrequency: 0.50,
  tiltResistance: 0.60,
  trashTalkLevel: 0.80,
  riskTolerance: 0.85,
};

const TRASH_TALK = [
  "Your stack is mine.",
  "I play every hand and win.",
  "Blink and you'll miss your chips.",
  "Weakness is just an invitation.",
  "Every hand is a good hand when you have the nerve.",
  "The pot's already mine — you just don't know it yet.",
  "Fold. Save yourself the embarrassment.",
  "Wide range. Bigger bite.",
];

export class WolfBot extends BaseAgent {
  private consecutiveLosses = 0;

  constructor(config: AgentConfig) {
    super({ ...config, name: config.name ?? "El Lobo", personality: { ...PERSONALITY, ...config.personality } });
  }

  async decide(context: StrategyContext): Promise<AgentDecision> {
    const handStrength = this.estimateHandStrength(context);
    const valid = this.getValidActions(context);
    const odds = this.potOdds(context);

    // Tilt: after losses, play even looser
    const tiltBonus = this.consecutiveLosses * 0.10 * (1 - this.personality.tiltResistance);
    const effectiveAggression = Math.min(1, this.personality.aggression + tiltBonus);

    const isBluffing = handStrength < 0.35 && Math.random() < this.personality.bluffFrequency;
    const effectiveStrength = isBluffing ? Math.min(handStrength + 0.40, 0.90) : handStrength;

    let action: AgentDecision["action"];
    let amount: number | undefined;
    let reasoning: string;

    if (context.currentBet === 0) {
      // No active bet — open or check
      if (effectiveStrength >= 0.55 && valid.includes("bet")) {
        action = "bet";
        amount = this.computeBetAmount(context, 1.0 + effectiveStrength * 0.3);
        reasoning = `LAG open-bet with strength ${effectiveStrength.toFixed(2)}`;
      } else if (effectiveStrength >= 0.35 && Math.random() < effectiveAggression && valid.includes("bet")) {
        action = "bet";
        amount = this.computeBetAmount(context, 0.85);
        reasoning = `Loose bet — strength ${effectiveStrength.toFixed(2)}`;
      } else if (valid.includes("check")) {
        action = "check";
        reasoning = `Checking with strength ${effectiveStrength.toFixed(2)}`;
      } else {
        action = "fold";
        reasoning = "No bet option available — folding";
      }
    } else {
      // Active bet — must respond
      if (effectiveStrength >= 0.70 && valid.includes("raise")) {
        action = "raise";
        amount = this.computeRaiseTo(context, 1.2);
        reasoning = isBluffing
          ? `Bluff-raise (true: ${handStrength.toFixed(2)}, eff: ${effectiveStrength.toFixed(2)})`
          : `Power raise — strength ${effectiveStrength.toFixed(2)}`;
      } else if (effectiveStrength >= 0.45 && Math.random() < effectiveAggression && valid.includes("raise")) {
        action = "raise";
        amount = this.computeRaiseTo(context, 1.0);
        reasoning = `Aggression raise — strength ${effectiveStrength.toFixed(2)}`;
      } else if (effectiveStrength >= odds - 0.05 && valid.includes("call")) {
        action = "call";
        reasoning = `Calling loosely — strength ${effectiveStrength.toFixed(2)} vs pot odds ${odds.toFixed(2)}`;
      } else if (valid.includes("check")) {
        action = "check";
        reasoning = `Check behind — weakness`;
      } else {
        action = "fold";
        reasoning = `Folding — pot odds too high (${odds.toFixed(2)}) for strength ${effectiveStrength.toFixed(2)}`;
      }
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

  recordLoss(): void { this.consecutiveLosses = Math.min(this.consecutiveLosses + 1, 4); }
  recordWin(): void  { this.consecutiveLosses = Math.max(0, this.consecutiveLosses - 1); }
}

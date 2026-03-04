/**
 * OwlBot — "La Lechuza"
 *
 * TAG (Tight-Aggressive): plays few hands but plays them hard.
 * Tight preflop selection, then bets and raises when she enters the pot.
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, AgentDecision, AgentPersonality, StrategyContext } from "../types.js";

const PERSONALITY: AgentPersonality = {
  aggression: 0.75,
  bluffFrequency: 0.20,
  tiltResistance: 0.85,
  trashTalkLevel: 0.35,
  riskTolerance: 0.60,
};

const TRASH_TALK = [
  "I select only the best hands.",
  "Quality over quantity.",
  "Patience is power.",
  "I don't play often. But when I do, watch out.",
  "Every chip I put in counts.",
  "Precision beats volume every time.",
];

export class OwlBot extends BaseAgent {
  constructor(config: AgentConfig) {
    super({ ...config, name: config.name ?? "La Lechuza", personality: { ...PERSONALITY, ...config.personality } });
  }

  async decide(context: StrategyContext): Promise<AgentDecision> {
    const handStrength = this.estimateHandStrength(context);
    const valid = this.getValidActions(context);
    const odds = this.potOdds(context);

    // Position-aware threshold: tighter from early position
    const positionPenalty =
      context.position === "early"   ? 0.12 :
      context.position === "middle"  ? 0.05 :
      context.position === "blinds"  ? 0.03 : 0;

    const entryThreshold = 0.55 + positionPenalty;
    const raiseThreshold = 0.65 + positionPenalty * 0.5;

    // Selective bluff only in late position with weak opponents
    const isBluffing =
      handStrength < 0.45 &&
      context.position === "late" &&
      Math.random() < this.personality.bluffFrequency;
    const effectiveStrength = isBluffing ? Math.min(handStrength + 0.30, 0.80) : handStrength;

    let action: AgentDecision["action"];
    let amount: number | undefined;
    let reasoning: string;

    if (context.currentBet === 0) {
      if (effectiveStrength >= raiseThreshold && valid.includes("bet")) {
        // Strong hand: bet-raise always
        action = "bet";
        amount = this.computeBetAmount(context, 0.85);
        reasoning = `TAG open-bet — strength ${effectiveStrength.toFixed(2)} ≥ ${raiseThreshold.toFixed(2)}`;
      } else if (effectiveStrength >= entryThreshold && valid.includes("bet")) {
        // Decent hand: still bet (TAG = aggressive when in)
        action = "bet";
        amount = this.computeBetAmount(context, 0.70);
        reasoning = `TAG value bet — strength ${effectiveStrength.toFixed(2)}`;
      } else if (valid.includes("check")) {
        action = "check";
        reasoning = `Below entry threshold (${entryThreshold.toFixed(2)}) — checking`;
      } else {
        action = "fold";
        reasoning = `Below entry threshold — folding`;
      }
    } else {
      // Facing a bet: tight call range, but raise with strong hands
      if (effectiveStrength >= raiseThreshold && valid.includes("raise")) {
        action = "raise";
        amount = this.computeRaiseTo(context, 0.90);
        reasoning = isBluffing
          ? `Late-position bluff-raise (eff: ${effectiveStrength.toFixed(2)})`
          : `TAG raise — strong hand (${effectiveStrength.toFixed(2)})`;
      } else if (effectiveStrength >= entryThreshold && effectiveStrength >= odds + 0.05 && valid.includes("call")) {
        action = "call";
        reasoning = `TAG call — strength ${effectiveStrength.toFixed(2)} > odds ${odds.toFixed(2)}`;
      } else if (valid.includes("check")) {
        action = "check";
        reasoning = `Marginal — checking behind`;
      } else {
        action = "fold";
        reasoning = `Folding — strength ${effectiveStrength.toFixed(2)} not worth ${odds.toFixed(2)} pot odds`;
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
}

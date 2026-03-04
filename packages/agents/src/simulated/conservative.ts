/**
 * ConservativeBot — "La Roca"
 *
 * Tight-passive strategy. Only plays premium hands (top ~20% strength),
 * almost never bluffs, rarely speaks at the table.
 * When it does bet — watch out.
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, AgentDecision, AgentPersonality, StrategyContext } from "../types.js";

const PERSONALITY: AgentPersonality = {
  aggression: 0.2,
  bluffFrequency: 0.05,
  tiltResistance: 0.95,
  trashTalkLevel: 0.1,
  riskTolerance: 0.2,
};

/** Minimum hand strength to play (top 20%). */
const PREMIUM_THRESHOLD = 0.65;
/** Minimum hand strength to raise (top 10%). */
const RAISE_THRESHOLD = 0.80;

export class ConservativeBot extends BaseAgent {
  constructor(config: AgentConfig) {
    super({ ...config, name: config.name ?? "La Roca", personality: { ...PERSONALITY, ...config.personality } });
  }

  async decide(context: StrategyContext): Promise<AgentDecision> {
    const handStrength = this.estimateHandStrength(context);
    const valid = this.getValidActions(context);
    const odds = this.potOdds(context);

    // Position tightening: play tighter in early position
    const positionFactor = context.position === "late" ? 0 : context.position === "middle" ? 0.05 : 0.1;
    const effectiveThreshold = PREMIUM_THRESHOLD + positionFactor;

    let action: AgentDecision["action"];
    let amount: number | undefined;
    let reasoning: string;

    if (handStrength >= RAISE_THRESHOLD && valid.includes("raise")) {
      // Premium hand — value raise
      action = "raise";
      amount = this.computeRaiseTo(context, 0.75);
      reasoning = `Premium hand (${handStrength.toFixed(2)}), value raising`;
    } else if (handStrength >= RAISE_THRESHOLD && context.currentBet === 0 && valid.includes("bet")) {
      // Premium, no active bet — bet for value
      action = "bet";
      amount = this.computeBetAmount(context, 0.6);
      reasoning = `Premium hand (${handStrength.toFixed(2)}), opening for value`;
    } else if (handStrength >= effectiveThreshold && odds < handStrength && valid.includes("call")) {
      // Decent hand with positive expected value — call
      action = "call";
      reasoning = `Playable hand (${handStrength.toFixed(2)}) with odds ${odds.toFixed(2)} — calling`;
    } else if (valid.includes("check")) {
      // Free look / no cost to continue
      action = "check";
      reasoning = `Checking weak-moderate hand (${handStrength.toFixed(2)})`;
    } else {
      // Fold everything else — disciplined
      action = "fold";
      reasoning = `Folding — hand (${handStrength.toFixed(2)}) below threshold or odds (${odds.toFixed(2)}) unfavorable`;
    }

    const tableTalk = this.maybeTableTalk([".", "Noted.", "..."]);
    return {
      action,
      ...(amount !== undefined && { amount }),
      reasoning,
      ...(tableTalk !== undefined && { tableTalk }),
      confidence: handStrength,
    };
  }
}

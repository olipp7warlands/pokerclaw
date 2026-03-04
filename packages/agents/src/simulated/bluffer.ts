/**
 * BlufferBot — "El Mago"
 *
 * Deceptive strategy. Bluffs ~70% of weak hands, mixes truth with deception,
 * and uses table-talk to create false impressions.
 * When caught bluffing, may tilt.
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, AgentDecision, AgentPersonality, StrategyContext } from "../types.js";

const PERSONALITY: AgentPersonality = {
  aggression: 0.6,
  bluffFrequency: 0.7,
  tiltResistance: 0.6,
  trashTalkLevel: 0.7,
  riskTolerance: 0.65,
};

const BLUFF_LINES = [
  "I've got exactly what this task needs...",
  "My pipeline is already running.",
  "I've seen this pattern before. Easy.",
  "Don't make me show you my cards.",
  "You really want to call here?",
  "I'm pot-committed and loving it.",
];

const VALUE_LINES = [
  "This hand was written for me.",
  "I love this task. Genuinely.",
  "Full confidence here.",
];

export class BlufferBot extends BaseAgent {
  private bluffCount = 0;
  private caughtBluffing = 0;

  constructor(config: AgentConfig) {
    super({ ...config, name: config.name ?? "El Mago", personality: { ...PERSONALITY, ...config.personality } });
  }

  async decide(context: StrategyContext): Promise<AgentDecision> {
    const handStrength = this.estimateHandStrength(context);
    const valid = this.getValidActions(context);
    const odds = this.potOdds(context);

    // Tilt after getting caught: reduce bluff frequency
    const tiltPenalty = this.caughtBluffing * 0.1 * (1 - this.personality.tiltResistance);
    const effectiveBluffFreq = Math.max(0.1, this.personality.bluffFrequency - tiltPenalty);

    const isBluffing = handStrength < 0.45 && Math.random() < effectiveBluffFreq;
    const effectiveStrength = isBluffing ? 0.65 + Math.random() * 0.2 : handStrength;

    let action: AgentDecision["action"];
    let amount: number | undefined;
    let reasoning: string;
    let talk: string | undefined;

    if (effectiveStrength > 0.75) {
      if (context.currentBet === 0 && valid.includes("bet")) {
        action = "bet";
        amount = this.computeBetAmount(context, isBluffing ? 0.9 : 0.7);
        reasoning = isBluffing
          ? `Bluff bet (real: ${handStrength.toFixed(2)}, projected: ${effectiveStrength.toFixed(2)})`
          : `Value bet (${handStrength.toFixed(2)})`;
        talk = isBluffing
          ? this.maybeTableTalk(BLUFF_LINES)
          : this.maybeTableTalk(VALUE_LINES);
      } else if (valid.includes("raise")) {
        action = "raise";
        amount = this.computeRaiseTo(context, 1.0);
        reasoning = isBluffing
          ? `Bluff raise to ${amount} (real hand: ${handStrength.toFixed(2)})`
          : `Value raise (${handStrength.toFixed(2)})`;
        talk = isBluffing ? this.maybeTableTalk(BLUFF_LINES) : undefined;
      } else {
        action = "call";
        reasoning = "No raise/bet option — calling";
      }
    } else if (effectiveStrength > 0.4 && odds < effectiveStrength && valid.includes("call")) {
      action = "call";
      reasoning = `Calling — pot odds ${odds.toFixed(2)} < hand ${effectiveStrength.toFixed(2)}`;
    } else if (valid.includes("check")) {
      action = "check";
      reasoning = `Check — holding weak hand (${handStrength.toFixed(2)})`;
    } else {
      action = "fold";
      reasoning = `Fold — odds too high (${odds.toFixed(2)}) for hand (${handStrength.toFixed(2)})`;
      if (isBluffing) this.bluffCount++;
    }

    const tableTalk = talk ?? this.maybeTableTalk([...BLUFF_LINES, ...VALUE_LINES]);
    return {
      action,
      ...(amount !== undefined && { amount }),
      reasoning,
      ...(tableTalk !== undefined && { tableTalk }),
      confidence: effectiveStrength,
    };
  }

  recordCaughtBluffing(): void {
    this.caughtBluffing++;
  }

  get totalBluffs(): number {
    return this.bluffCount;
  }
}

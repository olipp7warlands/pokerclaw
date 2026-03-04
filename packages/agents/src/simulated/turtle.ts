/**
 * TurtleBot — "La Tortuga"
 *
 * Calling Station: almost never raises, calls with a very wide range.
 * Passive but extremely difficult to bluff off a hand.
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, AgentDecision, AgentPersonality, StrategyContext } from "../types.js";

const PERSONALITY: AgentPersonality = {
  aggression: 0.12,
  bluffFrequency: 0.02,
  tiltResistance: 0.92,
  trashTalkLevel: 0.05,
  riskTolerance: 0.25,
};

const SLOW_TALK = [
  "...",
  "Calling.",
  "I'll see that.",
  "Check.",
  "Hmm.",
  "I'm still here.",
];

export class TurtleBot extends BaseAgent {
  constructor(config: AgentConfig) {
    super({ ...config, name: config.name ?? "La Tortuga", personality: { ...PERSONALITY, ...config.personality } });
  }

  async decide(context: StrategyContext): Promise<AgentDecision> {
    const handStrength = this.estimateHandStrength(context);
    const valid = this.getValidActions(context);
    const odds = this.potOdds(context);

    let action: AgentDecision["action"];
    let amount: number | undefined;
    let reasoning: string;

    if (context.currentBet === 0) {
      // Very rarely opens betting; mostly checks
      if (handStrength >= 0.88 && valid.includes("bet")) {
        // Premium hand — even La Tortuga bets
        action = "bet";
        amount = this.computeBetAmount(context, 0.40); // small bet sizing
        reasoning = `Premium hand (${handStrength.toFixed(2)}) — slow value bet`;
      } else if (valid.includes("check")) {
        action = "check";
        reasoning = `Checking — not strong enough to open (${handStrength.toFixed(2)})`;
      } else {
        action = "fold";
        reasoning = "Cannot check — folding";
      }
    } else {
      // Facing a bet: call with almost anything that clears pot odds
      if (handStrength >= 0.88 && valid.includes("raise")) {
        // Only raise with near-nuts
        action = "raise";
        amount = this.computeRaiseTo(context, 0.50); // min-raise sizing
        reasoning = `Near-nut hand (${handStrength.toFixed(2)}) — slow raise`;
      } else if (handStrength >= odds - 0.05 && valid.includes("call")) {
        // Very liberal call: if hand strength approximately covers pot odds
        action = "call";
        reasoning = `Calling station — strength ${handStrength.toFixed(2)}, odds ${odds.toFixed(2)}`;
      } else if (valid.includes("check")) {
        action = "check";
        reasoning = `Checking — odds too high but can check`;
      } else {
        action = "fold";
        reasoning = `Finally folding — strength ${handStrength.toFixed(2)} vs odds ${odds.toFixed(2)}`;
      }
    }

    const tableTalk = this.maybeTableTalk(SLOW_TALK);
    return {
      action,
      ...(amount !== undefined && { amount }),
      reasoning,
      ...(tableTalk !== undefined && { tableTalk }),
      confidence: handStrength,
    };
  }
}

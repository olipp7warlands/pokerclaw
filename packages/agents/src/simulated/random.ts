/**
 * RandomBot — "El Caos"
 *
 * Selects a uniformly random valid action each turn.
 * Amount (when required) is also random between min and max.
 * Useful as a baseline / chaos monkey for testing.
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, AgentDecision, AgentPersonality, StrategyContext } from "../types.js";

const PERSONALITY: AgentPersonality = {
  aggression: 0.5,
  bluffFrequency: 0.5,
  tiltResistance: 0.5,
  trashTalkLevel: 0.5,
  riskTolerance: 0.5,
};

export class RandomBot extends BaseAgent {
  constructor(config: AgentConfig) {
    super({ ...config, name: config.name ?? "El Caos", personality: { ...PERSONALITY, ...config.personality } });
  }

  async decide(context: StrategyContext): Promise<AgentDecision> {
    const valid = this.getValidActions(context);
    const action = valid[Math.floor(Math.random() * valid.length)]!;
    let amount: number | undefined;

    if (action === "bet") {
      const min = context.bigBlind;
      const max = context.myStack;
      amount = min + Math.floor(Math.random() * (max - min + 1));
    } else if (action === "raise") {
      const minRaiseTo = context.currentBet + Math.max(context.lastRaiseSize, context.bigBlind);
      // maxRaiseTo = chips already committed this round + remaining stack (engine rule)
      const maxRaiseTo = context.myCurrentBet + context.myStack;
      amount = minRaiseTo + Math.floor(Math.random() * (maxRaiseTo - minRaiseTo + 1));
    }

    const tableTalk = this.maybeTableTalk(["?", "...", "¯\\_(ツ)_/¯"]);
    return {
      action,
      ...(amount !== undefined && { amount }),
      reasoning: `Random selection from: [${valid.join(", ")}]`,
      ...(tableTalk !== undefined && { tableTalk }),
      confidence: 0.5,
    };
  }
}

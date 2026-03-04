/**
 * CalculatedBot — "El Reloj"
 *
 * The strongest simulated bot. Uses pot-odds vs hand-strength to make
 * mathematically grounded decisions. Raises with strong hands, calls
 * when equity > pot odds, folds the rest.
 *
 * Bluffs sparingly and only when positionally favored.
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, AgentDecision, AgentPersonality, StrategyContext } from "../types.js";

const PERSONALITY: AgentPersonality = {
  aggression: 0.55,
  bluffFrequency: 0.15,
  tiltResistance: 0.9,
  trashTalkLevel: 0.3,
  riskTolerance: 0.5,
};

/** Threshold above which the bot opens betting. */
const BET_THRESHOLD = 0.60;
/** Multiplier over pot-odds required to raise (ensures positive edge). */
const RAISE_EDGE_MULTIPLE = 1.8;
/** Multiplier over pot-odds required to call. */
const CALL_EDGE_MULTIPLE = 1.1;

export class CalculatedBot extends BaseAgent {
  constructor(config: AgentConfig) {
    super({ ...config, name: config.name ?? "El Reloj", personality: { ...PERSONALITY, ...config.personality } });
  }

  async decide(context: StrategyContext): Promise<AgentDecision> {
    const handStrength = this.estimateHandStrength(context);
    const odds = this.potOdds(context);
    const valid = this.getValidActions(context);
    const position = context.position;

    // Position bonus: late position allows wider range
    const posBonus = position === "late" ? 0.05 : position === "middle" ? 0.02 : 0;
    const effectiveStrength = handStrength + posBonus;

    // Opportunistic bluff: late position, opponents seem weak (no raises recently)
    const recentRaises = context.eventHistory
      .slice(-6)
      .filter((e) => e.type === "action-taken" && (e as { type: string; agentId?: string }).agentId !== context.agentId)
      .length;
    const opponentsSeemWeak = recentRaises === 0 && context.opponents.every((o) => !o.isAllIn);
    const canBluff =
      position === "late" &&
      opponentsSeemWeak &&
      Math.random() < this.personality.bluffFrequency;

    let action: AgentDecision["action"];
    let amount: number | undefined;
    let reasoning: string;

    // -----------------------------------------------------------------------
    // No active bet — check or open betting
    // -----------------------------------------------------------------------
    if (context.currentBet === 0) {
      if (effectiveStrength >= BET_THRESHOLD && valid.includes("bet")) {
        action = "bet";
        // Bet size: scale with strength (0.5–1.0 pot)
        const betMult = 0.5 + effectiveStrength * 0.5;
        amount = this.computeBetAmount(context, betMult);
        reasoning = `Opening bet — strength ${effectiveStrength.toFixed(2)}, sizing ${betMult.toFixed(2)}x pot`;
      } else if (canBluff && valid.includes("bet")) {
        action = "bet";
        amount = this.computeBetAmount(context, 0.5);
        reasoning = `Positional bluff — weak hand (${handStrength.toFixed(2)}) but good position`;
      } else if (valid.includes("check")) {
        action = "check";
        reasoning = `Checking — hand ${effectiveStrength.toFixed(2)} below open threshold`;
      } else {
        action = "fold";
        reasoning = "No free check available and hand too weak to bet";
      }

    // -----------------------------------------------------------------------
    // Active bet — must call, raise, or fold
    // -----------------------------------------------------------------------
    } else {
      if (effectiveStrength > odds * RAISE_EDGE_MULTIPLE && valid.includes("raise")) {
        // Strong edge — raise
        const raiseMult = 0.6 + effectiveStrength * 0.6;
        action = "raise";
        amount = this.computeRaiseTo(context, raiseMult);
        reasoning = `Raising — strength ${effectiveStrength.toFixed(2)} >> odds ${odds.toFixed(2)} (${RAISE_EDGE_MULTIPLE}x edge)`;
      } else if (effectiveStrength > odds * CALL_EDGE_MULTIPLE && valid.includes("call")) {
        action = "call";
        reasoning = `Calling — strength ${effectiveStrength.toFixed(2)} > odds ${odds.toFixed(2)}`;
      } else if (canBluff && valid.includes("raise")) {
        action = "raise";
        amount = this.computeRaiseTo(context, 0.5);
        reasoning = `Semi-bluff raise — weak hand but positional advantage`;
      } else if (valid.includes("check")) {
        action = "check";
        reasoning = `Checking back — hand ${effectiveStrength.toFixed(2)} < odds ${odds.toFixed(2)}`;
      } else {
        action = "fold";
        reasoning = `Folding — hand ${effectiveStrength.toFixed(2)}, odds ${odds.toFixed(2)}: no edge`;
      }
    }

    const tableTalk = this.maybeTableTalk([
      "Running the numbers.",
      "Pot odds check.",
      "This is optimal.",
    ]);
    return {
      action,
      ...(amount !== undefined && { amount }),
      reasoning,
      ...(tableTalk !== undefined && { tableTalk }),
      confidence: Math.min(1, effectiveStrength),
    };
  }
}

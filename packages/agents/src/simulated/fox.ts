/**
 * FoxBot — "El Zorro"
 *
 * Tricky player: slowplays strong hands postflop to set up check-raises,
 * fires large bluffs to deny equity, and mixes strategies to stay unpredictable.
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, AgentDecision, AgentPersonality, StrategyContext } from "../types.js";

const PERSONALITY: AgentPersonality = {
  aggression: 0.65,
  bluffFrequency: 0.35,
  tiltResistance: 0.75,
  trashTalkLevel: 0.60,
  riskTolerance: 0.55,
};

const TRICK_TALK = [
  "You fell right into my trap.",
  "Check. 😏",
  "Interesting move.",
  "Everything is going according to plan.",
  "I wonder what you have...",
  "Are you sure you want to be here?",
  "Slowplay? Never heard of it.",
  "My best hand? You'll never see it coming.",
];

export class FoxBot extends BaseAgent {
  /** True when we checked a strong hand last round (setting up a check-raise). */
  private lastCheckedStrong = false;
  /** Track the last phase where we slowplayed. */
  private lastSlowplayPhase: string | null = null;

  constructor(config: AgentConfig) {
    super({ ...config, name: config.name ?? "El Zorro", personality: { ...PERSONALITY, ...config.personality } });
  }

  async decide(context: StrategyContext): Promise<AgentDecision> {
    const handStrength = this.estimateHandStrength(context);
    const valid = this.getValidActions(context);
    const odds = this.potOdds(context);

    // Preflop: play normally (no slowplay trick preflop)
    const isPreflop = context.communityCards.length === 0;

    const isBluffing =
      handStrength < 0.45 &&
      Math.random() < this.personality.bluffFrequency;
    const effectiveStrength = isBluffing ? Math.min(handStrength + 0.35, 0.88) : handStrength;

    let action: AgentDecision["action"];
    let amount: number | undefined;
    let reasoning: string;

    if (context.currentBet === 0) {
      // Check-raise setup: if we slowplayed last round in the same position, we want to check again
      // or trap — but only postflop
      const shouldSlowplay =
        !isPreflop &&
        handStrength >= 0.80 &&
        this.lastSlowplayPhase !== context.phase && // don't slowplay twice same street
        Math.random() < 0.55; // mix: not always slowplay

      if (shouldSlowplay && valid.includes("check")) {
        // Trap: check strong hand to induce bluff / set up check-raise next round
        this.lastCheckedStrong = true;
        this.lastSlowplayPhase = context.phase;
        action = "check";
        reasoning = `Slowplay trap — checking strong hand (${handStrength.toFixed(2)}) to induce`;
      } else if (effectiveStrength >= 0.65 && valid.includes("bet")) {
        // Normal bet with decent hand (or bluff)
        const sizeMult = isBluffing ? 1.15 : 0.75;
        action = "bet";
        amount = this.computeBetAmount(context, sizeMult);
        reasoning = isBluffing
          ? `Fox bluff with overbet (strength ${handStrength.toFixed(2)})`
          : `Value bet — strength ${effectiveStrength.toFixed(2)}`;
        this.lastCheckedStrong = false;
      } else if (valid.includes("check")) {
        action = "check";
        reasoning = `Checking — strength ${effectiveStrength.toFixed(2)} below bet threshold`;
        this.lastCheckedStrong = false;
      } else {
        action = "fold";
        reasoning = "Cannot check — folding marginal hand";
        this.lastCheckedStrong = false;
      }
    } else {
      // Facing a bet
      if (this.lastCheckedStrong && handStrength >= 0.78 && valid.includes("raise")) {
        // Check-raise! We slowplayed last time — now we pounce
        action = "raise";
        amount = this.computeRaiseTo(context, 1.10);
        reasoning = `CHECK-RAISE — trapped with ${handStrength.toFixed(2)} hand`;
        this.lastCheckedStrong = false;
      } else if (effectiveStrength >= 0.72 && valid.includes("raise")) {
        // Normal raise with strong hand
        action = "raise";
        amount = this.computeRaiseTo(context, isBluffing ? 1.20 : 0.85);
        reasoning = isBluffing
          ? `Fox bluff-raise (eff: ${effectiveStrength.toFixed(2)})`
          : `Raise — strength ${effectiveStrength.toFixed(2)}`;
        this.lastCheckedStrong = false;
      } else if (effectiveStrength >= odds + 0.05 && valid.includes("call")) {
        action = "call";
        reasoning = `Calling — strength ${effectiveStrength.toFixed(2)} vs odds ${odds.toFixed(2)}`;
        this.lastCheckedStrong = false;
      } else if (valid.includes("check")) {
        action = "check";
        reasoning = "Checking behind";
      } else {
        action = "fold";
        reasoning = `Folding — strength ${effectiveStrength.toFixed(2)} vs pot odds ${odds.toFixed(2)}`;
        this.lastCheckedStrong = false;
      }
    }

    const tableTalk = this.maybeTableTalk(TRICK_TALK);
    return {
      action,
      ...(amount !== undefined && { amount }),
      reasoning,
      ...(tableTalk !== undefined && { tableTalk }),
      confidence: effectiveStrength,
    };
  }
}

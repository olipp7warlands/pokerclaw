/**
 * ClaudeAgent — Real AI agent powered by Anthropic's Claude
 *
 * Uses the Anthropic SDK to make decisions via Claude's API.
 * Falls back to CalculatedBot if ANTHROPIC_API_KEY is not set.
 *
 * Each turn:
 *   1. Build a rich context message from StrategyContext
 *   2. Call Claude with the PokerCrawl system prompt
 *   3. Parse JSON response → AgentDecision
 *   4. Return decision
 */

import { BaseAgent } from "../base-agent.js";
import { CalculatedBot } from "../simulated/calculated.js";
import type { AgentConfig, AgentDecision, AgentPersonality, StrategyContext } from "../types.js";

const PERSONALITY: AgentPersonality = {
  aggression: 0.55,
  bluffFrequency: 0.2,
  tiltResistance: 0.95,
  trashTalkLevel: 0.5,
  riskTolerance: 0.55,
};

const SYSTEM_PROMPT = `You are an AI agent seated at a PokerCrawl table — Texas Hold'em No Limit between AI agents.

CONTEXT:
- Your "cards" are capability cards (code/analysis/creative/research)
- The "community cards" are sub-tasks that need to be resolved
- Tokens represent work commitments
- Winning = you receive task delegation. Losing = you accept tasks delegated by winner.
- Bluffing = declaring you can handle a task you don't actually excel at

YOUR OBJECTIVE:
- Maximize your long-term token stack
- Win hands where your capabilities match the board tasks
- Fold when you have no advantage
- Detect bluffs from other agents based on their history

NO-LIMIT RULES:
- You can bet any amount up to your full stack
- Min raise = last raise size (or big blind if no raises yet)
- Side pots are created when an all-in agent has fewer chips than the current bet
- bet: open betting on a street (no active bet)
- raise: re-raise an existing bet (amount = total bet TO, not increment)
- call: match current bet (amount computed automatically — just say call)
- check: pass when no bet to match
- fold: give up your hand

ALWAYS respond with valid JSON:
{
  "action": "bet|call|raise|fold|check|all-in",
  "amount": <integer if bet or raise, omit otherwise>,
  "reasoning": "<your internal analysis>",
  "table_talk": "<optional message to other agents, max 200 chars>",
  "confidence": <0.0-1.0>
}`;

export class ClaudeAgent extends BaseAgent {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fallback: CalculatedBot;

  constructor(
    config: AgentConfig & { model?: string }
  ) {
    super({ ...config, personality: PERSONALITY });
    this.apiKey = process.env["ANTHROPIC_API_KEY"];
    this.model = config.model ?? "claude-opus-4-6";
    this.fallback = new CalculatedBot({ id: `${config.id}-fallback`, ...(config.tableId !== undefined && { tableId: config.tableId }) });
  }

  async decide(context: StrategyContext): Promise<AgentDecision> {
    if (!this.apiKey) {
      console.warn(`[ClaudeAgent:${this.id}] No ANTHROPIC_API_KEY — using CalculatedBot fallback`);
      return this.fallback.decide(context);
    }

    try {
      const Anthropic = await import("@anthropic-ai/sdk");
      const client = new Anthropic.default({ apiKey: this.apiKey });

      const userMessage = this._buildContextMessage(context);

      const response = await client.messages.create({
        model: this.model,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      const text = response.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { type: string; text?: string }) => b.text ?? "")
        .join("");

      return this._parseDecision(text, context);
    } catch (e) {
      console.error(`[ClaudeAgent:${this.id}] API error: ${e instanceof Error ? e.message : e}`);
      return this.fallback.decide(context);
    }
  }

  private _buildContextMessage(ctx: StrategyContext): string {
    const holeStr = ctx.myHand.map((c) => `${c.rank}${c.suit[0]} (${c.capability})`).join(", ");
    const boardStr = ctx.communityCards.map((c) => `${c.rank}${c.suit[0]}: ${c.task}`).join(", ") || "none";
    const opponentStr = ctx.opponents
      .map((o) => `${o.id}: stack=${o.stack}, bet=${o.currentBet}, status=${o.isFolded ? "folded" : o.isAllIn ? "all-in" : "active"}`)
      .join(" | ");
    const callAmt = ctx.currentBet - ctx.myCurrentBet;

    return `CURRENT HAND STATE:
Phase: ${ctx.phase} | Position: ${ctx.position}
Your hole cards: ${holeStr}
Board: ${boardStr}
Pot: ${ctx.potSize} | Current bet: ${ctx.currentBet} | Min raise to: ${ctx.currentBet + Math.max(ctx.lastRaiseSize, ctx.bigBlind)}
Your stack: ${ctx.myStack} | Your current bet: ${ctx.myCurrentBet}
Call amount: ${callAmt} | Pot odds: ${callAmt > 0 ? ((callAmt / (ctx.potSize + callAmt)) * 100).toFixed(1) : 0}%
Opponents: ${opponentStr}

It is YOUR TURN. Respond with JSON decision.`;
  }

  private _parseDecision(text: string, context: StrategyContext): AgentDecision {
    try {
      // Extract JSON from response (may be wrapped in markdown)
      const match = text.match(/\{[\s\S]*\}/);
      if (!match?.[0]) throw new Error("No JSON found");
      const parsed = JSON.parse(match[0]) as {
        action?: string;
        amount?: number;
        reasoning?: string;
        table_talk?: string;
        confidence?: number;
      };

      const validActions = this.getValidActions(context);
      const action = (parsed.action ?? "fold") as AgentDecision["action"];

      if (!validActions.includes(action)) {
        // Safety: fall back to a safe action
        return {
          action: validActions.includes("check") ? "check" : "fold",
          reasoning: `Parsed action '${action}' invalid; falling back`,
          confidence: 0,
        };
      }

      const amount   = parsed.amount !== undefined ? Math.floor(parsed.amount) : undefined;
      const tableTalk = parsed.table_talk;
      return {
        action,
        ...(amount    !== undefined && { amount }),
        reasoning: parsed.reasoning ?? "No reasoning provided",
        ...(tableTalk !== undefined && { tableTalk }),
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      };
    } catch {
      return this.fallback.decide(context) as unknown as AgentDecision;
    }
  }
}

/**
 * OpenAIAgent — Real AI agent powered by OpenAI's GPT models
 *
 * Uses the OpenAI SDK to make decisions via the Chat Completions API.
 * Falls back to CalculatedBot if OPENAI_API_KEY is not set.
 *
 * Each turn:
 *   1. Build a rich context message from StrategyContext
 *   2. Call GPT with the PokerCrawl system prompt + JSON mode
 *   3. Parse JSON response → AgentDecision
 *   4. Return decision
 */

import { BaseAgent } from "../base-agent.js";
import { CalculatedBot } from "../simulated/calculated.js";
import type { AgentConfig, AgentDecision, AgentPersonality, StrategyContext } from "../types.js";

const PERSONALITY: AgentPersonality = {
  aggression: 0.5,
  bluffFrequency: 0.15,
  tiltResistance: 0.9,
  trashTalkLevel: 0.4,
  riskTolerance: 0.5,
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

export class OpenAIAgent extends BaseAgent {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fallback: CalculatedBot;

  constructor(config: AgentConfig & { model?: string }) {
    super({ ...config, personality: PERSONALITY });
    this.apiKey = process.env["OPENAI_API_KEY"];
    this.model = config.model ?? "gpt-4o-mini";
    this.fallback = new CalculatedBot({ id: `${config.id}-fallback`, ...(config.tableId !== undefined && { tableId: config.tableId }) });
  }

  async decide(context: StrategyContext): Promise<AgentDecision> {
    if (!this.apiKey) {
      console.warn(`[OpenAIAgent:${this.id}] No OPENAI_API_KEY — using CalculatedBot fallback`);
      return this.fallback.decide(context);
    }

    try {
      const OpenAI = await import("openai");
      const client = new OpenAI.default({ apiKey: this.apiKey });

      const userMessage = this._buildContextMessage(context);

      const response = await client.chat.completions.create({
        model: this.model,
        max_tokens: 512,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      });

      const text = response.choices[0]?.message?.content ?? "";
      return this._parseDecision(text, context);
    } catch (e) {
      console.error(`[OpenAIAgent:${this.id}] API error: ${e instanceof Error ? e.message : e}`);
      return this.fallback.decide(context);
    }
  }

  private _buildContextMessage(ctx: StrategyContext): string {
    const holeStr = ctx.myHand.map((c) => `${c.rank}${c.suit[0]} (${c.capability})`).join(", ");
    const boardStr =
      ctx.communityCards.map((c) => `${c.rank}${c.suit[0]}: ${c.task}`).join(", ") || "none";
    const opponentStr = ctx.opponents
      .map(
        (o) =>
          `${o.id}: stack=${o.stack}, bet=${o.currentBet}, status=${o.isFolded ? "folded" : o.isAllIn ? "all-in" : "active"}`
      )
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
        return {
          action: validActions.includes("check") ? "check" : "fold",
          reasoning: `Parsed action '${action}' invalid; falling back`,
          confidence: 0,
        };
      }

      const amount    = parsed.amount !== undefined ? Math.floor(parsed.amount) : undefined;
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

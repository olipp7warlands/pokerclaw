/**
 * Core inference logic, decoupled from HTTP so it can be tested without
 * spinning up an Express server.
 */

import { calculateCost } from "./billing/token-counter.js";
import { getPrice }       from "./billing/pricing.js";
import type { TokenLedgerService }  from "./token-ledger.js";
import type { APIKeyManager }       from "./auth/api-keys.js";
import type { LLMProvider, ChatMessage } from "./providers/base-provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InferenceRequest {
  agentId:   string;
  provider:  string;
  model:     string;
  messages:  ChatMessage[];
  maxTokens: number;
}

export interface InferenceResult {
  response:         string;
  tokensUsed:       { inputTokens: number; outputTokens: number };
  costUSD:          number;
  remainingBalance: number;
}

// ---------------------------------------------------------------------------
// runInference
// ---------------------------------------------------------------------------

/**
 * Verify balance, call the LLM, deduct costs, return result.
 *
 * @throws If no API key is registered or the agent has zero balance.
 */
export async function runInference(
  ledger:       TokenLedgerService,
  keyManager:   APIKeyManager,
  provider:     LLMProvider,
  req:          InferenceRequest,
): Promise<InferenceResult> {
  const { agentId, provider: providerName, model, messages, maxTokens } = req;

  // 1. Retrieve decrypted API key
  const apiKey = await keyManager.getKey(agentId, providerName);
  if (!apiKey) {
    throw new Error(`No API key registered for agent "${agentId}" on provider "${providerName}"`);
  }

  // 2. Pre-flight balance check: ensure at least the max possible cost is coverable.
  const price = getPrice(model);
  if (price) {
    const maxCostUSD       = (maxTokens  / 1_000_000) * price.outputPer1M;
    const maxGameTokenCost = Math.ceil(maxCostUSD * 1_000_000);
    const balance          = await ledger.getBalance(agentId);

    if (balance.gameTokens < maxGameTokenCost) {
      throw new Error(
        `Insufficient balance: ${agentId} has ${balance.gameTokens} tokens, ` +
        `needs up to ${maxGameTokenCost} for ${maxTokens} output tokens on ${model}`,
      );
    }
  }

  // 3. Call provider
  const result = await provider.chat(messages, maxTokens, apiKey, model);

  // 4. Record actual spend in ledger
  await ledger.spend(agentId, providerName, model, result.inputTokens, result.outputTokens);

  // 5. Return summary
  const updated = await ledger.getBalance(agentId);

  return {
    response:         result.content,
    tokensUsed:       { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    costUSD:          calculateCost(model, result.inputTokens, result.outputTokens),
    remainingBalance: updated.gameTokens,
  };
}

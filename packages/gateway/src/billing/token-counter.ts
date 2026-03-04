/**
 * Token counting and cost calculation utilities.
 */

import { getPrice } from "./pricing.js";

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the number of tokens in a text string.
 *
 * Rule of thumb: ~4 characters per token (English prose, code).
 * This matches the common heuristic used by OpenAI and Anthropic.
 */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the USD cost for a given model and token counts.
 *
 * Returns 0 if the model is not in the pricing table.
 *
 * @param model         Model identifier (e.g. "gpt-4o-mini")
 * @param inputTokens   Number of prompt/input tokens consumed
 * @param outputTokens  Number of completion/output tokens generated
 * @returns             Cost in USD (floating point)
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = getPrice(model);
  if (!price) return 0;

  const inputCost  = (inputTokens  / 1_000_000) * price.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * price.outputPer1M;
  return inputCost + outputCost;
}

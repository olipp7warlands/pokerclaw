/**
 * Token pricing table and cross-model conversion utilities.
 *
 * Prices are in USD per 1,000,000 tokens (1M tokens).
 * Source: official provider pricing pages as of 2025.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelId =
  | "claude-sonnet-4-20250514"
  | "claude-haiku-4-5-20251001"
  | "claude-opus-4-20250514"
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gemini-2.0-flash"
  | "gemini-2.5-pro";

export interface PriceEntry {
  /** USD per 1M input (prompt) tokens. */
  inputPer1M: number;
  /** USD per 1M output (completion) tokens. */
  outputPer1M: number;
}

// ---------------------------------------------------------------------------
// Pricing table
// ---------------------------------------------------------------------------

export const PRICES: Record<ModelId, PriceEntry> = {
  "claude-sonnet-4-20250514":  { inputPer1M:  3.00, outputPer1M: 15.00 },
  "claude-haiku-4-5-20251001": { inputPer1M:  0.80, outputPer1M:  4.00 },
  "claude-opus-4-20250514":    { inputPer1M: 15.00, outputPer1M: 75.00 },
  "gpt-4o":                    { inputPer1M:  2.50, outputPer1M: 10.00 },
  "gpt-4o-mini":               { inputPer1M:  0.15, outputPer1M:  0.60 },
  "gemini-2.0-flash":          { inputPer1M:  0.10, outputPer1M:  0.40 },
  "gemini-2.5-pro":            { inputPer1M:  1.25, outputPer1M: 10.00 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the PriceEntry for a model, or undefined if the model is unknown.
 */
export function getPrice(model: string): PriceEntry | undefined {
  return PRICES[model as ModelId];
}

/**
 * Convert `fromAmount` tokens (denominated in `fromModel`) to an equivalent
 * number of tokens denominated in `toModel`, based on USD output-token value.
 *
 * Example: 1,000 GPT-4o tokens ≈ 2,500 gemini-2.0-flash tokens (both ~$0.01 USD).
 *
 * @returns Equivalent token count in `toModel`, rounded to the nearest integer.
 */
export function convertTokens(
  fromModel: ModelId,
  fromAmount: number,
  toModel: ModelId,
): number {
  const from = PRICES[fromModel];
  const to   = PRICES[toModel];

  // USD value of fromAmount output tokens of fromModel
  const usd = (fromAmount / 1_000_000) * from.outputPer1M;

  // How many output tokens of toModel that USD buys
  return Math.round((usd / to.outputPer1M) * 1_000_000);
}

/**
 * Returns the USD value of `amount` output tokens for a given model.
 */
export function tokensToUSD(model: ModelId, amount: number): number {
  return (amount / 1_000_000) * PRICES[model].outputPer1M;
}

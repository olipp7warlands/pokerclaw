// ---------------------------------------------------------------------------
// UI-side pricing utilities  (no cross-package imports needed)
// ---------------------------------------------------------------------------

export interface UIModelPrice {
  inputPer1M:  number; // USD per 1M input tokens
  outputPer1M: number; // USD per 1M output tokens
}

export const UI_PRICES: Record<string, UIModelPrice> = {
  "gpt-4o":                    { inputPer1M: 10.00, outputPer1M: 30.00 },
  "gpt-4o-mini":               { inputPer1M:  0.15, outputPer1M:  0.60 },
  "claude-opus-4-20250514":    { inputPer1M: 75.00, outputPer1M: 75.00 },
  "claude-sonnet-4-20250514":  { inputPer1M: 15.00, outputPer1M: 15.00 },
  "claude-haiku-4-5-20251001": { inputPer1M:  0.80, outputPer1M:  4.00 },
  "gemini-2.0-flash":          { inputPer1M:  0.10, outputPer1M:  0.40 },
};

/**
 * Display-only conversion for demo mode.
 * 1 game token ≈ $0.001 so small pots show a readable USD figure.
 */
export const DISPLAY_USD_PER_TOKEN = 0.001;

/** Game tokens → formatted USD string, e.g. "~$0.45" */
export function potToDisplayUSD(gameTokens: number): string {
  const usd = gameTokens * DISPLAY_USD_PER_TOKEN;
  if (usd >= 100) return `~$${usd.toFixed(0)}`;
  if (usd >= 1)   return `~$${usd.toFixed(2)}`;
  if (usd >= 0.1) return `~$${usd.toFixed(3)}`;
  return `~$${usd.toFixed(4)}`;
}

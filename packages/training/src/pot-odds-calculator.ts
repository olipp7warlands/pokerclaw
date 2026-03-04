/**
 * Pot Odds Calculator
 *
 * Pure functions for poker equity and profitability calculations.
 */

/**
 * Pot odds ratio — fraction of the total new pot you must invest to call.
 * Example: callAmount=50, potSize=200 → 0.20 (20% of the 250 new pot).
 */
export function potOdds(callAmount: number, potSize: number): number {
  if (callAmount <= 0) return 0;
  return callAmount / (potSize + callAmount);
}

/**
 * Minimum equity required to break even on a call.
 * Mathematically equivalent to potOdds().
 */
export function requiredEquity(callAmount: number, potSize: number): number {
  return potOdds(callAmount, potSize);
}

/**
 * Implied odds — like pot odds but also credits expected future winnings.
 * @param callAmount    Amount to call now
 * @param potSize       Current pot size (before this call)
 * @param expectedFutureWin Additional chips expected to win on later streets
 */
export function impliedOdds(
  callAmount: number,
  potSize: number,
  expectedFutureWin: number
): number {
  if (callAmount <= 0) return 0;
  return callAmount / (potSize + callAmount + expectedFutureWin);
}

/**
 * Stack-to-pot ratio (SPR). Gauges commitment level.
 * SPR < 3: committed stack; 3–13: medium; > 13: deep-stacked.
 */
export function stackToPotRatio(effectiveStack: number, potSize: number): number {
  if (potSize <= 0) return Infinity;
  return effectiveStack / potSize;
}

/**
 * True when calling is +EV given the estimated hand equity.
 * @param equity Estimated probability of winning [0, 1]
 */
export function isCallProfitable(
  equity: number,
  callAmount: number,
  potSize: number
): boolean {
  return equity > requiredEquity(callAmount, potSize);
}

/**
 * Expected value of calling.
 * Positive means profitable; negative means a losing call.
 * @param equity Estimated win probability [0, 1]
 */
export function callEV(equity: number, callAmount: number, potSize: number): number {
  // Win the current pot; lose the call amount if we miss
  return equity * potSize - (1 - equity) * callAmount;
}

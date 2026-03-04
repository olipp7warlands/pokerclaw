/**
 * PokerCrawl — Hand Evaluator
 *
 * Evaluates the best 5-card poker hand from 2 hole cards + up to 5 community
 * cards (7 total). Returns a ranking and numeric score for comparison.
 *
 * In PokerCrawl semantics, a "hand" represents how well an agent's capabilities
 * (hole cards) match the tasks on the board (community cards).
 */

import type {
  Card,
  EvaluatedHand,
  HandRank,
  HandRankValue,
  RankValue,
} from "./types.js";

// ---------------------------------------------------------------------------
// Rank value helpers
// ---------------------------------------------------------------------------

export const RANK_VALUE_MAP: Record<string, RankValue> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
} as const;

export const HAND_RANK_VALUE: Record<HandRank, HandRankValue> = {
  "high-card": 0,
  pair: 1,
  "two-pair": 2,
  "three-of-a-kind": 3,
  straight: 4,
  flush: 5,
  "full-house": 6,
  "four-of-a-kind": 7,
  "straight-flush": 8,
  "royal-flush": 9,
} as const;

// ---------------------------------------------------------------------------
// Combination helpers
// ---------------------------------------------------------------------------

/** Generate all C(n, k) combinations of an array. */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  if (first === undefined) return [];
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

// ---------------------------------------------------------------------------
// 5-card classification
// ---------------------------------------------------------------------------

function sortDesc(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => b.value - a.value);
}

function isFlush(cards: Card[]): boolean {
  return cards.every((c) => c.suit === cards[0]?.suit);
}

function isStraight(sorted: Card[]): { is: boolean; highValue: RankValue } {
  const vals = sorted.map((c) => c.value);

  // Normal straight
  let straight = true;
  for (let i = 0; i < vals.length - 1; i++) {
    if ((vals[i] ?? 0) - (vals[i + 1] ?? 0) !== 1) {
      straight = false;
      break;
    }
  }
  if (straight) return { is: true, highValue: vals[0] as RankValue };

  // Wheel: A-2-3-4-5
  const isWheel =
    vals.length === 5 &&
    vals[0] === 14 &&
    vals[1] === 5 &&
    vals[2] === 4 &&
    vals[3] === 3 &&
    vals[4] === 2;
  if (isWheel) return { is: true, highValue: 5 as RankValue };

  return { is: false, highValue: 0 as RankValue };
}

/** Encode tiebreaker values into a single comparable number. */
function encodeKickers(values: number[]): number {
  // Weights: each slot is 15^position so ordering is preserved
  let score = 0;
  for (let i = 0; i < values.length; i++) {
    score += (values[i] ?? 0) * Math.pow(15, values.length - 1 - i);
  }
  return score;
}

function groupByRank(cards: Card[]): Map<RankValue, Card[]> {
  const map = new Map<RankValue, Card[]>();
  for (const c of cards) {
    const group = map.get(c.value) ?? [];
    group.push(c);
    map.set(c.value, group);
  }
  return map;
}

/** Evaluate exactly 5 cards → EvaluatedHand (sans `bestFive` field). */
function evaluateFive(cards: Card[]): { rank: HandRank; rankValue: HandRankValue; score: number } {
  const sorted = sortDesc(cards);
  const vals = sorted.map((c) => c.value);
  const flush = isFlush(sorted);
  const { is: straight, highValue: straightHigh } = isStraight(sorted);
  const groups = groupByRank(sorted);

  // Counts
  const counts = [...groups.values()].map((g) => g.length).sort((a, b) => b - a);

  if (flush && straight) {
    if (straightHigh === 14 && vals[1] === 13) {
      // A-K-Q-J-10 flush
      return { rank: "royal-flush", rankValue: 9, score: 0 };
    }
    return {
      rank: "straight-flush",
      rankValue: 8,
      score: encodeKickers([straightHigh]),
    };
  }

  if (counts[0] === 4) {
    const quad = [...groups.entries()].find(([, g]) => g.length === 4)!;
    const kicker = [...groups.entries()].find(([, g]) => g.length === 1)!;
    return {
      rank: "four-of-a-kind",
      rankValue: 7,
      score: encodeKickers([quad[0], kicker[0]]),
    };
  }

  if (counts[0] === 3 && counts[1] === 2) {
    const trips = [...groups.entries()].find(([, g]) => g.length === 3)!;
    const pair = [...groups.entries()].find(([, g]) => g.length === 2)!;
    return {
      rank: "full-house",
      rankValue: 6,
      score: encodeKickers([trips[0], pair[0]]),
    };
  }

  if (flush) {
    return {
      rank: "flush",
      rankValue: 5,
      score: encodeKickers(vals),
    };
  }

  if (straight) {
    return {
      rank: "straight",
      rankValue: 4,
      score: encodeKickers([straightHigh]),
    };
  }

  if (counts[0] === 3) {
    const trips = [...groups.entries()].find(([, g]) => g.length === 3)!;
    const kickers = [...groups.entries()]
      .filter(([, g]) => g.length === 1)
      .map(([v]) => v)
      .sort((a, b) => b - a);
    return {
      rank: "three-of-a-kind",
      rankValue: 3,
      score: encodeKickers([trips[0], ...kickers]),
    };
  }

  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = [...groups.entries()]
      .filter(([, g]) => g.length === 2)
      .map(([v]) => v)
      .sort((a, b) => b - a);
    const kicker = [...groups.entries()].find(([, g]) => g.length === 1)![0];
    return {
      rank: "two-pair",
      rankValue: 2,
      score: encodeKickers([pairs[0]!, pairs[1]!, kicker]),
    };
  }

  if (counts[0] === 2) {
    const pair = [...groups.entries()].find(([, g]) => g.length === 2)!;
    const kickers = [...groups.entries()]
      .filter(([, g]) => g.length === 1)
      .map(([v]) => v)
      .sort((a, b) => b - a);
    return {
      rank: "pair",
      rankValue: 1,
      score: encodeKickers([pair[0], ...kickers]),
    };
  }

  return {
    rank: "high-card",
    rankValue: 0,
    score: encodeKickers(vals),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate the best 5-card hand from a set of 2–7 cards.
 * Tries all C(n, 5) combinations and returns the best.
 */
export function evaluateHand(cards: readonly Card[]): EvaluatedHand {
  if (cards.length < 2) {
    throw new Error(`Need at least 2 cards, got ${cards.length}`);
  }

  const cardArray = [...cards];

  // If ≤ 5 cards, evaluate directly
  if (cardArray.length <= 5) {
    const { rank, rankValue, score } = evaluateFive(cardArray);
    return { rank, rankValue, score, bestFive: sortDesc(cardArray) };
  }

  // Try all 5-card combinations
  const combos = combinations(cardArray, 5);
  let best: { rank: HandRank; rankValue: HandRankValue; score: number; bestFive: Card[] } | null =
    null;

  for (const combo of combos) {
    const result = evaluateFive(combo);
    if (
      best === null ||
      result.rankValue > best.rankValue ||
      (result.rankValue === best.rankValue && result.score > best.score)
    ) {
      best = { ...result, bestFive: sortDesc(combo) };
    }
  }

  if (!best) throw new Error("No combinations found");
  return best;
}

/**
 * Compare two evaluated hands.
 * Returns positive if a > b, negative if a < b, 0 if equal (chop).
 */
export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  if (a.rankValue !== b.rankValue) return a.rankValue - b.rankValue;
  return a.score - b.score;
}

/**
 * Given multiple agents' (hole + community) card sets,
 * returns the index/indices of the winner(s) — multiple on a tie.
 */
export function findWinners(
  hands: ReadonlyArray<{ agentId: string; cards: readonly Card[] }>
): string[] {
  if (hands.length === 0) return [];
  const evaluated = hands.map((h) => ({
    agentId: h.agentId,
    hand: evaluateHand(h.cards),
  }));

  let best = evaluated[0]!.hand;
  for (const e of evaluated.slice(1)) {
    if (compareHands(e.hand, best) > 0) best = e.hand;
  }

  return evaluated
    .filter((e) => compareHands(e.hand, best) === 0)
    .map((e) => e.agentId);
}

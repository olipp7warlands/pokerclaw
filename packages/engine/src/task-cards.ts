/**
 * PokerCrawl — Task Cards
 *
 * Maps task definitions (loaded from JSON) to TaskCard objects.
 * Provides a factory and a standard deck builder.
 */

import { z } from "zod";
import { RANK_VALUE_MAP } from "./hand-evaluator.js";
import type { Rank, RankValue, Suit, TaskCard, TaskDefinition } from "./types.js";

// ---------------------------------------------------------------------------
// Zod schema for TaskDefinition JSON validation
// ---------------------------------------------------------------------------

const SuitSchema = z.enum(["spades", "hearts", "diamonds", "clubs"]);
const RankSchema = z.enum(["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]);

export const TaskDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  effort: z.number().int().min(1).max(10),
  suit: SuitSchema,
  rank: RankSchema,
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a TaskCard from a validated TaskDefinition. */
export function taskDefinitionToCard(def: TaskDefinition): TaskCard {
  const value = RANK_VALUE_MAP[def.rank];
  if (value === undefined) {
    throw new Error(`Unknown rank: ${def.rank}`);
  }
  return {
    suit: def.suit as Suit,
    rank: def.rank as Rank,
    value: value as RankValue,
    task: def.name,
    effort: def.effort,
    metadata: {
      id: def.id,
      description: def.description,
      tags: def.tags,
      ...(def.metadata ?? {}),
    },
  };
}

/** Parse and validate raw JSON, then produce a TaskCard. */
export function taskFromJSON(raw: unknown): TaskCard {
  const def = TaskDefinitionSchema.parse(raw) as TaskDefinition;
  return taskDefinitionToCard(def);
}

/** Parse an array of task definitions. */
export function tasksFromJSON(raw: unknown[]): TaskCard[] {
  return raw.map(taskFromJSON);
}

// ---------------------------------------------------------------------------
// Standard deck helpers
// ---------------------------------------------------------------------------

const ALL_SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const ALL_RANKS: readonly Rank[] = [
  "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A",
];

/**
 * Build a full 52-card deck of TaskCards with generic task names.
 * Useful for shuffle-based tests; replace with real definitions in production.
 */
export function buildStandardDeck(): TaskCard[] {
  const deck: TaskCard[] = [];
  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      const value = RANK_VALUE_MAP[rank] as RankValue;
      deck.push({
        suit,
        rank,
        value,
        task: `${rank} of ${suit}`,
        effort: Math.ceil(value / 2), // 1–7
      });
    }
  }
  return deck;
}

/** Fisher-Yates shuffle (mutates in place, returns same array). */
export function shuffleDeck(deck: TaskCard[]): TaskCard[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // Swap
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

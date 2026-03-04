import type { Suit } from "@pokercrawl/engine";
import {
  SUIT_COLORS, SUIT_SYMBOLS, CHIP_COLORS,
} from "./constants.js";

/** Format token amount for display: 1200 → "1.2k", 1000000 → "1M" */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Get the hex color for a card suit */
export function suitColor(suit: Suit): string {
  return SUIT_COLORS[suit];
}

/** Get the unicode symbol for a suit */
export function suitSymbol(suit: Suit): string {
  return SUIT_SYMBOLS[suit];
}

/** Get chip color for a token value */
export function chipColor(value: number): string {
  for (const tier of CHIP_COLORS) {
    if (value >= tier.threshold) return tier.color;
  }
  return CHIP_COLORS[CHIP_COLORS.length - 1]?.color ?? "#e5e7eb";
}

/** Clamp a number to [min, max] */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Capitalize first letter */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Shorten a long string with ellipsis */
export function truncate(s: string, max = 24): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

import type { Suit } from "@pokercrawl/engine";

// ---------------------------------------------------------------------------
// Phase ordering
// ---------------------------------------------------------------------------

export const PHASE_ORDER = [
  "preflop",
  "flop",
  "turn",
  "river",
  "showdown",
] as const;

export const PHASE_LABELS: Record<string, string> = {
  waiting: "WAITING",
  preflop: "PRE-FLOP",
  flop: "FLOP",
  turn: "TURN",
  river: "RIVER",
  showdown: "SHOWDOWN",
  execution: "EXECUTION",
  settlement: "SETTLEMENT",
};

// ---------------------------------------------------------------------------
// Suit colours & icons
// ---------------------------------------------------------------------------

export const SUIT_COLORS: Record<Suit, string> = {
  spades: "#3b82f6",    // blue — code
  hearts: "#ef4444",    // red — analysis
  diamonds: "#a855f7",  // purple — creative
  clubs: "#22c55e",     // green — research
};

export const SUIT_ICONS: Record<Suit, string> = {
  spades: "⟨/⟩",
  hearts: "📊",
  diamonds: "🎨",
  clubs: "🔍",
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

// ---------------------------------------------------------------------------
// Chip colors by value
// ---------------------------------------------------------------------------

export const CHIP_COLORS: Array<{ threshold: number; color: string; label: string }> = [
  { threshold: 500, color: "#d4af37", label: "gold" },
  { threshold: 100, color: "#1a1a1a", label: "black" },
  { threshold: 25,  color: "#22c55e", label: "green" },
  { threshold: 5,   color: "#ef4444", label: "red" },
  { threshold: 1,   color: "#e5e7eb", label: "white" },
];

// ---------------------------------------------------------------------------
// Agent styles
// ---------------------------------------------------------------------------

export type AgentType = "claude" | "gpt" | "bot";

export interface DemoAgent {
  id: string;
  name: string;
  nickname: string;
  emoji: string;
  type: AgentType;
  color: string;
  style: string;
}

export const DEMO_AGENTS: DemoAgent[] = [
  {
    id: "shark",
    name: "AggressiveBot",
    nickname: "El Tiburón",
    emoji: "🦈",
    type: "bot",
    color: "#ef4444",
    style: "Raise-heavy, bluffs ~40%",
  },
  {
    id: "rock",
    name: "ConservativeBot",
    nickname: "La Roca",
    emoji: "🪨",
    type: "bot",
    color: "#6b7280",
    style: "Tight-passive, top 20% hands",
  },
  {
    id: "mago",
    name: "BlufferBot",
    nickname: "El Mago",
    emoji: "🎩",
    type: "bot",
    color: "#a855f7",
    style: "Bluffs ~70%, table talk",
  },
  {
    id: "caos",
    name: "RandomBot",
    nickname: "El Caos",
    emoji: "🎲",
    type: "bot",
    color: "#f97316",
    style: "Uniform random",
  },
  {
    id: "reloj",
    name: "CalculatedBot",
    nickname: "El Reloj",
    emoji: "⏱️",
    type: "bot",
    color: "#3b82f6",
    style: "Pot-odds vs hand-strength",
  },
  {
    id: "wolf",
    name: "WolfBot",
    nickname: "El Lobo",
    emoji: "🐺",
    type: "bot",
    color: "#f59e0b",
    style: "LAG — wide range, raises hard",
  },
  {
    id: "owl",
    name: "OwlBot",
    nickname: "La Lechuza",
    emoji: "🦉",
    type: "bot",
    color: "#06b6d4",
    style: "TAG — tight but aggressive",
  },
  {
    id: "turtle",
    name: "TurtleBot",
    nickname: "La Tortuga",
    emoji: "🐢",
    type: "bot",
    color: "#84cc16",
    style: "Calling Station — rarely raises",
  },
  {
    id: "fox",
    name: "FoxBot",
    nickname: "El Zorro",
    emoji: "🦊",
    type: "bot",
    color: "#ec4899",
    style: "Tricky — check-raise, slowplay",
  },
];

// ---------------------------------------------------------------------------
// Action colours
// ---------------------------------------------------------------------------

export const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  bet:    { bg: "#d4af37", text: "#000000" },
  raise:  { bg: "#d4af37", text: "#000000" },
  call:   { bg: "#3b82f6", text: "#ffffff" },
  check:  { bg: "#4b5563", text: "#ffffff" },
  fold:   { bg: "#7f1d1d", text: "#fca5a5" },
  "all-in": { bg: "#d4af37", text: "#000000" },
};

// ---------------------------------------------------------------------------
// Table geometry
// ---------------------------------------------------------------------------

export const TABLE_WIDTH  = 900;
export const TABLE_HEIGHT = 520;

/** Center of the poker table in container coordinates */
export const TABLE_CENTER_X = TABLE_WIDTH  / 2; // 450
export const TABLE_CENTER_Y = TABLE_HEIGHT / 2; // 260

// ---------------------------------------------------------------------------
// Seat regions — determines card placement relative to avatar
// ---------------------------------------------------------------------------

export type SeatRegion = "top" | "right" | "bottom" | "left";

// ---------------------------------------------------------------------------
// Seat positions — percentage-based (% of container width/height)
// Container: position:relative, width:100%, max-width:900px, aspect-ratio:16/10
// Seats go clockwise starting from top-center.
// ---------------------------------------------------------------------------

export interface SeatPct {
  top:  number;  // % from container top
  left: number;  // % from container left
}

// 9-player ring (base positions, clockwise from top-center)
// Seat 0: top center · 1: top-right · 2: right · 3: bottom-right
// 4: bottom center-right · 5: bottom center-left · 6: bottom-left
// 7: left · 8: top-left
export const SEAT_PCT: Record<number, ReadonlyArray<SeatPct>> = {
  2: [
    { top:  8, left: 50 },
    { top: 82, left: 50 },
  ],
  3: [
    { top:  8, left: 50 },
    { top: 70, left: 80 },
    { top: 70, left: 20 },
  ],
  4: [
    { top:  8, left: 50 },
    { top: 42, left: 88 },
    { top: 82, left: 50 },
    { top: 42, left: 12 },
  ],
  5: [
    { top:  8, left: 50 },
    { top: 30, left: 76 },
    { top: 72, left: 70 },
    { top: 72, left: 26 },
    { top: 30, left: 15 },
  ],
  6: [
    { top:  8, left: 50 },
    { top: 25, left: 86 },
    { top: 68, left: 86 },
    { top: 82, left: 50 },
    { top: 68, left: 14 },
    { top: 25, left: 14 },
  ],
  7: [
    { top:  8, left: 50 },
    { top: 18, left: 80 },
    { top: 52, left: 90 },
    { top: 78, left: 72 },
    { top: 78, left: 28 },
    { top: 52, left: 10 },
    { top: 18, left: 20 },
  ],
  8: [
    { top:  8, left: 50 },
    { top: 15, left: 78 },
    { top: 42, left: 90 },
    { top: 70, left: 80 },
    { top: 82, left: 50 },
    { top: 70, left: 20 },
    { top: 42, left: 10 },
    { top: 15, left: 22 },
  ],
  9: [
    { top:  6, left: 50 },
    { top: 12, left: 76 },
    { top: 36, left: 90 },
    { top: 64, left: 86 },
    { top: 80, left: 66 },
    { top: 80, left: 34 },
    { top: 64, left: 14 },
    { top: 36, left: 10 },
    { top: 12, left: 24 },
  ],
};

// ---------------------------------------------------------------------------
// Timing (ms)
// ---------------------------------------------------------------------------

export const ANIMATION_BASE = 400;
export const ACTION_BADGE_DURATION = 2200;
export const DEAL_STAGGER = 100;
export const FLIP_DURATION = 0.4;

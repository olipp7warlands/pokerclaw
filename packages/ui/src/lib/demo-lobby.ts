// ---------------------------------------------------------------------------
// Demo data for the Lobby screen
// ---------------------------------------------------------------------------

export interface LobbyTable {
  id: string;
  name: string;
  blinds: { small: number; big: number };
  currentPlayers: number;
  maxSeats: number;
  avgPot: number;
  type: "cash" | "tournament" | "sit-n-go";
  status: "waiting" | "playing";
}

export interface LobbyTournament {
  id: string;
  name: string;
  currentPlayers: number;
  maxPlayers: number;
  buyIn: number;
  prizePool: number;
  topPrize: number;
  status: "registering" | "running" | "final-table" | "complete";
  startsInMs: number; // negative = already started
}

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  name: string;
  emoji: string;
  type: "claude" | "openai" | "simulated" | "custom";
  elo: number;
  badges: string[];
  winRate: number;
}

// ---------------------------------------------------------------------------
// Badge → emoji
// ---------------------------------------------------------------------------

export const BADGE_ICONS: Record<string, string> = {
  "first-hand":        "🃏",
  "shark":             "🦈",
  "bluff-master":      "🎭",
  "rock-solid":        "🪨",
  "high-roller":       "💎",
  "comeback-kid":      "🔥",
  "tournament-winner": "🏆",
  "elo-1500":          "⭐",
  "all-in-survivor":   "💀",
  "table-captain":     "👑",
  "silent-assassin":   "🗡️",
  "trash-talker":      "🎯",
  "molt-veteran":      "✦",
};

// ---------------------------------------------------------------------------
// Demo data matching the mockup
// ---------------------------------------------------------------------------

export const DEMO_TABLES: LobbyTable[] = [
  {
    id:             "beginners-table",
    name:           "Beginners Table",
    blinds:         { small: 5, big: 10 },
    currentPlayers: 3,
    maxSeats:       6,
    avgPot:         45,
    type:           "cash",
    status:         "playing",
  },
  {
    id:             "shark-tank",
    name:           "Shark Tank",
    blinds:         { small: 25, big: 50 },
    currentPlayers: 6,
    maxSeats:       9,
    avgPot:         340,
    type:           "cash",
    status:         "playing",
  },
  {
    id:             "high-rollers",
    name:           "High Rollers",
    blinds:         { small: 100, big: 200 },
    currentPlayers: 2,
    maxSeats:       4,
    avgPot:         1200,
    type:           "cash",
    status:         "playing",
  },
  {
    id:             "bot-arena",
    name:           "Bot Arena",
    blinds:         { small: 10, big: 20 },
    currentPlayers: 5,
    maxSeats:       6,
    avgPot:         120,
    type:           "cash",
    status:         "playing",
  },
];

export const DEMO_TOURNAMENTS: LobbyTournament[] = [
  {
    id:             "weekly-1",
    name:           "PokerCrawl Weekly #1",
    currentPlayers: 12,
    maxPlayers:     32,
    buyIn:          100,
    prizePool:      1200,
    topPrize:       1500,
    status:         "registering",
    startsInMs:     5 * 60 * 1000,
  },
  {
    id:             "midnight-run",
    name:           "Midnight Run",
    currentPlayers: 8,
    maxPlayers:     8,
    buyIn:          500,
    prizePool:      3500,
    topPrize:       2000,
    status:         "running",
    startsInMs:     -1,
  },
];

export const DEMO_LEADERBOARD: LeaderboardEntry[] = [
  {
    rank:    1,
    agentId: "reloj",
    name:    "El Reloj",
    emoji:   "⏱️",
    type:    "simulated",
    elo:     1485,
    badges:  ["shark", "tournament-winner", "trash-talker"],
    winRate: 62,
  },
  {
    rank:    2,
    agentId: "claude-4",
    name:    "Claude-4",
    emoji:   "✦",
    type:    "claude",
    elo:     1420,
    badges:  ["tournament-winner", "high-roller"],
    winRate: 58,
  },
  {
    rank:    3,
    agentId: "shark",
    name:    "El Tiburón",
    emoji:   "🦈",
    type:    "simulated",
    elo:     1380,
    badges:  ["shark", "comeback-kid"],
    winRate: 54,
  },
  {
    rank:    4,
    agentId: "gpt4o",
    name:    "GPT-4o",
    emoji:   "◆",
    type:    "openai",
    elo:     1350,
    badges:  ["high-roller"],
    winRate: 51,
  },
  {
    rank:    5,
    agentId: "mago",
    name:    "El Mago",
    emoji:   "🎩",
    type:    "simulated",
    elo:     1290,
    badges:  ["bluff-master", "silent-assassin"],
    winRate: 48,
  },
  {
    rank:    6,
    agentId: "roca",
    name:    "La Roca",
    emoji:   "🪨",
    type:    "simulated",
    elo:     1240,
    badges:  ["rock-solid"],
    winRate: 45,
  },
  {
    rank:    7,
    agentId: "caos",
    name:    "El Caos",
    emoji:   "🎲",
    type:    "simulated",
    elo:     1180,
    badges:  ["first-hand"],
    winRate: 38,
  },
];

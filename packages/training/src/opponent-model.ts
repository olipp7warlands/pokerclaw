/**
 * Opponent Model
 *
 * Classifies each agent's playing tendency from observed hand history
 * and suggests a counter-strategy.
 */

import type { AgentStats, HandRecord } from "./hand-history-db.js";
import { HandHistoryDb } from "./hand-history-db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Tendency =
  | "tight-aggressive"
  | "tight-passive"
  | "loose-aggressive"
  | "loose-passive"
  | "unknown";

/** Six-archetype player classification. */
export type PlayerType =
  | "rock"            // tight + passive
  | "tag"             // tight + aggressive
  | "lag"             // loose + aggressive (but not extreme)
  | "calling-station" // loose + passive — calls everything
  | "maniac"          // extreme loose + extreme aggressive
  | "unknown";

export interface OpponentProfile {
  agentId: string;
  handsObserved: number;
  stats: AgentStats;
  tendency: Tendency;
  /** Brief advice for playing against this opponent. */
  counterStrategy: string;
}

// ---------------------------------------------------------------------------
// OpponentModel
// ---------------------------------------------------------------------------

const MIN_HANDS_FOR_READ = 5;

/** VPIP threshold separating "tight" from "loose". */
const VPIP_THRESHOLD = 0.30;

/** AF threshold separating "aggressive" from "passive". */
const AF_THRESHOLD = 1.5;

export class OpponentModel {
  private readonly db: HandHistoryDb;

  constructor(db: HandHistoryDb) {
    this.db = db;
  }

  /** Record a completed hand into the shared database. */
  observe(hand: HandRecord): void {
    this.db.addHand(hand);
  }

  /** Build a profile for one agent from all observed data. */
  getProfile(agentId: string): OpponentProfile {
    const stats = this.db.computeStats(agentId);
    const tendency = classifyTendency(stats);
    return {
      agentId,
      handsObserved: stats.handsPlayed,
      stats,
      tendency,
      counterStrategy: counterAdvice(tendency, stats),
    };
  }

  /** Six-archetype classification for one agent. */
  classifyPlayer(agentId: string): PlayerType {
    const stats = this.db.computeStats(agentId);
    return classifyPlayer(stats);
  }

  /** Profiles for all agents observed at least once. */
  getAllProfiles(): OpponentProfile[] {
    const agents = new Set<string>();
    for (const hand of this.db.getHands()) {
      for (const agentId of hand.agents) {
        agents.add(agentId);
      }
    }
    return [...agents].map((id) => this.getProfile(id));
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

export function classifyTendency(stats: AgentStats): Tendency {
  if (stats.handsPlayed < MIN_HANDS_FOR_READ) return "unknown";
  const tight = stats.vpip < VPIP_THRESHOLD;
  const aggressive = stats.af > AF_THRESHOLD;
  if (tight && aggressive) return "tight-aggressive";
  if (tight && !aggressive) return "tight-passive";
  if (!tight && aggressive) return "loose-aggressive";
  return "loose-passive";
}

/**
 * Six-archetype classification of a player based on their stats.
 * Requires at least MIN_HANDS_FOR_READ hands, otherwise returns "unknown".
 */
export function classifyPlayer(stats: AgentStats): PlayerType {
  if (stats.handsPlayed < MIN_HANDS_FOR_READ) return "unknown";
  const loose = stats.vpip >= VPIP_THRESHOLD;
  const aggr  = stats.af  >= AF_THRESHOLD;
  // Maniac: extreme on both axes
  if (stats.vpip > 0.50 && stats.af > 3.5) return "maniac";
  // Calling station: loose + passive (high WTSD confirms they see every street)
  if (loose && !aggr) return "calling-station";
  // LAG: loose + aggressive
  if (loose && aggr) return "lag";
  // TAG: tight + aggressive
  if (!loose && aggr) return "tag";
  // Rock: tight + passive
  return "rock";
}

export function counterAdvice(tendency: Tendency, stats: AgentStats): string {
  if (tendency === "unknown") {
    return `Insufficient data (${stats.handsPlayed} hands) — play standard poker.`;
  }
  switch (tendency) {
    case "tight-aggressive":
      return "Wait for premium holdings; fold to 3-bets unless very strong; steal when they're in the blinds.";
    case "tight-passive":
      return "Steal blinds frequently; fire multiple streets for value; they rarely raise without the nuts.";
    case "loose-aggressive":
      return "Call down lighter with medium-strength hands; set traps with strong hands; avoid thin bluffs.";
    case "loose-passive":
      return "Value bet heavily on every street; never bluff — they call too often; bet for max value.";
  }
}

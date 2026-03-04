/**
 * Hand History Database
 *
 * In-memory store for completed hands with optional JSON file persistence.
 * Provides computed aggregate statistics per agent (VPIP, PFR, AF, etc.).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandAction {
  agentId: string;
  action: string;
  phase: string;
  amount?: number;
}

export interface HandRecord {
  handNumber: number;
  timestamp: number;
  /** IDs of all agents seated at the table for this hand. */
  agents: string[];
  actions: HandAction[];
  winners: Array<{ agentId: string; amountWon: number; hand: string | null }>;
  startStacks: Record<string, number>;
  endStacks: Record<string, number>;
  finalPhase: string;
}

export interface AgentStats {
  handsPlayed: number;
  handsWon: number;
  /** Voluntarily put chips in pot (preflop call/raise frequency). */
  vpip: number;
  /** Pre-flop raise frequency. */
  pfr: number;
  /** Aggression factor: (raises + bets) / calls. */
  af: number;
  /** Win rate when reaching showdown. */
  showdownWR: number;
  /** % of hands the agent reached showdown (Went To ShowDown). */
  wtsd: number;
  /** Net chips won/lost across all tracked hands. */
  totalProfit: number;
}

// ---------------------------------------------------------------------------
// HandHistoryDb
// ---------------------------------------------------------------------------

export class HandHistoryDb {
  private hands: HandRecord[] = [];
  private readonly filePath: string | null;

  constructor(filePath: string | null = null) {
    this.filePath = filePath;
    if (filePath !== null && existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          this.hands = parsed as HandRecord[];
        }
      } catch {
        // Corrupt or empty file — start fresh
      }
    }
  }

  addHand(hand: HandRecord): void {
    this.hands.push(hand);
    if (this.filePath !== null) {
      this._persist();
    }
  }

  getHands(): readonly HandRecord[] {
    return this.hands;
  }

  clear(): void {
    this.hands = [];
  }

  /**
   * Compute aggregate statistics for one agent across all stored hands
   * where that agent was seated (i.e., appears in startStacks).
   */
  computeStats(agentId: string): AgentStats {
    const agentHands = this.hands.filter(
      (h) => h.startStacks[agentId] !== undefined
    );

    if (agentHands.length === 0) {
      return {
        handsPlayed: 0,
        handsWon: 0,
        vpip: 0,
        pfr: 0,
        af: 0,
        showdownWR: 0,
        wtsd: 0,
        totalProfit: 0,
      };
    }

    let handsWon = 0;
    let vpipCount = 0;
    let pfrCount = 0;
    let aggrCount = 0; // raises + bets + all-in
    let callCount = 0;
    let showdowns = 0;
    let showdownWins = 0;
    let totalProfit = 0;

    for (const hand of agentHands) {
      const preflopActions = hand.actions.filter(
        (a) => a.agentId === agentId && a.phase === "preflop"
      );
      const allActions = hand.actions.filter((a) => a.agentId === agentId);

      // VPIP: called or raised voluntarily preflop
      const didVPIP = preflopActions.some(
        (a) =>
          a.action === "call" ||
          a.action === "raise" ||
          a.action === "bet" ||
          a.action === "all-in"
      );
      if (didVPIP) vpipCount++;

      // PFR: raised preflop
      const didPFR = preflopActions.some(
        (a) => a.action === "raise" || a.action === "bet"
      );
      if (didPFR) pfrCount++;

      // AF components
      aggrCount += allActions.filter(
        (a) => a.action === "raise" || a.action === "bet" || a.action === "all-in"
      ).length;
      callCount += allActions.filter((a) => a.action === "call").length;

      // Win tracking
      if (hand.winners.some((w) => w.agentId === agentId)) handsWon++;

      // Profit
      const startStack = hand.startStacks[agentId] ?? 0;
      const endStack = hand.endStacks[agentId] ?? 0;
      totalProfit += endStack - startStack;

      // Showdown: hand went to showdown if the agent didn't fold and the
      // hand reached showdown/settlement phase
      const isShowdown =
        hand.finalPhase === "showdown" || hand.finalPhase === "settlement";
      const agentFolded = allActions.some((a) => a.action === "fold");
      if (isShowdown && !agentFolded) {
        showdowns++;
        if (hand.winners.some((w) => w.agentId === agentId)) showdownWins++;
      }
    }

    const total = agentHands.length;

    return {
      handsPlayed: total,
      handsWon,
      vpip: vpipCount / total,
      pfr: pfrCount / total,
      // AF: if no calls were made, treat as highly aggressive
      af: callCount > 0 ? aggrCount / callCount : aggrCount > 0 ? 3 : 1,
      showdownWR: showdowns > 0 ? showdownWins / showdowns : 0,
      wtsd: showdowns / total,
      totalProfit,
    };
  }

  private _persist(): void {
    if (this.filePath === null) return;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(this.hands, null, 2), "utf-8");
  }
}

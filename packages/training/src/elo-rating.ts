/**
 * ELO Rating System
 *
 * Standard ELO with K=32. Each winner is matched against each loser after
 * every hand. Unknown agents start at INITIAL_RATING.
 */

const K = 32;
const INITIAL_RATING = 1200;

export interface AgentRating {
  agentId: string;
  rating: number;
}

export class EloRating {
  private readonly ratings = new Map<string, number>();
  private readonly initial: number;

  constructor(initial: number = INITIAL_RATING) {
    this.initial = initial;
  }

  getRating(agentId: string): number {
    return this.ratings.get(agentId) ?? this.initial;
  }

  /**
   * Update ratings after a hand: each winner plays against each loser.
   */
  updateAfterHand(winners: readonly string[], losers: readonly string[]): void {
    for (const winner of winners) {
      for (const loser of losers) {
        const rw = this.getRating(winner);
        const rl = this.getRating(loser);
        const ew = this._expected(rw, rl);
        const el = this._expected(rl, rw);
        this.ratings.set(winner, rw + K * (1 - ew));
        this.ratings.set(loser, rl + K * (0 - el));
      }
    }
  }

  /** Sorted rankings, highest rated first. */
  getRankings(): AgentRating[] {
    return [...this.ratings.entries()]
      .map(([agentId, rating]) => ({ agentId, rating }))
      .sort((a, b) => b.rating - a.rating);
  }

  private _expected(ra: number, rb: number): number {
    return 1 / (1 + Math.pow(10, (rb - ra) / 400));
  }
}

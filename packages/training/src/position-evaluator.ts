/**
 * Position Evaluator
 *
 * Pure functions and a stats tracker for positional play analysis.
 */

export type TablePosition = "early" | "middle" | "late" | "blinds";

export interface PositionWinRate {
  position: TablePosition;
  handsPlayed: number;
  winRate: number;
}

/**
 * Returns the TablePosition of a seat relative to the dealer button.
 */
export function getPosition(
  seatIndex: number,
  dealerIndex: number,
  numSeats: number
): TablePosition {
  const relative = (seatIndex - dealerIndex + numSeats) % numSeats;
  if (relative === 0) return "late"; // dealer / button
  if (relative === 1 || relative === 2) return "blinds"; // SB and BB
  const third = Math.ceil(numSeats / 3);
  if (relative <= third) return "early";
  if (relative <= 2 * third) return "middle";
  return "late";
}

/**
 * Equity multiplier based on position.
 * Late position hands are worth more because of acting last.
 */
export function positionMultiplier(pos: TablePosition): number {
  switch (pos) {
    case "early":  return 0.75;
    case "blinds": return 0.80;
    case "middle": return 1.00;
    case "late":   return 1.25;
  }
}

/**
 * Tracks win rates per position across multiple hands.
 */
export class PositionStats {
  private readonly data = new Map<TablePosition, { played: number; won: number }>();

  record(position: TablePosition, won: boolean): void {
    const current = this.data.get(position) ?? { played: 0, won: 0 };
    this.data.set(position, {
      played: current.played + 1,
      won: current.won + (won ? 1 : 0),
    });
  }

  getWinRates(): PositionWinRate[] {
    const positions: TablePosition[] = ["early", "middle", "late", "blinds"];
    return positions.map((pos) => {
      const d = this.data.get(pos) ?? { played: 0, won: 0 };
      return {
        position: pos,
        handsPlayed: d.played,
        winRate: d.played > 0 ? d.won / d.played : 0,
      };
    });
  }
}

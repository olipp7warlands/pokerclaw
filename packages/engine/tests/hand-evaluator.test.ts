import { describe, expect, it } from "vitest";
import {
  compareHands,
  evaluateHand,
  findWinners,
  RANK_VALUE_MAP,
} from "../src/hand-evaluator.js";
import type { Card, Rank, RankValue, Suit } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helper: build a card quickly
// ---------------------------------------------------------------------------
function card(rank: Rank, suit: Suit): Card {
  return { rank, suit, value: RANK_VALUE_MAP[rank] as RankValue };
}

const c = card; // alias

// ---------------------------------------------------------------------------
// Individual hand rankings
// ---------------------------------------------------------------------------
describe("evaluateHand — 5-card hands", () => {
  it("detects royal flush", () => {
    const hand = evaluateHand([
      c("A", "spades"),
      c("K", "spades"),
      c("Q", "spades"),
      c("J", "spades"),
      c("10", "spades"),
    ]);
    expect(hand.rank).toBe("royal-flush");
    expect(hand.rankValue).toBe(9);
  });

  it("detects straight flush", () => {
    const hand = evaluateHand([
      c("9", "hearts"),
      c("8", "hearts"),
      c("7", "hearts"),
      c("6", "hearts"),
      c("5", "hearts"),
    ]);
    expect(hand.rank).toBe("straight-flush");
    expect(hand.rankValue).toBe(8);
  });

  it("detects four of a kind", () => {
    const hand = evaluateHand([
      c("A", "spades"),
      c("A", "hearts"),
      c("A", "diamonds"),
      c("A", "clubs"),
      c("K", "spades"),
    ]);
    expect(hand.rank).toBe("four-of-a-kind");
    expect(hand.rankValue).toBe(7);
  });

  it("detects full house", () => {
    const hand = evaluateHand([
      c("K", "spades"),
      c("K", "hearts"),
      c("K", "diamonds"),
      c("Q", "spades"),
      c("Q", "hearts"),
    ]);
    expect(hand.rank).toBe("full-house");
    expect(hand.rankValue).toBe(6);
  });

  it("detects flush", () => {
    const hand = evaluateHand([
      c("A", "clubs"),
      c("J", "clubs"),
      c("9", "clubs"),
      c("5", "clubs"),
      c("2", "clubs"),
    ]);
    expect(hand.rank).toBe("flush");
    expect(hand.rankValue).toBe(5);
  });

  it("detects straight", () => {
    const hand = evaluateHand([
      c("8", "spades"),
      c("7", "hearts"),
      c("6", "diamonds"),
      c("5", "clubs"),
      c("4", "spades"),
    ]);
    expect(hand.rank).toBe("straight");
    expect(hand.rankValue).toBe(4);
  });

  it("detects wheel straight (A-2-3-4-5)", () => {
    const hand = evaluateHand([
      c("A", "spades"),
      c("2", "hearts"),
      c("3", "diamonds"),
      c("4", "clubs"),
      c("5", "spades"),
    ]);
    expect(hand.rank).toBe("straight");
    expect(hand.rankValue).toBe(4);
    // High card of wheel = 5
    expect(hand.score).toBeGreaterThan(0);
  });

  it("detects three of a kind", () => {
    const hand = evaluateHand([
      c("Q", "spades"),
      c("Q", "hearts"),
      c("Q", "diamonds"),
      c("7", "clubs"),
      c("3", "spades"),
    ]);
    expect(hand.rank).toBe("three-of-a-kind");
    expect(hand.rankValue).toBe(3);
  });

  it("detects two pair", () => {
    const hand = evaluateHand([
      c("J", "spades"),
      c("J", "hearts"),
      c("9", "diamonds"),
      c("9", "clubs"),
      c("A", "spades"),
    ]);
    expect(hand.rank).toBe("two-pair");
    expect(hand.rankValue).toBe(2);
  });

  it("detects pair", () => {
    const hand = evaluateHand([
      c("10", "spades"),
      c("10", "hearts"),
      c("A", "diamonds"),
      c("K", "clubs"),
      c("2", "spades"),
    ]);
    expect(hand.rank).toBe("pair");
    expect(hand.rankValue).toBe(1);
  });

  it("detects high card", () => {
    const hand = evaluateHand([
      c("A", "spades"),
      c("J", "hearts"),
      c("9", "diamonds"),
      c("5", "clubs"),
      c("2", "spades"),
    ]);
    expect(hand.rank).toBe("high-card");
    expect(hand.rankValue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7-card evaluation (Texas Hold'em)
// ---------------------------------------------------------------------------
describe("evaluateHand — 7 cards (best 5)", () => {
  it("finds the best hand from 7 cards", () => {
    // Hole: Kh Qh | Community: Ah Jh 10h 2s 7c → royal flush possible
    const hand = evaluateHand([
      c("K", "hearts"),
      c("Q", "hearts"),
      c("A", "hearts"),
      c("J", "hearts"),
      c("10", "hearts"),
      c("2", "spades"),
      c("7", "clubs"),
    ]);
    expect(hand.rank).toBe("royal-flush");
    expect(hand.bestFive).toHaveLength(5);
  });

  it("picks the strongest possible hand", () => {
    // Hole: 2c 3c | Community: 4c 5c 6c Ah Kh → straight flush 2-6
    const hand = evaluateHand([
      c("2", "clubs"),
      c("3", "clubs"),
      c("4", "clubs"),
      c("5", "clubs"),
      c("6", "clubs"),
      c("A", "hearts"),
      c("K", "hearts"),
    ]);
    expect(hand.rank).toBe("straight-flush");
  });
});

// ---------------------------------------------------------------------------
// Compare hands
// ---------------------------------------------------------------------------
describe("compareHands", () => {
  it("higher rank wins", () => {
    const flush = evaluateHand([
      c("A", "clubs"), c("J", "clubs"), c("9", "clubs"), c("5", "clubs"), c("2", "clubs"),
    ]);
    const pair = evaluateHand([
      c("A", "spades"), c("A", "hearts"), c("K", "diamonds"), c("Q", "clubs"), c("J", "spades"),
    ]);
    expect(compareHands(flush, pair)).toBeGreaterThan(0);
  });

  it("same rank — kicker breaks tie", () => {
    const highA = evaluateHand([
      c("A", "spades"), c("K", "hearts"), c("Q", "diamonds"), c("J", "clubs"), c("9", "spades"),
    ]);
    const highQ = evaluateHand([
      c("Q", "spades"), c("J", "hearts"), c("9", "diamonds"), c("8", "clubs"), c("7", "spades"),
    ]);
    expect(compareHands(highA, highQ)).toBeGreaterThan(0);
  });

  it("identical hands return 0", () => {
    const a = evaluateHand([
      c("A", "spades"), c("K", "hearts"), c("Q", "diamonds"), c("J", "clubs"), c("9", "spades"),
    ]);
    const b = evaluateHand([
      c("A", "hearts"), c("K", "clubs"), c("Q", "spades"), c("J", "hearts"), c("9", "clubs"),
    ]);
    expect(compareHands(a, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findWinners
// ---------------------------------------------------------------------------
describe("findWinners", () => {
  it("returns the single winner", () => {
    const winners = findWinners([
      {
        agentId: "alice",
        cards: [
          c("A", "spades"), c("A", "hearts"),
          c("A", "diamonds"), c("A", "clubs"), c("K", "spades"),
        ],
      },
      {
        agentId: "bob",
        cards: [
          c("K", "hearts"), c("K", "diamonds"),
          c("Q", "spades"), c("Q", "hearts"), c("J", "spades"),
        ],
      },
    ]);
    expect(winners).toEqual(["alice"]);
  });

  it("returns both agents on a chop", () => {
    const community = [c("A", "hearts"), c("K", "clubs"), c("Q", "spades"), c("J", "diamonds"), c("10", "clubs")];
    // Both make broadway straight using community
    const winners = findWinners([
      { agentId: "alice", cards: [c("2", "spades"), c("3", "spades"), ...community] },
      { agentId: "bob",   cards: [c("4", "spades"), c("5", "spades"), ...community] },
    ]);
    expect(winners.sort()).toEqual(["alice", "bob"]);
  });
});

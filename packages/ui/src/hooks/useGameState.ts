/**
 * useGameState — Engine-driven game state
 *
 * Demo mode:  Runs the real engine in the browser via mock-game.ts.
 *             Hole cards are visible (local game, no privacy concerns).
 *
 * Live mode:  Applies LiveSnapshot updates from the WebSocket server.
 *             Hole cards are hidden (server never sends them).
 */

import { useState, useEffect, useRef, MutableRefObject } from "react";
import type { MockGameControl } from "../lib/mock-game.js";
import type {
  GameState,
  AgentSeat,
  AgentStatus,
  CapabilityCard,
  TaskCard,
  WinnerResult,
  GamePhase,
} from "@pokercrawl/engine";
import type { LiveSnapshot } from "./useGameSocket.js";
import type { Speed } from "./useAnimations.js";
import { startMockGame } from "../lib/mock-game.js";

// ---------------------------------------------------------------------------
// LiveSnapshot → GameState converter
// ---------------------------------------------------------------------------

function snapshotToGameState(snap: LiveSnapshot, prev?: GameState): GameState {
  const seats: AgentSeat[] = snap.seats.map((s) => {
    const prevSeat = prev?.seats.find((ps) => ps.agentId === s.agentId);

    const holeCards: CapabilityCard[] = s.holeCards
      ? s.holeCards.map((c) => ({
          rank: c.rank as CapabilityCard["rank"],
          suit: c.suit as CapabilityCard["suit"],
          value: c.value as CapabilityCard["value"],
          capability: c.capability ?? "",
          confidence: c.value / 14,
        }))
      : [...(prevSeat?.holeCards ?? [])];

    return {
      agentId: s.agentId,
      stack: s.stack,
      currentBet: s.currentBet,
      totalBet: s.totalBet,
      status: s.status as AgentStatus,
      hasActedThisRound: s.hasActedThisRound,
      holeCards,
    };
  });

  const mapTask = (c: { rank: string; suit: string; value: number; task?: string }): TaskCard => ({
    rank: c.rank as TaskCard["rank"],
    suit: c.suit as TaskCard["suit"],
    value: c.value as TaskCard["value"],
    task: c.task ?? "",
    effort: Math.ceil(c.value / 4),
  });

  const winners: WinnerResult[] = snap.winners.map((w) => ({
    agentId: w.agentId,
    amountWon: w.amountWon,
    hand: w.handRank
      ? ({ rank: w.handRank, rankValue: 0, score: 0, bestFive: [] } as unknown as import("@pokercrawl/engine").EvaluatedHand)
      : null,
    potIndex: 0,
  }));

  return {
    gameId: prev?.gameId ?? "live",
    seats,
    dealerIndex: snap.dealerIndex,
    phase: snap.phase as GamePhase,
    board: {
      flop: snap.board.flop.map(mapTask),
      turn: snap.board.turn ? mapTask(snap.board.turn) : null,
      river: snap.board.river ? mapTask(snap.board.river) : null,
    },
    mainPot: snap.mainPot,
    sidePots: snap.sidePots,
    actionOnIndex: snap.actionOnIndex,
    currentBet: snap.currentBet,
    lastRaiseAmount: snap.lastRaiseAmount,
    deck: prev?.deck ?? [],
    events: prev?.events ?? [],
    winners,
    assignedTasks: prev?.assignedTasks ?? [],
    handNumber: snap.handNumber,
  };
}

// ---------------------------------------------------------------------------
// Default state (shown before mock game initialises)
// ---------------------------------------------------------------------------

const DEFAULT_STATE: GameState = {
  gameId: "init",
  seats: [],   // empty — first mock-game snapshot populates real seats
  dealerIndex: 0,
  phase: "waiting" as GamePhase,
  board: { flop: [], turn: null, river: null },
  mainPot: 0,
  sidePots: [],
  actionOnIndex: 0,
  currentBet: 0,
  lastRaiseAmount: 0,
  deck: [],
  events: [],
  winners: [],
  assignedTasks: [],
  handNumber: 0,
};

// ---------------------------------------------------------------------------
// Action log types
// ---------------------------------------------------------------------------

export interface RecentAction {
  agentId: string;
  action: string;
  amount?: number;
  timestamp: number;
}

export interface DemoChat {
  agentId: string;
  message: string;
  timestamp: number;
}

export interface HandEntry {
  handNumber: number;
  winnerId: string;
  amount: number;
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export function useGameState(
  liveSnapshot: LiveSnapshot | null,
  isLive: boolean,
  isPlaying: boolean,
  speed: Speed,
  smallBlind?: number,
  bigBlind?: number,
  botCount?: number,
) {
  const [gameState, setGameState] = useState<GameState>(DEFAULT_STATE);
  const [recentActions, setRecentActions] = useState<RecentAction[]>([]);
  const [demoChat, setDemoChat] = useState<DemoChat[]>([]);
  const [handHistory, setHandHistory] = useState<HandEntry[]>([]);
  // Track which hand numbers we've already recorded to avoid duplicates
  const recordedHands = useRef(new Set<number>());

  // Expose the mock game control so callers can add/remove/rebuy agents.
  const controlRef = useRef<MockGameControl | null>(null);

  // Use a ref for speed so we can change it without restarting the game.
  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // -------------------------------------------------------------------------
  // Demo mode — run the real engine in the browser
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Live mode is handled separately; paused → don't advance
    if (isLive || !isPlaying) return;

    const ctrl = startMockGame({
      getIntervalMs: () => Math.max(300, 2000 / speedRef.current),
      ...(smallBlind !== undefined ? { smallBlind } : {}),
      ...(bigBlind   !== undefined ? { bigBlind }   : {}),
      ...(botCount   !== undefined ? { botCount }   : {}),
      onSnapshot: (snap, chat) => {
        setGameState((prev) => snapshotToGameState(snap, prev));

        if (snap.lastAction) {
          const { agentId, type, amount } = snap.lastAction;
          setRecentActions((a) => [
            ...a.slice(-19),
            {
              agentId,
              action: type,
              ...(amount > 0 && { amount }),
              timestamp: Date.now(),
            },
          ]);
        }

        // Record hand result when winners are announced (once per handNumber)
        if (snap.winners.length > 0 && snap.handNumber > 0) {
          const winner = snap.winners[0]!;
          if (!recordedHands.current.has(snap.handNumber)) {
            recordedHands.current.add(snap.handNumber);
            setHandHistory((h) => [
              ...h.slice(-49),
              { handNumber: snap.handNumber, winnerId: winner.agentId, amount: winner.amountWon },
            ]);
          }
        }

        if (chat) {
          setDemoChat((c) => [
            ...c.slice(-19),
            { agentId: chat.agentId, message: chat.message, timestamp: Date.now() },
          ]);
        }
      },
    });

    controlRef.current = ctrl;
    return ctrl.stop;
  }, [isLive, isPlaying, smallBlind, bigBlind, botCount]); // speed intentionally excluded — handled via ref

  // -------------------------------------------------------------------------
  // Live mode — apply full snapshots from the WebSocket
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isLive || !liveSnapshot) return;

    setGameState((prev) => snapshotToGameState(liveSnapshot, prev));

    if (liveSnapshot.lastAction) {
      const { agentId, type, amount } = liveSnapshot.lastAction;
      setRecentActions((a) => [
        ...a.slice(-19),
        {
          agentId,
          action: type,
          ...(amount > 0 && { amount }),
          timestamp: Date.now(),
        },
      ]);
    }

    if (liveSnapshot.winners.length > 0 && liveSnapshot.handNumber > 0) {
      const winner = liveSnapshot.winners[0]!;
      if (!recordedHands.current.has(liveSnapshot.handNumber)) {
        recordedHands.current.add(liveSnapshot.handNumber);
        setHandHistory((h) => [
          ...h.slice(-49),
          { handNumber: liveSnapshot.handNumber, winnerId: winner.agentId, amount: winner.amountWon },
        ]);
      }
    }
  }, [isLive, liveSnapshot]);

  return { gameState, recentActions, demoChat, handHistory, controlRef: controlRef as MutableRefObject<MockGameControl | null> };
}

/**
 * useTablePolling — REST-based live table state.
 *
 * Polls /api/tables/:id/state every `intervalMs` ms and converts the
 * response to the GameState shape that PokerTable expects.
 * Falls back gracefully: isConnected=false when server is unreachable.
 */

import { useState, useEffect } from "react";
import type {
  GameState,
  AgentSeat,
  AgentStatus,
  TaskCard,
  WinnerResult,
  GamePhase,
} from "@pokercrawl/engine";

// ---------------------------------------------------------------------------
// Types mirroring /api/tables/:id/state response
// ---------------------------------------------------------------------------

interface ApiCard { rank: string; suit: string; value: number; task?: string }

interface ApiSeat {
  agentId:           string;
  name?:             string;
  stack:             number;
  currentBet:        number;
  totalBet:          number;
  status:            string;
  hasActedThisRound: boolean;
}

interface ApiTableState {
  tableId:         string;
  phase:           string;
  handNumber:      number;
  mainPot:         number;
  sidePots?:       Array<{ amount: number; eligibleAgents: string[] }>;
  currentBet:      number;
  lastRaiseAmount: number;
  dealerIndex:     number;
  actionOnIndex:   number;
  seats:           ApiSeat[];
  board:           { flop: ApiCard[]; turn: ApiCard | null; river: ApiCard | null };
  winners?:        Array<{ agentId: string; amountWon: number }>;
  agentNames?:     Record<string, string>;
  config?:         { name: string; smallBlind: number; bigBlind: number; maxPlayers: number };
}

// ---------------------------------------------------------------------------
// TableMeta — feeds the info bar
// ---------------------------------------------------------------------------

export interface PolledTableMeta {
  name:       string;
  smallBlind: number;
  bigBlind:   number;
  maxPlayers: number;
  players:    number;
  handNumber: number;
  pot:        number;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapCard(c: ApiCard): TaskCard {
  return {
    rank:   c.rank   as TaskCard["rank"],
    suit:   c.suit   as TaskCard["suit"],
    value:  c.value  as TaskCard["value"],
    task:   c.task   ?? "",
    effort: Math.ceil(c.value / 4),
  };
}

function mapResponse(data: ApiTableState): GameState {
  const seats: AgentSeat[] = data.seats.map((s) => ({
    agentId:           s.agentId,
    stack:             s.stack,
    currentBet:        s.currentBet,
    totalBet:          s.totalBet,
    status:            s.status as AgentStatus,
    hasActedThisRound: s.hasActedThisRound,
    holeCards:         [],
  }));

  const winners: WinnerResult[] = (data.winners ?? []).map((w) => ({
    agentId:   w.agentId,
    amountWon: w.amountWon,
    hand:      null,
    potIndex:  0,
  }));

  return {
    gameId:          "live",
    seats,
    dealerIndex:     data.dealerIndex,
    phase:           data.phase as GamePhase,
    board: {
      flop:  data.board.flop.map(mapCard),
      turn:  data.board.turn  ? mapCard(data.board.turn)  : null,
      river: data.board.river ? mapCard(data.board.river) : null,
    },
    mainPot:         data.mainPot,
    sidePots:        data.sidePots ?? [],
    actionOnIndex:   data.actionOnIndex,
    currentBet:      data.currentBet,
    lastRaiseAmount: data.lastRaiseAmount ?? 0,
    deck:            [],
    events:          [],
    winners,
    assignedTasks:   [],
    handNumber:      data.handNumber,
  };
}

function mapMeta(data: ApiTableState): PolledTableMeta {
  return {
    name:       data.config?.name       ?? data.tableId,
    smallBlind: data.config?.smallBlind ?? 5,
    bigBlind:   data.config?.bigBlind   ?? 10,
    maxPlayers: data.config?.maxPlayers ?? 9,
    players:    data.seats.length,
    handNumber: data.handNumber,
    pot:        data.mainPot,
  };
}

// ---------------------------------------------------------------------------
// Default state — shown before first successful poll
// ---------------------------------------------------------------------------

const DEFAULT_STATE: GameState = {
  gameId:          "init",
  seats:           [],
  dealerIndex:     0,
  phase:           "waiting" as GamePhase,
  board:           { flop: [], turn: null, river: null },
  mainPot:         0,
  sidePots:        [],
  actionOnIndex:   0,
  currentBet:      0,
  lastRaiseAmount: 0,
  deck:            [],
  events:          [],
  winners:         [],
  assignedTasks:   [],
  handNumber:      0,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTablePolling(tableId: string | undefined, intervalMs = 2_000) {
  const [gameState,   setGameState]   = useState<GameState>(DEFAULT_STATE);
  const [meta,        setMeta]        = useState<PolledTableMeta | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!tableId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const r = await fetch(`/api/tables/${tableId}/state`);
        if (cancelled) return;
        if (!r.ok) { setIsConnected(false); return; }
        const data = await r.json() as ApiTableState;
        if (cancelled) return;
        setGameState(mapResponse(data));
        setMeta(mapMeta(data));
        setIsConnected(true);
      } catch {
        if (!cancelled) setIsConnected(false);
      }
    };

    void poll();
    const interval = setInterval(() => { void poll(); }, intervalMs);
    return () => { cancelled = true; clearInterval(interval); };
  }, [tableId, intervalMs]);

  return { gameState, meta, isConnected };
}

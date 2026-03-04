import { useState, useEffect, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Wire types (must match ws-bridge.ts LiveSnapshot)
// ---------------------------------------------------------------------------

export interface CardSnapshot {
  rank: string;
  suit: string;
  value: number;
  /** Set by mock-game.ts for hole cards (capability name). */
  capability?: string;
  /** Set by mock-game.ts for community cards (task description). */
  task?: string;
}

export interface LiveSnapshot {
  phase: string;
  handNumber: number;
  mainPot: number;
  sidePots: Array<{ amount: number; eligibleAgents: string[] }>;
  currentBet: number;
  lastRaiseAmount: number;
  dealerIndex: number;
  actionOnIndex: number;
  seats: Array<{
    agentId: string;
    stack: number;
    currentBet: number;
    totalBet: number;
    status: string;
    hasActedThisRound: boolean;
    /** Only present in mock (local) mode — the server never sends hole cards. */
    holeCards?: CardSnapshot[];
  }>;
  board: {
    flop: CardSnapshot[];
    turn: CardSnapshot | null;
    river: CardSnapshot | null;
  };
  winners: Array<{ agentId: string; amountWon: number; handRank?: string }>;
  lastAction?: { agentId: string; type: string; amount: number };
}

export interface WSEvent {
  type: "game_update" | "agent_action" | "phase_change" | "showdown" | "chat" | "error";
  tableId: string;
  data: unknown;
  timestamp: number;
}

export interface ChatMessage {
  agentId: string;
  message: string;
  timestamp: number;
}

export type ConnectionMode = "demo" | "connecting" | "connected" | "error";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function defaultWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // In dev (Vite on 5173) Vite proxies /ws-ui to localhost:3000. In production same host.
  return `${proto}//${window.location.host}/ws-ui`;
}

export function useGameSocket(serverUrl = defaultWsUrl()) {
  const [mode, setMode] = useState<ConnectionMode>("demo");
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setMode("connecting");
    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setMode("connected");
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      try {
        const event = JSON.parse(ev.data) as WSEvent;

        if (event.type === "chat") {
          const d = event.data as { agentId: string; message: string };
          setChatMessages((msgs) => [
            ...msgs.slice(-99),
            { agentId: d.agentId, message: d.message, timestamp: event.timestamp },
          ]);
          return;
        }

        if (
          event.type === "game_update" ||
          event.type === "agent_action" ||
          event.type === "phase_change" ||
          event.type === "showdown"
        ) {
          setLiveSnapshot(event.data as LiveSnapshot);
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      setMode("error");
    };

    ws.onclose = () => {
      setMode((m) => (m === "demo" ? "demo" : "error"));
    };
  }, [serverUrl]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setMode("demo");
    setLiveSnapshot(null);
  }, []);

  const toggleMode = useCallback(() => {
    if (mode === "demo") {
      connect();
    } else {
      disconnect();
    }
  }, [mode, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return {
    mode,
    liveSnapshot,
    chatMessages,
    setChatMessages,
    connect,
    disconnect,
    toggleMode,
    isLive: mode === "connected",
    isDemo: mode === "demo",
  };
}

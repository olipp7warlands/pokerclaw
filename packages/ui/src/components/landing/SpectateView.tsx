import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAnimations } from "../../hooks/useAnimations.js";
import { useGameSocket }  from "../../hooks/useGameSocket.js";
import { useGameState }   from "../../hooks/useGameState.js";
import { Layout }         from "../layout/Layout.js";
import { Header }         from "../layout/Header.js";
import { PokerTable }     from "../table/PokerTable.js";
import { DEMO_TABLES }    from "../../lib/demo-lobby.js";

interface LiveTableMeta {
  name:       string;
  smallBlind: number;
  bigBlind:   number;
  maxPlayers: number;
  players:    number;
}

/**
 * Spectator view — read-only table (no actions panel).
 * Connects to the real WS table and polls /api/tables/:id/state for metadata.
 */
export function SpectateView() {
  const navigate = useNavigate();
  const { id }  = useParams<{ id: string }>();

  const demoConfig = DEMO_TABLES.find((t) => t.id === id);
  const smallBlind = demoConfig?.blinds.small ?? 5;
  const bigBlind   = demoConfig?.blinds.big   ?? 10;
  const botCount   = demoConfig?.maxSeats      ?? 5;

  // Poll live table metadata for the banner
  const [meta, setMeta] = useState<LiveTableMeta | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/tables/${id}/state`);
        if (!r.ok || cancelled) return;
        const d = await r.json() as {
          config?: { name: string; smallBlind: number; bigBlind: number; maxPlayers: number };
          seats?:  unknown[];
        };
        if (!cancelled && d.config) {
          setMeta({
            name:       d.config.name,
            smallBlind: d.config.smallBlind,
            bigBlind:   d.config.bigBlind,
            maxPlayers: d.config.maxPlayers,
            players:    d.seats?.length ?? 0,
          });
        }
      } catch { /* ignore */ }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 3_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [id]);

  const maxSeats   = meta?.maxPlayers ?? demoConfig?.maxSeats ?? 9;

  const { speed, isPlaying }        = useAnimations();
  // Connect to the real WS table so the spectator sees live state
  const { mode, liveSnapshot }      = useGameSocket(undefined, id);
  const { gameState, recentActions, demoChat } = useGameState(
    liveSnapshot,
    mode === "connected",
    isPlaying,
    speed,
    smallBlind,
    bigBlind,
    botCount,
  );

  const bannerName    = meta?.name    ?? demoConfig?.name ?? id ?? "Table";
  const bannerBlinds  = meta ? `$${meta.smallBlind}/$${meta.bigBlind}` : "";
  const bannerPlayers = meta?.players ?? gameState.seats.length;

  return (
    <Layout>
      <Header
        handNumber={gameState.handNumber}
        mode={mode}
        phase={gameState.phase}
        onLogoClick={() => navigate("/")}
        onBack={() => navigate("/lobby")}
        backLabel="Lobby"
      />

      {/* Spectate banner */}
      <div
        style={{
          background:    "rgba(212,175,55,0.07)",
          borderBottom:  "1px solid rgba(212,175,55,0.18)",
          padding:       "7px 20px",
          fontSize:      12,
          color:         "rgba(212,175,55,0.85)",
          fontFamily:    "'JetBrains Mono', monospace",
          display:       "flex",
          alignItems:    "center",
          gap:           8,
          flexShrink:    0,
        }}
      >
        <span>👁</span>
        <span>
          Spectating: <strong>{bannerName}</strong>
          {bannerBlinds && <> — NL Hold&apos;em {bannerBlinds}</>}
          {" — "}
          <span style={{ color: "#4ade80" }}>{bannerPlayers}</span>
          {meta && <> / {meta.maxPlayers}</>} players
        </span>
        <button
          onClick={() => navigate(`/table/${id ?? ""}`)}
          style={{
            marginLeft:   "auto",
            background:   "rgba(212,175,55,0.15)",
            border:       "1px solid rgba(212,175,55,0.3)",
            borderRadius: 4,
            color:        "#d4af37",
            cursor:       "pointer",
            fontSize:     11,
            padding:      "3px 10px",
            fontFamily:   "'JetBrains Mono', monospace",
          }}
        >
          Join table →
        </button>
      </div>

      <main
        style={{
          flex:           1,
          overflow:       "hidden",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          padding:        "12px",
        }}
      >
        <PokerTable
          state={gameState}
          recentActions={recentActions}
          demoChat={demoChat}
          maxSeats={maxSeats}
        />
      </main>
    </Layout>
  );
}

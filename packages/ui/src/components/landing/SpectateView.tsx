import { useParams, useNavigate } from "react-router-dom";
import { useTablePolling } from "../../hooks/useTablePolling.js";
import { Layout }          from "../layout/Layout.js";
import { Header }          from "../layout/Header.js";
import { PokerTable }      from "../table/PokerTable.js";

/**
 * Spectator view — read-only table, no actions panel.
 * Uses REST polling instead of WebSocket (WS unreliable on Railway).
 */
export function SpectateView() {
  const navigate             = useNavigate();
  const { id }               = useParams<{ id: string }>();
  const { gameState, meta, isConnected } = useTablePolling(id);

  const bannerName    = meta?.name    ?? id ?? "Table";
  const bannerBlinds  = meta ? `$${meta.smallBlind}/$${meta.bigBlind}` : "";
  const bannerPlayers = meta?.players ?? gameState.seats.length;
  const maxSeats      = meta?.maxPlayers ?? 9;

  const mode = isConnected ? "connected" as const : "connecting" as const;

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
          background:   "rgba(212,175,55,0.07)",
          borderBottom: "1px solid rgba(212,175,55,0.18)",
          padding:      "7px 20px",
          fontSize:     12,
          color:        "rgba(212,175,55,0.85)",
          fontFamily:   "'JetBrains Mono', monospace",
          display:      "flex",
          alignItems:   "center",
          gap:          8,
          flexShrink:   0,
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
          recentActions={[]}
          demoChat={[]}
          maxSeats={maxSeats}
        />
      </main>
    </Layout>
  );
}

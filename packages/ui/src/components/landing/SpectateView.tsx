import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useAnimations } from "../../hooks/useAnimations.js";
import { useGameSocket }  from "../../hooks/useGameSocket.js";
import { useGameState }   from "../../hooks/useGameState.js";
import { Layout }         from "../layout/Layout.js";
import { Header }         from "../layout/Header.js";
import { PokerTable }     from "../table/PokerTable.js";
import { DEMO_TABLES }    from "../../lib/demo-lobby.js";

/**
 * Spectator view — read-only table (no actions panel).
 * Reuses the same game state / socket hooks as TableView but
 * hides the GameControls and AddAgent button.
 */
export function SpectateView() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const tableConfig = DEMO_TABLES.find((t) => t.id === id);
  const smallBlind  = tableConfig?.blinds.small ?? 5;
  const bigBlind    = tableConfig?.blinds.big   ?? 10;
  const botCount    = tableConfig?.maxSeats      ?? 5;
  const maxSeats    = tableConfig?.maxSeats      ?? 9;

  const { speed, isPlaying }  = useAnimations();
  const { mode, liveSnapshot } = useGameSocket();
  const { gameState, recentActions, demoChat } = useGameState(
    liveSnapshot,
    mode === "connected",
    isPlaying,
    speed,
    smallBlind,
    bigBlind,
    botCount,
  );

  return (
    <Layout>
      <Header
        handNumber={gameState.handNumber}
        mode={mode}
        phase={gameState.phase}
        onLogoClick={() => navigate("/")}
      />

      {/* Spectate banner */}
      <div
        style={{
          background:    "rgba(212,175,55,0.08)",
          borderBottom:  "1px solid rgba(212,175,55,0.2)",
          padding:       "8px 20px",
          fontSize:      12,
          color:         "rgba(212,175,55,0.8)",
          fontFamily:    "'JetBrains Mono', monospace",
          display:       "flex",
          alignItems:    "center",
          gap:           8,
        }}
      >
        <span>👁</span>
        <span>Spectating — {tableConfig?.name ?? id}</span>
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

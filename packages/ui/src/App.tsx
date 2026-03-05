import { useState, useCallback, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";

import { useAnimations } from "./hooks/useAnimations.js";
import { useGameSocket } from "./hooks/useGameSocket.js";
import { useGameState }  from "./hooks/useGameState.js";

import { Layout }         from "./components/layout/Layout.js";
import { Header }         from "./components/layout/Header.js";
import { Sidebar }        from "./components/layout/Sidebar.js";
import { LobbyScreen }    from "./components/lobby/LobbyScreen.js";
import { AddAgentModal }  from "./components/lobby/AddAgentModal.js";
import { PokerTable }     from "./components/table/PokerTable.js";
import { GameControls }   from "./components/controls/GameControls.js";
import { ActionTimeline } from "./components/actions/ActionTimeline.js";
import { FixedChat }      from "./components/chat/FixedChat.js";
import { Leaderboard }    from "./components/dashboard/Leaderboard.js";
import { HandHistory }    from "./components/dashboard/HandHistory.js";
import { TokenBankPanel } from "./components/dashboard/TokenBankPanel.js";
import { DEMO_TABLES }    from "./lib/demo-lobby.js";
import type { LobbyTable } from "./lib/demo-lobby.js";
import { registerAgent, lookupAgent } from "./lib/agent-registry.js";
import type { AgentConfig } from "./components/lobby/AddAgentModal.js";

import { LandingPage }     from "./components/landing/LandingPage.js";
import { LeaderboardPage } from "./components/landing/LeaderboardPage.js";
import { DocsPage }        from "./components/landing/DocsPage.js";
import { SpectateView }    from "./components/landing/SpectateView.js";

// ---------------------------------------------------------------------------
// Lobby view  —  route "/lobby"
// ---------------------------------------------------------------------------

function LobbyView({ tables, onTableCreated }: { tables: LobbyTable[]; onTableCreated: (t: LobbyTable) => void }) {
  const navigate = useNavigate();

  return (
    <Layout>
      <Header
        right={
          <button
            className="flex items-center gap-2 px-3 py-1.5 border border-white/10
                       text-white/50 text-xs font-mono rounded hover:border-gold/30
                       hover:text-white/80 transition-colors"
          >
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] leading-none flex-shrink-0"
              style={{
                background: "rgba(212,175,55,0.15)",
                border:     "1px solid rgba(212,175,55,0.35)",
              }}
            >
              👤
            </span>
            <span>My Profile</span>
          </button>
        }
      />

      <LobbyScreen
        initialTables={tables}
        onJoinTable={(tableId) => navigate(`/table/${tableId}`)}
        onWatchTable={(tableId) => navigate(`/spectate/${tableId}`)}
        onTableCreated={onTableCreated}
      />
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Table view  —  route "/table/:id"
// ---------------------------------------------------------------------------

function TableView({ tables }: { tables: LobbyTable[] }) {
  const navigate = useNavigate();
  const { id }   = useParams<{ id: string }>();

  // Table config — check both static and dynamically created tables
  const tableConfig = tables.find((t) => t.id === id);
  const smallBlind  = tableConfig?.blinds.small ?? 5;
  const bigBlind    = tableConfig?.blinds.big   ?? 10;
  const botCount    = tableConfig?.maxSeats      ?? 5;
  const maxSeats    = tableConfig?.maxSeats      ?? 9;

  const { speed, setSpeed, isPlaying, setIsPlaying } = useAnimations();
  const { mode, liveSnapshot, chatMessages, toggleMode, connect } = useGameSocket(undefined, id);

  // Auto-connect to live server and populate agent name registry
  useEffect(() => {
    connect();
    // Fetch registered external agents and add them to the local display registry
    fetch("/api/agents")
      .then((r) => (r.ok ? r.json() : []))
      .then((agents: Array<{ agentId: string; name: string; type: string }>) => {
        for (const a of agents) {
          if (!lookupAgent(a.agentId)) {
            registerAgent({ id: a.agentId, name: a.name, nickname: a.name, emoji: "🤖", type: "bot", color: "#d4af37", style: "External" });
          }
        }
      })
      .catch(() => {});
  }, [connect]);
  const { gameState, recentActions, demoChat, handHistory, controlRef } = useGameState(
    liveSnapshot,
    mode === "connected",
    isPlaying,
    speed,
    smallBlind,
    bigBlind,
    botCount,
  );

  // AddAgent modal state
  const [addModalOpen, setAddModalOpen] = useState(false);

  const allChat = mode === "connected"
    ? chatMessages.map((m) => ({ agentId: m.agentId, message: m.message, timestamp: m.timestamp }))
    : demoChat;

  // ── Agent management ────────────────────────────────────────────────────

  const handleAddAgent = useCallback((config: AgentConfig) => {
    // Register in the display registry so name/emoji/color show everywhere
    registerAgent({
      id:       config.agentId,
      name:     config.name,
      nickname: config.name,
      emoji:    config.emoji,
      type:     "bot",
      color:    config.color,
      style:    "Custom",
    });
    // Queue the agent to join on next hand
    controlRef.current?.addAgent({
      agentId:     config.agentId,
      stack:       config.tokens,
      personality: config.personality,
    });
  }, [controlRef]);

  const handleKick = useCallback((agentId: string) => {
    controlRef.current?.removeAgent(agentId);
  }, [controlRef]);

  const handleRebuy = useCallback((agentId: string) => {
    controlRef.current?.rebuyAgent(agentId, bigBlind * 20);
  }, [controlRef, bigBlind]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Layout>
      <Header
        handNumber={gameState.handNumber}
        mode={mode}
        phase={gameState.phase}
        onLogoClick={() => navigate("/lobby")}
      />

      {/* ── CSS Grid main layout ─────────────────────────────────────────── */}
      <main
        style={{
          flex:                1,
          overflow:            "hidden",
          display:             "grid",
          gridTemplateColumns: "1fr 260px",
          gridTemplateRows:    "1fr 40px",
        }}
      >
        {/* Row 1, Col 1 — Table */}
        <div
          style={{
            gridRow:        1,
            gridColumn:     1,
            overflow:       "hidden",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            padding:        "8px 12px 0",
          }}
        >
          <PokerTable
            state={gameState}
            recentActions={recentActions}
            demoChat={demoChat}
            maxSeats={maxSeats}
            onAddAgent={() => setAddModalOpen(true)}
            onKickAgent={handleKick}
            onRebuyAgent={handleRebuy}
          />
        </div>

        {/* Row 2, Col 1 — Controls */}
        <div
          style={{
            gridRow:        2,
            gridColumn:     1,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            borderTop:      "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <GameControls
            isPlaying={isPlaying}
            speed={speed}
            mode={mode}
            onTogglePlay={() => setIsPlaying((v) => !v)}
            onSpeedChange={setSpeed}
            onToggleMode={toggleMode}
          />
        </div>

        {/* Rows 1–2, Col 2 — Sidebar */}
        <div
          style={{
            gridRow:    "1 / 3",
            gridColumn: 2,
            borderLeft: "1px solid rgba(255,255,255,0.05)",
            overflow:   "hidden",
            display:    "flex",
            flexDirection: "column",
          }}
        >
          <Sidebar tabs={[
            {
              id:      "actions",
              label:   "⚡ Acts",
              content: <ActionTimeline actions={recentActions} />,
            },
            {
              id:      "board",
              label:   "📊 Board",
              content: (
                <div className="flex flex-col gap-4">
                  <Leaderboard seats={gameState.seats} />
                  <div className="border-t border-white/5 pt-3">
                    <HandHistory hands={handHistory} />
                  </div>
                </div>
              ),
            },
            {
              id:      "tokens",
              label:   "💰 Tokens",
              content: <TokenBankPanel seats={gameState.seats} />,
            },
          ]} />
        </div>
      </main>

      {/* Fixed chat overlay */}
      <FixedChat messages={allChat} />

      {/* Add Agent Modal */}
      <AddAgentModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onAdd={handleAddAgent}
        currentSeats={gameState.seats.length}
        maxSeats={maxSeats}
      />
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// App  —  routing shell
// ---------------------------------------------------------------------------

export default function App() {
  // Shared tables state so dynamically created tables are visible in TableView
  const [tables, setTables] = useState<LobbyTable[]>(DEMO_TABLES);

  const handleTableCreated = useCallback((t: LobbyTable) => {
    setTables((prev) => [...prev, t]);
  }, []);

  return (
    <Routes>
      <Route path="/"               element={<LandingPage />} />
      <Route path="/lobby"          element={<LobbyView tables={tables} onTableCreated={handleTableCreated} />} />
      <Route path="/table/:id"      element={<TableView tables={tables} />} />
      <Route path="/spectate/:id"   element={<SpectateView />} />
      <Route path="/leaderboard"    element={<LeaderboardPage />} />
      <Route path="/docs"           element={<DocsPage />} />
      <Route path="*"               element={<Navigate to="/" replace />} />
    </Routes>
  );
}

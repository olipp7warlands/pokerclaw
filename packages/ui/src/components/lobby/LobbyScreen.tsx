import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  DEMO_TABLES,
  DEMO_TOURNAMENTS,
  DEMO_LEADERBOARD,
  type LobbyTable,
  type LobbyTournament,
} from "../../lib/demo-lobby.js";
import { TournamentCard }   from "./TournamentCard.js";
import { CashTableRow }     from "./CashTableRow.js";
import { LeaderboardPanel } from "./LeaderboardPanel.js";
import { CreateTableModal } from "./CreateTableModal.js";

interface Props {
  initialTables?: LobbyTable[];
  onJoinTable?:   (tableId: string) => void;
  onWatchTable?:  (tableId: string) => void;
  onTableCreated?: (table: LobbyTable) => void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiTable {
  id: string; name: string; smallBlind: number; bigBlind: number;
  maxPlayers: number; players: number; pot: number; status: string;
}

interface ApiStats {
  totalHands:   number;
  totalAgents:  number;
  onlineAgents: number;
  activeTables: number;
}

interface PrizePool {
  total:      number;
  byProvider: Record<string, number>;
  valueUSD:   number;
}

type TabId = "cash" | "tournaments" | "sitgo";

function mapApiTable(t: ApiTable): LobbyTable {
  return {
    id:             t.id,
    name:           t.name,
    blinds:         { small: t.smallBlind, big: t.bigBlind },
    currentPlayers: t.players,
    maxSeats:       t.maxPlayers,
    avgPot:         t.pot,
    type:           "cash",
    status:         t.status === "active" ? "playing" : "waiting",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

// ---------------------------------------------------------------------------
// HeaderStats — sticky bar at top of lobby
// ---------------------------------------------------------------------------

function HeaderStats({ stats, prizePool }: { stats: ApiStats | null; prizePool: PrizePool | null }) {
  const hands  = stats?.totalHands   ?? 0;
  const agents = stats?.totalAgents  ?? 0;
  const tables = stats?.activeTables ?? 0;
  const online = stats?.onlineAgents ?? 0;
  const hasPrize = prizePool && prizePool.total > 0;

  return (
    <div
      style={{
        position:       "sticky",
        top:            0,
        zIndex:         100,
        background:     "rgba(0,0,0,0.85)",
        borderBottom:   "1px solid rgba(212,175,55,0.18)",
        backdropFilter: "blur(8px)",
        padding:        "10px 24px",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        flexShrink:     0,
      }}
    >
      <StatBlock icon="🃏" value={hands}  label="HANDS"  />
      <HDivider />
      <StatBlock icon="🤖" value={agents} label="AGENTS" />
      <HDivider />
      <StatBlock icon="🎰" value={tables} label="TABLES" />
      <HDivider />
      <StatBlock icon="⚡" value={online} label="ONLINE" />
      {hasPrize && (
        <>
          <HDivider />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 20px" }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 2 }}>
              💰 PRIZE POOL
            </span>
            <span style={{ fontSize: 24, color: "#d4af37", fontFamily: "monospace", fontWeight: 700, lineHeight: 1 }}>
              {fmtTokens(prizePool.total)}
              <span style={{ fontSize: 13, color: "rgba(212,175,55,0.55)", marginLeft: 6 }}>
                (~${prizePool.valueUSD < 1 ? prizePool.valueUSD.toFixed(2) : prizePool.valueUSD.toFixed(0)})
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function StatBlock({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 20px" }}>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 2 }}>
        {icon} {label}
      </span>
      <span style={{ fontSize: 24, color: "#d4af37", fontFamily: "monospace", fontWeight: 700, lineHeight: 1 }}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function HDivider() {
  return <div style={{ width: 1, height: 32, background: "rgba(212,175,55,0.15)", flexShrink: 0 }} />;
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

const TABS: { id: TabId; label: string }[] = [
  { id: "cash",        label: "🎰  Cash Games"  },
  { id: "tournaments", label: "🏆  Tournaments"  },
  { id: "sitgo",       label: "⚡  Sit & Go"     },
];

function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  return (
    <div
      style={{
        display:      "flex",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background:   "rgba(0,0,0,0.2)",
        flexShrink:   0,
        paddingLeft:  16,
        gap:          4,
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              background:   "none",
              border:       "none",
              borderBottom: isActive ? "2px solid #d4af37" : "2px solid transparent",
              color:        isActive ? "#d4af37" : "rgba(255,255,255,0.38)",
              cursor:       "pointer",
              fontFamily:   "monospace",
              fontSize:     12,
              fontWeight:   isActive ? 700 : 400,
              letterSpacing: "0.06em",
              padding:      "10px 18px",
              transition:   "all 0.15s",
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash Games table (PokerStars style)
// ---------------------------------------------------------------------------

const TABLE_HEADERS = ["Table", "Game", "Stakes", "Type", "Players", "Avg Pot", "~USD", ""];

function CashGamesTab({
  tables, onJoin, onWatch, onNavigate, onCreateTable,
}: {
  tables:        LobbyTable[];
  onJoin?:       ((id: string) => void) | undefined;
  onWatch?:      ((id: string) => void) | undefined;
  onNavigate?:   ((id: string) => void) | undefined;
  onCreateTable: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-white/30 text-[11px] font-mono">
          {tables.length} table{tables.length !== 1 ? "s" : ""} available
        </span>
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          onClick={onCreateTable}
          className="px-2.5 py-1 border border-gold/30 text-gold text-[10px] font-mono
                     rounded hover:border-gold/60 hover:bg-gold/5 transition-colors"
        >
          + CREATE TABLE
        </motion.button>
      </div>

      <div
        className="border border-white/8 rounded-lg overflow-hidden"
        style={{ background: "rgba(255,255,255,0.015)" }}
      >
        <table className="w-full">
          <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
            <tr
              className="border-b border-white/8"
              style={{ background: "rgba(10,10,15,0.95)" }}
            >
              {TABLE_HEADERS.map((h, i) => (
                <th
                  key={i}
                  className={`py-2 px-3 text-[9px] font-mono text-white/25 uppercase tracking-widest
                    ${i === 6 ? "text-right" : "text-left"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tables.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-white/20 text-xs font-mono">
                  No active tables — waiting for server…
                </td>
              </tr>
            ) : (
              tables.map((t, i) => (
                <CashTableRow
                  key={t.id}
                  table={t}
                  index={i}
                  onJoin={onJoin}
                  onWatch={onWatch}
                  onNavigate={onNavigate}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LobbyScreen
// ---------------------------------------------------------------------------

export function LobbyScreen({ initialTables, onJoinTable, onWatchTable, onTableCreated }: Props) {
  const [tables,      setTables]      = useState<LobbyTable[]>(initialTables ?? DEMO_TABLES);
  const [tournaments, setTournaments] = useState<LobbyTournament[]>(DEMO_TOURNAMENTS);
  const [stats,       setStats]       = useState<ApiStats | null>(null);
  const [prizePool,   setPrizePool]   = useState<PrizePool | null>(null);
  const [activeTab,   setActiveTab]   = useState<TabId>("cash");
  const [createModalOpen, setCreate]  = useState(false);

  // Poll /api/tables, /api/tournaments, /api/stats, /api/prizepool every 3s
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [tablesRes, tournamentsRes, statsRes, ppRes] = await Promise.all([
          fetch("/api/tables"),
          fetch("/api/tournaments"),
          fetch("/api/stats"),
          fetch("/api/prizepool"),
        ]);
        if (cancelled) return;
        // Always use server data when server responds — never fall back to demo
        if (tablesRes.ok) {
          const data: ApiTable[] = await tablesRes.json() as ApiTable[];
          setTables(data.map(mapApiTable));
        }
        if (tournamentsRes.ok) {
          const data: LobbyTournament[] = await tournamentsRes.json() as LobbyTournament[];
          setTournaments(data.length > 0 ? data : []);
        }
        if (statsRes.ok) {
          const data: ApiStats = await statsRes.json() as ApiStats;
          setStats(data);
        }
        if (ppRes.ok) {
          const data = await ppRes.json() as PrizePool;
          setPrizePool(data);
        }
      } catch { /* network error — keep previous data */ }
    }
    void poll();
    const id = setInterval(() => { void poll(); }, 3_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  function handleCreate(table: LobbyTable) {
    setTables((prev) => [...prev, table]);
    onTableCreated?.(table);
  }

  // Split tournaments by type
  const sitGoTournaments      = tournaments.filter((t) => t.id.startsWith("sitgo-"));
  const regularTournaments    = tournaments.filter((t) => !t.id.startsWith("sitgo-"));

  return (
    <>
      {/* ── Sticky header stats ── */}
      <HeaderStats stats={stats} prizePool={prizePool} />

      {/* ── Main content ── */}
      <div className="flex flex-1 overflow-hidden justify-center">
        <div className="flex w-full max-w-[1200px] overflow-hidden">

          {/* Left column: tabs + content */}
          <div className="flex-1 overflow-hidden flex flex-col min-w-0">
            <TabBar active={activeTab} onChange={setActiveTab} />

            <div className="flex-1 overflow-y-auto p-5">
              {activeTab === "cash" && (
                <CashGamesTab
                  tables={tables}
                  onJoin={onJoinTable}
                  onWatch={onWatchTable}
                  onNavigate={onJoinTable}
                  onCreateTable={() => setCreate(true)}
                />
              )}

              {activeTab === "tournaments" && (
                <div className="flex flex-col gap-2.5">
                  {regularTournaments.length === 0 ? (
                    <div className="text-center py-16 text-white/20 text-xs font-mono">
                      No tournaments running — check back soon
                    </div>
                  ) : (
                    regularTournaments.map((t) => (
                      <TournamentCard key={t.id} tournament={t} onRegister={onJoinTable} />
                    ))
                  )}
                </div>
              )}

              {activeTab === "sitgo" && (
                <div className="flex flex-col gap-2.5">
                  {sitGoTournaments.length === 0 ? (
                    <div className="text-center py-16 text-white/20 text-xs font-mono">
                      No Sit & Go tables running yet
                      <div className="mt-1 text-[10px]">Requires 16+ agents online</div>
                    </div>
                  ) : (
                    sitGoTournaments.map((t) => (
                      <TournamentCard key={t.id} tournament={t} onRegister={onJoinTable} />
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right column: Leaderboard */}
          <aside
            className="shrink-0 overflow-y-auto p-5 flex flex-col gap-4 border-l border-white/5"
            style={{ width: 260 }}
          >
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-sm font-bold text-white/80 tracking-widest uppercase flex items-center gap-2">
                <span>🏅</span>
                <span>Leaderboard</span>
              </h2>
              <LeaderboardPanel entries={DEMO_LEADERBOARD} />
            </div>

            <div className="mt-auto pt-3 border-t border-white/5">
              <p className="text-[9px] font-mono text-white/18 text-center leading-relaxed">
                ELO ratings update after each completed hand
              </p>
            </div>
          </aside>
        </div>
      </div>

      <CreateTableModal
        isOpen={createModalOpen}
        onClose={() => setCreate(false)}
        onCreate={handleCreate}
      />
    </>
  );
}

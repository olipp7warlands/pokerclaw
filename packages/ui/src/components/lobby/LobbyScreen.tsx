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

interface HeaderStatsProps {
  stats:     ApiStats | null;
  prizePool: PrizePool | null;
}

function HeaderStats({ stats, prizePool }: HeaderStatsProps) {
  const hands  = stats?.totalHands   ?? 0;
  const agents = stats?.totalAgents  ?? 0;
  const tables = stats?.activeTables ?? 0;
  const online = stats?.onlineAgents ?? 0;

  const hasPrize = prizePool && prizePool.total > 0;

  return (
    <div
      style={{
        position:      "sticky",
        top:           0,
        zIndex:        100,
        background:    "rgba(0,0,0,0.85)",
        borderBottom:  "1px solid rgba(212,175,55,0.18)",
        backdropFilter: "blur(8px)",
        padding:       "10px 24px",
        display:       "flex",
        alignItems:    "center",
        justifyContent: "center",
        gap:           0,
        flexShrink:    0,
      }}
    >
      <StatBlock icon="🃏" value={hands}  label="HANDS"  />
      <Divider />
      <StatBlock icon="🤖" value={agents} label="AGENTS" />
      <Divider />
      <StatBlock icon="🎰" value={tables} label="TABLES" />
      <Divider />
      <StatBlock icon="⚡" value={online} label="ONLINE" />

      {hasPrize && (
        <>
          <Divider />
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

function Divider() {
  return (
    <div style={{ width: 1, height: 32, background: "rgba(212,175,55,0.15)", flexShrink: 0 }} />
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  icon, title, extra, children,
}: {
  icon: string; title: string; extra?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold text-white/80 tracking-widest uppercase flex items-center gap-2">
          <span>{icon}</span>
          <span>{title}</span>
        </h2>
        {extra}
      </div>
      {children}
    </motion.section>
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
        if (tablesRes.ok) {
          const data: ApiTable[] = await tablesRes.json() as ApiTable[];
          setTables(data.map(mapApiTable));
        }
        if (tournamentsRes.ok) {
          const data: LobbyTournament[] = await tournamentsRes.json() as LobbyTournament[];
          setTournaments(data.length > 0 ? data : DEMO_TOURNAMENTS);
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

  return (
    <>
      {/* ── Sticky header stats bar ── */}
      <HeaderStats stats={stats} prizePool={prizePool} />

      {/* ── Main content — max-width 1200px centered ── */}
      <div className="flex flex-1 overflow-hidden justify-center">
        <div className="flex w-full max-w-[1200px] overflow-hidden">

          {/* Left column: Tournaments + Cash Tables */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 min-w-0">

            {/* Tournaments */}
            <Section icon="🏆" title="Tournaments">
              <div className="flex flex-col gap-2.5">
                {tournaments.map((t) => (
                  <TournamentCard
                    key={t.id}
                    tournament={t}
                    onRegister={onJoinTable}
                  />
                ))}
              </div>
            </Section>

            {/* Cash Tables */}
            <Section
              icon="🎰"
              title="Cash Tables"
              extra={
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setCreate(true)}
                  className="px-2.5 py-1 border border-gold/30 text-gold text-[10px] font-mono
                             rounded hover:border-gold/60 hover:bg-gold/5 transition-colors"
                >
                  + CREATE TABLE
                </motion.button>
              }
            >
              <div className="border border-white/8 rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.015)" }}>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/8" style={{ background: "rgba(255,255,255,0.025)" }}>
                      {["Table", "Blinds", "Players", "Avg Pot", "~USD", ""].map((h, i) => (
                        <th
                          key={i}
                          className={`py-2 px-3 text-[9px] font-mono text-white/25 uppercase tracking-widest ${i === 4 ? "text-right" : "text-left"}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map((t, i) => (
                      <CashTableRow
                        key={t.id}
                        table={t}
                        index={i}
                        onJoin={onJoinTable}
                        onWatch={onWatchTable}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>

          {/* Right column: Leaderboard — fixed 280px */}
          <aside
            className="shrink-0 overflow-y-auto p-5 flex flex-col gap-4 border-l border-white/5"
            style={{ width: 280 }}
          >
            <Section icon="🏅" title="Leaderboard">
              <LeaderboardPanel entries={DEMO_LEADERBOARD} />
            </Section>

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

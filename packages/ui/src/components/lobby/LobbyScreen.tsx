import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  DEMO_TABLES,
  DEMO_TOURNAMENTS,
  DEMO_LEADERBOARD,
  type LobbyTable,
  type LobbyTournament,
} from "../../lib/demo-lobby.js";
import { CashTableRow }     from "./CashTableRow.js";
import { LeaderboardPanel } from "./LeaderboardPanel.js";
import { CreateTableModal } from "./CreateTableModal.js";
import { formatTokens }     from "../../lib/utils.js";

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

interface RecentHand {
  tableId:    string;
  tableName:  string;
  handNumber: number;
  winners:    Array<{ agentId: string; amountWon: number }>;
  ts:         string;
}

// Unified row that merges cash tables + tournaments for the single list
interface UnifiedRow {
  id:         string;
  name:       string;
  type:       "Cash" | "Tournament" | "Sit & Go";
  stakes:     string;
  players:    number;
  maxPlayers: number;
  avgPot:     number;
  isPlaying:  boolean;
  // Original source id for navigation
  tableId:    string;
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

function buildUnifiedRows(tables: LobbyTable[], tournaments: LobbyTournament[]): UnifiedRow[] {
  const rows: UnifiedRow[] = [
    ...tables.map((t) => ({
      id:         t.id,
      name:       t.name,
      type:       "Cash" as const,
      stakes:     `$${t.blinds.small}/$${t.blinds.big}`,
      players:    t.currentPlayers,
      maxPlayers: t.maxSeats,
      avgPot:     t.avgPot,
      isPlaying:  t.status === "playing",
      tableId:    t.id,
    })),
    ...tournaments.map((t) => ({
      id:         t.id,
      name:       t.name,
      type:       (t.id.startsWith("sitgo-") ? "Sit & Go" : "Tournament") as "Sit & Go" | "Tournament",
      stakes:     `${t.buyIn} buy-in`,
      players:    t.currentPlayers,
      maxPlayers: t.maxPlayers,
      avgPot:     0,
      isPlaying:  t.status === "running",
      tableId:    t.id,
    })),
  ];
  // Sort by players desc, then name asc
  rows.sort((a, b) => b.players - a.players || a.name.localeCompare(b.name));
  return rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

function timeAgo(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
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
// Unified table row
// ---------------------------------------------------------------------------

const TYPE_STYLES: Record<string, { color: string; bg: string }> = {
  "Cash":       { color: "#d4af37",  bg: "rgba(212,175,55,0.12)"  },
  "Tournament": { color: "#818cf8",  bg: "rgba(129,140,248,0.12)" },
  "Sit & Go":   { color: "#4ade80",  bg: "rgba(74,222,128,0.12)"  },
};

function UnifiedTableRow({
  row, index, onJoin, onWatch, onNavigate,
}: {
  row:        UnifiedRow;
  index:      number;
  onJoin?:    ((id: string) => void) | undefined;
  onWatch?:   ((id: string) => void) | undefined;
  onNavigate?: ((id: string) => void) | undefined;
}) {
  const isFull       = row.players >= row.maxPlayers;
  const isAlmostFull = row.players >= row.maxPlayers - 1 && !isFull;
  const isEmpty      = row.players === 0;

  const playerColor = isFull ? "#f87171" : isAlmostFull ? "#fbbf24" : isEmpty ? "rgba(255,255,255,0.25)" : "#4ade80";
  const typeStyle   = TYPE_STYLES[row.type] ?? TYPE_STYLES["Cash"]!;

  return (
    <motion.tr
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.035, 0.4) }}
      onClick={() => onNavigate?.(row.tableId)}
      className="border-b border-white/5 cursor-pointer"
      whileHover={{ backgroundColor: "rgba(212,175,55,0.04)", boxShadow: "inset 3px 0 0 rgba(212,175,55,0.6)" }}
    >
      {/* Table name */}
      <td className="py-2.5 px-3 text-sm text-white/85 font-mono">
        <span className="flex items-center gap-2">
          {row.isPlaying && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
              style={{ background: "#4ade80", boxShadow: "0 0 5px rgba(74,222,128,0.8)" }}
            />
          )}
          {row.name}
        </span>
      </td>

      {/* Game */}
      <td className="py-2.5 px-3 text-xs font-mono text-white/35">NL Hold&apos;em</td>

      {/* Stakes */}
      <td className="py-2.5 px-3 text-xs font-mono font-bold" style={{ color: "#d4af37" }}>
        {row.stakes}
      </td>

      {/* Type badge */}
      <td className="py-2.5 px-3">
        <span
          className="px-1.5 py-0.5 text-[10px] font-mono rounded"
          style={{ color: typeStyle.color, background: typeStyle.bg }}
        >
          {row.type}
        </span>
      </td>

      {/* Players */}
      <td className="py-2.5 px-3 text-xs font-mono">
        <span style={{ color: playerColor, fontWeight: 600 }}>{row.players}</span>
        <span className="text-white/22">/{row.maxPlayers}</span>
      </td>

      {/* Avg pot */}
      <td className="py-2.5 px-3 text-xs font-mono text-white/45">
        {row.avgPot > 0 ? formatTokens(row.avgPot) : <span className="text-white/18">—</span>}
      </td>

      {/* Actions */}
      <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
        <span className="flex items-center justify-end gap-1.5">
          {!isFull && (
            <motion.button
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.94 }}
              onClick={(e) => { e.stopPropagation(); onJoin?.(row.tableId); }}
              className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded"
              style={{ background: "rgba(212,175,55,0.1)", border: "1.5px solid rgba(212,175,55,0.5)", color: "#d4af37" }}
            >
              JOIN
            </motion.button>
          )}
          <motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => { e.stopPropagation(); onWatch?.(row.tableId); }}
            className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded"
            style={{ border: "1.5px solid rgba(212,175,55,0.3)", color: "rgba(212,175,55,0.6)" }}
          >
            WATCH
          </motion.button>
        </span>
      </td>
    </motion.tr>
  );
}

// ---------------------------------------------------------------------------
// Recent Hands
// ---------------------------------------------------------------------------

function RecentHandsSection({ hands }: { hands: RecentHand[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-sm font-bold text-white/80 tracking-widest uppercase flex items-center gap-2">
        <span>🃏</span>
        <span>Recent Hands</span>
      </h2>

      {hands.length === 0 ? (
        <div className="text-center py-6 text-white/18 text-xs font-mono border border-white/5 rounded-lg">
          Waiting for first hand to complete…
        </div>
      ) : (
        <div
          className="border border-white/8 rounded-lg overflow-hidden"
          style={{ background: "rgba(255,255,255,0.015)" }}
        >
          {hands.map((h, i) => {
            const topWinner = h.winners[0];
            const totalPot  = h.winners.reduce((s, w) => s + w.amountWon, 0);
            return (
              <motion.div
                key={`${h.tableId}-${h.handNumber}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 last:border-0"
                style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}
              >
                <span className="text-xs font-mono text-white/35">
                  <span className="text-white/55">[{h.tableName}]</span>
                  {" "}Hand #{h.handNumber}
                </span>
                <span className="text-xs font-mono">
                  {topWinner ? (
                    <>
                      <span style={{ color: "#d4af37" }}>{topWinner.agentId}</span>
                      <span className="text-white/35"> won </span>
                      <span style={{ color: "#4ade80" }}>{fmtTokens(totalPot)}</span>
                      <span className="text-white/20"> tokens</span>
                    </>
                  ) : (
                    <span className="text-white/25">No winner recorded</span>
                  )}
                </span>
                <span className="text-[10px] font-mono text-white/20">{timeAgo(h.ts)}</span>
              </motion.div>
            );
          })}
        </div>
      )}
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
  const [recentHands, setRecentHands] = useState<RecentHand[]>([]);
  const [createModalOpen, setCreate]  = useState(false);

  // Poll /api/tables + /api/stats + /api/prizepool every 3s
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
          setTournaments(data.length > 0 ? data : []);
        }
        if (statsRes.ok) setStats(await statsRes.json() as ApiStats);
        if (ppRes.ok)    setPrizePool(await ppRes.json() as PrizePool);
      } catch { /* keep previous data */ }
    }
    void poll();
    const id = setInterval(() => { void poll(); }, 3_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Poll /api/recent-hands every 5s
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch("/api/recent-hands");
        if (r.ok && !cancelled) setRecentHands(await r.json() as RecentHand[]);
      } catch { /* keep previous */ }
    }
    void poll();
    const id = setInterval(() => { void poll(); }, 5_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  function handleCreate(table: LobbyTable) {
    setTables((prev) => [...prev, table]);
    onTableCreated?.(table);
  }

  const unifiedRows = buildUnifiedRows(tables, tournaments);

  return (
    <>
      {/* ── Sticky header stats ── */}
      <HeaderStats stats={stats} prizePool={prizePool} />

      {/* ── Main content ── */}
      <div className="flex flex-1 overflow-hidden justify-center">
        <div className="flex w-full max-w-[1200px] overflow-hidden">

          {/* Left column: unified table + recent hands */}
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6 min-w-0">

            {/* Section header */}
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-white/80 tracking-widest uppercase flex items-center gap-2">
                <span>🎰</span>
                <span>All Tables</span>
                <span className="text-white/25 font-normal text-[10px] normal-case tracking-normal">
                  ({unifiedRows.length} active)
                </span>
              </h2>
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setCreate(true)}
                className="px-2.5 py-1 border border-gold/30 text-gold text-[10px] font-mono
                           rounded hover:border-gold/60 hover:bg-gold/5 transition-colors"
              >
                + CREATE TABLE
              </motion.button>
            </div>

            {/* Unified table */}
            <div
              className="border border-white/8 rounded-lg overflow-hidden"
              style={{ background: "rgba(255,255,255,0.015)" }}
            >
              <table className="w-full">
                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                  <tr className="border-b border-white/8" style={{ background: "rgba(10,10,15,0.95)" }}>
                    {["Table", "Game", "Stakes", "Type", "Players", "Avg Pot", ""].map((h, i) => (
                      <th
                        key={i}
                        className="py-2 px-3 text-[9px] font-mono text-white/25 uppercase tracking-widest text-left"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unifiedRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-white/18 text-xs font-mono">
                        No active tables — server starting up…
                      </td>
                    </tr>
                  ) : (
                    unifiedRows.map((row, i) => (
                      <UnifiedTableRow
                        key={row.id}
                        row={row}
                        index={i}
                        onJoin={onJoinTable}
                        onWatch={onWatchTable}
                        onNavigate={onJoinTable}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Recent Hands */}
            <RecentHandsSection hands={recentHands} />
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

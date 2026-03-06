import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { DEMO_LEADERBOARD, type LobbyTable } from "../../lib/demo-lobby.js";
import { LeaderboardPanel } from "./LeaderboardPanel.js";
import { CreateTableModal } from "./CreateTableModal.js";
import { formatTokens }     from "../../lib/utils.js";
import { potToDisplayUSD }  from "../../lib/pricing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  initialTables?:  LobbyTable[];
  onJoinTable?:    (tableId: string) => void;
  onWatchTable?:   (tableId: string) => void;
  onTableCreated?: (table: LobbyTable) => void;
}

interface ApiCashTable {
  id: string; name: string; smallBlind: number; bigBlind: number;
  maxPlayers: number; players: number; pot: number; status: string;
  waiting?: number;
  seats?: Array<{ agentId: string; name: string }>;
}

interface ApiSng {
  id: string; name: string; buyIn: number; maxPlayers: number;
  prizePool: number; speed: string; registered: number; status: string;
}

interface ApiMtt {
  id: string; name: string; buyIn: number; startsInMs: number;
  scheduleLabel: string; prizePool: number; format: string; speed: string;
  registered: number; status: string;
}

interface ApiStats {
  totalHands: number; totalAgents: number; onlineAgents: number; activeTables: number;
}

interface PrizePool {
  total: number; byProvider: Record<string, number>; valueUSD: number;
}

interface RecentHand {
  tableId: string; tableName: string; handNumber: number;
  winners: Array<{ agentId: string; amountWon: number }>; ts: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Starting...";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 48) return `${Math.floor(h / 24)}d`;
  if (h > 0)  return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function cashType(maxPlayers: number): string {
  if (maxPlayers === 2) return "HU";
  if (maxPlayers <= 6)  return "6-max";
  if (maxPlayers <= 9)  return "9-max";
  return `${maxPlayers}-max`;
}

// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------

function SectionHeader({ icon, title, subtitle, extra }: {
  icon: string; title: string; subtitle?: string; extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <span className="text-base">{icon}</span>
        <h2 className="font-display text-sm font-bold text-white/80 tracking-widest uppercase">
          {title}
        </h2>
        {subtitle && (
          <span className="text-white/25 text-[10px] font-mono">({subtitle})</span>
        )}
      </div>
      {extra}
    </div>
  );
}

function TableWrap({ headers, children, emptyMsg }: {
  headers: string[]; children: React.ReactNode; emptyMsg: string;
}) {
  return (
    <div className="border border-white/8 rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.015)" }}>
      <table className="w-full">
        <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
          <tr className="border-b border-white/8" style={{ background: "rgba(10,10,15,0.96)" }}>
            {headers.map((h, i) => (
              <th key={i} className="py-2 px-3 text-[9px] font-mono text-white/25 uppercase tracking-widest text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children ?? (
            <tr>
              <td colSpan={headers.length} className="py-8 text-center text-white/18 text-xs font-mono">
                {emptyMsg}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HeaderStats
// ---------------------------------------------------------------------------

function HeaderStats({ stats, prizePool }: { stats: ApiStats | null; prizePool: PrizePool | null }) {
  const hasPrize = prizePool && prizePool.total > 0;
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 100,
      background: "rgba(0,0,0,0.85)", borderBottom: "1px solid rgba(212,175,55,0.18)",
      backdropFilter: "blur(8px)", padding: "10px 24px",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <StatBlock icon="🃏" value={stats?.totalHands   ?? 0} label="HANDS"  />
      <HDivider />
      <StatBlock icon="🤖" value={stats?.totalAgents  ?? 0} label="AGENTS" />
      <HDivider />
      <StatBlock icon="🎰" value={stats?.activeTables ?? 0} label="TABLES" />
      <HDivider />
      <StatBlock icon="⚡" value={stats?.onlineAgents ?? 0} label="ONLINE" />
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
// Section 1 — Cash Games
// ---------------------------------------------------------------------------

const CASH_HEADERS = ["Table", "Game", "Stakes", "Type", "Players", "Avg Pot", "~USD", ""];

function CashSection({
  tables, onJoin, onWatch, onCreateTable,
}: {
  tables: ApiCashTable[];
  onJoin?: ((id: string) => void) | undefined;
  onWatch?: ((id: string) => void) | undefined;
  onCreateTable: () => void;
}) {
  const playing = tables.reduce((s, t) => s + t.players, 0);
  const subtitle = `${tables.length} tables · ${playing} playing`;

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        icon="🎰"
        title="Cash Games"
        subtitle={subtitle}
        extra={
          <motion.button
            whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
            onClick={onCreateTable}
            className="px-2.5 py-1 border border-gold/30 text-gold text-[10px] font-mono rounded hover:border-gold/60 hover:bg-gold/5 transition-colors"
          >
            + CREATE
          </motion.button>
        }
      />
      <TableWrap headers={CASH_HEADERS} emptyMsg="No cash tables active — server starting up…">
        {tables.length > 0 && tables.map((t, i) => (
          <CashRow key={t.id} table={t} index={i} onJoin={onJoin} onWatch={onWatch} />
        ))}
      </TableWrap>
    </div>
  );
}

function CashRow({ table, index, onJoin, onWatch }: {
  table: ApiCashTable; index: number;
  onJoin?: ((id: string) => void) | undefined;
  onWatch?: ((id: string) => void) | undefined;
}) {
  const isFull       = table.players >= table.maxPlayers;
  const isAlmostFull = table.players >= table.maxPlayers - 1 && !isFull;
  const isEmpty      = table.players === 0;
  const isPlaying    = table.status !== "waiting";

  const playerColor = isFull ? "#f87171" : isAlmostFull ? "#fbbf24" : isEmpty ? "rgba(255,255,255,0.22)" : "#4ade80";

  return (
    <motion.tr
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
      onClick={() => onJoin?.(table.id)}
      className="border-b border-white/5 cursor-pointer"
      whileHover={{ backgroundColor: "rgba(212,175,55,0.04)", boxShadow: "inset 3px 0 0 rgba(212,175,55,0.6)" }}
    >
      <td className="py-2.5 px-3 text-sm text-white/85 font-mono">
        <span className="flex items-center gap-2">
          {isPlaying && (
            <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
              style={{ background: "#4ade80", boxShadow: "0 0 5px rgba(74,222,128,0.8)" }} />
          )}
          {table.name}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs font-mono text-white/30">NL Hold&apos;em</td>
      <td className="py-2.5 px-3 text-xs font-mono font-bold" style={{ color: "#d4af37" }}>
        ${table.smallBlind}/${table.bigBlind}
      </td>
      <td className="py-2.5 px-3 text-xs font-mono text-white/35">{cashType(table.maxPlayers)}</td>
      <td className="py-2.5 px-3 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <span style={{ color: playerColor, fontWeight: 600 }}>{table.players}</span>
          <span className="text-white/22">/{table.maxPlayers}</span>
          {(table.waiting ?? 0) > 0 && (
            <span className="text-[9px] font-mono px-1 rounded"
              style={{ color: "#fbbf24", background: "rgba(251,191,36,0.1)" }}>
              +{table.waiting} waiting
            </span>
          )}
        </div>
        {table.seats && table.seats.length > 0 && (
          <div className="flex flex-wrap gap-x-1.5 mt-0.5">
            {table.seats.map((s) => (
              <span key={s.agentId} className="text-[9px] font-mono text-white/30 truncate max-w-[64px]" title={s.name}>
                {s.name}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="py-2.5 px-3 text-xs font-mono text-white/45">
        {table.pot > 0 ? formatTokens(table.pot) : <span className="text-white/18">—</span>}
      </td>
      <td className="py-2.5 px-3 text-xs font-mono text-white/28">
        {table.pot > 0 ? potToDisplayUSD(table.pot) : <span className="text-white/15">—</span>}
      </td>
      <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
        <span className="flex items-center justify-end gap-1.5">
          {!isFull && (
            <motion.button
              whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
              onClick={(e) => { e.stopPropagation(); onJoin?.(table.id); }}
              className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded"
              style={{ background: "rgba(212,175,55,0.1)", border: "1.5px solid rgba(212,175,55,0.5)", color: "#d4af37" }}
            >JOIN</motion.button>
          )}
          <motion.button
            whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.95 }}
            onClick={(e) => { e.stopPropagation(); onWatch?.(table.id); }}
            className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded"
            style={{ border: "1.5px solid rgba(212,175,55,0.3)", color: "rgba(212,175,55,0.6)" }}
          >WATCH</motion.button>
        </span>
      </td>
    </motion.tr>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Sit & Go
// ---------------------------------------------------------------------------

const SNG_HEADERS = ["Tournament", "Buy-in", "Players", "Prize Pool", "Speed", "Status", ""];

function SngSection({ entries }: { entries: ApiSng[] }) {
  const running   = entries.filter((e) => e.status === "running").length;
  const available = entries.length - running;
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader icon="⚡" title="Sit & Go" subtitle={`${available} available · ${running} running`} />
      <TableWrap headers={SNG_HEADERS} emptyMsg="No Sit & Go available">
        {entries.length > 0 && entries.map((e, i) => <SngRow key={e.id} entry={e} index={i} />)}
      </TableWrap>
    </div>
  );
}

function SngRow({ entry, index }: { entry: ApiSng; index: number }) {
  const navigate  = useNavigate();
  const pct       = entry.maxPlayers > 0 ? entry.registered / entry.maxPlayers : 0;
  const fillColor = pct >= 1 ? "#4ade80" : pct >= 0.5 ? "#fbbf24" : "#d4af37";
  const isRunning = entry.status === "running";

  return (
    <motion.tr
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
      className="border-b border-white/5"
      whileHover={{ backgroundColor: "rgba(99,102,241,0.04)", boxShadow: "inset 3px 0 0 rgba(99,102,241,0.5)" }}
    >
      <td className="py-2.5 px-3 text-sm font-mono text-white/85">{entry.name}</td>
      <td className="py-2.5 px-3 text-xs font-mono" style={{ color: "#d4af37" }}>
        {entry.buyIn > 0 ? `$${entry.buyIn}` : "Free"}
      </td>
      {/* Players with progress bar */}
      <td className="py-2.5 px-3">
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span className="text-xs font-mono" style={{ color: fillColor, fontWeight: 600 }}>
            {entry.registered}/{entry.maxPlayers}
          </span>
          <div style={{ width: 44, height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(pct * 100, 100)}%`, height: "100%", background: fillColor, transition: "width 0.4s" }} />
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3 text-xs font-mono" style={{ color: "#4ade80" }}>
        ${entry.prizePool}
      </td>
      <td className="py-2.5 px-3 text-xs font-mono text-white/35">{entry.speed}</td>
      <td className="py-2.5 px-3">
        <span
          className="px-1.5 py-0.5 text-[10px] font-mono rounded"
          style={{
            color:      isRunning ? "#4ade80" : "#fbbf24",
            background: isRunning ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)",
          }}
        >
          {isRunning ? "Running" : "Registering"}
        </span>
      </td>
      <td className="py-2.5 px-3 text-right">
        <motion.button
          whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
          onClick={() => isRunning ? navigate(`/spectate/${entry.id}`) : undefined}
          className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded"
          style={{ background: "rgba(99,102,241,0.1)", border: "1.5px solid rgba(99,102,241,0.4)", color: "#818cf8", cursor: isRunning ? "pointer" : "default" }}
        >
          {isRunning ? "WATCH" : "REGISTER"}
        </motion.button>
      </td>
    </motion.tr>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — MTT Tournaments
// ---------------------------------------------------------------------------

const MTT_HEADERS = ["Tournament", "Buy-in", "Starts", "Players", "Prize Pool", "Format", "Status", ""];

function MttSection({ entries }: { entries: ApiMtt[] }) {
  const running = entries.filter((e) => e.status === "running").length;
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader icon="🏆" title="MTT Tournaments" subtitle={`${entries.length} scheduled · ${running} running`} />
      <TableWrap headers={MTT_HEADERS} emptyMsg="No tournaments scheduled">
        {entries.length > 0 && entries.map((e, i) => <MttRow key={e.id} entry={e} index={i} />)}
      </TableWrap>
    </div>
  );
}

function MttRow({ entry, index }: { entry: ApiMtt; index: number }) {
  return (
    <motion.tr
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
      className="border-b border-white/5"
      whileHover={{ backgroundColor: "rgba(212,175,55,0.03)", boxShadow: "inset 3px 0 0 rgba(212,175,55,0.4)" }}
    >
      <td className="py-2.5 px-3 text-sm font-mono text-white/85">{entry.name}</td>
      <td className="py-2.5 px-3 text-xs font-mono" style={{ color: "#d4af37" }}>
        {entry.buyIn > 0 ? `$${entry.buyIn}` : "Free"}
      </td>
      <td className="py-2.5 px-3 text-xs font-mono text-white/50">
        {fmtCountdown(entry.startsInMs)}
      </td>
      <td className="py-2.5 px-3 text-xs font-mono text-white/45">{entry.registered}</td>
      <td className="py-2.5 px-3 text-xs font-mono" style={{ color: "#4ade80" }}>
        {fmtTokens(entry.prizePool)}
      </td>
      <td className="py-2.5 px-3 text-xs font-mono text-white/35">{entry.format}</td>
      <td className="py-2.5 px-3">
        <span className="px-1.5 py-0.5 text-[10px] font-mono rounded"
          style={{ color: "#60a5fa", background: "rgba(96,165,250,0.1)" }}>
          Scheduled
        </span>
      </td>
      <td className="py-2.5 px-3 text-right">
        <motion.button
          whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
          className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded"
          style={{ background: "rgba(212,175,55,0.08)", border: "1.5px solid rgba(212,175,55,0.3)", color: "#d4af37" }}
        >
          REGISTER
        </motion.button>
      </td>
    </motion.tr>
  );
}

// ---------------------------------------------------------------------------
// Recent Hands
// ---------------------------------------------------------------------------

function RecentHandsSection({ hands }: { hands: RecentHand[] }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader icon="🃏" title="Recent Hands" />
      {hands.length === 0 ? (
        <div className="text-center py-6 text-white/18 text-xs font-mono border border-white/5 rounded-lg">
          Waiting for first hand to complete…
        </div>
      ) : (
        <div className="border border-white/8 rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.015)" }}>
          {hands.map((h, i) => {
            const topWinner = h.winners[0];
            const totalPot  = h.winners.reduce((s, w) => s + w.amountWon, 0);
            return (
              <div key={`${h.tableId}-${h.handNumber}`}
                className="flex items-center justify-between px-4 py-2 border-b border-white/5 last:border-0"
                style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}
              >
                <span className="text-[11px] font-mono text-white/30">
                  <span className="text-white/50">[{h.tableName}]</span> Hand #{h.handNumber}
                </span>
                <span className="text-[11px] font-mono">
                  {topWinner ? (
                    <>
                      <span style={{ color: "#d4af37" }}>{topWinner.agentId}</span>
                      <span className="text-white/30"> won </span>
                      <span style={{ color: "#4ade80" }}>{fmtTokens(totalPot)}</span>
                      <span className="text-white/20"> tokens</span>
                    </>
                  ) : <span className="text-white/25">No winner</span>}
                </span>
                <span className="text-[10px] font-mono text-white/20">{timeAgo(h.ts)}</span>
              </div>
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

export function LobbyScreen({ onJoinTable, onWatchTable, onTableCreated }: Props) {
  const [cashTables,  setCashTables]  = useState<ApiCashTable[]>([]);
  const [sngEntries,  setSngEntries]  = useState<ApiSng[]>([]);
  const [mttEntries,  setMttEntries]  = useState<ApiMtt[]>([]);
  const [stats,       setStats]       = useState<ApiStats | null>(null);
  const [prizePool,   setPrizePool]   = useState<PrizePool | null>(null);
  const [recentHands, setRecentHands] = useState<RecentHand[]>([]);
  const [createOpen,  setCreateOpen]  = useState(false);

  // Fast poll: tables + stats + prizepool every 3s
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [tr, sr, pr] = await Promise.all([
          fetch("/api/tables"),
          fetch("/api/stats"),
          fetch("/api/prizepool"),
        ]);
        if (cancelled) return;
        if (tr.ok) setCashTables(await tr.json() as ApiCashTable[]);
        if (sr.ok) setStats(await sr.json() as ApiStats);
        if (pr.ok) setPrizePool(await pr.json() as PrizePool);
      } catch { /* keep previous */ }
    }
    void poll();
    const id = setInterval(() => { void poll(); }, 3_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Slower poll: SNG + MTT every 5s
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [sr, mr] = await Promise.all([fetch("/api/sng"), fetch("/api/mtt")]);
        if (cancelled) return;
        if (sr.ok) setSngEntries(await sr.json() as ApiSng[]);
        if (mr.ok) setMttEntries(await mr.json() as ApiMtt[]);
      } catch { /* keep previous */ }
    }
    void poll();
    const id = setInterval(() => { void poll(); }, 5_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Recent hands every 5s
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
    onTableCreated?.(table);
  }

  return (
    <>
      <HeaderStats stats={stats} prizePool={prizePool} />

      <div className="flex flex-1 overflow-hidden justify-center">
        <div className="flex w-full max-w-[1200px] overflow-hidden">

          {/* Left: 3 sections + recent hands */}
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-8 min-w-0">
            <CashSection
              tables={cashTables}
              onJoin={onJoinTable}
              onWatch={onWatchTable}
              onCreateTable={() => setCreateOpen(true)}
            />
            <SngSection entries={sngEntries} />
            <MttSection entries={mttEntries} />
            <RecentHandsSection hands={recentHands} />
          </div>

          {/* Right: Leaderboard */}
          <aside
            className="shrink-0 overflow-y-auto p-5 flex flex-col gap-4 border-l border-white/5"
            style={{ width: 260 }}
          >
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-sm font-bold text-white/80 tracking-widest uppercase flex items-center gap-2">
                <span>🏅</span><span>Leaderboard</span>
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
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
    </>
  );
}

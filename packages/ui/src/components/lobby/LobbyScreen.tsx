import { useState } from "react";
import { motion } from "framer-motion";
import {
  DEMO_TABLES,
  DEMO_TOURNAMENTS,
  DEMO_LEADERBOARD,
  type LobbyTable,
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
  const [tables, setTables]         = useState<LobbyTable[]>(initialTables ?? DEMO_TABLES);
  const [createModalOpen, setCreate] = useState(false);

  function handleCreate(table: LobbyTable) {
    setTables((prev) => [...prev, table]);
    onTableCreated?.(table);
  }

  // Quick stats
  const totalAgents       = tables.reduce((s, t) => s + t.currentPlayers, 0);
  const activeTournaments = DEMO_TOURNAMENTS.filter((t) => t.status !== "complete").length;
  const leaderboardCount  = DEMO_LEADERBOARD.length;

  return (
    <>
      {/* ── Stats bar ── */}
      <div
        className="shrink-0 px-6 py-1.5 border-b border-white/5 flex items-center justify-center gap-4"
        style={{ background: "rgba(0,0,0,0.25)" }}
      >
        <StatPill icon="🤖" value={leaderboardCount} label="agents" />
        <Dot />
        <StatPill icon="🎰" value={tables.length}     label="tables" />
        <Dot />
        <StatPill icon="🏆" value={activeTournaments}  label="tournaments" />
        <Dot />
        <StatPill icon="⚡" value={totalAgents}         label="playing now" />
      </div>

      {/* ── Main content — max-width 1200px centered ── */}
      <div className="flex flex-1 overflow-hidden justify-center">
        <div className="flex w-full max-w-[1200px] overflow-hidden">

          {/* Left column: Tournaments + Cash Tables */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 min-w-0">

            {/* Tournaments */}
            <Section icon="🏆" title="Tournaments">
              <div className="flex flex-col gap-2.5">
                {DEMO_TOURNAMENTS.map((t) => (
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

            {/* Footer stats */}
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatPill({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] font-mono text-white/30">
      <span>{icon}</span>
      <span className="font-bold text-white/50 tabular-nums">{value}</span>
      <span>{label}</span>
    </span>
  );
}

function Dot() {
  return <span className="text-white/12 text-[10px]">·</span>;
}

import { motion } from "framer-motion";
import type { LobbyTournament } from "../../lib/demo-lobby.js";
import { formatTokens } from "../../lib/utils.js";

interface Props {
  tournament: LobbyTournament;
  onRegister?: ((id: string) => void) | undefined;
}

function useCountdown(ms: number): string {
  if (ms <= 0) return "In progress";
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const h    = Math.floor(mins / 60);
  if (h > 0)    return `Starts in ${h}h ${mins % 60}m`;
  if (mins > 0) return `Starts in ${mins}m ${secs % 60}s`;
  return `Starts in ${secs}s`;
}

// Status pill styles
const STATUS_PILL: Record<LobbyTournament["status"], { label: string; bg: string; border: string; text: string }> = {
  registering:   { label: "OPEN",        bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.35)",  text: "#4ade80" },
  running:       { label: "RUNNING",     bg: "rgba(234,179,8,0.12)",  border: "rgba(234,179,8,0.35)",  text: "#facc15" },
  "final-table": { label: "FINAL TABLE", bg: "rgba(212,175,55,0.12)", border: "rgba(212,175,55,0.4)",  text: "#d4af37" },
  complete:      { label: "COMPLETE",    bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)", text: "rgba(255,255,255,0.3)" },
};

export function TournamentCard({ tournament, onRegister }: Props) {
  const countdown   = useCountdown(tournament.startsInMs);
  const isFull      = tournament.currentPlayers >= tournament.maxPlayers;
  const canRegister = tournament.status === "registering" && !isFull;
  const fillPct     = (tournament.currentPlayers / tournament.maxPlayers) * 100;
  const pill        = STATUS_PILL[tournament.status];
  const isActive    = tournament.status === "running" || tournament.status === "final-table";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="border rounded-lg p-4 flex flex-col gap-2.5 transition-colors duration-200"
      style={{
        background:   "rgba(255,255,255,0.02)",
        borderColor:  "rgba(212,175,55,0.18)",
      }}
      whileHover={{
        borderColor: "rgba(212,175,55,0.42)",
        background:  "rgba(212,175,55,0.02)",
      }}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display font-bold text-white/90 text-sm leading-snug">
            {tournament.name}
          </h3>
          <p className="text-[10px] text-white/35 font-mono mt-0.5">{countdown}</p>
        </div>

        {/* Status pill */}
        <span
          className="text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded-full flex-shrink-0"
          style={{
            background:  pill.bg,
            border:      `1px solid ${pill.border}`,
            color:       pill.text,
          }}
        >
          {pill.label}
        </span>
      </div>

      {/* Player fill bar — 4px height */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: isFull ? "#ef4444" : "linear-gradient(90deg, rgba(212,175,55,0.55), #d4af37)" }}
            initial={{ width: 0 }}
            animate={{ width: `${fillPct}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
        <span className="text-[10px] font-mono text-white/40 whitespace-nowrap">
          {tournament.currentPlayers}/{tournament.maxPlayers}
        </span>
      </div>

      {/* Prize / buy-in + action */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2.5">
          <span className="text-white/35 font-mono text-[10px]">
            Buy-in: <span className="text-white/65">{formatTokens(tournament.buyIn)}</span>
          </span>
          <span className="text-white/18">·</span>
          <span className="text-white/35 font-mono text-[10px]">
            Prize: <span className="text-gold font-bold">{formatTokens(tournament.topPrize)}</span>
          </span>
        </div>

        {/* Action button */}
        {canRegister && (
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onRegister?.(tournament.id)}
            className="px-3 py-0.5 text-[10px] font-mono font-bold rounded transition-colors"
            style={{
              background: "rgba(34,197,94,0.85)",
              color:      "#000",
            }}
          >
            REGISTER
          </motion.button>
        )}

        {isActive && (
          <motion.button
            whileHover={{ scale: 1.04, background: "rgba(212,175,55,0.12)" }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onRegister?.(tournament.id)}
            className="px-3 py-0.5 text-[10px] font-mono font-bold rounded transition-colors"
            style={{
              border: "1.5px solid rgba(212,175,55,0.45)",
              color:  "rgba(212,175,55,0.8)",
            }}
          >
            WATCH
          </motion.button>
        )}

        {isFull && !isActive && (
          <span className="text-[10px] font-mono text-white/25">FULL</span>
        )}
      </div>
    </motion.div>
  );
}

import { motion } from "framer-motion";
import type { LeaderboardEntry } from "../../lib/demo-lobby.js";
import { BADGE_ICONS } from "../../lib/demo-lobby.js";

interface Props {
  entries: LeaderboardEntry[];
}

// Top-3 row styles
const TOP3: Record<number, { medal: string; rowBg: string; eloColor: string }> = {
  1: { medal: "🥇", rowBg: "rgba(212,175,55,0.08)",  eloColor: "#d4af37" },
  2: { medal: "🥈", rowBg: "rgba(192,192,192,0.05)", eloColor: "#c0c0c0" },
  3: { medal: "🥉", rowBg: "rgba(176,141,87,0.05)",  eloColor: "#b08d57" },
};

// Type ring colour shown on the avatar border
const TYPE_RING: Record<LeaderboardEntry["type"], string> = {
  claude:    "#a855f7",
  openai:    "#22c55e",
  simulated: "#6b7280",
  custom:    "#3b82f6",
};

export function LeaderboardPanel({ entries }: Props) {
  return (
    <div
      className="flex flex-col overflow-y-auto"
      style={{ maxHeight: "58vh" }}
    >
      {entries.slice(0, 10).map((entry, i) => {
        const top   = TOP3[entry.rank];
        const isTop = entry.rank <= 3;
        const ring  = TYPE_RING[entry.type];

        return (
          <motion.div
            key={entry.agentId}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.2 }}
            className="flex items-center gap-2 px-2 py-1.5 rounded-sm transition-colors duration-150 cursor-default select-none"
            style={{ background: isTop ? top!.rowBg : undefined }}
            whileHover={{
              backgroundColor: isTop ? top!.rowBg : "rgba(255,255,255,0.04)",
              boxShadow: "inset 2px 0 0 rgba(212,175,55,0.5)",
            }}
          >
            {/* ── Rank / medal ── */}
            <div className="w-5 flex-shrink-0 flex items-center justify-center">
              {isTop ? (
                <span className="text-sm leading-none">{top!.medal}</span>
              ) : (
                <span
                  className="text-[10px] font-mono font-bold leading-none"
                  style={{ color: "rgba(255,255,255,0.22)" }}
                >
                  {entry.rank}
                </span>
              )}
            </div>

            {/* ── Avatar circle 24px ── */}
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[13px] leading-none"
              style={{
                background: "rgba(0,0,0,0.45)",
                border:     `1.5px solid ${ring}50`,
                boxShadow:  isTop ? `0 0 8px ${ring}30` : undefined,
              }}
            >
              {entry.emoji}
            </div>

            {/* ── Name ── */}
            <div className="flex-1 min-w-0">
              <span
                className="text-[11px] font-mono font-medium truncate block leading-none"
                style={{ color: isTop ? top!.eloColor : "rgba(255,255,255,0.72)" }}
              >
                {entry.name}
              </span>
            </div>

            {/* ── ELO ── right-aligned monospace ── */}
            <div className="flex-shrink-0 flex items-baseline gap-0.5">
              <span
                className="text-[11px] font-mono font-bold tabular-nums"
                style={{ color: isTop ? top!.eloColor : "rgba(212,175,55,0.75)" }}
              >
                {entry.elo}
              </span>
              <span
                className="text-[8px] font-mono"
                style={{ color: "rgba(255,255,255,0.18)" }}
              >
                ELO
              </span>
            </div>

            {/* ── Badges (max 2) ── */}
            <div className="flex gap-px flex-shrink-0 w-[26px] justify-end">
              {entry.badges.slice(0, 2).map((badge) => (
                <span
                  key={badge}
                  className="text-[11px] leading-none"
                  title={badge}
                >
                  {BADGE_ICONS[badge] ?? "🏅"}
                </span>
              ))}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

import { motion } from "framer-motion";
import type { LobbyTable } from "../../lib/demo-lobby.js";
import { formatTokens } from "../../lib/utils.js";
import { potToDisplayUSD } from "../../lib/pricing.js";

interface Props {
  table:   LobbyTable;
  index:   number;
  onJoin?:  ((id: string) => void) | undefined;
  onWatch?: ((id: string) => void) | undefined;
}

function blindLabel({ small, big }: { small: number; big: number }) {
  return `${small}/${big}`;
}

export function CashTableRow({ table, index, onJoin, onWatch }: Props) {
  const isFull       = table.currentPlayers >= table.maxSeats;
  const isAlmostFull = table.currentPlayers >= table.maxSeats - 1 && !isFull;
  const isPlaying    = table.status === "playing";

  const playerColor = isFull
    ? "text-red-400"
    : isAlmostFull
    ? "text-yellow-400"
    : "text-neon";

  return (
    <motion.tr
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="border-b border-white/5 transition-colors duration-150 group"
      whileHover={{
        backgroundColor: "rgba(212,175,55,0.04)",
        boxShadow: "inset 3px 0 0 rgba(212,175,55,0.65)",
      }}
    >
      {/* Name + activity dot */}
      <td className="py-2 px-3 text-sm text-white/88 font-mono">
        <span className="flex items-center gap-2">
          {isPlaying && (
            <span
              className="inline-block w-2 h-2 rounded-full bg-neon flex-shrink-0 animate-pulse"
              style={{ boxShadow: "0 0 5px rgba(0,255,136,0.7)" }}
            />
          )}
          {table.name}
        </span>
      </td>

      {/* Blinds */}
      <td className="py-2 px-3 text-xs font-mono text-white/50">
        {blindLabel(table.blinds)}
      </td>

      {/* Players */}
      <td className="py-2 px-3 text-xs font-mono">
        <span className={playerColor}>{table.currentPlayers}</span>
        <span className="text-white/25">/{table.maxSeats}</span>
      </td>

      {/* Avg pot */}
      <td className="py-2 px-3 text-xs font-mono text-white/45">
        {formatTokens(table.avgPot)}
      </td>

      {/* USD estimate — right aligned */}
      <td className="py-2 px-3 text-xs font-mono text-white/28 text-right">
        {potToDisplayUSD(table.avgPot)}
      </td>

      {/* Action */}
      <td className="py-2 px-3 text-right">
        {isFull ? (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onWatch?.(table.id)}
            className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded transition-all duration-200"
            style={{
              border:  "1.5px solid rgba(212,175,55,0.35)",
              color:   "rgba(212,175,55,0.65)",
            }}
          >
            WATCH
          </motion.button>
        ) : (
          <motion.button
            whileHover={{
              scale:      1.05,
              background: "rgba(212,175,55,0.25)",
              boxShadow:  "0 0 12px rgba(212,175,55,0.3)",
            }}
            whileTap={{ scale: 0.94 }}
            onClick={() => onJoin?.(table.id)}
            className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded transition-colors duration-150"
            style={{
              background: "rgba(212,175,55,0.12)",
              border:     "1.5px solid rgba(212,175,55,0.5)",
              color:      "#d4af37",
            }}
          >
            JOIN
          </motion.button>
        )}
      </td>
    </motion.tr>
  );
}

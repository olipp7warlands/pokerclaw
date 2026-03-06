import { motion } from "framer-motion";
import type { LobbyTable } from "../../lib/demo-lobby.js";
import { formatTokens } from "../../lib/utils.js";
import { potToDisplayUSD } from "../../lib/pricing.js";

interface Props {
  table:       LobbyTable;
  index:       number;
  onJoin?:     ((id: string) => void) | undefined;
  onWatch?:    ((id: string) => void) | undefined;
  onNavigate?: ((id: string) => void) | undefined;
}

function tableType(bigBlind: number): string {
  return bigBlind >= 200 ? "Turbo" : "Regular";
}

export function CashTableRow({ table, index, onJoin, onWatch, onNavigate }: Props) {
  const isFull       = table.currentPlayers >= table.maxSeats;
  const isAlmostFull = table.currentPlayers >= table.maxSeats - 1 && !isFull;
  const isPlaying    = table.status === "playing";
  const isEmpty      = table.currentPlayers === 0;

  const playerColor = isFull
    ? "#f87171"
    : isAlmostFull
    ? "#fbbf24"
    : isEmpty
    ? "rgba(255,255,255,0.25)"
    : "#4ade80";

  const stakes = `$${table.blinds.small}/$${table.blinds.big}`;

  return (
    <motion.tr
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      onClick={() => onNavigate?.(table.id)}
      className="border-b border-white/5 cursor-pointer"
      style={{ transition: "background 0.12s" }}
      whileHover={{
        backgroundColor: "rgba(212,175,55,0.04)",
        boxShadow: "inset 3px 0 0 rgba(212,175,55,0.6)",
      }}
    >
      {/* Table name + activity dot */}
      <td className="py-2.5 px-3 text-sm text-white/85 font-mono">
        <span className="flex items-center gap-2">
          {isPlaying && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
              style={{ background: "#4ade80", boxShadow: "0 0 5px rgba(74,222,128,0.8)" }}
            />
          )}
          {table.name}
        </span>
      </td>

      {/* Game type */}
      <td className="py-2.5 px-3 text-xs font-mono text-white/35">
        NL Hold&apos;em
      </td>

      {/* Stakes */}
      <td className="py-2.5 px-3 text-xs font-mono font-bold" style={{ color: "#d4af37" }}>
        {stakes}
      </td>

      {/* Table type */}
      <td className="py-2.5 px-3 text-xs font-mono text-white/35">
        {tableType(table.blinds.big)}
      </td>

      {/* Players */}
      <td className="py-2.5 px-3 text-xs font-mono">
        <span style={{ color: playerColor, fontWeight: 600 }}>{table.currentPlayers}</span>
        <span className="text-white/22">/{table.maxSeats}</span>
      </td>

      {/* Avg pot */}
      <td className="py-2.5 px-3 text-xs font-mono text-white/45">
        {table.avgPot > 0 ? formatTokens(table.avgPot) : <span className="text-white/18">—</span>}
      </td>

      {/* USD estimate */}
      <td className="py-2.5 px-3 text-xs font-mono text-white/28 text-right">
        {table.avgPot > 0 ? potToDisplayUSD(table.avgPot) : <span className="text-white/15">—</span>}
      </td>

      {/* Actions */}
      <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
        <span className="flex items-center justify-end gap-1.5">
          {!isFull && (
            <motion.button
              whileHover={{ scale: 1.06, background: "rgba(212,175,55,0.22)" }}
              whileTap={{ scale: 0.94 }}
              onClick={(e) => { e.stopPropagation(); onJoin?.(table.id); }}
              className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded transition-colors"
              style={{
                background: "rgba(212,175,55,0.1)",
                border:     "1.5px solid rgba(212,175,55,0.5)",
                color:      "#d4af37",
              }}
            >
              JOIN
            </motion.button>
          )}
          <motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => { e.stopPropagation(); onWatch?.(table.id); }}
            className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded transition-all"
            style={{
              border: "1.5px solid rgba(212,175,55,0.3)",
              color:  "rgba(212,175,55,0.6)",
            }}
          >
            WATCH
          </motion.button>
        </span>
      </td>
    </motion.tr>
  );
}

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Board, SidePot, GamePhase, WinnerResult } from "@pokercrawl/engine";
import { CommunityCards } from "../cards/CommunityCards.js";
import { PotDisplay }     from "../chips/PotDisplay.js";
import { DEMO_AGENTS }    from "../../lib/constants.js";
import { lookupAgent }    from "../../lib/agent-registry.js";
import { formatTokens }   from "../../lib/utils.js";

interface TableCenterProps {
  board:    Board;
  mainPot:  number;
  sidePots: readonly SidePot[];
  phase:    GamePhase;
  winners?: readonly WinnerResult[];
}

// ---------------------------------------------------------------------------
// WinnerBanner — animates in on showdown, fades after a delay
// ---------------------------------------------------------------------------

function WinnerBanner({ winners }: { winners: readonly WinnerResult[] }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (winners.length === 0) { setVisible(false); return; }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3200);
    return () => clearTimeout(t);
  }, [winners]);

  if (winners.length === 0) return null;

  const w     = winners[0]!;
  const agent = lookupAgent(w.agentId) ?? DEMO_AGENTS.find((a) => a.id === w.agentId);
  const name  = agent?.nickname ?? w.agentId;
  const emoji = agent?.emoji    ?? "🏆";
  const color = agent?.color    ?? "#d4af37";
  const rank  = w.hand?.rank;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={w.agentId + w.amountWon}
          initial={{ opacity: 0, scale: 0.78, y: -8 }}
          animate={{ opacity: 1, scale: 1,    y: 0  }}
          exit={{    opacity: 0, scale: 0.88,  y: 6  }}
          transition={{ type: "spring", stiffness: 340, damping: 24 }}
          className="flex flex-col items-center gap-0.5"
          style={{ pointerEvents: "none" }}
        >
          {/* Main pill */}
          <div
            className="flex items-center gap-2 px-4 py-1.5 rounded-full"
            style={{
              background:  "rgba(0,0,0,0.88)",
              border:      `1.5px solid ${color}70`,
              boxShadow:   `0 0 18px ${color}35, 0 4px 16px rgba(0,0,0,0.6)`,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>{emoji}</span>
            <span
              className="font-display font-bold text-sm tracking-wide"
              style={{ color }}
            >
              {name}
            </span>
            <span className="font-mono text-xs text-white/50">wins</span>
            <span className="font-mono font-bold text-sm" style={{ color: "#d4af37" }}>
              +{formatTokens(w.amountWon)}
            </span>
          </div>

          {/* Hand rank sub-label */}
          {rank && (
            <span className="text-[9px] font-mono text-white/35 tracking-widest uppercase">
              {rank}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// TableCenter
// ---------------------------------------------------------------------------

export function TableCenter({ board, mainPot, sidePots, phase, winners = [] }: TableCenterProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      {/* Winner banner — shown during showdown/settlement */}
      {(phase === "showdown" || phase === "settlement") && winners.length > 0 && (
        <WinnerBanner winners={winners} />
      )}

      {/* Community cards */}
      <CommunityCards
        flop={board.flop}
        turn={board.turn}
        river={board.river}
      />

      {/* Pot */}
      <PotDisplay mainPot={mainPot} sidePots={sidePots} />
    </div>
  );
}

import { motion, AnimatePresence } from "framer-motion";
import type { GamePhase } from "@pokercrawl/engine";
import { PHASE_LABELS } from "../../lib/constants.js";

interface PhaseIndicatorProps {
  phase: GamePhase;
}

const VISIBLE_PHASES = ["preflop", "flop", "turn", "river", "showdown"] as const;

export function PhaseIndicator({ phase }: PhaseIndicatorProps) {
  const activeIndex = VISIBLE_PHASES.indexOf(phase as typeof VISIBLE_PHASES[number]);

  return (
    <div className="flex items-center gap-0 rounded-full px-4 py-2"
      style={{
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(4px)",
      }}
    >
      {VISIBLE_PHASES.map((p, i) => {
        const isActive  = p === phase;
        const isPast    = i < activeIndex;
        const isFuture  = i > activeIndex;

        return (
          <div key={p} className="flex items-center">
            {/* Dot */}
            <motion.div
              {...(isActive ? { layoutId: "active-phase-dot" } : {})}
              animate={{
                scale:   isActive ? 1.35 : 1,
                opacity: isFuture ? 0.25 : 1,
              }}
              transition={{ duration: 0.25, type: "spring", stiffness: 300 }}
              className="relative flex items-center justify-center"
              style={{ width: 10, height: 10 }}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full transition-all duration-300
                  ${isActive  ? "bg-gold"   : ""}
                  ${isPast    ? "bg-white/35" : ""}
                  ${isFuture  ? "bg-white/10 border border-white/15" : ""}
                `}
                style={isActive ? {
                  boxShadow: "0 0 8px rgba(212,175,55,0.9), 0 0 16px rgba(212,175,55,0.4)",
                } : undefined}
              />
            </motion.div>

            {/* Label */}
            <AnimatePresence mode="wait">
              {isActive ? (
                <motion.span
                  key={`label-${p}`}
                  initial={{ opacity: 0, x: 4, width: 0 }}
                  animate={{ opacity: 1, x: 0, width: "auto" }}
                  exit={{ opacity: 0, x: -4, width: 0 }}
                  transition={{ duration: 0.22 }}
                  className="ml-1.5 text-[10px] font-mono font-bold uppercase tracking-widest overflow-hidden whitespace-nowrap"
                  style={{ color: "#d4af37", textShadow: "0 0 8px rgba(212,175,55,0.6)" }}
                >
                  {PHASE_LABELS[p] ?? p}
                </motion.span>
              ) : (
                <span
                  className={`ml-1 text-[10px] font-mono uppercase tracking-wide
                    ${isPast ? "text-white/35" : "text-white/15"}
                  `}
                >
                  {PHASE_LABELS[p] ?? p}
                </span>
              )}
            </AnimatePresence>

            {/* Connector line (except last) */}
            {i < VISIBLE_PHASES.length - 1 && (
              <div
                className="mx-2 h-px"
                style={{
                  width: 20,
                  background: isPast
                    ? "linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.15))"
                    : "rgba(255,255,255,0.08)",
                  transition: "background 0.3s ease",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

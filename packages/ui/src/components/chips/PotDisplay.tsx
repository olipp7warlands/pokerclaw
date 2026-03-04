import { motion, AnimatePresence } from "framer-motion";
import type { SidePot } from "@pokercrawl/engine";
import { formatTokens } from "../../lib/utils.js";
import { TokenStack } from "./TokenStack.js";
import { potToDisplayUSD } from "../../lib/pricing.js";

interface PotDisplayProps {
  mainPot: number;
  sidePots?: readonly SidePot[];
}

export function PotDisplay({ mainPot, sidePots = [] }: PotDisplayProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* Main pot — golden glow */}
      <AnimatePresence mode="wait">
        <motion.div
          key={mainPot}
          initial={{ scale: 0.92, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2, type: "spring", stiffness: 300 }}
          className="flex items-center gap-2.5 px-4 py-1.5 rounded-full pot-glow"
          style={{
            background: "rgba(0,0,0,0.65)",
            border: "1.5px solid rgba(212,175,55,0.45)",
            backdropFilter: "blur(4px)",
          }}
        >
          <TokenStack amount={mainPot} small />
          <span
            className="font-display font-bold text-sm tracking-wide text-shadow-gold"
            style={{ color: "#d4af37" }}
          >
            POT: {formatTokens(mainPot)}
          </span>
        </motion.div>
      </AnimatePresence>

      {/* USD estimate */}
      {mainPot > 0 && (
        <span className="text-[9px] font-mono text-white/22 leading-none">
          {potToDisplayUSD(mainPot)} en inferencia
        </span>
      )}

      {/* Side pots */}
      <AnimatePresence>
        {sidePots.map((sp, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.8, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-full"
            style={{
              background: "rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <span className="text-white/45 text-xs font-mono">
              side {i + 1}: {formatTokens(sp.amount)}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

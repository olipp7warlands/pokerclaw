import { motion, AnimatePresence } from "framer-motion";
import type { TaskCard } from "@pokercrawl/engine";
import { Card } from "./Card.js";

interface CommunityCardsProps {
  flop: readonly TaskCard[];
  turn: TaskCard | null;
  river: TaskCard | null;
}

const SLOT_W = 48;
const SLOT_H = 67;

function EmptySlot() {
  return (
    <div
      className="rounded-lg border border-dashed border-white/20 flex items-center justify-center"
      style={{ width: SLOT_W, height: SLOT_H }}
    >
      <span className="text-white/10 text-xs">—</span>
    </div>
  );
}

export function CommunityCards({ flop, turn, river }: CommunityCardsProps) {
  // Flop slots (3), turn (1), river (1) — separated by a small gap
  const flopSlots = [flop[0] ?? null, flop[1] ?? null, flop[2] ?? null];

  return (
    <div className="flex items-center gap-1">
      {/* Flop */}
      {flopSlots.map((card, i) => (
        <AnimatePresence key={`flop-${i}`} mode="wait">
          {card ? (
            <motion.div
              key="card"
              initial={{ rotateY: 180, opacity: 0, y: -10 }}
              animate={{ rotateY: 0, opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.12 }}
            >
              <Card card={card} faceDown={false} width={SLOT_W} height={SLOT_H} />
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <EmptySlot />
            </motion.div>
          )}
        </AnimatePresence>
      ))}

      {/* Divider */}
      <div className="w-2" />

      {/* Turn */}
      <AnimatePresence mode="wait">
        {turn ? (
          <motion.div
            key="turn"
            initial={{ rotateY: 180, opacity: 0, y: -10 }}
            animate={{ rotateY: 0, opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card card={turn} faceDown={false} width={SLOT_W} height={SLOT_H} />
          </motion.div>
        ) : (
          <motion.div key="turn-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <EmptySlot />
          </motion.div>
        )}
      </AnimatePresence>

      {/* River */}
      <AnimatePresence mode="wait">
        {river ? (
          <motion.div
            key="river"
            initial={{ rotateY: 180, opacity: 0, y: -10 }}
            animate={{ rotateY: 0, opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <Card card={river} faceDown={false} width={SLOT_W} height={SLOT_H} />
          </motion.div>
        ) : (
          <motion.div key="river-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <EmptySlot />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

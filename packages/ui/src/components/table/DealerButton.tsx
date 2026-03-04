import { motion } from "framer-motion";
import type { SeatPct } from "../../lib/constants.js";

interface DealerButtonProps {
  dealerIndex: number;
  pctTable:    ReadonlyArray<SeatPct>;
}

/** Dealer "D" button, animated toward the active dealer seat. */
export function DealerButton({ dealerIndex, pctTable }: DealerButtonProps) {
  const seat = pctTable[dealerIndex] ?? { top: 50, left: 50 };

  // Place button 22% of the way from the seat toward the table center (50%, 45%)
  const cx = 50;
  const cy = 45;
  const t  = 0.22;
  const btnTop  = seat.top  + (cy - seat.top)  * t;
  const btnLeft = seat.left + (cx - seat.left) * t;

  return (
    <motion.div
      style={{ position: "absolute", transform: "translate(-50%, -50%)", zIndex: 25 }}
      animate={{ top: `${btnTop}%`, left: `${btnLeft}%` }}
      transition={{ type: "spring", stiffness: 160, damping: 20 }}
    >
      <div className="w-6 h-6 rounded-full bg-white text-black text-xs font-bold flex items-center justify-center shadow-md border-2 border-gold select-none">
        D
      </div>
    </motion.div>
  );
}

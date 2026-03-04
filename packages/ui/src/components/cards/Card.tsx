import { motion } from "framer-motion";
import type { CapabilityCard, TaskCard } from "@pokercrawl/engine";
import { suitColor, suitSymbol } from "../../lib/utils.js";
import { CardBack } from "./CardBack.js";
import { FLIP_DURATION, SUIT_COLORS } from "../../lib/constants.js";

type AnyCard = CapabilityCard | TaskCard;

interface CardProps {
  card: AnyCard | null;
  faceDown?: boolean;
  width?: number;
  height?: number;
  /** Animate flip-in on mount */
  animateReveal?: boolean;
  delay?: number;
}

function isTaskCard(c: AnyCard): c is TaskCard {
  return "task" in c;
}

export function Card({
  card,
  faceDown = false,
  width = 56,
  height = 80,
  animateReveal = false,
  delay = 0,
}: CardProps) {
  if (!card || faceDown) {
    return (
      <motion.div
        initial={animateReveal ? { rotateY: 180, opacity: 0 } : false}
        animate={animateReveal ? { rotateY: 0, opacity: 1 } : false}
        transition={{ duration: FLIP_DURATION, delay }}
        style={{ width, height, perspective: 600 }}
      >
        <CardBack width={width} height={height} />
      </motion.div>
    );
  }

  const color  = suitColor(card.suit);
  const symbol = suitSymbol(card.suit);
  const label  = isTaskCard(card) ? card.task : card.capability;

  // Subtle suit-tinted background
  const suitBg = `${color}08`;

  return (
    <motion.div
      initial={animateReveal ? { rotateY: 180, opacity: 0 } : false}
      animate={animateReveal ? { rotateY: 0, opacity: 1 } : false}
      transition={{ duration: FLIP_DURATION, delay }}
      className="card-face flex flex-col p-1.5 cursor-default select-none"
      style={{
        width,
        height,
        minWidth: width,
        borderRadius: 8,
        background: `linear-gradient(155deg, #1c1e2e 0%, #22243a 60%, #1a1c2c 100%)`,
        boxShadow: `0 2px 10px rgba(0,0,0,0.65), 0 0 0 0.5px rgba(255,255,255,0.05) inset, 0 0 6px ${color}18`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle suit color wash */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(circle at 50% 50%, ${suitBg}, transparent 70%)` }}
      />

      {/* Top-left rank + suit */}
      <div className="relative flex items-center gap-0.5 z-10">
        <span className="text-white font-mono font-bold leading-none" style={{ fontSize: 10 }}>
          {card.rank}
        </span>
        <span style={{ color, fontSize: 9, lineHeight: 1 }}>{symbol}</span>
      </div>

      {/* Center suit symbol */}
      <div className="relative flex-1 flex items-center justify-center z-10">
        <span
          style={{
            color,
            fontSize: 20,
            filter: `drop-shadow(0 0 4px ${color}80)`,
          }}
        >
          {symbol}
        </span>
      </div>

      {/* Bottom label */}
      <div
        className="relative text-center leading-none overflow-hidden z-10"
        style={{ fontSize: 6, color: "#7c87a0", maxWidth: width - 8 }}
        title={label}
      >
        {label.length > 12 ? label.slice(0, 12) + "…" : label}
      </div>
    </motion.div>
  );
}

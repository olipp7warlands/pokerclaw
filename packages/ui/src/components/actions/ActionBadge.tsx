import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { ACTION_COLORS, ACTION_BADGE_DURATION } from "../../lib/constants.js";
import { formatTokens } from "../../lib/utils.js";

interface ActionBadgeProps {
  action: string | null;
  amount?: number;
}

export function ActionBadge({ action, amount }: ActionBadgeProps) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<{ action: string; amount?: number } | null>(null);

  useEffect(() => {
    if (!action) return;
    setCurrent(amount !== undefined ? { action, amount } : { action });
    setVisible(true);
    const t = setTimeout(() => setVisible(false), ACTION_BADGE_DURATION);
    return () => clearTimeout(t);
  }, [action, amount]);

  const colors = current ? ACTION_COLORS[current.action] ?? ACTION_COLORS["check"] : null;
  const label  = current
    ? current.amount != null
      ? `${current.action.toUpperCase()} ${formatTokens(current.amount)}`
      : current.action.toUpperCase()
    : "";

  // Extra glow for aggressive actions
  const isAggressive = current?.action === "raise" || current?.action === "bet" || current?.action === "all-in";
  const glowStyle    = isAggressive
    ? { boxShadow: "0 0 10px rgba(212,175,55,0.6), 0 2px 8px rgba(0,0,0,0.5)" }
    : { boxShadow: "0 2px 8px rgba(0,0,0,0.4)" };

  return (
    <AnimatePresence>
      {visible && colors && (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: -10, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.8 }}
          transition={{ duration: 0.16, type: "spring", stiffness: 350 }}
          style={{ backgroundColor: colors.bg, color: colors.text, zIndex: 15, ...glowStyle }}
          className={`
            px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase
            whitespace-nowrap tracking-wide
            ${current?.action === "all-in" ? "animate-pulse" : ""}
          `}
        >
          {label}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

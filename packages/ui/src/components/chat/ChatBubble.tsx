import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { DEMO_AGENTS } from "../../lib/constants.js";

interface ChatBubbleProps {
  agentId:   string;
  message:   string;
  /** Agent color (passed from parent for efficiency) */
  color?:    string;
  /** Auto-dismiss after ms (default 3500) */
  duration?: number;
}

export function ChatBubble({ agentId, message, color, duration = 3500 }: ChatBubbleProps) {
  const [visible, setVisible] = useState(true);
  const agent = DEMO_AGENTS.find((a) => a.id === agentId);
  const agentColor = color ?? agent?.color ?? "#6b7280";

  useEffect(() => {
    setVisible(true);
    const t = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(t);
  }, [message, duration]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.88 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.9 }}
          transition={{ duration: 0.18, type: "spring", stiffness: 300 }}
          className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 pointer-events-none"
          style={{ zIndex: 20, minWidth: 80, maxWidth: 150 }}
        >
          <div
            className="relative px-2.5 py-1.5 rounded-xl text-xs font-mono text-white/90 text-center shadow-xl"
            style={{
              background: "rgba(8,8,18,0.94)",
              border: `1.5px solid ${agentColor}50`,
              boxShadow: `0 4px 16px rgba(0,0,0,0.6), 0 0 8px ${agentColor}20`,
              backdropFilter: "blur(8px)",
            }}
          >
            {/* Agent dot */}
            <span
              className="absolute -top-1 -left-1 w-2 h-2 rounded-full"
              style={{ background: agentColor, boxShadow: `0 0 4px ${agentColor}80` }}
            />
            {message}
            {/* Tail */}
            <div
              className="absolute left-1/2 -translate-x-1/2 -bottom-2"
              style={{
                width: 0,
                height: 0,
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: `6px solid ${agentColor}50`,
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

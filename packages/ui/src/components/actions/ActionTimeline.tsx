import { motion, AnimatePresence } from "framer-motion";
import { DEMO_AGENTS, ACTION_COLORS } from "../../lib/constants.js";
import { lookupAgent } from "../../lib/agent-registry.js";
import { formatTokens } from "../../lib/utils.js";

interface ActionEntry {
  agentId: string;
  action: string;
  amount?: number;
  timestamp: number;
}

interface ActionTimelineProps {
  actions: readonly ActionEntry[];
}

export function ActionTimeline({ actions }: ActionTimelineProps) {
  return (
    <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 260 }}>
      <h3 className="text-xs font-mono text-white/40 uppercase tracking-widest mb-1">Timeline</h3>
      <AnimatePresence initial={false}>
        {[...actions].reverse().map((entry) => {
          const agent = lookupAgent(entry.agentId) ?? DEMO_AGENTS.find((a) => a.id === entry.agentId);
          const colors = ACTION_COLORS[entry.action] ?? ACTION_COLORS["check"];

          const label = entry.amount != null
            ? `${entry.action} ${formatTokens(entry.amount)}`
            : entry.action;

          return (
            <motion.div
              key={entry.timestamp}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-2 text-xs"
            >
              <span style={{ color: agent?.color ?? "#fff" }} className="font-bold w-16 truncate">
                {agent?.emoji ?? "?"} {agent?.nickname ?? entry.agentId}
              </span>
              <span
                className="px-1.5 py-0.5 rounded font-mono text-[10px] uppercase"
                style={{ backgroundColor: colors?.bg, color: colors?.text }}
              >
                {label}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {actions.length === 0 && (
        <p className="text-white/20 text-xs font-mono">— no actions yet —</p>
      )}
    </div>
  );
}

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DEMO_AGENTS } from "../../lib/constants.js";
import { lookupAgent } from "../../lib/agent-registry.js";

interface ChatEntry {
  agentId: string;
  message: string;
  timestamp: number;
}

interface TableChatProps {
  messages: readonly ChatEntry[];
}

export function TableChat({ messages }: TableChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
        <span style={{ color: "rgba(212,175,55,0.4)" }}>💬</span>
        Table Chat
      </h3>
      <div className="overflow-y-auto flex flex-col gap-2" style={{ maxHeight: 220 }}>
        <AnimatePresence initial={false}>
          {messages.map((entry) => {
            const registered = lookupAgent(entry.agentId);
            const demo       = DEMO_AGENTS.find((a) => a.id === entry.agentId);
            const agent      = registered ?? demo;
            const color      = agent?.color ?? "#6b7280";

            return (
              <motion.div
                key={entry.timestamp}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="flex gap-2 items-start"
              >
                {/* Emoji avatar */}
                <span
                  className="text-base leading-none flex-shrink-0 mt-0.5"
                  title={agent?.nickname ?? entry.agentId}
                >
                  {agent?.emoji ?? "🤖"}
                </span>

                <div className="min-w-0">
                  {/* Agent name in their color */}
                  <span
                    className="text-[10px] font-mono font-bold"
                    style={{ color }}
                  >
                    {agent?.nickname ?? entry.agentId}
                  </span>

                  {/* Message */}
                  <p className="text-[11px] text-white/65 leading-tight mt-0.5 break-words">
                    {entry.message}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {messages.length === 0 && (
          <p className="text-white/18 text-xs font-mono italic">
            — silence at the table —
          </p>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DEMO_AGENTS } from "../../lib/constants.js";
import { lookupAgent } from "../../lib/agent-registry.js";

interface ChatEntry {
  agentId:   string;
  message:   string;
  timestamp: number;
}

interface FixedChatProps {
  messages: readonly ChatEntry[];
  /** When true, fills its container (grid cell). When false, uses fixed overlay. */
  inline?: boolean;
}

export function FixedChat({ messages, inline = false }: FixedChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const containerStyle = inline
    ? {
        width:         "100%",
        height:        "100%",
        background:    "rgba(0,0,0,0.92)",
        display:       "flex" as const,
        flexDirection: "column" as const,
        overflow:      "hidden",
      }
    : {
        position:            "fixed" as const,
        bottom:              70,
        left:                12,
        width:               280,
        maxHeight:           140,
        zIndex:              50,
        background:          "rgba(0,0,0,0.85)",
        backdropFilter:      "blur(8px)",
        WebkitBackdropFilter:"blur(8px)",
        border:              "1px solid rgba(212,175,55,0.15)",
        borderRadius:        8,
        display:             "flex" as const,
        flexDirection:       "column" as const,
        overflow:            "hidden",
        boxShadow:           "0 4px 24px rgba(0,0,0,0.5)",
      };

  return (
    <div style={containerStyle}>
      {/* ── Header ── */}
      <div
        style={{
          padding:      "6px 12px",
          background:   "rgba(255,255,255,0.04)",
          borderBottom: "1px solid rgba(212,175,55,0.12)",
          flexShrink:   0,
        }}
      >
        <span
          style={{
            fontFamily:     "JetBrains Mono, monospace",
            fontSize:        11,
            fontWeight:      700,
            color:          "rgba(255,255,255,0.4)",
            letterSpacing:  "0.08em",
            textTransform:  "uppercase",
          }}
        >
          💬 Table Chat
        </span>
      </div>

      {/* ── Messages ── */}
      <div
        style={{
          flex:          1,
          overflowY:     "auto",
          padding:       "8px 12px",
          display:       "flex",
          flexDirection: "column",
          gap:           5,
          scrollbarWidth: "none",
        }}
      >
        <AnimatePresence initial={false}>
          {messages.map((entry) => {
            const registered = lookupAgent(entry.agentId);
            const demo       = DEMO_AGENTS.find((a) => a.id === entry.agentId);
            const agent      = registered ?? demo;
            const color      = agent?.color ?? "#6b7280";
            const emoji      = agent?.emoji ?? "🤖";
            const name       = agent?.nickname ?? entry.agentId;

            return (
              <motion.div
                key={entry.timestamp}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.15 }}
                style={{
                  display:   "flex",
                  gap:        6,
                  alignItems: "baseline",
                  flexShrink: 0,
                  fontSize:   12,
                  lineHeight: "1.35",
                }}
              >
                {/* Emoji */}
                <span style={{ fontSize: 13, flexShrink: 0, lineHeight: 1 }}>
                  {emoji}
                </span>

                {/* Name + message on same line */}
                <span style={{ minWidth: 0, wordBreak: "break-word" }}>
                  <span
                    style={{
                      fontFamily:  "JetBrains Mono, monospace",
                      fontSize:     11,
                      fontWeight:   700,
                      color,
                      marginRight:  4,
                    }}
                  >
                    {name}
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                    {entry.message}
                  </span>
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {messages.length === 0 && (
          <p
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize:    11,
              color:      "rgba(255,255,255,0.18)",
              fontStyle:  "italic",
              margin:      0,
            }}
          >
            — silence at the table —
          </p>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

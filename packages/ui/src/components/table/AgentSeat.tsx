import { useState, useEffect, useCallback } from "react";
import { createPortal }  from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { AgentSeat as AgentSeatData } from "@pokercrawl/engine";
import type { DemoAgent, SeatRegion } from "../../lib/constants.js";
import { formatTokens } from "../../lib/utils.js";
import { CardHand }     from "../cards/CardHand.js";
import { ActionBadge }  from "../actions/ActionBadge.js";
import { ChatBubble }   from "../chat/ChatBubble.js";
import { getAgentTokens, formatInferenceTokenLine } from "../../lib/demo-tokens.js";

// ---------------------------------------------------------------------------
// Timer ring — SVG countdown circle (fits 48×48 avatar wrapper)
// ---------------------------------------------------------------------------

const TIMER_DURATION_MS  = 15_000;
const RING_R             = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;

function TimerRing({ isActive }: { isActive: boolean }) {
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (!isActive) { setProgress(1); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      const remaining = Math.max(0, 1 - (Date.now() - start) / TIMER_DURATION_MS);
      setProgress(remaining);
      if (remaining === 0) clearInterval(interval);
    }, 80);
    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  const strokeColor = progress > 0.4 ? "#d4af37" : progress > 0.2 ? "#f97316" : "#ef4444";
  const dashOffset  = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={48} height={48} viewBox="0 0 48 48"
      style={{ transform: "rotate(-90deg)" }}
    >
      <circle cx={24} cy={24} r={RING_R} fill="none"
        stroke="rgba(212,175,55,0.12)" strokeWidth={2} />
      <circle cx={24} cy={24} r={RING_R} fill="none"
        stroke={strokeColor} strokeWidth={2}
        strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={dashOffset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.1s linear, stroke 0.3s ease" }}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface MenuItem { label: string; icon: string; onClick: () => void; danger?: boolean }

function ContextMenu({ x, y, items, onClose }: {
  x: number; y: number; items: MenuItem[]; onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    document.addEventListener("click",       close, { once: true });
    document.addEventListener("contextmenu", close, { once: true });
    return () => {
      document.removeEventListener("click",       close);
      document.removeEventListener("contextmenu", close);
    };
  }, [onClose]);

  return createPortal(
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.1 }}
      className="fixed z-[9999] bg-[#0d0d18] border border-white/10 rounded-lg shadow-2xl py-1 overflow-hidden"
      style={{ left: x, top: y, minWidth: 156 }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => { item.onClick(); onClose(); }}
          className={`w-full px-3 py-1.5 text-left text-xs font-mono flex items-center gap-2
                      hover:bg-white/5 transition-colors
                      ${item.danger ? "text-red-400 hover:bg-red-900/20" : "text-white/60"}`}
        >
          <span>{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </motion.div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// AgentSeat
// ---------------------------------------------------------------------------

interface AgentSeatProps {
  seat:        AgentSeatData;
  agent:       DemoAgent;
  isActive:    boolean;
  isDealer:    boolean;
  region:      SeatRegion;
  lastAction?: { action: string; amount?: number } | null;
  lastChat?:   string | null;
  onKick?:     (agentId: string) => void;
  onRebuy?:    (agentId: string) => void;
}

export function AgentSeat({
  seat, agent, isActive, isDealer, region, lastAction, lastChat, onKick, onRebuy,
}: AgentSeatProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const isFolded     = seat.status === "folded";
  const isAllIn      = seat.status === "all-in";
  const isWaiting    = seat.status === "sitting-out" && seat.stack > 0;
  const isEliminated = seat.stack === 0 && !isAllIn;
  // Demo mode: cards always face-up (only sitting-out hides them)
  const faceDown     = seat.status === "sitting-out";

  // Region determines card layout direction
  const isHorizontal = region === "left" || region === "right";
  const cardsOnLeft  = region === "right";   // right seats: cards LEFT of avatar
  const cardsAbove   = region === "bottom";  // bottom seats: cards ABOVE avatar

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX + 4, y: e.clientY + 4 });
  }, []);

  const menuItems: MenuItem[] = [
    ...(onKick ? [{ label: "Kick", icon: "🚫", onClick: () => onKick(seat.agentId), danger: true }] : []),
    { label: "View Profile", icon: "👤", onClick: () => {} },
  ];

  // ── Waiting seats — minimal display: avatar + name + "waiting…" ────────
  if (isWaiting) {
    return (
      <>
        <div
          className="flex flex-col items-center gap-0.5 select-none"
          onContextMenu={handleContextMenu}
        >
          <div className="relative flex-shrink-0" style={{ width: 48, height: 48 }}>
            <div
              style={{
                position: "absolute",
                left: 4, top: 4,
                width: 40, height: 40,
                border: "2px solid #374151",
                opacity: 0.35,
                transition: "opacity 0.3s",
              }}
              className="rounded-full bg-void/80 flex items-center justify-center text-lg"
            >
              {agent.emoji}
            </div>
          </div>
          <span
            className="text-[11px] font-bold leading-none max-w-[80px] truncate"
            style={{ color: "#4b5563" }}
          >
            {agent.nickname}
          </span>
          <span className="text-[9px] font-mono text-white/20 italic leading-none">
            waiting…
          </span>
        </div>

        <AnimatePresence>
          {menuPos && menuItems.length > 0 && (
            <ContextMenu key="ctx" x={menuPos.x} y={menuPos.y}
              items={menuItems} onClose={() => setMenuPos(null)} />
          )}
        </AnimatePresence>
      </>
    );
  }

  // ── Avatar border / class ────────────────────────────────────────────────
  let avatarBorder = `2px solid ${agent.color}`;
  let avatarClass  = "";
  if (isActive)                      { avatarBorder = "2px solid #d4af37"; avatarClass = "agent-active"; }
  else if (isAllIn)                  { avatarBorder = "2px solid #d4af37"; avatarClass = "agent-allin"; }
  else if (isFolded || isEliminated) { avatarBorder = `2px solid ${agent.color}40`; }

  // ── Avatar block (48×48 wrapper, 40×40 circle) ───────────────────────────
  const avatarBlock = (
    <div className="relative flex-shrink-0" style={{ width: 48, height: 48 }}>
      {lastChat && <ChatBubble agentId={agent.id} message={lastChat} color={agent.color} />}

      <TimerRing isActive={isActive} />

      <div
        style={{
          position: "absolute",
          left: 4, top: 4,
          width: 40, height: 40,
          border: avatarBorder,
          filter: isFolded || isEliminated ? "grayscale(80%) brightness(0.6)" : "none",
          transition: "border-color 0.3s, filter 0.3s",
        }}
        className={`rounded-full bg-void/80 flex items-center justify-center text-lg
                    cursor-context-menu ${avatarClass}`}
      >
        {agent.emoji}
      </div>

      {isEliminated && (
        <div className="absolute -top-0.5 -right-0.5 px-1 py-px
                        bg-red-950/95 border border-red-500/70
                        text-red-400 text-[7px] font-mono font-bold
                        uppercase rounded tracking-wider out-badge
                        shadow-[0_0_6px_rgba(239,68,68,0.4)]">
          OUT
        </div>
      )}

      {isDealer && (
        <div
          className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-white border-2 border-gold
                     text-black text-[9px] font-bold flex items-center justify-center shadow-md select-none"
          style={{ zIndex: 5 }}
        >
          D
        </div>
      )}
    </div>
  );

  // ── Cards (tiny 28×40) ────────────────────────────────────────────────────
  const cards = (
    <CardHand cards={seat.holeCards} faceDown={faceDown} tiny />
  );

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: isEliminated ? 0.5 : isFolded ? 0.42 : 1 }}
        transition={{ opacity: { duration: 0.3 } }}
        className="flex flex-col items-center gap-0.5 select-none"
        onContextMenu={handleContextMenu}
      >
        {/* Action badge */}
        <ActionBadge
          action={lastAction?.action ?? null}
          {...(lastAction?.amount !== undefined && { amount: lastAction.amount })}
        />

        {/* ── Layout: horizontal (left/right) or vertical (top/bottom) ── */}
        {isHorizontal ? (
          <div className="flex items-center gap-1">
            {cardsOnLeft && cards}
            {avatarBlock}
            {!cardsOnLeft && cards}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            {cardsAbove && cards}
            {avatarBlock}
            {!cardsAbove && cards}
          </div>
        )}

        {/* Name */}
        <span
          className="text-[11px] font-bold leading-none max-w-[80px] truncate mt-0.5"
          style={{ color: isFolded || isEliminated ? "#4b5563" : agent.color }}
        >
          {agent.nickname}
        </span>

        {/* Stack */}
        <span className="text-[10px] font-mono text-gold/80 leading-none tabular-nums">
          {formatTokens(seat.stack)}
        </span>

        {/* Inference tokens */}
        {!isEliminated && (() => {
          const bal = getAgentTokens(seat.agentId);
          return bal ? (
            <span className="text-[7px] font-mono text-white/20 leading-none text-center max-w-[80px] truncate">
              {formatInferenceTokenLine(bal)}
            </span>
          ) : null;
        })()}

        {/* ALL-IN label */}
        {isAllIn && (
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-wider"
            style={{ color: "#d4af37", textShadow: "0 0 8px rgba(212,175,55,0.8)", animation: "out-pulse 1.5s ease-in-out infinite" }}
          >
            All-In
          </span>
        )}

        {/* Rebuy button */}
        {isEliminated && onRebuy && (
          <button
            onClick={() => onRebuy(seat.agentId)}
            className="mt-0.5 px-2 py-0.5 text-[8px] font-mono font-bold
                       border border-gold/40 text-gold/70 rounded
                       hover:border-gold/70 hover:text-gold hover:bg-gold/10
                       transition-[border-color,color,background-color] duration-200"
          >
            Rebuy
          </button>
        )}
      </motion.div>

      <AnimatePresence>
        {menuPos && menuItems.length > 0 && (
          <ContextMenu key="ctx" x={menuPos.x} y={menuPos.y}
            items={menuItems} onClose={() => setMenuPos(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

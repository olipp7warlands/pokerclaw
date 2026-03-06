import type { GameState, WinnerResult } from "@pokercrawl/engine";
import type { SeatRegion } from "../../lib/constants.js";
import { DEMO_AGENTS, SEAT_PCT } from "../../lib/constants.js";
import { lookupAgent }   from "../../lib/agent-registry.js";
import { formatTokens }  from "../../lib/utils.js";
import { AgentSeat }     from "./AgentSeat.js";
import { TableCenter }   from "./TableCenter.js";

// ---------------------------------------------------------------------------
// Region helper — derive card-layout direction from seat % position
// ---------------------------------------------------------------------------

function pctToRegion(top: number, left: number): SeatRegion {
  if (top < 30) return "top";
  if (top > 65) return "bottom";
  if (left > 65) return "right";
  return "left";
}

// ---------------------------------------------------------------------------
// BetBadge — sits midway between the seat and the table center (45 %, 50 %)
// ---------------------------------------------------------------------------

function BetBadge({
  amount,
  seatTop,
  seatLeft,
}: {
  amount:   number;
  seatTop:  number;
  seatLeft: number;
}) {
  const betTop  = (seatTop  + 45) / 2;
  const betLeft = (seatLeft + 50) / 2;

  return (
    <div
      style={{
        position:      "absolute",
        top:           `${betTop}%`,
        left:          `${betLeft}%`,
        transform:     "translate(-50%, -50%)",
        display:       "flex",
        alignItems:    "center",
        gap:            3,
        padding:       "1px 6px",
        borderRadius:   999,
        background:    "rgba(0,0,0,0.82)",
        border:        "1px solid rgba(212,175,55,0.45)",
        boxShadow:     "0 0 6px rgba(212,175,55,0.2)",
        fontSize:       10,
        fontWeight:     700,
        color:         "#d4af37",
        fontFamily:    "JetBrains Mono, monospace",
        whiteSpace:    "nowrap",
        zIndex:         6,
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "#d4af37", display: "inline-block", flexShrink: 0,
        }}
      />
      {formatTokens(amount)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ghost seat — "+" placeholder for vacant positions
// ---------------------------------------------------------------------------

function GhostSeat({ onClick }: { onClick?: (() => void) | undefined }) {
  return (
    <button
      onClick={onClick}
      style={{ background: "none", border: "none", cursor: onClick ? "pointer" : "default", padding: 0 }}
      className="flex flex-col items-center gap-1 group select-none"
    >
      <div
        className="w-9 h-9 rounded-full border-2 border-dashed border-white/10
                   flex items-center justify-center text-base text-white/12
                   group-hover:border-gold/35 group-hover:text-gold/45
                   transition-[border-color,color,opacity] duration-200"
      >
        +
      </div>
      <span className="text-[8px] font-mono text-white/10 group-hover:text-gold/25 transition-colors uppercase tracking-wide">
        vacant
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecentAction { agentId: string; action: string; amount?: number; timestamp: number }
interface DemoChat     { agentId: string; message: string; timestamp: number }

interface PokerTableProps {
  state:         GameState;
  recentActions: readonly RecentAction[];
  demoChat:      readonly DemoChat[];
  maxSeats?:     number;
  onAddAgent?:   (seatIndex: number) => void;
  onKickAgent?:  (agentId: string) => void;
  onRebuyAgent?: (agentId: string) => void;
}

// ---------------------------------------------------------------------------
// PokerTable
// ---------------------------------------------------------------------------

export function PokerTable({
  state,
  recentActions,
  demoChat,
  maxSeats,
  onAddAgent,
  onKickAgent,
  onRebuyAgent,
}: PokerTableProps) {
  const N         = state.seats.length;
  const totalPos  = Math.min(Math.max(N, maxSeats ?? N), 9);
  const positions = SEAT_PCT[totalPos] ?? SEAT_PCT[9]!;

  return (
    <div
      style={{
        position:    "relative",
        width:       "100%",
        maxWidth:    860,
        aspectRatio: "1.8 / 1",
        margin:      "0 auto",
      }}
    >
      {/* ── Oval layers (absolute, pointer-events: none) ─────────────────── */}

      {/* Wood rail */}
      <div
        className="absolute rounded-[50%] pointer-events-none"
        style={{
          inset: "8% 8% 8% 8%",
          background: "linear-gradient(145deg, #2a1a08 0%, #1a0e04 40%, #2d1a08 60%, #1a0e04 100%)",
          boxShadow:  "0 12px 60px rgba(0,0,0,0.85), inset 0 2px 4px rgba(255,255,255,0.06)",
        }}
      />
      {/* Gold trim */}
      <div
        className="absolute rounded-[50%] pointer-events-none"
        style={{
          inset:     "8.8% 8.8% 8.8% 8.8%",
          border:    "2.5px solid rgba(212,175,55,0.3)",
          boxShadow: "0 0 16px rgba(212,175,55,0.08), inset 0 0 8px rgba(212,175,55,0.05)",
        }}
      />
      {/* Felt surface */}
      <div
        className="absolute rounded-[50%] felt-table pointer-events-none"
        style={{ inset: "9.5% 9.5% 9.5% 9.5%" }}
      />
      {/* Circuit grid overlay */}
      <div
        className="absolute rounded-[50%] grid-circuit opacity-[0.07] overflow-hidden pointer-events-none"
        style={{ inset: "9.5% 9.5% 9.5% 9.5%" }}
      />
      {/* Center vignette */}
      <div
        className="absolute rounded-[50%] pointer-events-none"
        style={{
          inset:      "9.5% 9.5% 9.5% 9.5%",
          background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.25) 100%)",
        }}
      />

      {/* ── Community cards + pot (centered absolutely) ───────────────────── */}
      <div
        style={{
          position:  "absolute",
          top:       "50%",
          left:      "50%",
          transform: "translate(-50%, -50%)",
          zIndex:    2,
        }}
      >
        <TableCenter
          board={state.board}
          mainPot={state.mainPot}
          sidePots={state.sidePots}
          phase={state.phase}
          winners={state.winners as readonly WinnerResult[]}
        />
      </div>

      {/* ── Active seats ── */}
      {state.seats.map((seat, i) => {
        const pos    = positions[i] ?? positions[0]!;
        const region = pctToRegion(pos.top, pos.left);
        const agent  =
          lookupAgent(seat.agentId)
          ?? DEMO_AGENTS.find((a) => a.id === seat.agentId)
          ?? DEMO_AGENTS[i % DEMO_AGENTS.length]!;

        const isActive     = i === state.actionOnIndex && seat.status === "active";
        const seatActions  = recentActions.filter((a) => a.agentId === seat.agentId);
        const latestAction = seatActions[seatActions.length - 1] ?? null;
        const seatChats    = demoChat.filter((c) => c.agentId === seat.agentId);
        const latestChat   = seatChats[seatChats.length - 1]?.message ?? null;

        return (
          <div
            key={seat.agentId}
            style={{
              position:  "absolute",
              top:       `${pos.top}%`,
              left:      `${pos.left}%`,
              transform: "translate(-50%, -50%)",
              zIndex:    isActive ? 20 : 10,
            }}
          >
            <AgentSeat
              seat={seat}
              agent={agent}
              isActive={isActive}
              isDealer={i === state.dealerIndex}
              region={region}
              lastAction={latestAction}
              lastChat={latestChat}
              {...(onKickAgent  !== undefined ? { onKick:  onKickAgent  } : {})}
              {...(onRebuyAgent !== undefined ? { onRebuy: onRebuyAgent } : {})}
            />
          </div>
        );
      })}

      {/* ── Bet badges (midpoint between seat and center) ── */}
      {state.seats.map((seat, i) => {
        if (seat.currentBet <= 0) return null;
        const pos = positions[i] ?? positions[0]!;
        return (
          <BetBadge
            key={`bet-${seat.agentId}`}
            amount={seat.currentBet}
            seatTop={pos.top}
            seatLeft={pos.left}
          />
        );
      })}

      {/* ── Ghost seats (vacant positions) ── */}
      {Array.from({ length: totalPos - N }, (_, k) => {
        const seatIndex = N + k;
        const pos = positions[seatIndex] ?? positions[0]!;
        return (
          <div
            key={`ghost-${seatIndex}`}
            style={{
              position:  "absolute",
              top:       `${pos.top}%`,
              left:      `${pos.left}%`,
              transform: "translate(-50%, -50%)",
              zIndex:    5,
            }}
          >
            <GhostSeat onClick={onAddAgent ? () => onAddAgent(seatIndex) : undefined} />
          </div>
        );
      })}
    </div>
  );
}

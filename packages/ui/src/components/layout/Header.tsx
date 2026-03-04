import type { GamePhase } from "@pokercrawl/engine";
import type { ConnectionMode } from "../../hooks/useGameSocket.js";
import { PhaseIndicator } from "../actions/PhaseIndicator.js";

interface HeaderProps {
  handNumber?: number;
  mode?:       ConnectionMode;
  phase?:      GamePhase;
  onLogoClick?: () => void;
  right?:      React.ReactNode;
}

const MODE_DOT: Record<ConnectionMode, string> = {
  demo:       "bg-white/30",
  connecting: "bg-yellow-400 animate-pulse",
  connected:  "bg-neon animate-pulse",
  error:      "bg-red-500",
};

const MODE_TEXT: Record<ConnectionMode, string> = {
  demo:       "Demo",
  connecting: "Connecting…",
  connected:  "Live",
  error:      "Disconnected",
};

export function Header({ handNumber, mode, phase, onLogoClick, right }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-2 border-b border-white/5 bg-void/60 backdrop-blur-sm shrink-0 gap-4">
      {/* ── Logo ── */}
      <button
        onClick={onLogoClick}
        className={`flex items-center gap-2.5 group flex-shrink-0 ${onLogoClick ? "cursor-pointer" : "cursor-default"}`}
      >
        <span
          className="text-2xl leading-none select-none"
          style={{ filter: "drop-shadow(0 0 8px rgba(212,175,55,0.55))" }}
        >
          🃏
        </span>
        <span
          className="font-display text-xl font-bold tracking-wide leading-none"
          style={{ color: "#d4af37", textShadow: "0 0 18px rgba(212,175,55,0.35)" }}
        >
          PokerCrawl
        </span>
        <span className="text-white/18 font-mono text-[10px] leading-none self-end mb-0.5">
          v0.1
        </span>
      </button>

      {/* ── Center: hand # + phase indicator ── */}
      <div className="flex items-center gap-4 flex-1 justify-center min-w-0">
        {handNumber !== undefined && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="font-mono text-[10px] text-white/35 uppercase tracking-widest">Hand</span>
            <span className="font-mono text-sm font-bold text-white/80">#{handNumber}</span>
          </div>
        )}
        {phase && <PhaseIndicator phase={phase} />}
      </div>

      {/* ── Right ── */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {mode && (
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${MODE_DOT[mode]}`} />
            <span className="text-xs font-mono text-white/40">{MODE_TEXT[mode]}</span>
          </div>
        )}
        {right}
      </div>
    </header>
  );
}

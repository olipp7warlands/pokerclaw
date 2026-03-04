import type { Speed } from "../../hooks/useAnimations.js";
import type { ConnectionMode } from "../../hooks/useGameSocket.js";
import { SpeedSlider } from "./SpeedSlider.js";

interface GameControlsProps {
  isPlaying: boolean;
  speed: Speed;
  mode: ConnectionMode;
  onTogglePlay: () => void;
  onSpeedChange: (s: Speed) => void;
  onToggleMode: () => void;
}

const MODE_LABELS: Record<ConnectionMode, string> = {
  demo:       "DEMO",
  connecting: "CONNECTING…",
  connected:  "LIVE",
  error:      "ERROR",
};

const MODE_COLORS: Record<ConnectionMode, string> = {
  demo:       "bg-white/10 text-white/60 border-white/20",
  connecting: "bg-yellow-900/40 text-yellow-400 border-yellow-500/40 animate-pulse",
  connected:  "bg-neon/10 text-neon border-neon/40",
  error:      "bg-red-900/40 text-red-400 border-red-500/40",
};

export function GameControls({
  isPlaying,
  speed,
  mode,
  onTogglePlay,
  onSpeedChange,
  onToggleMode,
}: GameControlsProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-void/80 border border-white/10 rounded-xl backdrop-blur-sm">
      {/* Play / Pause */}
      <button
        onClick={onTogglePlay}
        disabled={mode === "connected"}
        className={`
          w-9 h-9 rounded-full flex items-center justify-center
          font-bold text-lg transition-all duration-150
          ${isPlaying && mode !== "connected"
            ? "bg-gold text-black shadow-gold shadow-sm"
            : "bg-white/10 text-white/60 hover:bg-white/20"
          }
          disabled:opacity-40 disabled:cursor-not-allowed
        `}
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? "⏸" : "▶"}
      </button>

      {/* Speed */}
      <SpeedSlider speed={speed} onChange={onSpeedChange} />

      {/* Divider */}
      <div className="w-px h-6 bg-white/10" />

      {/* Demo / Live toggle */}
      <button
        onClick={onToggleMode}
        className={`
          px-3 py-1 rounded-lg text-xs font-mono font-bold border transition-all duration-200
          ${MODE_COLORS[mode]}
        `}
      >
        {MODE_LABELS[mode]}
      </button>
    </div>
  );
}

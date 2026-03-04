import type { AgentSeat } from "@pokercrawl/engine";
import { DEMO_AGENTS } from "../../lib/constants.js";
import { lookupAgent } from "../../lib/agent-registry.js";
import { formatTokens } from "../../lib/utils.js";

interface LeaderboardProps {
  seats: readonly AgentSeat[];
}

export function Leaderboard({ seats }: LeaderboardProps) {
  const sorted = [...seats].sort((a, b) => b.stack - a.stack);

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-mono text-white/40 uppercase tracking-widest mb-1">Leaderboard</h3>
      {sorted.map((seat, rank) => {
        const agent = lookupAgent(seat.agentId) ?? DEMO_AGENTS.find((a) => a.id === seat.agentId);
        const isBust = seat.stack === 0;

        return (
          <div
            key={seat.agentId}
            className={`flex items-center gap-2 text-xs ${isBust ? "opacity-30" : ""}`}
          >
            <span className="font-mono text-white/30 w-4 text-right">{rank + 1}</span>
            <span className="text-base leading-none">{agent?.emoji ?? "?"}</span>
            <span
              className="flex-1 font-bold truncate"
              style={{ color: agent?.color ?? "#fff" }}
            >
              {agent?.nickname ?? seat.agentId}
            </span>
            <span className="font-mono text-gold font-bold">{formatTokens(seat.stack)}</span>
            {seat.status === "folded" && (
              <span className="text-[9px] text-red-500/60 font-mono">fold</span>
            )}
            {seat.status === "all-in" && (
              <span className="text-[9px] text-gold/80 font-mono">ALL-IN</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

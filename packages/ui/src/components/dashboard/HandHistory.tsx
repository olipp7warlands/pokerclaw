import { DEMO_AGENTS } from "../../lib/constants.js";
import { lookupAgent } from "../../lib/agent-registry.js";
import { formatTokens } from "../../lib/utils.js";

interface HandEntry {
  handNumber: number;
  winnerId: string;
  amount: number;
}

interface HandHistoryProps {
  hands: readonly HandEntry[];
}

export function HandHistory({ hands }: HandHistoryProps) {
  if (hands.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-mono text-white/40 uppercase tracking-widest mb-1">
          Hand History
        </h3>
        <p className="text-white/20 text-xs font-mono">— no hands played —</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-mono text-white/40 uppercase tracking-widest mb-1">
        Hand History
      </h3>
      <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 120 }}>
        {[...hands].reverse().map((h) => {
          const agent = lookupAgent(h.winnerId) ?? DEMO_AGENTS.find((a) => a.id === h.winnerId);
          return (
            <div key={h.handNumber} className="flex items-center gap-2 text-xs font-mono">
              <span className="text-white/25 w-6 shrink-0">#{h.handNumber}</span>
              <span className="text-base leading-none shrink-0">{agent?.emoji ?? "?"}</span>
              <span
                className="flex-1 truncate font-bold"
                style={{ color: agent?.color ?? "#fff" }}
              >
                {agent?.nickname ?? h.winnerId}
              </span>
              <span className="text-gold shrink-0">+{formatTokens(h.amount)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

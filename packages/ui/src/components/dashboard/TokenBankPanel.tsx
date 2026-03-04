import type { AgentSeat } from "@pokercrawl/engine";
import { DEMO_TOKEN_BALANCES } from "../../lib/demo-tokens.js";
import { lookupAgent } from "../../lib/agent-registry.js";

const PROVIDER_COLORS: Record<string, string> = {
  claude: "#d4af37",
  openai: "#22c55e",
  google: "#3b82f6",
};

interface Props {
  seats: readonly AgentSeat[];
}

export function TokenBankPanel({ seats }: Props) {
  const agentIds = new Set(seats.map((s) => s.agentId));
  const balances = DEMO_TOKEN_BALANCES.filter((b) => agentIds.has(b.agentId));
  const totalUSD = balances.reduce((sum, b) => sum + b.totalUSD, 0);

  if (balances.length === 0) {
    return (
      <p className="text-xs font-mono text-white/20 text-center py-6">
        No token data available
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Total */}
      <div className="flex items-baseline justify-between border-b border-white/5 pb-3">
        <span className="text-[10px] font-mono text-white/40 uppercase tracking-wide">
          Token Bank
        </span>
        <span className="text-sm font-mono text-gold font-bold">
          ${totalUSD.toFixed(2)} total
        </span>
      </div>

      {/* Per-agent rows */}
      {balances.map((bal) => {
        const agent = lookupAgent(bal.agentId);
        return (
          <div key={bal.agentId} className="flex flex-col gap-1.5">
            {/* Agent header */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-white/70 flex items-center gap-1">
                <span>{agent?.emoji ?? "🤖"}</span>
                <span>{agent?.nickname ?? bal.agentId}</span>
              </span>
              <span className="text-[10px] font-mono text-white/40">
                ${bal.totalUSD.toFixed(2)}
              </span>
            </div>

            {/* Per-provider bars */}
            {bal.providers.map((p) => {
              const color  = PROVIDER_COLORS[p.provider] ?? "#6b7280";
              const pct    = bal.totalUSD > 0
                ? Math.round((p.usdValue / bal.totalUSD) * 100)
                : 0;
              return (
                <div key={`${p.provider}/${p.model}`} className="flex items-center gap-2">
                  <span className="text-[8px] font-mono text-white/30 w-10 truncate capitalize">
                    {p.provider}
                  </span>
                  <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: color }}
                    />
                  </div>
                  <span className="text-[8px] font-mono text-white/30 text-right w-10">
                    {fmtTokens(p.tokens)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 border-t border-white/5">
        {Object.entries(PROVIDER_COLORS).map(([name, color]) => (
          <span key={name} className="flex items-center gap-1 text-[8px] font-mono text-white/30 capitalize">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return `${n}`;
}

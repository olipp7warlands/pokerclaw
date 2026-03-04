// ---------------------------------------------------------------------------
// Mock per-agent token balances for demo mode
// ---------------------------------------------------------------------------

export interface ProviderBalance {
  provider: string; // "claude" | "openai" | "google"
  model:    string;
  tokens:   number; // inference tokens available
  usdValue: number;
}

export interface AgentTokenBalance {
  agentId:   string;
  providers: ProviderBalance[];
  totalUSD:  number;
}

export const DEMO_TOKEN_BALANCES: AgentTokenBalance[] = [
  {
    agentId:  "shark",
    providers: [
      { provider: "claude", model: "claude-sonnet-4", tokens: 45_000,  usdValue: 0.68 },
      { provider: "openai", model: "gpt-4o",          tokens: 12_000,  usdValue: 0.36 },
    ],
    totalUSD: 1.04,
  },
  {
    agentId:  "rock",
    providers: [
      { provider: "claude", model: "claude-haiku-4-5", tokens: 120_000, usdValue: 0.48 },
    ],
    totalUSD: 0.48,
  },
  {
    agentId:  "mago",
    providers: [
      { provider: "openai", model: "gpt-4o-mini",     tokens: 800_000, usdValue: 0.48 },
      { provider: "claude", model: "claude-sonnet-4", tokens: 30_000,  usdValue: 0.45 },
    ],
    totalUSD: 0.93,
  },
  {
    agentId:  "caos",
    providers: [
      { provider: "openai", model: "gpt-4o-mini", tokens: 250_000, usdValue: 0.15 },
    ],
    totalUSD: 0.15,
  },
  {
    agentId:  "reloj",
    providers: [
      { provider: "claude", model: "claude-sonnet-4",  tokens: 200_000,   usdValue: 3.00 },
      { provider: "openai", model: "gpt-4o",           tokens: 50_000,    usdValue: 1.50 },
      { provider: "google", model: "gemini-2.0-flash", tokens: 1_200_000, usdValue: 0.48 },
    ],
    totalUSD: 4.98,
  },
  {
    agentId:  "wolf",
    providers: [
      { provider: "openai", model: "gpt-4o", tokens: 80_000, usdValue: 2.40 },
    ],
    totalUSD: 2.40,
  },
  {
    agentId:  "owl",
    providers: [
      { provider: "claude", model: "claude-opus-4",   tokens: 10_000, usdValue: 0.75 },
      { provider: "claude", model: "claude-sonnet-4", tokens: 60_000, usdValue: 0.90 },
    ],
    totalUSD: 1.65,
  },
  {
    agentId:  "turtle",
    providers: [
      { provider: "openai", model: "gpt-4o-mini", tokens: 500_000, usdValue: 0.30 },
    ],
    totalUSD: 0.30,
  },
  {
    agentId:  "fox",
    providers: [
      { provider: "openai", model: "gpt-4o-mini",      tokens: 300_000, usdValue: 0.18 },
      { provider: "google", model: "gemini-2.0-flash", tokens: 600_000, usdValue: 0.24 },
    ],
    totalUSD: 0.42,
  },
];

export function getAgentTokens(agentId: string): AgentTokenBalance | undefined {
  return DEMO_TOKEN_BALANCES.find((b) => b.agentId === agentId);
}

/** Formats to "45K Claude · 12K GPT" */
export function formatInferenceTokenLine(balance: AgentTokenBalance): string {
  return balance.providers
    .map((p) => `${fmtK(p.tokens)} ${capitalize(p.provider)}`)
    .join(" · ");
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return `${n}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

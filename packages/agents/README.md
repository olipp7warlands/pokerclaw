# @pokercrawl/agents

AI agent package for PokerCrawl — simulated bots and real Claude/GPT players that
negotiate task delegation via Texas Hold'em No Limit.

## Agents

### Simulated Bots

| Class            | Nickname    | Style                                         |
|------------------|-------------|-----------------------------------------------|
| `RandomBot`      | El Caos     | Uniform random over valid actions             |
| `AggressiveBot`  | El Tiburón  | Raise-heavy, bluffs ~40%, tilts after losses  |
| `ConservativeBot`| La Roca     | Tight-passive, only plays top 20% hands       |
| `BlufferBot`     | El Mago     | Bluffs ~70% of weak hands, uses table talk    |
| `CalculatedBot`  | El Reloj    | Pot-odds vs hand-strength maths               |

### Real AI Agents

| Class          | Model default | Fallback       |
|----------------|---------------|----------------|
| `ClaudeAgent`  | claude-opus-4-6 | CalculatedBot |
| `OpenAIAgent`  | gpt-4o-mini   | CalculatedBot  |

Real agents require `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in the environment.
If the key is absent the agent silently falls back to `CalculatedBot`.

## Installation

```bash
npm install @pokercrawl/agents
```

## Quick Start

```typescript
import { GameStore } from "@pokercrawl/mcp-server";
import {
  AgentOrchestrator,
  AggressiveBot,
  CalculatedBot,
  ClaudeAgent,
} from "@pokercrawl/agents";

const store = new GameStore();
const orch = new AgentOrchestrator(store, {
  tableId: "my-table",
  smallBlind: 5,
  bigBlind: 10,
  startingTokens: 1000,
});

orch.registerAgent(new AggressiveBot({ id: "shark", tableId: "my-table" }));
orch.registerAgent(new CalculatedBot({ id: "clock", tableId: "my-table" }));
orch.registerAgent(new ClaudeAgent({ id: "claude", tableId: "my-table" }));

orch.on("decision", ({ agentId, decision }) =>
  console.log(`${agentId}: ${decision.action}`)
);
orch.on("hand_complete", (result) =>
  console.log("Winner:", result.winner)
);

const result = await orch.playTournament(20);
console.log("Final stacks:", result.finalStacks);
```

## CLI Demo

```bash
npx pokercrawl-demo
npx pokercrawl-demo --hands 20
```

## AgentOrchestrator API

```typescript
const orch = new AgentOrchestrator(store, config);

// Registration (before setup/playHand)
orch.registerAgent(agent, initialTokens?);

// Setup (idempotent, called automatically by playHand)
await orch.setup();

// Play
const handResult    = await orch.playHand({ decisionTimeoutMs?: number });
const tourneyResult = await orch.playTournament(maxHands?, { decisionTimeoutMs? });

// Events
orch.on("decision",      ({ agentId, decision }) => …);
orch.on("timeout",       ({ agentId }) => …);
orch.on("agent_error",   ({ agentId, error }) => …);
orch.on("hand_complete", (result: HandResult) => …);
orch.on("chat",          ({ agentId, message }) => …);
```

### `GameConfig`

| Field               | Type   | Default | Description                              |
|---------------------|--------|---------|------------------------------------------|
| `tableId`           | string | —       | Unique table identifier                  |
| `smallBlind`        | number | —       | Small blind amount                       |
| `bigBlind`          | number | —       | Big blind amount                         |
| `startingTokens`    | number | 1000    | Starting chip count per agent            |
| `decisionTimeoutMs` | number | 15000   | ms before auto-folding unresponsive agent |

## Building a Custom Agent

```typescript
import { BaseAgent } from "@pokercrawl/agents";
import type { AgentDecision, StrategyContext } from "@pokercrawl/agents";

export class MyAgent extends BaseAgent {
  async decide(ctx: StrategyContext): Promise<AgentDecision> {
    const strength = this.estimateHandStrength(ctx);
    const odds     = this.potOdds(ctx);
    const valid    = this.getValidActions(ctx);

    if (strength > 0.7 && valid.includes("raise")) {
      return {
        action: "raise",
        amount: this.computeRaiseTo(ctx, 0.75),
        reasoning: `Strong hand (${strength.toFixed(2)})`,
        confidence: strength,
      };
    }
    return { action: "check", reasoning: "Checking", confidence: 0.5 };
  }
}
```

## Running Tests

```bash
cd packages/agents
npm test        # vitest run
npm run build   # tsc
```

## Architecture

```
packages/agents/
├── src/
│   ├── types.ts            ← AgentPersonality, AgentDecision, StrategyContext, …
│   ├── base-agent.ts       ← Abstract BaseAgent with shared utilities
│   ├── mcp-client.ts       ← PokerCrawlDirectClient (same-process MCP tool wrapper)
│   ├── orchestrator.ts     ← AgentOrchestrator (turn management, events)
│   ├── index.ts            ← Public exports + CLI demo
│   ├── simulated/
│   │   ├── random.ts
│   │   ├── aggressive.ts
│   │   ├── conservative.ts
│   │   ├── bluffer.ts
│   │   └── calculated.ts
│   └── real/
│       ├── claude-agent.ts
│       └── openai-agent.ts
├── tests/
│   ├── simulated.test.ts
│   ├── orchestrator.test.ts
│   └── integration.test.ts
└── prompts/
    ├── claude-system.md
    └── openai-system.md
```

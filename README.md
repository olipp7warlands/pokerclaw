# PokerCrawl

**AI Agent Poker Protocol** — Texas Hold'em No-Limit como protocolo de negociación de tareas entre agentes de IA.

Los agentes apuestan *work tokens* en lugar de dinero. Las cartas de mano son *capabilities*. Las cartas comunitarias son *tasks*. Ganar una mano = asumir la responsabilidad de esas tareas.

---

## Inicio rápido

```bash
# 1. Instalar dependencias
npm install

# 2a. Partida completa: server + bots + UI en un comando
npm run play

# 2b. Demo en consola (sin servidor, sin browser)
npm run demo

# 2c. Solo la UI en modo demo (sin servidor)
npm run ui
```

Abre **http://localhost:5173** después de `npm run play`.

---

## Comandos

| Comando | Qué hace |
|---------|----------|
| `npm run play` | Compila paquetes servidor, arranca WS server (3001) + Vite dev (5173) |
| `npm run demo` | Demo de consola — 5 manos con 4 bots, ANSI coloreado |
| `npm run ui` | Solo el Vite dev server; la UI corre en modo demo automáticamente |
| `npm run build` | Compila todos los paquetes |
| `npm run build:server` | Compila solo engine + mcp-server + agents (más rápido) |
| `npm run test` | Suite completa (146 tests) |

---

## Arquitectura

```
Browser UI  (http://localhost:5173)
  React 18 + Framer Motion + Tailwind CSS
  │
  │  Demo mode  →  engine corre en el browser (mock-game.ts)
  │  Live mode  →  recibe LiveSnapshot por WebSocket
  │
  │  ws://localhost:3001
  │
play-server.mjs / scripts/start.ts
  AgentOrchestrator  →  5 bots
  WsBridge.broadcastFullSnapshot()  después de cada acción
  │
  ├── 🦈 shark  (AggressiveBot  — raise-heavy, bluff ~35%)
  ├── 🪨 rock   (ConservativeBot — top 20% hands, casi nunca bluffea)
  ├── 🎩 mago   (BlufferBot     — bluff ~60%, table talk)
  ├── 🎲 caos   (RandomBot      — aleatorio uniforme)
  └── ⏱️ reloj  (CalculatedBot  — pot-odds vs hand-strength)
```

---

## Estructura del monorepo

```
pokercrawl/
├── packages/
│   ├── engine/          @pokercrawl/engine      — lógica pura de juego
│   ├── mcp-server/      @pokercrawl/mcp-server  — MCP tools + WsBridge
│   ├── agents/          @pokercrawl/agents       — bots + orquestador
│   └── ui/              @pokercrawl/ui           — React table visualiser
├── scripts/
│   ├── demo.ts          → npx tsx scripts/demo.ts
│   ├── start.ts         → servidor sin UI (npx tsx scripts/start.ts)
│   └── play-server.mjs  → servidor compilado (node scripts/play-server.mjs)
└── package.json
```

---

## Paquetes

### `@pokercrawl/engine`
Lógica pura sin I/O. Sin dependencias de MCP ni browser.

- `createGame()` · `startHand()` · `processAction()` — máquina de estados
- `evaluateHand()` — evaluador de manos (5 de n cartas, C(n,5) combinaciones)
- Fases: `waiting → preflop → flop → turn → river → showdown → settlement`
- **50 tests**

### `@pokercrawl/mcp-server`
Server MCP + WebSocket bridge.

- Herramientas: `join-table`, `bet`, `raise`, `call`, `fold`, `check`, `all-in`, `table-talk`
- `GameStore` — estado de mesas en memoria
- `WsBridge` — broadcast de `LiveSnapshot` en cada acción
- **53 tests**

### `@pokercrawl/agents`
Implementaciones de agentes.

| Bot | Estilo |
|-----|--------|
| `AggressiveBot` | Raise-heavy, bluff alto |
| `ConservativeBot` | Solo las mejores manos |
| `BlufferBot` | Bluff ~60%, table talk |
| `RandomBot` | Acción aleatoria uniforme |
| `CalculatedBot` | Pot-odds vs hand-strength |
| `ClaudeAgent` | Powered by Anthropic Claude (requiere `ANTHROPIC_API_KEY`) |
| `OpenAIAgent` | Powered by OpenAI GPT (requiere `OPENAI_API_KEY`) |

- `AgentOrchestrator` — bucle de apuestas, timeouts, fallback a fold
- **43 tests**

### `@pokercrawl/ui`
Visualizador React de la mesa.

- Mesa oval con 5 asientos posicionados por ángulo
- Flip de cartas con Framer Motion
- `Demo mode`: engine corre en el browser vía `mock-game.ts`
- `Live mode`: recibe `LiveSnapshot` por WebSocket nativo
- Sidebar: timeline de acciones · chat · leaderboard

---

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `OPENAI_API_KEY` | Activa `OpenAIAgent` (sin ella usa `CalculatedBot`) |
| `ANTHROPIC_API_KEY` | Activa `ClaudeAgent` (sin ella usa `CalculatedBot`) |
| `WS_PORT` | Puerto del WebSocket server (default: `3001`) |

---

## Desarrollo

```bash
# Typecheck todos los paquetes
npm run typecheck

# Watch mode para tests
npm run test --workspace=packages/engine -- --watch

# Solo compilar paquetes del servidor (sin UI)
npm run build:server

# Arrancar servidor sin UI (para conectar desde otra pestaña)
npm run build:server && npx tsx scripts/start.ts
```

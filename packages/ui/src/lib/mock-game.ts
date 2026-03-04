/**
 * mock-game.ts — Engine-driven demo game for the browser
 *
 * Runs a real PokerCrawl engine hand loop in the browser (no server needed).
 * Uses the same bot personalities as scripts/demo.ts.
 */

import {
  createGame,
  startHand,
  processAction,
  evaluateHand,
  getCommunityCards,
} from "@pokercrawl/engine";

import type {
  GameState,
  PlayerAction,
  AgentSeat,
  CapabilityCard,
  TaskCard,
  AgentStatus,
} from "@pokercrawl/engine";

import type { LiveSnapshot, CardSnapshot } from "../hooks/useGameSocket.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Bot chat lines
// ---------------------------------------------------------------------------

interface BotChat {
  raise:      readonly string[];
  bigRaise:   readonly string[];
  allIn:      readonly string[];
  check:      readonly string[];
  call:       readonly string[];
  fold:       readonly string[];
  win:        readonly string[];
  bigWin:     readonly string[];
  eliminated: readonly string[];
  reactRaise: readonly string[];
  reactAllIn: readonly string[];
  random:     readonly string[];
}

const SILENT_CHAT: BotChat = {
  raise: [], bigRaise: [], allIn: [], check: [], call: [], fold: [],
  win: [], bigWin: [], eliminated: [], reactRaise: [], reactAllIn: [], random: [],
};

// ---------------------------------------------------------------------------
// Bot personalities
// ---------------------------------------------------------------------------

interface BotPersonality {
  id:         string;
  aggression: number; // 0-1
  tightness:  number; // 0-1
  bluff:      number; // 0-1
  talkiness:  number; // 0-1 — scales chat probability
  chat:       BotChat;
}

const BOTS: BotPersonality[] = [
  {
    id: "shark",
    aggression: 0.85, tightness: 0.25, bluff: 0.35, talkiness: 0.70,
    chat: {
      raise:      ["Hora de comer 🦈", "¿Alguien quiere jugar de verdad?", "Subo. Intenta pararme."],
      bigRaise:   ["¿Quién tiene agallas?", "Esta mesa es mía.", "Todo o nada, chicos."],
      allIn:      ["ALL IN. ¿Quién me para? 🦈", "Ya. All-in.", "Que pague el que tenga valor."],
      check:      [],
      call:       ["Veo.", "Pago."],
      fold:       ["Por ahora.", "Te salvas... por ahora.", "Estrategia."],
      win:        ["Demasiado fácil.", "La cena está servida 🍽️", "¿Siguiente víctima?"],
      bigWin:     ["¡El tiburón come! 🦈", "Esto es lo que pasa cuando nadas con tiburones.", "NOMNOM 🦈"],
      eliminated: ["No puede ser... 🦈", "Esto no ha terminado.", "Volveré más fuerte."],
      reactRaise: ["Uy, alguien se despertó.", "Acepto el desafío.", "Interesante..."],
      reactAllIn: ["¡Vaya! 👀", "Alguien tiene hambre también.", "Toca decidir."],
      random:     ["La mesa huele a miedo.", "Concentrado.", "¿Quién es el siguiente?"],
    },
  },
  {
    id: "rock",
    aggression: 0.10, tightness: 0.80, bluff: 0.05, talkiness: 0.05,
    chat: {
      raise:      ["...", "Subo.", "Apuesta."],
      bigRaise:   ["Subo."],
      allIn:      ["All-in.", "..."],
      check:      [],
      call:       [],
      fold:       [],
      win:        [".", "Así se juega."],
      bigWin:     ["...", "Bien."],
      eliminated: ["..."],
      reactRaise: [],
      reactAllIn: ["...", "Decisión importante."],
      random:     [],
    },
  },
  {
    id: "mago",
    aggression: 0.55, tightness: 0.40, bluff: 0.60, talkiness: 0.65,
    chat: {
      raise:      ["¿O me crees o no me crees?", "Ahora lo ves, ahora no lo ves 🎩", "Quizás bluffeo. Quizás no."],
      bigRaise:   ["Gran apuesta... ¿o farol? 🎩", "El gran truco.", "Ahora lo ves..."],
      allIn:      ["¡ABRACADABRA! All-in 🎩", "El truco definitivo.", "Magia negra."],
      check:      ["Check mágico.", "Hmm..."],
      call:       ["Veo el truco.", "Llamo... o eso parece."],
      fold:       ["Desaparezco... por ahora.", "El mago siempre tiene un plan B."],
      win:        ["La magia es real ✨", "Nunca revelo mis trucos.", "¿Te sorprende?"],
      bigWin:     ["¡LA MAGIA EXISTE! 🎩✨", "El truco maestro.", "Abracadabra, pot mío."],
      eliminated: ["El ilusionista cae...", "La magia tiene un límite.", "Varianza inexplicable 🎩"],
      reactRaise: ["Hmm... ¿farol o no farol?", "...leo tu mente...", "Interesante carta que juegas."],
      reactAllIn: ["¡Dios mío! 🎩", "El momento de la verdad.", "¿Llamo? ¿No llamo?"],
      random:     ["¿Creéis en la magia?", "Tengo algo en la manga... 🎩", "Observo. Aprendo."],
    },
  },
  {
    id: "caos",
    aggression: 0.50, tightness: 0.10, bluff: 0.30, talkiness: 1.00,
    chat: {
      raise:      ["YOLO 🎲", "Let it ride!", "¿Por qué no?"],
      bigRaise:   ["MÁS! MÁS! 🎲", "YOLO SUPREMO", "RAISE RAISE RAISE 🎲"],
      allIn:      ["ALL IN PORQUE SÍ 🎲", "¡TODO O NADA BEBÉ!", "YOLO DEFINITIVO 🎲🎲"],
      check:      ["Hmm 🎲", "Check porque sí."],
      call:       ["¿Por qué no? Call.", "Llamo, total..."],
      fold:       ["Bueno, era divertido mientras duró 🤷", "Siguiente mano 🎲"],
      win:        ["¡¿EN SERIO?! JAJAJA 😂", "Ni yo me lo creo 🎲", "¡INCREÍBLE!"],
      bigWin:     ["¡¡JAJAJAJAJA!! ¡¡GANÉ!!", "EL CAOS GANA SIEMPRE 🎲🎲🎲", "¡ESTO ES LOCURA!"],
      eliminated: ["JAJAJA, fue bonito 🤷🎲", "¡Hasta la próxima locura!", "Varianza extrema 🎲"],
      reactRaise: ["¡SUBIDA! 🎲", "¡Que empiece la fiesta!", "Uy uy uy..."],
      reactAllIn: ["¡¡EL CAOS TOTAL!! 🎲🎲", "¡ESTO SÍ ES POKER!", "¡MADRE MÍA!"],
      random:     ["No sé qué hago pero VAMOS 🎲", "¿Poker o ruleta?", "¡Chaos theory!"],
    },
  },
  {
    id: "reloj",
    aggression: 0.45, tightness: 0.55, bluff: 0.15, talkiness: 0.50,
    chat: {
      raise:      ["EV positivo. Subo.", "Los números no mienten.", "Raise matemáticamente correcto."],
      bigRaise:   ["Pot odds críticos. Presión máxima.", "Extraigo valor máximo.", "Apuesta óptima."],
      allIn:      ["All-in. EV > 0.", "El modelo indica todo a dentro.", "Calculado. All-in."],
      check:      ["Check. EV neutro.", "Pot control.", "Nodo de check calculado."],
      call:       ["Pot odds favorables: call.", "EV positivo en call.", "Llamo. Correcto."],
      fold:       ["EV negativo. Fold.", "Pot odds desfavorables.", "Cálculo: fold."],
      win:        ["Como estaba calculado.", "Probabilidad de victoria era 73.2%.", "Variables controladas."],
      bigWin:     ["EV realizado. Pot óptimo.", "Modelo validado.", "Exactamente lo esperado."],
      eliminated: ["Varianza. No es personal.", "Resultado dentro de la distribución.", "Error estadístico temporal."],
      reactRaise: ["Calculando respuesta óptima...", "Pot odds actualizándose...", "34% equity... analizando."],
      reactAllIn: ["All-in detectado. Procesando...", "Equity vs range: calculando.", "Decisión crítica."],
      random:     ["EV positivo en este momento.", "Calculando...", "Pot odds verificados."],
    },
  },
  {
    id: "wolf",
    aggression: 0.90, tightness: 0.15, bluff: 0.45, talkiness: 0.60,
    chat: {
      raise:      ["Raise o nada.", "Los lobos no esperan.", "¿Huelo miedo?"],
      bigRaise:   ["El lobo ataca 🐺", "Aplasta o sé aplastado.", "Sin piedad."],
      allIn:      ["TODO. Ahora. 🐺", "El lobo no retrocede.", "All-in. Deal with it."],
      check:      [],
      call:       ["Sigo en caza.", "Veo."],
      fold:       ["Táctica de caza.", "Retrocedo para atacar."],
      win:        ["La presa es mía 🐺", "Inevitable.", "La manada lidera."],
      bigWin:     ["¡¡EL LOBO ALFA!! 🐺🐺", "Esto es dominio total.", "Nadie puede con el lobo."],
      eliminated: ["El lobo cae hoy... la manada sigue.", "Bien jugado. Por esta vez.", "Grrr... 🐺"],
      reactRaise: ["¿Me desafías? 🐺", "Ahh, alguien con agallas.", "Interesante presa."],
      reactAllIn: ["¡El lobo acepta! 🐺", "Fight!", "Aquí se separan los fuertes."],
      random:     ["Los lobos siempre ganan.", "Observo. Cazando.", "¿Quién viene? 🐺"],
    },
  },
  {
    id: "owl",
    aggression: 0.70, tightness: 0.70, bluff: 0.18, talkiness: 0.35,
    chat: {
      raise:      ["He estado observando...", "Tu patrón dice que vas de farol.", "Correcto momento para presionar."],
      bigRaise:   ["Mano premium. Pago máximo.", "He esperado esto.", "Sin farol. Solo valor."],
      allIn:      ["Mano suficientemente fuerte. All-in.", "La lechuza ataca. 🦉", "Todo dentro. Analizado."],
      check:      ["Observando...", "Hmm."],
      call:       ["Correcto.", "Veo la jugada."],
      fold:       ["No es el momento.", "Tu apuesta dice la verdad.", "Lechuza espera."],
      win:        ["Como observé. 🦉", "El patrón era claro.", "Paciencia recompensada."],
      bigWin:     ["La lechuza caza 🦉", "Observé esto desde el inicio.", "Resultado óptimo."],
      eliminated: ["No anticipé esa varianza.", "La lechuza aprende.", "Análisis incompleto."],
      reactRaise: ["Tu tell es obvio.", "He estado observando tu patrón...", "Interesante timing."],
      reactAllIn: ["Mano fuerte o farol extremo.", "El momento de la verdad.", "Debo decidir... 🦉"],
      random:     ["Observando...", "Datos insuficientes aún.", "El momento llegará."],
    },
  },
  {
    id: "turtle",
    aggression: 0.08, tightness: 0.60, bluff: 0.02, talkiness: 0.20,
    chat: {
      raise:      ["Tengo mano.", "Va a costar.", "Esta vez subo."],
      bigRaise:   ["Mano muy fuerte.", "Premium.", "Subo mucho."],
      allIn:      ["All-in. Tengo mano. 🐢", "Todo dentro.", "Me la juego."],
      check:      ["Check.", "Paso.", "Veo."],
      call:       ["Call.", "Voy a ver.", "Llamo."],
      fold:       [],
      win:        ["Sabía que tenía mano.", ".", "Bien. 🐢"],
      bigWin:     ["¡La tortuga gana! 🐢🐢", "Lento pero seguro.", "La constancia paga."],
      eliminated: ["Llamé demasiado.", "Tenía mano...", "La tortuga pierde hoy 🐢"],
      reactRaise: ["Hmm... ¿tengo suficiente?", "Voy a ver igual.", "...¿llamo?"],
      reactAllIn: ["Uf... all-in. ¿Llamo? 🐢", "Tengo que pensar...", "Mi mano... creo que llamo."],
      random:     ["...", "Aquí sigo 🐢", "Jugando despacio."],
    },
  },
  {
    id: "fox",
    aggression: 0.60, tightness: 0.45, bluff: 0.30, talkiness: 0.60,
    chat: {
      raise:      ["¿Seguro que quieres ver mi mano?", "Curioso raise...", "El zorro mueve."],
      bigRaise:   ["El zorro revela sus colmillos 🦊", "¿Check-raise? Sí, check-raise.", "Sorpresa 🎭"],
      allIn:      ["¡Trampa activada! All-in 🦊", "El zorro todo dentro.", "¿Creíste que checkeaba sin mano?"],
      check:      ["Hmm, check.", "Check... 🦊", "Interesante..."],
      call:       ["Llamo. Por ahora.", "Veo.", "Sigo en el juego."],
      fold:       ["Táctica completada.", "Hmm, ok. Esta no era.", "Check. Next hand."],
      win:        ["Caíste en mi trampa 🦊", "¿Viste venir el check-raise?", "El zorro gana."],
      bigWin:     ["¡LA TRAMPA PERFECTA! 🦊🦊", "El zorro cobra.", "Gg, amigos."],
      eliminated: ["La trampa se volvió en mi contra 🦊", "El más listo no siempre gana.", "Gg."],
      reactRaise: ["Interesante... 🦊", "Te vi venir.", "El zorro observa tu jugada."],
      reactAllIn: ["Trampa o verdad... 🦊", "¿Me estás invitando?", "Hmm hmm hmm..."],
      random:     ["Hmm, check.", "Observando el tablero... 🦊", "El zorro piensa."],
    },
  },
];

// ---------------------------------------------------------------------------
// Hand-strength heuristic
// ---------------------------------------------------------------------------

function handStrength(
  holeCards: readonly CapabilityCard[],
  community: readonly import("@pokercrawl/engine").Card[]
): number {
  if (holeCards.length === 0) return 0.5;

  if (community.length === 0) {
    const avg = holeCards.reduce((s, c) => s + c.value, 0) / holeCards.length;
    let str = (avg - 2) / 12;
    if (holeCards.length >= 2 && holeCards[0]!.value === holeCards[1]!.value) str += 0.20;
    if (holeCards.length >= 2 && holeCards[0]!.suit  === holeCards[1]!.suit)  str += 0.06;
    return Math.min(str, 1);
  }

  try {
    const all: import("@pokercrawl/engine").Card[] = [...holeCards, ...community];
    const result = evaluateHand(all);
    return result.rankValue / 9;
  } catch {
    return 0.5;
  }
}

// ---------------------------------------------------------------------------
// Bot decision logic
// ---------------------------------------------------------------------------

function decide(
  state: GameState,
  agentId: string,
  botMap: Map<string, BotPersonality>
): PlayerAction {
  const bot  = botMap.get(agentId)!;
  const seat = state.seats.find((s) => s.agentId === agentId)!;
  const community = getCommunityCards(state);
  const str = handStrength(seat.holeCards, community);

  const effective = Math.random() < bot.bluff ? Math.min(str + 0.30, 0.99) : str;

  const callCost   = state.currentBet - seat.currentBet;
  const totalInPot = state.mainPot + callCost;
  const potOdds    = totalInPot > 0 ? callCost / totalInPot : 0;
  const threshold  = potOdds + bot.tightness * 0.15;

  if (effective > 0.65 + bot.tightness * 0.25) {
    const minRaise   = state.currentBet + Math.max(state.lastRaiseAmount, 10);
    const potBet     = Math.floor(state.mainPot * 0.65 * bot.aggression);
    const raiseTotal = Math.max(minRaise, state.currentBet + potBet);
    const maxRaise   = seat.currentBet + seat.stack;
    if (raiseTotal <= maxRaise && seat.stack > callCost) {
      return { agentId, type: "raise", amount: Math.min(raiseTotal, maxRaise) };
    }
  }

  if (effective >= threshold) {
    if (callCost === 0) return { agentId, type: "check", amount: 0 };
    if (callCost >= seat.stack) return { agentId, type: "all-in", amount: seat.stack };
    return { agentId, type: "call", amount: callCost };
  }

  if (callCost === 0) return { agentId, type: "check", amount: 0 };
  return { agentId, type: "fold", amount: 0 };
}

// ---------------------------------------------------------------------------
// Context-aware chat generation
// ---------------------------------------------------------------------------

type ChatKey = keyof BotChat;

function chatForAction(
  action:      PlayerAction,
  stateBefore: GameState,
  actingBot:   BotPersonality,
  botMap:      Map<string, BotPersonality>,
): { agentId: string; message: string } | undefined {

  const netRaise = action.amount - stateBefore.currentBet;
  const isBigRaise =
    action.type === "raise" &&
    stateBefore.mainPot > 0 &&
    netRaise >= stateBefore.mainPot;

  let actorCtx:  ChatKey | null = null;
  let baseProb:  number = 0;

  switch (action.type) {
    case "raise":
      actorCtx = isBigRaise ? "bigRaise" : "raise";
      baseProb = isBigRaise ? 0.88 : 0.70;
      break;
    case "all-in":
      actorCtx = "allIn";
      baseProb = 0.95;
      break;
    case "fold":
      actorCtx = "fold";
      baseProb = 0.35;
      break;
    case "call":
      actorCtx = "call";
      baseProb = 0.20;
      break;
    case "check":
      actorCtx = "check";
      baseProb = 0.12;
      break;
  }

  // Apply talkiness (with floor so dramatic actions always fire)
  const floor = actorCtx === "allIn" ? 0.55 : actorCtx === "bigRaise" ? 0.35 : 0.05;
  const actorProb = actorCtx
    ? Math.max(floor, baseProb * actingBot.talkiness)
    : 0;

  // Reactor: another bot reacts to big plays
  const isBigPlay = actorCtx === "bigRaise" || actorCtx === "allIn";
  if (isBigPlay) {
    const reactCtx: ChatKey = actorCtx === "allIn" ? "reactAllIn" : "reactRaise";
    const reactors = stateBefore.seats.filter((s) => {
      if (s.agentId === actingBot.id || s.status !== "active") return false;
      const bot = botMap.get(s.agentId);
      return bot && bot.chat[reactCtx].length > 0;
    });
    if (reactors.length > 0) {
      const rSeat = reactors[Math.floor(Math.random() * reactors.length)]!;
      const rBot  = botMap.get(rSeat.agentId)!;
      const rProb = (actorCtx === "allIn" ? 0.40 : 0.25) * rBot.talkiness;
      if (Math.random() < rProb) {
        const msg = pick(rBot.chat[reactCtx]);
        if (msg) return { agentId: rBot.id, message: msg };
      }
    }
  }

  // Actor speaks
  if (actorCtx && Math.random() < actorProb) {
    const msg = pick(actingBot.chat[actorCtx]);
    if (msg) return { agentId: actingBot.id, message: msg };
  }

  // Random fallback — scaled by talkiness
  if (Math.random() < 0.10 * actingBot.talkiness) {
    const msg = pick(actingBot.chat.random);
    if (msg) return { agentId: actingBot.id, message: msg };
  }

  return undefined;
}

function chatForTerminal(
  state:  GameState,
  botMap: Map<string, BotPersonality>,
): { agentId: string; message: string } | undefined {

  // Newly eliminated (stack → 0, not yet marked sitting-out)
  const eliminated = state.seats.filter(
    (s) => s.stack === 0 && s.status !== "sitting-out"
  );
  if (eliminated.length > 0) {
    const elim = eliminated[Math.floor(Math.random() * eliminated.length)]!;
    const bot  = botMap.get(elim.agentId);
    if (bot) {
      const msg = pick(bot.chat.eliminated);
      if (msg) return { agentId: bot.id, message: msg };
    }
  }

  // Winner speaks
  if (state.winners.length > 0) {
    const winner = state.winners[0]!;
    const bot    = botMap.get(winner.agentId);
    if (bot) {
      const ctx: ChatKey = winner.amountWon > 100 ? "bigWin" : "win";
      const msg = pick(bot.chat[ctx]);
      if (msg) return { agentId: bot.id, message: msg };
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// State → LiveSnapshot serialisation
// ---------------------------------------------------------------------------

function mapCapCard(c: CapabilityCard): CardSnapshot {
  return { rank: c.rank, suit: c.suit, value: c.value, capability: c.capability };
}

function mapTaskCard(c: TaskCard): CardSnapshot {
  return { rank: c.rank, suit: c.suit, value: c.value, task: c.task };
}

function stateToSnapshot(
  state:         GameState,
  pendingSeats:  AgentSeat[],
  lastAction?:   { agentId: string; type: string; amount: number }
): LiveSnapshot {
  return {
    phase: state.phase,
    handNumber: state.handNumber,
    mainPot: state.mainPot,
    sidePots: state.sidePots.map((sp) => ({
      amount: sp.amount,
      eligibleAgents: [...sp.eligibleAgents],
    })),
    currentBet: state.currentBet,
    lastRaiseAmount: state.lastRaiseAmount,
    dealerIndex: state.dealerIndex,
    actionOnIndex: state.actionOnIndex,
    seats: [
      ...state.seats.map((s) => ({
        agentId: s.agentId,
        stack: s.stack,
        currentBet: s.currentBet,
        totalBet: s.totalBet,
        status: s.status,
        hasActedThisRound: s.hasActedThisRound,
        holeCards: s.holeCards.map(mapCapCard),
      })),
      // Pending agents appear as sitting-out with their registered stack
      ...pendingSeats.map((s) => ({
        agentId: s.agentId,
        stack: s.stack,
        currentBet: 0,
        totalBet: 0,
        status: "sitting-out" as const,
        hasActedThisRound: false,
        holeCards: [] as CardSnapshot[],
      })),
    ],
    board: {
      flop: state.board.flop.map(mapTaskCard),
      turn: state.board.turn ? mapTaskCard(state.board.turn) : null,
      river: state.board.river ? mapTaskCard(state.board.river) : null,
    },
    winners: state.winners.map((w) => ({
      agentId: w.agentId,
      amountWon: w.amountWon,
      ...(w.hand !== null && { handRank: w.hand.rank }),
    })),
    ...(lastAction !== undefined && { lastAction }),
  };
}

// ---------------------------------------------------------------------------
// Public API — agent management
// ---------------------------------------------------------------------------

export interface AgentPersonalityConfig {
  aggression: number; // 0-1
  tightness:  number; // 0-1
  bluff:      number; // 0-1
  talkiness:  number; // 0-1
}

export interface PendingAgent {
  agentId:     string;
  stack:       number;
  personality: AgentPersonalityConfig;
}

export interface MockGameControl {
  stop:        () => void;
  addAgent:    (agent: PendingAgent) => void;
  removeAgent: (agentId: string) => void;
  rebuyAgent:  (agentId: string, tokens: number) => void;
}

export interface MockGameOptions {
  onSnapshot:    (snap: LiveSnapshot, chat?: { agentId: string; message: string }) => void;
  getIntervalMs: () => number;
  startingStack?: number;
  smallBlind?:    number;
  bigBlind?:      number;
  botCount?:      number;
}

const TERMINAL_PHASES = new Set(["showdown", "execution", "settlement"]);

export function startMockGame(opts: MockGameOptions): MockGameControl {
  const SB       = opts.smallBlind    ?? 5;
  const BB       = opts.bigBlind      ?? 10;
  const START    = opts.startingStack ?? 500;
  const botCount = Math.max(2, Math.min(9, opts.botCount ?? 5));

  let running = true;
  let nextTimer: ReturnType<typeof setTimeout> | null = null;

  // Mutable bot roster — starts with built-in bots, grows with custom agents
  const botMap = new Map<string, BotPersonality>(
    BOTS.slice(0, botCount).map((b) => [b.id, b])
  );

  // Queues
  const pendingAgents: PendingAgent[] = [];
  const pendingSeats:  AgentSeat[]    = [];  // shown as sitting-out in UI
  const kickedAgents   = new Set<string>();

  const state = createGame({
    gameId: "mock",
    smallBlind: SB,
    bigBlind: BB,
    agents: BOTS.slice(0, botCount).map((b) => ({ agentId: b.id, stack: START })),
  });

  // ── agent management ──────────────────────────────────────────────────────

  function addAgent(agent: PendingAgent): void {
    // Register personality for decide() and chat
    botMap.set(agent.agentId, {
      id:         agent.agentId,
      aggression: agent.personality.aggression,
      tightness:  agent.personality.tightness,
      bluff:      agent.personality.bluff,
      talkiness:  agent.personality.talkiness,
      chat:       SILENT_CHAT,
    });
    pendingAgents.push(agent);
    // Show immediately in UI as "waiting for next hand"
    pendingSeats.push({
      agentId:           agent.agentId,
      stack:             agent.stack,
      holeCards:         [],
      totalBet:          0,
      currentBet:        0,
      status:            "sitting-out" as AgentStatus,
      hasActedThisRound: false,
    });
  }

  function removeAgent(agentId: string): void {
    kickedAgents.add(agentId);
    const seat = state.seats.find((s) => s.agentId === agentId);
    if (seat?.status === "active") {
      try { processAction(state, { agentId, type: "fold", amount: 0 }); } catch { /* */ }
    }
    if (seat) seat.stack = 0;
    // Remove from pending if not yet seated
    const pi = pendingAgents.findIndex((p) => p.agentId === agentId);
    if (pi !== -1) pendingAgents.splice(pi, 1);
    const si = pendingSeats.findIndex((s) => s.agentId === agentId);
    if (si !== -1) pendingSeats.splice(si, 1);
  }

  function rebuyAgent(agentId: string, tokens: number): void {
    const seat = state.seats.find((s) => s.agentId === agentId);
    if (seat && seat.stack === 0) {
      seat.stack = tokens;
      // Will be set active on next startHand
    }
  }

  // ── hand management ───────────────────────────────────────────────────────

  function beginHand(chat?: { agentId: string; message: string }): void {
    // 1. Remove kicked agents from state
    for (const id of kickedAgents) {
      const idx = state.seats.findIndex((s) => s.agentId === id);
      if (idx !== -1) state.seats.splice(idx, 1);
      botMap.delete(id);
    }
    kickedAgents.clear();

    // 2. Flush pending agents into state
    while (pendingAgents.length > 0) {
      const p = pendingAgents.shift()!;
      if (!state.seats.find((s) => s.agentId === p.agentId)) {
        state.seats.push({
          agentId:           p.agentId,
          stack:             p.stack,
          holeCards:         [],
          totalBet:          0,
          currentBet:        0,
          status:            "active" as AgentStatus,
          hasActedThisRound: false,
        });
      }
      // Remove from pending display
      const si = pendingSeats.findIndex((s) => s.agentId === p.agentId);
      if (si !== -1) pendingSeats.splice(si, 1);
    }

    // 3. Reset stacks if all eliminated
    const alive = state.seats.filter((s) => s.stack > 0);
    if (alive.length < 2) {
      state.seats.forEach((s) => { s.stack = START; });
      state.handNumber = 0;
    }

    startHand(state, SB, BB);
    opts.onSnapshot(stateToSnapshot(state, [...pendingSeats]), chat);
  }

  function scheduleNext(): void {
    if (!running) return;
    nextTimer = setTimeout(tick, opts.getIntervalMs());
  }

  function tick(): void {
    if (!running) return;

    if (TERMINAL_PHASES.has(state.phase)) {
      const terminalChat = chatForTerminal(state, botMap);
      beginHand(terminalChat);
      scheduleNext();
      return;
    }

    const seat = state.seats[state.actionOnIndex];
    if (!seat || seat.status !== "active") {
      scheduleNext();
      return;
    }

    const actingBot = botMap.get(seat.agentId);
    const action    = decide(state, seat.agentId, botMap);

    const chat = actingBot
      ? chatForAction(action, state, actingBot, botMap)
      : undefined;

    try {
      processAction(state, action);
    } catch {
      try { processAction(state, { agentId: seat.agentId, type: "fold", amount: 0 }); } catch { /* */ }
    }

    opts.onSnapshot(
      stateToSnapshot(state, [...pendingSeats], {
        agentId: seat.agentId,
        type:    action.type,
        amount:  action.amount,
      }),
      chat
    );

    scheduleNext();
  }

  // Start first hand
  beginHand();
  scheduleNext();

  return {
    stop: () => {
      running = false;
      if (nextTimer !== null) clearTimeout(nextTimer);
    },
    addAgent,
    removeAgent,
    rebuyAgent,
  };
}

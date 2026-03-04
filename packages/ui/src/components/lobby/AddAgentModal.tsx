import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AgentPersonalityConfig } from "../../lib/mock-game.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentType = "simulated" | "claude" | "openai" | "mcp";

export interface AgentConfig {
  agentId:      string;
  name:         string;
  emoji:        string;
  color:        string;
  type:         AgentType;
  personality:  AgentPersonalityConfig;
  tokens:       number;
  apiKey?:      string;
  mcpEndpoint?: string;
}

interface Props {
  isOpen:       boolean;
  onClose:      () => void;
  onAdd:        (config: AgentConfig) => void;
  currentSeats: number;
  maxSeats:     number;
}

// ---------------------------------------------------------------------------
// Preset personalities
// ---------------------------------------------------------------------------

const PRESET_EMOJIS = ["🦈", "🪨", "🎩", "🎲", "⏱️", "🐺", "🦉", "🐢", "🦊"];

const PRESET_COLORS = [
  "#ef4444", "#6b7280", "#a855f7", "#f97316", "#3b82f6",
  "#f59e0b", "#06b6d4", "#84cc16", "#ec4899",
];

interface Preset {
  id:         string;
  label:      string;
  aggression: number;
  tightness:  number;
  bluff:      number;
  talkiness:  number;
}

const PRESETS: Preset[] = [
  { id: "shark",  label: "🦈 Tiburón — Agresivo",    aggression: 85, tightness: 25, bluff: 35, talkiness: 70 },
  { id: "rock",   label: "🪨 Roca — Estoico",         aggression: 10, tightness: 80, bluff:  5, talkiness:  5 },
  { id: "mago",   label: "🎩 Mago — Misterioso",      aggression: 55, tightness: 40, bluff: 60, talkiness: 65 },
  { id: "caos",   label: "🎲 Caos — Random",          aggression: 50, tightness: 10, bluff: 30, talkiness:100 },
  { id: "reloj",  label: "⏱️ Reloj — Calculado",      aggression: 45, tightness: 55, bluff: 15, talkiness: 50 },
  { id: "wolf",   label: "🐺 Lobo — LAG",             aggression: 90, tightness: 15, bluff: 45, talkiness: 60 },
  { id: "owl",    label: "🦉 Lechuza — TAG",          aggression: 70, tightness: 70, bluff: 18, talkiness: 35 },
  { id: "turtle", label: "🐢 Tortuga — Calling Stn",  aggression:  8, tightness: 60, bluff:  2, talkiness: 20 },
  { id: "fox",    label: "🦊 Zorro — Tramposo",       aggression: 60, tightness: 45, bluff: 30, talkiness: 60 },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SliderField({
  label, value, onChange, hint,
}: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-baseline">
        <label className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
          {label}
        </label>
        <span className="text-[10px] font-mono text-gold/70">{value}</span>
      </div>
      <input
        type="range" min={0} max={100} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 rounded appearance-none bg-white/10 accent-gold cursor-pointer"
      />
      {hint && <span className="text-[9px] font-mono text-white/20">{hint}</span>}
    </div>
  );
}

function TypeButton({
  value, selected, label, icon, onClick,
}: { value: AgentType; selected: boolean; label: string; icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-1.5 px-2 text-[10px] font-mono rounded border flex flex-col items-center gap-0.5 transition-colors
        ${selected
          ? "bg-gold/15 border-gold/50 text-gold"
          : "border-white/10 text-white/40 hover:border-white/25 hover:text-white/60"}`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// AddAgentModal
// ---------------------------------------------------------------------------

export function AddAgentModal({ isOpen, onClose, onAdd, currentSeats, maxSeats }: Props) {
  const [name, setName]             = useState("");
  const [emoji, setEmoji]           = useState("🦈");
  const [customEmoji, setCustom]    = useState("");
  const [agentType, setType]        = useState<AgentType>("simulated");
  const [usePreset, setUsePreset]   = useState(true);
  const [presetId, setPresetId]     = useState("shark");
  const [sliders, setSliders]       = useState({ aggression: 50, tightness: 50, bluff: 20, talkiness: 50 });
  const [tokens, setTokens]         = useState(150);
  const [apiKey, setApiKey]         = useState("");
  const [mcpEndpoint, setMcp]       = useState("");
  const [errors, setErrors]         = useState<string[]>([]);

  const activeEmoji   = customEmoji || emoji;
  const selectedPreset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!;
  const emojiColor     = PRESET_COLORS[PRESET_EMOJIS.indexOf(emoji)] ?? "#d4af37";

  function setSlider(key: keyof typeof sliders, v: number) {
    setSliders((prev) => ({ ...prev, [key]: v }));
  }

  function validate(): boolean {
    const errs: string[] = [];
    if (!name.trim())                           errs.push("El nombre es obligatorio.");
    if (currentSeats >= maxSeats)               errs.push("La mesa está completa.");
    if ((agentType === "claude" || agentType === "openai") && !apiKey.trim())
                                                errs.push("La API key es obligatoria.");
    if (agentType === "mcp" && !mcpEndpoint.trim())
                                                errs.push("El endpoint MCP es obligatorio.");
    setErrors(errs);
    return errs.length === 0;
  }

  function buildPersonality(): AgentPersonalityConfig {
    if (agentType !== "simulated") {
      return { aggression: 0.5, tightness: 0.5, bluff: 0.2, talkiness: 0.5 };
    }
    if (usePreset) {
      return {
        aggression: selectedPreset.aggression / 100,
        tightness:  selectedPreset.tightness  / 100,
        bluff:      selectedPreset.bluff      / 100,
        talkiness:  selectedPreset.talkiness  / 100,
      };
    }
    return {
      aggression: sliders.aggression / 100,
      tightness:  sliders.tightness  / 100,
      bluff:      sliders.bluff      / 100,
      talkiness:  sliders.talkiness  / 100,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    onAdd({
      agentId:     `agent_${Date.now().toString(36)}`,
      name:        name.trim(),
      emoji:       activeEmoji,
      color:       emojiColor,
      type:        agentType,
      personality: buildPersonality(),
      tokens,
      ...(apiKey      ? { apiKey }      : {}),
      ...(mcpEndpoint ? { mcpEndpoint } : {}),
    });

    // Reset
    setName(""); setCustom(""); setEmoji("🦈"); setType("simulated");
    setUsePreset(true); setPresetId("shark"); setTokens(150);
    setApiKey(""); setMcp(""); setErrors([]);
    onClose();
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.92, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 14 }}
            transition={{ type: "spring", damping: 22, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-void-elevated border border-gold/20 rounded-xl
                       shadow-2xl shadow-black/60 p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between shrink-0">
              <h2 className="font-display text-base font-bold text-white tracking-wide flex items-center gap-2">
                <span>{activeEmoji}</span>
                <span>Añadir Agente</span>
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="text-white/40 hover:text-white/80 text-xl leading-none transition-colors"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">

              {/* Name */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                  Nombre
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Señor Bluff"
                  className={inputCls}
                  autoFocus
                />
              </div>

              {/* Avatar */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                  Avatar
                </label>
                <div className="flex gap-1.5 flex-wrap">
                  {PRESET_EMOJIS.map((em, i) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => { setEmoji(em); setCustom(""); }}
                      className={`w-8 h-8 text-base rounded border transition-colors flex items-center justify-center
                        ${emoji === em && !customEmoji
                          ? "border-gold/60 bg-gold/15"
                          : "border-white/10 hover:border-white/30"}`}
                      style={emoji === em && !customEmoji
                        ? { boxShadow: `0 0 8px ${PRESET_COLORS[i]}40` }
                        : {}}
                    >
                      {em}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={customEmoji}
                  onChange={(e) => setCustom(e.target.value.slice(-2))}
                  placeholder="Custom emoji…"
                  className={`${inputCls} text-center`}
                  style={{ maxWidth: 120 }}
                />
              </div>

              {/* Type */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                  Tipo
                </label>
                <div className="flex gap-1.5">
                  <TypeButton value="simulated" selected={agentType === "simulated"} label="Bot" icon="🤖" onClick={() => setType("simulated")} />
                  <TypeButton value="claude"    selected={agentType === "claude"}    label="Claude" icon="✦" onClick={() => setType("claude")} />
                  <TypeButton value="openai"    selected={agentType === "openai"}    label="OpenAI" icon="◆" onClick={() => setType("openai")} />
                  <TypeButton value="mcp"       selected={agentType === "mcp"}       label="MCP" icon="⚡" onClick={() => setType("mcp")} />
                </div>
              </div>

              {/* Bot personality section */}
              {agentType === "simulated" && (
                <div className="flex flex-col gap-3 border border-white/5 rounded-lg p-3 bg-black/20">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setUsePreset(true)}
                      className={`flex-1 py-1 text-[10px] font-mono rounded border transition-colors
                        ${usePreset
                          ? "border-gold/40 text-gold bg-gold/10"
                          : "border-white/10 text-white/40 hover:border-white/25"}`}
                    >
                      Preset
                    </button>
                    <button
                      type="button"
                      onClick={() => setUsePreset(false)}
                      className={`flex-1 py-1 text-[10px] font-mono rounded border transition-colors
                        ${!usePreset
                          ? "border-gold/40 text-gold bg-gold/10"
                          : "border-white/10 text-white/40 hover:border-white/25"}`}
                    >
                      Custom
                    </button>
                  </div>

                  {usePreset ? (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                        Personalidad
                      </label>
                      <select
                        value={presetId}
                        onChange={(e) => setPresetId(e.target.value)}
                        className={`${inputCls} cursor-pointer`}
                      >
                        {PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                      {/* Preset preview bars */}
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                        {(["aggression", "tightness", "bluff", "talkiness"] as const).map((k) => (
                          <div key={k} className="flex items-center gap-1.5">
                            <span className="text-[9px] font-mono text-white/25 w-14 capitalize">{k}</span>
                            <div className="flex-1 h-1 rounded bg-white/10">
                              <div
                                className="h-full rounded bg-gold/50"
                                style={{ width: `${selectedPreset[k]}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      <SliderField label="Agresión"  value={sliders.aggression} onChange={(v) => setSlider("aggression", v)} hint="Qué tan seguido ataca" />
                      <SliderField label="Bluff"     value={sliders.bluff}      onChange={(v) => setSlider("bluff",      v)} hint="Probabilidad de farolear" />
                      <SliderField label="Selección" value={sliders.tightness}  onChange={(v) => setSlider("tightness",  v)} hint="Qué tan selectivo es con las manos" />
                      <SliderField label="Charla"    value={sliders.talkiness}  onChange={(v) => setSlider("talkiness",  v)} hint="Qué tanto habla en la mesa" />
                    </div>
                  )}
                </div>
              )}

              {/* API key (Claude / OpenAI) */}
              {(agentType === "claude" || agentType === "openai") && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                    API Key {agentType === "claude" ? "(Anthropic)" : "(OpenAI)"}
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={agentType === "claude" ? "sk-ant-…" : "sk-…"}
                    className={inputCls}
                    autoComplete="off"
                  />
                  <p className="text-[9px] font-mono text-white/20">
                    ⚠️ La key se usa solo en esta sesión de browser y no se envía a ningún servidor.
                  </p>
                </div>
              )}

              {/* MCP endpoint */}
              {agentType === "mcp" && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                    Endpoint MCP
                  </label>
                  <input
                    type="text"
                    value={mcpEndpoint}
                    onChange={(e) => setMcp(e.target.value)}
                    placeholder="ws://localhost:4001"
                    className={inputCls}
                  />
                  <p className="text-[9px] font-mono text-white/20">
                    El agente debe implementar el protocolo PokerCrawl MCP.
                  </p>
                </div>
              )}

              {/* Tokens slider */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-baseline">
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                    Tokens Iniciales
                  </label>
                  <span className="text-xs font-mono font-bold text-gold">{tokens}</span>
                </div>
                <input
                  type="range" min={50} max={500} step={10}
                  value={tokens}
                  onChange={(e) => setTokens(Number(e.target.value))}
                  className="w-full h-1 rounded appearance-none bg-white/10 accent-gold cursor-pointer"
                />
                <div className="flex justify-between text-[9px] font-mono text-white/20">
                  <span>50</span><span>500</span>
                </div>
              </div>

              {/* Errors */}
              {errors.length > 0 && (
                <ul className="text-xs text-red-400 space-y-0.5 bg-red-900/20 border border-red-900/40 rounded p-2">
                  {errors.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2 border border-white/10 text-white/50 text-xs font-mono
                             rounded hover:border-white/30 hover:text-white/80 transition-colors"
                >
                  Cancelar
                </button>
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className="flex-1 py-2 bg-gold/20 border border-gold/50 text-gold text-xs font-mono
                             font-bold rounded hover:bg-gold/30 hover:border-gold/80 transition-colors"
                >
                  🪑 Sentarse
                </motion.button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inputCls =
  "w-full bg-black/30 border border-white/10 rounded px-3 py-1.5 text-xs font-mono " +
  "text-white/80 placeholder-white/20 focus:outline-none focus:border-gold/40 transition-colors " +
  "bg-void";

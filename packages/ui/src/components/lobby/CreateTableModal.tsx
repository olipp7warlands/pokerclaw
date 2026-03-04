import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LobbyTable } from "../../lib/demo-lobby.js";

interface Props {
  isOpen:   boolean;
  onClose:  () => void;
  onCreate: (table: LobbyTable) => void;
}

export function CreateTableModal({ isOpen, onClose, onCreate }: Props) {
  const [name,     setName]     = useState("");
  const [sb,       setSb]       = useState(5);
  const [bb,       setBb]       = useState(10);
  const [maxSeats, setMaxSeats] = useState(6);
  const [errors,   setErrors]   = useState<string[]>([]);

  function validate(): boolean {
    const errs: string[] = [];
    if (!name.trim())  errs.push("El nombre de la mesa es obligatorio.");
    if (bb < sb * 2)   errs.push("El Big Blind debe ser al menos 2\u00d7 el Small Blind.");
    if (sb < 1)        errs.push("El Small Blind debe ser al menos 1.");
    setErrors(errs);
    return errs.length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    onCreate({
      id:             Date.now().toString(36),
      name:           name.trim(),
      blinds:         { small: sb, big: bb },
      currentPlayers: 0,
      maxSeats,
      avgPot:         bb * 5,
      type:           "cash",
      status:         "waiting",
    });

    setName(""); setSb(5); setBb(10); setMaxSeats(6); setErrors([]);
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
            className="w-full max-w-sm bg-void-elevated border border-gold/20 rounded-xl shadow-2xl shadow-black/60 p-5 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-white tracking-wide flex items-center gap-2">
                <span>&#x1F3B0;</span>
                <span>Crear Mesa</span>
              </h2>
              <button type="button" onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none transition-colors">
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">

              <div className="flex flex-col gap-1">
                <label className={labelCls}>Nombre de la mesa</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Noche de Lobos"
                  className={inputCls}
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className={labelCls}>Small Blind</label>
                  <input
                    type="number"
                    value={sb}
                    min={1}
                    onChange={(e) => setSb(Math.max(1, Number(e.target.value)))}
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className={labelCls}>Big Blind</label>
                  <input
                    type="number"
                    value={bb}
                    min={2}
                    onChange={(e) => setBb(Math.max(2, Number(e.target.value)))}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className={labelCls}>M&#xe1;x. jugadores</label>
                <select
                  value={maxSeats}
                  onChange={(e) => setMaxSeats(Number(e.target.value))}
                  className={`${inputCls} cursor-pointer`}
                >
                  {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <option key={n} value={n}>{n} jugadores</option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg px-3 py-2 flex items-center justify-between"
                style={{ background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.15)" }}>
                <span className="text-[10px] font-mono text-white/35">Vista previa</span>
                <span className="text-[11px] font-mono text-gold/80">
                  {name.trim() || "\u2014"} &middot; {sb}/{bb} &middot; {maxSeats} seats
                </span>
              </div>

              {errors.length > 0 && (
                <ul className="text-xs text-red-400 space-y-0.5 bg-red-900/20 border border-red-900/40 rounded p-2">
                  {errors.map((err, i) => <li key={i}>&bull; {err}</li>)}
                </ul>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2 border border-white/10 text-white/50 text-xs font-mono rounded hover:border-white/30 hover:text-white/80 transition-colors"
                >
                  Cancelar
                </button>
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className="flex-1 py-2 bg-gold/20 border border-gold/50 text-gold text-xs font-mono font-bold rounded hover:bg-gold/30 hover:border-gold/80 transition-colors"
                >
                  &#x1F3B0; Crear Mesa
                </motion.button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const labelCls =
  "text-[10px] font-mono text-white/40 uppercase tracking-wider";

const inputCls =
  "w-full bg-black/30 border border-white/10 rounded px-3 py-1.5 text-xs font-mono " +
  "text-white/80 placeholder-white/20 focus:outline-none focus:border-gold/40 transition-colors bg-void";

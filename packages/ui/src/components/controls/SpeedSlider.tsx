import type { Speed } from "../../hooks/useAnimations.js";

interface SpeedSliderProps {
  speed: Speed;
  onChange: (s: Speed) => void;
}

const OPTIONS: { value: Speed; label: string }[] = [
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 5, label: "5×" },
];

export function SpeedSlider({ speed, onChange }: SpeedSliderProps) {
  return (
    <div className="flex items-center gap-1 bg-black/30 rounded-lg p-0.5 border border-white/10">
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`
            px-2.5 py-1 rounded-md text-xs font-mono font-bold transition-all duration-150
            ${speed === value
              ? "bg-gold text-black shadow-sm"
              : "text-white/50 hover:text-white/80"
            }
          `}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

import { chipColor } from "../../lib/utils.js";

interface TokenChipProps {
  value: number;
  size?: number;
}

export function TokenChip({ value, size = 24 }: TokenChipProps) {
  const bg = chipColor(value);
  const isGold = value >= 500;

  return (
    <div
      title={String(value)}
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        border: isGold ? "2px solid #d4af37" : "2px solid rgba(255,255,255,0.15)",
        boxShadow: isGold ? "0 0 6px rgba(212,175,55,0.6)" : "inset 0 1px 0 rgba(255,255,255,0.1)",
      }}
      className="rounded-full flex items-center justify-center select-none"
    >
      <span
        style={{ fontSize: size * 0.35, lineHeight: 1 }}
        className="font-mono font-bold text-white/90"
      >
        {value >= 100 ? value / 100 : value}
      </span>
    </div>
  );
}

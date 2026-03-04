import { TokenChip } from "./TokenChip.js";
import { formatTokens } from "../../lib/utils.js";

interface TokenStackProps {
  amount: number;
  label?: string;
  small?: boolean;
}

/** Visual stacked chips + numeric label */
export function TokenStack({ amount, label, small = false }: TokenStackProps) {
  if (amount <= 0) return null;

  const chipSize = small ? 16 : 20;

  // Pick up to 4 chips to show
  const chips: number[] = [];
  let remaining = amount;
  for (const tier of [500, 100, 25, 5, 1]) {
    while (remaining >= tier && chips.length < 4) {
      chips.push(tier);
      remaining -= tier;
    }
    if (chips.length >= 4) break;
  }

  return (
    <div className="flex items-center gap-1">
      {/* Stacked chips (overlap each other visually) */}
      <div className="relative flex" style={{ width: chipSize + (chips.length - 1) * 6 }}>
        {chips.map((v, i) => (
          <div
            key={i}
            style={{ position: "absolute", left: i * 6, zIndex: i }}
          >
            <TokenChip value={v} size={chipSize} />
          </div>
        ))}
      </div>
      <span
        className="font-mono font-bold text-gold leading-none"
        style={{ fontSize: small ? 10 : 12 }}
      >
        {label ?? formatTokens(amount)}
      </span>
    </div>
  );
}

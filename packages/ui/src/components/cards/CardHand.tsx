import type { CapabilityCard } from "@pokercrawl/engine";
import { Card } from "./Card.js";
import { CardBack } from "./CardBack.js";

interface CardHandProps {
  cards:    readonly CapabilityCard[];
  faceDown?: boolean;
  /** tiny: 36×50 (beside avatar in compact seat) */
  tiny?:    boolean;
  /** small: 40×56 */
  small?:   boolean;
}

export function CardHand({ cards, faceDown = true, tiny = false, small = false }: CardHandProps) {
  const w = tiny ? 28 : small ? 40 : 56;
  const h = tiny ? 40 : small ? 56 : 80;

  if (faceDown || cards.length === 0) {
    return (
      <div className="flex" style={{ gap: tiny ? 2 : 4 }}>
        <CardBack width={w} height={h} />
        <CardBack width={w} height={h} />
      </div>
    );
  }

  return (
    <div className="flex" style={{ gap: tiny ? 2 : 4 }}>
      {cards.slice(0, 2).map((card, i) => (
        <Card
          key={i}
          card={card}
          faceDown={false}
          width={w}
          height={h}
          animateReveal
          delay={i * 0.1}
        />
      ))}
    </div>
  );
}

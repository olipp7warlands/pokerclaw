interface CardBackProps {
  width?: number;
  height?: number;
}

export function CardBack({ width = 56, height = 80 }: CardBackProps) {
  return (
    <div
      style={{
        width,
        height,
        minWidth: width,
        borderRadius: 5,
        background: "#1a1a2e",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
        flexShrink: 0,
      }}
    />
  );
}

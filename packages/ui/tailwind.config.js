/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        felt: {
          DEFAULT: "#0d4a2e",
          dark: "#082d1b",
          light: "#1a6b42",
        },
        gold: {
          DEFAULT: "#d4af37",
          light: "#f0d060",
          dim: "#8a7020",
        },
        neon: {
          DEFAULT: "#00ff88",
          dim: "#00cc66",
        },
        void: {
          DEFAULT: "#0a0a0f",
          surface: "#12121a",
          elevated: "#1a1a24",
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', "Georgia", "serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },
      boxShadow: {
        gold:      "0 0 20px rgba(212,175,55,0.4)",
        "gold-sm": "0 0 8px rgba(212,175,55,0.3)",
        "gold-lg": "0 0 40px rgba(212,175,55,0.5)",
        neon:      "0 0 20px rgba(0,255,136,0.4)",
      },
      animation: {
        "pulse-gold":  "pulse-gold  2s ease-in-out infinite",
        "spin-slow":   "spin        8s linear     infinite",
        "allin-glow":  "pulse-allin 1.8s ease-in-out infinite",
        "out-pulse":   "out-pulse   2.5s ease-in-out infinite",
        "pot-shimmer": "pot-shimmer 3s ease-in-out infinite",
      },
      keyframes: {
        "pulse-gold": {
          "0%, 100%": { boxShadow: "0 0 8px rgba(212,175,55,0.3)" },
          "50%":       { boxShadow: "0 0 24px rgba(212,175,55,0.8)" },
        },
        "pulse-allin": {
          "0%, 100%": { boxShadow: "0 0 0 2px #d4af37, 0 0 10px rgba(212,175,55,0.5)" },
          "50%":       { boxShadow: "0 0 0 3px #f0d060, 0 0 22px rgba(240,208,96,0.85)" },
        },
        "out-pulse": {
          "0%, 100%": { opacity: "0.65" },
          "50%":       { opacity: "1" },
        },
        "pot-shimmer": {
          "0%, 100%": { boxShadow: "0 0 14px rgba(212,175,55,0.22), inset 0 0 8px rgba(212,175,55,0.06)" },
          "50%":       { boxShadow: "0 0 28px rgba(212,175,55,0.45), inset 0 0 16px rgba(212,175,55,0.12)" },
        },
      },
    },
  },
  plugins: [],
};

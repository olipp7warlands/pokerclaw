import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const GOLD  = "#d4af37";
const MONO  = "'JetBrains Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";

interface Entry {
  rank:    number;
  agentId: string;
  name:    string;
  emoji:   string;
  elo:     number;
  winRate: number;
  wins:    number;
  hands:   number;
}

const FALLBACK: Entry[] = [
  { rank: 1, agentId: "reloj",  name: "El Reloj",   emoji: "⏱️", elo: 1485, winRate: 62, wins: 0, hands: 0 },
  { rank: 2, agentId: "shark",  name: "El Tiburón", emoji: "🦈", elo: 1380, winRate: 54, wins: 0, hands: 0 },
  { rank: 3, agentId: "mago",   name: "El Mago",    emoji: "🎩", elo: 1290, winRate: 48, wins: 0, hands: 0 },
  { rank: 4, agentId: "wolf",   name: "El Lobo",    emoji: "🐺", elo: 1260, winRate: 52, wins: 0, hands: 0 },
  { rank: 5, agentId: "rock",   name: "La Roca",    emoji: "🪨", elo: 1240, winRate: 45, wins: 0, hands: 0 },
  { rank: 6, agentId: "owl",    name: "La Lechuza", emoji: "🦉", elo: 1220, winRate: 47, wins: 0, hands: 0 },
  { rank: 7, agentId: "caos",   name: "El Caos",    emoji: "🎲", elo: 1180, winRate: 38, wins: 0, hands: 0 },
  { rank: 8, agentId: "fox",    name: "El Zorro",   emoji: "🦊", elo: 1150, winRate: 41, wins: 0, hands: 0 },
  { rank: 9, agentId: "turtle", name: "La Tortuga", emoji: "🐢", elo: 1100, winRate: 22, wins: 0, hands: 0 },
];

export function LeaderboardPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Entry[]>(FALLBACK);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Entry[] | null) => { if (data?.length) setEntries(data); })
      .catch(() => { /* use fallback */ });
  }, []);

  return (
    <div
      style={{
        minHeight:  "100vh",
        background: "#0a0a0f",
        color:      "#fff",
        fontFamily: MONO,
      }}
    >
      {/* Nav */}
      <nav
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "14px 40px",
          borderBottom:   "1px solid rgba(212,175,55,0.1)",
          background:     "rgba(10,10,15,0.95)",
          backdropFilter: "blur(16px)",
          position:       "sticky",
          top:            0,
          zIndex:         100,
        }}
      >
        <button
          onClick={() => navigate("/")}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontFamily: SERIF, fontSize: 22, color: GOLD, padding: 0,
          }}
        >
          ♠ POKERCRAWL
        </button>
        <button
          onClick={() => navigate("/lobby")}
          style={{
            background: GOLD, border: "none", borderRadius: 5,
            color: "#000", cursor: "pointer", fontWeight: 700,
            fontSize: 13, padding: "7px 20px", fontFamily: MONO,
          }}
        >
          Enter Game →
        </button>
      </nav>

      {/* Content */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "64px 40px" }}>
        <h1
          style={{
            fontFamily: SERIF, fontSize: 48, fontWeight: 700,
            color: "#fff", marginBottom: 8,
          }}
        >
          Leaderboard
        </h1>
        <p style={{ color: "rgba(255,255,255,0.4)", marginBottom: 40, fontSize: 14 }}>
          Rankings based on ELO score. Updated after every hand.
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                borderBottom:  "1px solid rgba(255,255,255,0.08)",
                fontSize:      11,
                color:         "rgba(255,255,255,0.3)",
                letterSpacing: "0.1em",
                textAlign:     "left",
              }}
            >
              {["Rank", "Agent", "ELO", "Win %", "Hands"].map((h) => (
                <th key={h} style={{ padding: "10px 16px", fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.agentId}
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  fontSize:     15,
                  transition:   "background 0.15s",
                }}
              >
                <td style={{ padding: "14px 16px", color: e.rank <= 3 ? GOLD : "rgba(255,255,255,0.4)", fontWeight: e.rank <= 3 ? 700 : 400, width: 60 }}>
                  {e.rank <= 3 ? ["🥇","🥈","🥉"][e.rank - 1] : e.rank}
                </td>
                <td style={{ padding: "14px 16px" }}>
                  <span style={{ marginRight: 8, fontSize: 18 }}>{e.emoji}</span>
                  <span style={{ color: e.rank === 1 ? GOLD : "#fff" }}>{e.name}</span>
                </td>
                <td style={{ padding: "14px 16px", color: GOLD, fontWeight: 700 }}>{e.elo}</td>
                <td style={{ padding: "14px 16px", color: e.winRate >= 50 ? "#4ade80" : "rgba(255,255,255,0.5)" }}>
                  {e.winRate}%
                </td>
                <td style={{ padding: "14px 16px", color: "rgba(255,255,255,0.35)" }}>
                  {e.hands > 0 ? e.hands.toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useState } from "react";

interface Props {
  isOpen:  boolean;
  tableId: string | undefined;
  onClose: () => void;
}

type Status = "idle" | "loading" | "done" | "error";

export function JoinTableModal({ isOpen, tableId, onClose }: Props) {
  const [name,   setName]   = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState("");

  if (!isOpen) return null;

  const handleJoin = async () => {
    if (!name.trim()) return;
    setStatus("loading");
    setErrMsg("");
    try {
      // 1. Register agent
      const regRes = await fetch("/api/agents/register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: name.trim(), type: "human" }),
      });
      const reg = await regRes.json() as { agentId?: string; token?: string; error?: string };
      if (!regRes.ok) throw new Error(reg.error ?? "Registration failed");

      // 2. Connect (auto-seats at best available table)
      const connRes = await fetch("/api/agents/connect", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token: reg.token }),
      });
      const conn = await connRes.json() as { sessionId?: string; tableId?: string; error?: string };
      if (!connRes.ok) throw new Error(conn.error ?? "Connection failed");

      // 3. Persist session so the page can send actions later
      if (conn.sessionId) localStorage.setItem("pokerSessionId", conn.sessionId);
      if (reg.agentId)   localStorage.setItem("pokerAgentId",   reg.agentId);
      if (conn.tableId)  localStorage.setItem("pokerTableId",   conn.tableId);

      setStatus("done");
      setTimeout(onClose, 1_400);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    }
  };

  return (
    <div
      style={{
        position:       "fixed",
        inset:          0,
        background:     "rgba(0,0,0,0.72)",
        backdropFilter: "blur(4px)",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        zIndex:         9000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background:   "#0d0d18",
          border:       "1px solid rgba(212,175,55,0.25)",
          borderRadius: 10,
          padding:      "28px 32px",
          width:        340,
          display:      "flex",
          flexDirection:"column",
          gap:          16,
          fontFamily:   "'JetBrains Mono', monospace",
        }}
      >
        <div style={{ color: "#d4af37", fontWeight: 700, fontSize: 15 }}>
          Join Table {tableId ? `· ${tableId}` : ""}
        </div>

        {status === "done" ? (
          <div style={{ color: "#4ade80", fontSize: 13, textAlign: "center", padding: "12px 0" }}>
            ✓ Seated! Joining table…
          </div>
        ) : (
          <>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleJoin(); }}
              placeholder="Your name"
              style={{
                background:   "rgba(255,255,255,0.05)",
                border:       "1px solid rgba(212,175,55,0.2)",
                borderRadius: 6,
                padding:      "9px 13px",
                color:        "#fff",
                fontSize:     13,
                outline:      "none",
                fontFamily:   "inherit",
                width:        "100%",
                boxSizing:    "border-box",
              }}
            />

            {errMsg && (
              <div style={{ color: "#f87171", fontSize: 11 }}>{errMsg}</div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={onClose}
                style={{
                  background:   "none",
                  border:       "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 6,
                  color:        "rgba(255,255,255,0.45)",
                  cursor:       "pointer",
                  fontSize:     12,
                  padding:      "7px 16px",
                  fontFamily:   "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleJoin()}
                disabled={!name.trim() || status === "loading"}
                style={{
                  background:   name.trim() ? "rgba(212,175,55,0.18)" : "rgba(255,255,255,0.05)",
                  border:       "1px solid rgba(212,175,55,0.35)",
                  borderRadius: 6,
                  color:        name.trim() ? "#d4af37" : "rgba(255,255,255,0.25)",
                  cursor:       name.trim() && status !== "loading" ? "pointer" : "default",
                  fontSize:     12,
                  fontWeight:   700,
                  padding:      "7px 20px",
                  fontFamily:   "inherit",
                }}
              >
                {status === "loading" ? "Joining…" : "Sit Down"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

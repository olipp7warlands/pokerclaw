/**
 * PokerCrawl — Supabase persistence layer
 *
 * All functions are no-ops when SUPABASE_URL is not set so the app runs
 * in development without a database. In production, Railway injects the
 * env vars and all writes/reads are live.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Client (singleton, lazy-initialised)
// ---------------------------------------------------------------------------

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (_client) return _client;
  const url  = process.env["SUPABASE_URL"];
  const key  = process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) return null;
  _client = createClient(url, key);
  return _client;
}

export function isDbAvailable(): boolean {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_ANON_KEY"];
  console.log(`[DB] SUPABASE_URL=${url ? "SET" : "MISSING"}, SUPABASE_ANON_KEY=${key ? `SET(len=${key.length})` : "MISSING"}`);
  return getClient() !== null;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export async function saveAgent(
  id:           string,
  name:         string,
  avatar?:      string,
  capabilities: string[] = [],
  model?:       string,
): Promise<void> {
  const db = getClient();
  if (!db) return;
  const { error } = await db.from("agents").upsert(
    { id, name, avatar, capabilities, model, last_seen: new Date().toISOString() },
    { onConflict: "id" },
  );
  if (error) console.error("[DB] saveAgent error:", error.message, error.details, error.hint);
}

export async function updateAgentStats(
  id:          string,
  handsPlayed: number,
  handsWon:    number,
  elo:         number,
): Promise<void> {
  const db = getClient();
  if (!db) return;
  const { error } = await db
    .from("agents")
    .update({ hands_played: handsPlayed, hands_won: handsWon, elo, last_seen: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[DB] updateAgentStats error:", error.message, error.details, error.hint);
}

// ---------------------------------------------------------------------------
// Hands
// ---------------------------------------------------------------------------

export async function saveHandResult(
  tableId:     string,
  handNumber:  number,
  winners:     string[],
  pot:         number,
  players:     unknown,
): Promise<void> {
  const db = getClient();
  if (!db) return;
  const { error } = await db.from("hands").insert({
    table_id:    tableId,
    hand_number: handNumber,
    winners,
    pot,
    players,
    created_at:  new Date().toISOString(),
  });
  if (error) console.error("[DB] saveHandResult error:", error.message, error.details, error.hint);
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export async function getLeaderboard(limit = 10): Promise<Array<{
  id:          string;
  name:        string;
  avatar?:     string;
  elo:         number;
  hands_played: number;
  hands_won:   number;
}> | null> {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from("agents")
    .select("id, name, avatar, elo, hands_played, hands_won")
    .order("elo", { ascending: false })
    .limit(limit);
  if (error) { console.error("[DB] getLeaderboard error:", error.message); return null; }
  return data;
}

// ---------------------------------------------------------------------------
// Global stats
// ---------------------------------------------------------------------------

export async function getGlobalStats(): Promise<{ total_hands: number; total_agents: number } | null> {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db.from("stats").select("total_hands, total_agents").eq("id", "global").single();
  if (error) { console.error("[DB] getGlobalStats error:", error.message, error.details); return null; }
  return data;
}

export async function incrementGlobalHands(count = 1): Promise<void> {
  const db = getClient();
  if (!db) return;

  // Try RPC first
  const { error: rpcError } = await db.rpc("increment_global_hands", { inc: count });
  if (!rpcError) return;

  // Fallback: read-modify-write
  const { data, error: readError } = await db.from("stats").select("total_hands").eq("id", "global").single();
  if (readError) {
    console.error("[DB] incrementGlobalHands read error:", readError.message);
    return;
  }
  if (data) {
    const { error: writeError } = await db.from("stats")
      .update({ total_hands: (data.total_hands as number) + count, updated_at: new Date().toISOString() })
      .eq("id", "global");
    if (writeError) console.error("[DB] incrementGlobalHands write error:", writeError.message, writeError.hint);
  } else {
    // Row doesn't exist — insert it
    const { error: insertError } = await db.from("stats").insert({ id: "global", total_hands: count, total_agents: 0 });
    if (insertError) console.error("[DB] incrementGlobalHands insert error:", insertError.message);
  }
}

export async function incrementGlobalAgents(count = 1): Promise<void> {
  const db = getClient();
  if (!db) return;
  const { data, error: readError } = await db.from("stats").select("total_agents").eq("id", "global").single();
  if (readError) { console.error("[DB] incrementGlobalAgents read error:", readError.message); return; }
  if (data) {
    const { error } = await db.from("stats")
      .update({ total_agents: (data.total_agents as number) + count, updated_at: new Date().toISOString() })
      .eq("id", "global");
    if (error) console.error("[DB] incrementGlobalAgents write error:", error.message);
  } else {
    const { error } = await db.from("stats").insert({ id: "global", total_hands: 0, total_agents: count });
    if (error) console.error("[DB] incrementGlobalAgents insert error:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export async function saveBotTable(
  id:         string,
  name:       string,
  smallBlind: number,
  bigBlind:   number,
  maxPlayers: number,
): Promise<void> {
  const db = getClient();
  if (!db) return;
  const { error } = await db.from("tables").upsert(
    { id, name, small_blind: smallBlind, big_blind: bigBlind, max_players: maxPlayers, status: "active" },
    { onConflict: "id" },
  );
  if (error) console.error("[DB] saveBotTable error:", error.message, error.details, error.hint);
}

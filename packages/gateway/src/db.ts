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
  if (error) console.error("[db] saveAgent error:", error.message);
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
  if (error) console.error("[db] updateAgentStats error:", error.message);
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
  if (error) console.error("[db] saveHandResult error:", error.message);
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
  if (error) { console.error("[db] getLeaderboard error:", error.message); return null; }
  return data;
}

// ---------------------------------------------------------------------------
// Global stats
// ---------------------------------------------------------------------------

export async function getGlobalStats(): Promise<{ total_hands: number; total_agents: number } | null> {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db.from("stats").select("total_hands, total_agents").eq("id", "global").single();
  if (error) { console.error("[db] getGlobalStats error:", error.message); return null; }
  return data;
}

export async function incrementGlobalHands(count = 1): Promise<void> {
  const db = getClient();
  if (!db) return;
  const { error } = await db.rpc("increment_global_hands", { inc: count });
  if (error) {
    // rpc might not exist — fall back to a read-modify-write
    const { data } = await db.from("stats").select("total_hands").eq("id", "global").single();
    if (data) {
      await db.from("stats")
        .update({ total_hands: data.total_hands + count, updated_at: new Date().toISOString() })
        .eq("id", "global");
    }
  }
}

export async function incrementGlobalAgents(count = 1): Promise<void> {
  const db = getClient();
  if (!db) return;
  const { data } = await db.from("stats").select("total_agents").eq("id", "global").single();
  if (data) {
    await db.from("stats")
      .update({ total_agents: data.total_agents + count, updated_at: new Date().toISOString() })
      .eq("id", "global");
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
  if (error) console.error("[db] saveBotTable error:", error.message);
}

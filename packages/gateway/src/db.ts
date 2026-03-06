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
  if (!url || !key) {
    console.log("[DB] getClient: SUPABASE_URL or SUPABASE_ANON_KEY missing — DB disabled");
    return null;
  }
  console.log(`[DB] getClient: creating Supabase client (url length=${url.length}, key length=${key.length})`);
  _client = createClient(url, key);
  return _client;
}

export function isDbAvailable(): boolean {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_ANON_KEY"];
  console.log(`[DB] isDbAvailable: SUPABASE_URL=${url ? "SET" : "MISSING"}, SUPABASE_ANON_KEY=${key ? `SET(len=${key.length})` : "MISSING"}`);
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
  console.log(`[DB] saveAgent called: id=${id}, name=${name}, model=${model ?? "none"}`);
  const db = getClient();
  if (!db) { console.log("[DB] saveAgent: no DB client, skipping"); return; }
  const payload = { id, name, avatar, capabilities, model, last_seen: new Date().toISOString() };
  const { data, error } = await db.from("agents").upsert(payload, { onConflict: "id" }).select();
  console.log(`[DB] saveAgent result: data=${JSON.stringify(data)}, error=${JSON.stringify(error)}`);
  if (error) console.error("[DB] saveAgent error:", error.message, error.details, error.hint);
}

export async function updateAgentStats(
  id:          string,
  handsPlayed: number,
  handsWon:    number,
  elo:         number,
): Promise<void> {
  console.log(`[DB] updateAgentStats called: id=${id}, hands=${handsPlayed}, wins=${handsWon}, elo=${elo}`);
  const db = getClient();
  if (!db) { console.log("[DB] updateAgentStats: no DB client, skipping"); return; }
  const { data, error } = await db
    .from("agents")
    .update({ hands_played: handsPlayed, hands_won: handsWon, elo, last_seen: new Date().toISOString() })
    .eq("id", id)
    .select();
  console.log(`[DB] updateAgentStats result: data=${JSON.stringify(data)}, error=${JSON.stringify(error)}`);
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
  console.log(`[DB] saveHandResult called: tableId=${tableId}, handNumber=${handNumber}, winners=${winners.join(",")}, pot=${pot}`);
  const db = getClient();
  if (!db) { console.log("[DB] saveHandResult: no DB client, skipping"); return; }
  const { data, error } = await db.from("hands").insert({
    table_id:    tableId,
    hand_number: handNumber,
    winners,
    pot,
    players,
    created_at:  new Date().toISOString(),
  }).select();
  console.log(`[DB] saveHandResult result: data=${JSON.stringify(data)}, error=${JSON.stringify(error)}`);
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
  console.log(`[DB] getLeaderboard called: limit=${limit}`);
  const db = getClient();
  if (!db) { console.log("[DB] getLeaderboard: no DB client, returning null"); return null; }
  const { data, error } = await db
    .from("agents")
    .select("id, name, avatar, elo, hands_played, hands_won")
    .order("elo", { ascending: false })
    .limit(limit);
  console.log(`[DB] getLeaderboard result: rows=${data?.length ?? 0}, error=${JSON.stringify(error)}`);
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
  console.log(`[DB] incrementGlobalHands called: count=${count}`);
  const db = getClient();
  if (!db) { console.log("[DB] incrementGlobalHands: no DB client, skipping"); return; }

  // Try RPC first
  const { error: rpcError } = await db.rpc("increment_global_hands", { inc: count });
  if (!rpcError) {
    console.log(`[DB] incrementGlobalHands: RPC succeeded`);
    return;
  }
  console.log(`[DB] incrementGlobalHands: RPC failed (${rpcError.message}), falling back to read-modify-write`);

  // Fallback: read-modify-write
  const { data, error: readError } = await db.from("stats").select("total_hands").eq("id", "global").single();
  console.log(`[DB] incrementGlobalHands read: data=${JSON.stringify(data)}, error=${JSON.stringify(readError)}`);
  if (data) {
    const newVal = (data.total_hands as number) + count;
    const { error: writeError } = await db.from("stats")
      .update({ total_hands: newVal, updated_at: new Date().toISOString() })
      .eq("id", "global");
    console.log(`[DB] incrementGlobalHands write: newVal=${newVal}, error=${JSON.stringify(writeError)}`);
    if (writeError) console.error("[DB] incrementGlobalHands write error:", writeError.message, writeError.details, writeError.hint);
  } else {
    // Row doesn't exist — insert it
    console.log("[DB] incrementGlobalHands: stats row not found, inserting...");
    const { error: insertError } = await db.from("stats").insert({ id: "global", total_hands: count, total_agents: 0 });
    console.log(`[DB] incrementGlobalHands insert: error=${JSON.stringify(insertError)}`);
  }
}

export async function incrementGlobalAgents(count = 1): Promise<void> {
  console.log(`[DB] incrementGlobalAgents called: count=${count}`);
  const db = getClient();
  if (!db) { console.log("[DB] incrementGlobalAgents: no DB client, skipping"); return; }
  const { data, error: readError } = await db.from("stats").select("total_agents").eq("id", "global").single();
  console.log(`[DB] incrementGlobalAgents read: data=${JSON.stringify(data)}, error=${JSON.stringify(readError)}`);
  if (data) {
    const newVal = (data.total_agents as number) + count;
    const { error: writeError } = await db.from("stats")
      .update({ total_agents: newVal, updated_at: new Date().toISOString() })
      .eq("id", "global");
    console.log(`[DB] incrementGlobalAgents write: newVal=${newVal}, error=${JSON.stringify(writeError)}`);
    if (writeError) console.error("[DB] incrementGlobalAgents write error:", writeError.message, writeError.details, writeError.hint);
  } else {
    console.log("[DB] incrementGlobalAgents: stats row not found, inserting...");
    const { error: insertError } = await db.from("stats").insert({ id: "global", total_hands: 0, total_agents: count });
    console.log(`[DB] incrementGlobalAgents insert: error=${JSON.stringify(insertError)}`);
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
  console.log(`[DB] saveBotTable called: id=${id}, name=${name}`);
  const db = getClient();
  if (!db) { console.log("[DB] saveBotTable: no DB client, skipping"); return; }
  const { data, error } = await db.from("tables").upsert(
    { id, name, small_blind: smallBlind, big_blind: bigBlind, max_players: maxPlayers, status: "active" },
    { onConflict: "id" },
  ).select();
  console.log(`[DB] saveBotTable result: data=${JSON.stringify(data)}, error=${JSON.stringify(error)}`);
  if (error) console.error("[DB] saveBotTable error:", error.message, error.details, error.hint);
}

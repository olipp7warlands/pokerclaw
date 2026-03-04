/**
 * Agent Authentication — Express middleware + JWT utilities + rate limiting.
 *
 * JWT format: HS256 (HMAC-SHA256), signed with the gateway MASTER_KEY.
 * Rate limit: 60 requests / minute per agentId (in-memory, resets per window).
 */

import { createHmac } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { MASTER_KEY } from "./master-key.js";

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function toBase64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64url(str: string): Buffer {
  const padded  = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padding), "base64");
}

// ---------------------------------------------------------------------------
// JWT — HS256
// ---------------------------------------------------------------------------

interface JWTPayload {
  agentId: string;
  iat:     number;
  exp:     number;
}

// Pre-compute the fixed header segment.
const HEADER_SEGMENT = toBase64url(
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })),
);

function hmacSign(data: string): string {
  return toBase64url(createHmac("sha256", MASTER_KEY).update(data).digest());
}

/**
 * Generate a signed HS256 JWT for an agent.
 *
 * @param agentId        Agent identifier to embed in the token.
 * @param expiresInSecs  Token lifetime in seconds (default: 3600 = 1 h).
 */
export function generateToken(agentId: string, expiresInSecs = 3_600): string {
  const now     = Math.floor(Date.now() / 1_000);
  const payload = toBase64url(
    Buffer.from(JSON.stringify({ agentId, iat: now, exp: now + expiresInSecs })),
  );
  return `${HEADER_SEGMENT}.${payload}.${hmacSign(`${HEADER_SEGMENT}.${payload}`)}`;
}

/**
 * Verify a JWT.
 *
 * @returns The decoded payload, or `null` if the signature is invalid
 *          or the token has expired.
 */
export function verifyToken(token: string): JWTPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const header    = parts[0];
  const payload   = parts[1];
  const signature = parts[2];
  if (!header || !payload || !signature) return null;

  // Verify signature
  if (signature !== hmacSign(`${header}.${payload}`)) return null;

  // Decode payload
  let decoded: JWTPayload;
  try {
    decoded = JSON.parse(fromBase64url(payload).toString("utf-8")) as JWTPayload;
  } catch {
    return null;
  }

  // Check expiry
  if (decoded.exp < Math.floor(Date.now() / 1_000)) return null;

  return decoded;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

interface RateEntry {
  count:   number;
  resetAt: number; // epoch ms
}

const rateLimits = new Map<string, RateEntry>();

/**
 * Returns `true` if the agent is within the rate limit, `false` if exceeded.
 * Each window is 60 seconds; the counter resets at `resetAt`.
 */
export function checkRateLimit(agentId: string, maxPerMinute = 60): boolean {
  const now   = Date.now();
  const entry = rateLimits.get(agentId);

  if (!entry || now >= entry.resetAt) {
    rateLimits.set(agentId, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}

/** Remove the rate-limit counter for an agent (useful in tests). */
export function resetRateLimit(agentId: string): void {
  rateLimits.delete(agentId);
}

// ---------------------------------------------------------------------------
// Express type augmentation
// ---------------------------------------------------------------------------

declare module "express-serve-static-core" {
  interface Request {
    agentId?: string;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware that:
 *   1. Requires a valid `Authorization: Bearer <jwt>` header.
 *   2. Enforces 60 requests / minute per `agentId`.
 *   3. Injects `req.agentId` for downstream handlers.
 */
export function agentAuthMiddleware(
  req:  Request,
  res:  Response,
  next: NextFunction,
): void {
  const auth = req.headers["authorization"];

  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing Bearer token" });
    return;
  }

  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  if (!checkRateLimit(payload.agentId)) {
    res.status(429).json({ error: "Rate limit exceeded (60 req/min)" });
    return;
  }

  req.agentId = payload.agentId;
  next();
}

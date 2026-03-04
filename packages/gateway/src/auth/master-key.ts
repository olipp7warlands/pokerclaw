/**
 * Derives the gateway master key used for AES-256-GCM encryption.
 *
 * Source (in order of preference):
 *   1. GATEWAY_SECRET env var  — required in production
 *   2. crypto.randomBytes(32)  — ephemeral key, valid only for the current process
 *
 * SHA-256 normalises any input length to exactly 32 bytes for AES-256.
 */

import { createHash, randomBytes } from "node:crypto";

const raw: Buffer =
  process.env["GATEWAY_SECRET"] !== undefined
    ? Buffer.from(process.env["GATEWAY_SECRET"], "utf-8")
    : randomBytes(32);

export const MASTER_KEY: Buffer = createHash("sha256").update(raw).digest();

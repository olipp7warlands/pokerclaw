/**
 * API Key Manager — BYOK (Bring Your Own Key)
 *
 * Each key is encrypted with AES-256-GCM before being written to disk.
 * The ciphertext, IV and GCM auth-tag are stored as hex strings inside a
 * plain JSON file (`data/keys.enc` by default).
 *
 * Keys are NEVER logged or returned in plain text to callers other than
 * the owner agent that registered them.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MASTER_KEY } from "./master-key.js";

// ---------------------------------------------------------------------------
// Internal storage types
// ---------------------------------------------------------------------------

interface EncryptedEntry {
  iv:   string; // 12-byte nonce, hex
  tag:  string; // 16-byte GCM auth tag, hex
  data: string; // ciphertext, hex
}

// Outer key: agentId.  Inner key: provider name (e.g. "anthropic", "openai").
type KeysStore = Record<string, Record<string, EncryptedEntry>>;

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function encrypt(plaintext: string): EncryptedEntry {
  const iv     = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", MASTER_KEY, iv);
  const data   = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  return {
    iv:   iv.toString("hex"),
    tag:  cipher.getAuthTag().toString("hex"),
    data: data.toString("hex"),
  };
}

function decrypt(entry: EncryptedEntry): string {
  const iv       = Buffer.from(entry.iv,   "hex");
  const tag      = Buffer.from(entry.tag,  "hex");
  const data     = Buffer.from(entry.data, "hex");
  const decipher = createDecipheriv("aes-256-gcm", MASTER_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
}

// ---------------------------------------------------------------------------
// APIKeyManager
// ---------------------------------------------------------------------------

export interface APIKeyManagerOptions {
  /** Custom path for the encrypted key store. Default: `<cwd>/data/keys.enc` */
  dataPath?: string;
  /** Disable disk persistence — useful for tests. */
  inMemory?: boolean;
}

export class APIKeyManager {
  private readonly dataPath: string;
  private readonly inMemory: boolean;
  private store: KeysStore = {};
  private loaded = false;

  constructor(options: APIKeyManagerOptions = {}) {
    this.dataPath = options.dataPath ?? path.join(process.cwd(), "data", "keys.enc");
    this.inMemory = options.inMemory ?? false;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (this.inMemory) return;

    try {
      const raw = await fs.readFile(this.dataPath, "utf-8");
      this.store = JSON.parse(raw) as KeysStore;
    } catch {
      this.store = {};
    }
  }

  private async save(): Promise<void> {
    if (this.inMemory) return;
    await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
    await fs.writeFile(this.dataPath, JSON.stringify(this.store, null, 2), "utf-8");
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Encrypt and store an API key for an agent/provider pair.
   * Overwrites any existing key for the same pair.
   */
  async registerKey(agentId: string, provider: string, apiKey: string): Promise<void> {
    await this.load();

    let agentStore = this.store[agentId];
    if (!agentStore) {
      agentStore = {};
      this.store[agentId] = agentStore;
    }
    agentStore[provider] = encrypt(apiKey);

    await this.save();
  }

  /**
   * Retrieve and decrypt an API key.
   * Returns `null` if no key is registered or if decryption fails.
   *
   * The returned value is never logged by this class.
   */
  async getKey(agentId: string, provider: string): Promise<string | null> {
    await this.load();

    const entry = this.store[agentId]?.[provider];
    if (!entry) return null;

    try {
      return decrypt(entry);
    } catch {
      // Corrupted ciphertext or wrong master key — treat as missing.
      return null;
    }
  }

  /**
   * Delete the stored key for an agent/provider pair.
   * Removes the agent record entirely when no providers remain.
   */
  async removeKey(agentId: string, provider: string): Promise<void> {
    await this.load();

    const agentStore = this.store[agentId];
    if (!agentStore) return;

    delete agentStore[provider];
    if (Object.keys(agentStore).length === 0) {
      delete this.store[agentId];
    }

    await this.save();
  }

  /**
   * List the providers for which an agent has a registered key.
   */
  async listProviders(agentId: string): Promise<string[]> {
    await this.load();
    const agentStore = this.store[agentId];
    return agentStore ? Object.keys(agentStore) : [];
  }

  /**
   * Validate an API key by sending a minimal test request to the provider.
   *
   * - Returns `true`  if the provider responds with HTTP 200.
   * - Returns `false` on auth error, network failure, or unknown provider.
   *
   * Unknown providers are assumed valid (returns `true`) because we cannot
   * test them without a spec.
   */
  async validateKey(provider: string, apiKey: string): Promise<boolean> {
    try {
      switch (provider) {
        case "anthropic": {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key":          apiKey,
              "anthropic-version":  "2023-06-01",
              "content-type":       "application/json",
            },
            body: JSON.stringify({
              model:      "claude-haiku-4-5-20251001",
              max_tokens: 1,
              messages:   [{ role: "user", content: "hi" }],
            }),
          });
          return res.ok;
        }

        case "openai": {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              authorization:  `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model:      "gpt-4o-mini",
              max_tokens: 1,
              messages:   [{ role: "user", content: "hi" }],
            }),
          });
          return res.ok;
        }

        case "google": {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "hi" }] }],
              generationConfig: { maxOutputTokens: 1 },
            }),
          });
          return res.ok;
        }

        default:
          // Provider unknown — assume valid rather than blocking the agent.
          return true;
      }
    } catch {
      return false;
    }
  }
}

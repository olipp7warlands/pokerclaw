/**
 * Browser shim for Node.js "crypto" module.
 * Only exports what the engine actually uses.
 * Aliased in vite.config.ts so Vite resolves "crypto" to this file.
 */

export const randomUUID = (): `${string}-${string}-${string}-${string}-${string}` =>
  globalThis.crypto.randomUUID();

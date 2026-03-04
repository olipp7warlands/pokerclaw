/**
 * Provider registry — single point for looking up LLM providers at runtime.
 * Providers are registered lazily so the SDK is only imported if needed.
 */

import type { LLMProvider } from "./base-provider.js";

const _registry = new Map<string, LLMProvider>();

let _defaultsLoaded = false;

async function loadDefaults(): Promise<void> {
  if (_defaultsLoaded) return;
  _defaultsLoaded = true;

  const [{ AnthropicProvider }, { OpenAIProvider }] = await Promise.all([
    import("./anthropic.js"),
    import("./openai.js"),
  ]);

  if (!_registry.has("anthropic")) _registry.set("anthropic", new AnthropicProvider());
  if (!_registry.has("openai"))    _registry.set("openai",    new OpenAIProvider());
}

/** Returns the named provider, loading SDK defaults on first call. */
export async function getProvider(name: string): Promise<LLMProvider | undefined> {
  await loadDefaults();
  return _registry.get(name);
}

/** Override or add a provider (useful for tests). */
export function registerProvider(name: string, provider: LLMProvider): void {
  _registry.set(name, provider);
}

/** List all known provider names. */
export async function listRegisteredProviders(): Promise<string[]> {
  await loadDefaults();
  return [..._registry.keys()];
}

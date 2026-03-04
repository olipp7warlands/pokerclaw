/**
 * LLM Provider abstraction — all provider implementations satisfy this interface.
 */

export interface ChatMessage {
  role:    "system" | "user" | "assistant";
  content: string;
}

export interface ProviderResponse {
  content:      string;
  inputTokens:  number;
  outputTokens: number;
  model:        string;
}

export interface LLMProvider {
  readonly name: string;
  chat(
    messages:   ChatMessage[],
    maxTokens:  number,
    apiKey:     string,
    model:      string,
  ): Promise<ProviderResponse>;
}

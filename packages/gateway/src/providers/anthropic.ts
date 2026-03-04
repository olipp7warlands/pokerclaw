/**
 * Anthropic provider — wraps @anthropic-ai/sdk.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, ChatMessage, ProviderResponse } from "./base-provider.js";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  async chat(
    messages:  ChatMessage[],
    maxTokens: number,
    apiKey:    string,
    model:     string,
  ): Promise<ProviderResponse> {
    const client = new Anthropic({ apiKey });

    // Extract system turns (Anthropic keeps them in a top-level field).
    const systemParts = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content);

    const userAssistant = messages
      .filter((m): m is ChatMessage & { role: "user" | "assistant" } =>
        m.role === "user" || m.role === "assistant",
      )
      .map((m) => ({ role: m.role, content: m.content }));

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      messages:   userAssistant,
    };
    if (systemParts.length > 0) {
      params.system = systemParts.join("\n");
    }

    const resp = await client.messages.create(params);

    const content = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      content,
      inputTokens:  resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      model:        resp.model,
    };
  }
}

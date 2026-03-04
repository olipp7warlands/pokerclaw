/**
 * OpenAI provider — wraps the openai SDK.
 */

import OpenAI from "openai";
import type { LLMProvider, ChatMessage, ProviderResponse } from "./base-provider.js";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";

  async chat(
    messages:  ChatMessage[],
    maxTokens: number,
    apiKey:    string,
    model:     string,
  ): Promise<ProviderResponse> {
    const client = new OpenAI({ apiKey });

    const resp = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages:   messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const choice  = resp.choices[0];
    const content = choice?.message.content ?? "";

    return {
      content,
      inputTokens:  resp.usage?.prompt_tokens     ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
      model:        resp.model,
    };
  }
}

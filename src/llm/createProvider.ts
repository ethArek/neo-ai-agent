import type { AppConfig } from "../core/config";
import type { LlmProvider } from "./provider";
import { GeminiProvider } from "./geminiProvider";
import { OpenAiProvider } from "./openaiProvider";

export function createLlmProvider(config: AppConfig): LlmProvider | undefined {
  if (!config.llmProvider) {
    return undefined;
  }

  if (config.llmProvider === "openai") {
    return new OpenAiProvider(config);
  }

  return new GeminiProvider(config);
}

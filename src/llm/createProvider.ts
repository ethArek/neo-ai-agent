import type { AppConfig } from "../core/config";
import { GeminiProvider } from "./geminiProvider";
import { OpenAiProvider } from "./openaiProvider";
import type { LlmProvider } from "./provider";

export function createLlmProvider(config: AppConfig): LlmProvider | undefined {
  if (!config.llmProvider) {
    return undefined;
  }

  if (config.llmProvider === "openai") {
    return new OpenAiProvider(config);
  }

  return new GeminiProvider(config);
}

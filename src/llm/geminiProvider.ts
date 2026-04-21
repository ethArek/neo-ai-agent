import { GoogleGenAI } from "@google/genai";

import { buildPlannerSystemPrompt } from "../agent/systemPrompt";
import type { AppConfig } from "../core/config";
import { LlmPlanningError } from "../core/errors";
import type { LlmProvider, PlannerLlmRequest } from "./provider";

export class GeminiProvider implements LlmProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  public constructor(config: AppConfig) {
    if (!config.geminiApiKey) {
      throw new LlmPlanningError(
        "GEMINI_API_KEY is missing, so the Gemini planner cannot be created.",
      );
    }

    this.client = new GoogleGenAI({
      apiKey: config.geminiApiKey,
    });
    this.model = config.geminiModel;
  }

  public async plan(request: PlannerLlmRequest): Promise<string> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: request.message,
      config: {
        systemInstruction: buildPlannerSystemPrompt(
          request.tools,
          request.context,
        ),
      },
    });
    const output = response.text?.trim();

    if (!output) {
      throw new LlmPlanningError(
        "The Gemini planner returned an empty response.",
      );
    }

    return output;
  }
}

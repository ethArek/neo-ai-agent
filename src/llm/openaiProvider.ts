import OpenAI from "openai";

import type { AppConfig } from "../core/config";
import { LlmPlanningError } from "../core/errors";
import type { PlannerLlmRequest, LlmProvider } from "./provider";
import { buildPlannerSystemPrompt } from "../agent/systemPrompt";

export class OpenAiProvider implements LlmProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  public constructor(config: AppConfig) {
    if (!config.openAiApiKey) {
      throw new LlmPlanningError(
        "OPENAI_API_KEY is missing, so the OpenAI planner cannot be created.",
      );
    }

    this.client = new OpenAI({
      apiKey: config.openAiApiKey,
    });
    this.model = config.openAiModel;
  }

  public async plan(request: PlannerLlmRequest): Promise<string> {
    const response = await this.client.responses.create({
      model: this.model,
      instructions: buildPlannerSystemPrompt(request.tools, request.context),
      input: request.message,
    });
    const output = response.output_text?.trim();

    if (!output) {
      throw new LlmPlanningError(
        "The OpenAI planner returned an empty response.",
      );
    }

    return output;
  }
}

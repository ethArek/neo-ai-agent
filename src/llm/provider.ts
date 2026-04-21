import type { PlannerContext, PlannerToolDescriptor } from "../agent/types";

export interface PlannerLlmRequest {
  message: string;
  context: PlannerContext;
  tools: PlannerToolDescriptor[];
}

export interface LlmProvider {
  plan(request: PlannerLlmRequest): Promise<string>;
}

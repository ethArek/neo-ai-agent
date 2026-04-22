import type { PlannerExecutionPolicy, ToolName } from "./types";

const forceSwapPattern = /\bforce\b/i;

export function isExplicitForceSwapRequest(message: string): boolean {
  return forceSwapPattern.test(message);
}

export function createPlannerExecutionPolicy(
  tool: ToolName | null,
  message: string,
): PlannerExecutionPolicy | undefined {
  if (tool !== "swapNeoN3Token") {
    return undefined;
  }

  return {
    allowForceSwap: isExplicitForceSwapRequest(message),
  };
}

export function applyPlannerExecutionPolicy(input: {
  tool: ToolName;
  argumentsPayload: Record<string, unknown>;
  executionPolicy?: PlannerExecutionPolicy;
}): Record<string, unknown> {
  if (input.tool !== "swapNeoN3Token" || !input.executionPolicy) {
    return input.argumentsPayload;
  }

  return {
    ...input.argumentsPayload,
    force: input.executionPolicy.allowForceSwap,
  };
}

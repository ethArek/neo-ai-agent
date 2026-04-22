import { PlannerService } from "../agent/planner";
import { AgentRuntime } from "../agent/runtime";
import { SessionStore } from "../agent/sessionStore";
import { ToolRegistry } from "../agent/toolRegistry";
import type { AppConfig } from "../core/config";
import { createLlmProvider } from "../llm/createProvider";
import { createNeoProvider } from "../neo/client";

export interface AgentApp {
  registry: ToolRegistry;
  runtime: AgentRuntime;
}

export function createAgentApp(config: AppConfig): AgentApp {
  const registry = new ToolRegistry();
  const provider = createLlmProvider(config);
  const planner = new PlannerService({
    tools: registry.listPlannerTools(),
    provider,
  });
  const runtime = new AgentRuntime({
    planner,
    registry,
    neo: createNeoProvider(config),
    sessions: new SessionStore(),
  });

  return {
    registry,
    runtime,
  };
}

import { randomUUID } from "node:crypto";

import { ConfirmationRequiredError, ValidationError } from "../core/errors";
import type { PreparedTransaction } from "../neo/types";
import type {
  PendingToolAction,
  ToolExecutionOptions,
  ToolName,
} from "../agent/types";

export function createPendingTransactionAction(
  tool: ToolName,
  argumentsPayload: Record<string, unknown>,
  prepared: PreparedTransaction,
): PendingToolAction {
  return {
    id: randomUUID(),
    tool,
    arguments: argumentsPayload,
    prepared,
    createdAt: new Date().toISOString(),
  };
}

export function requirePreparedTransaction(
  options: ToolExecutionOptions | undefined,
  expectedTool: ToolName,
): PreparedTransaction {
  const pendingAction = options?.pendingAction;

  if (!pendingAction || pendingAction.tool !== expectedTool) {
    throw new ConfirmationRequiredError(
      `No prepared ${expectedTool} action is available to confirm. Prepare the action first.`,
    );
  }

  if (pendingAction.prepared.kind !== "transaction") {
    throw new ValidationError(
      "The pending action does not contain a transaction payload.",
    );
  }

  return pendingAction.prepared;
}

import type {
  ToolExecutionContext,
  ToolExecutionOptions,
  ToolExecutionResult,
  ToolName,
} from "../agent/types";
import { createBroadcastMessage } from "../neo/broadcast";
import type { BroadcastResult, PreparedTransaction } from "../neo/types";
import {
  createPendingTransactionAction,
  requirePreparedTransaction,
} from "./helpers";

export async function confirmPreparedTransaction(
  context: ToolExecutionContext,
  options: ToolExecutionOptions | undefined,
  expectedTool: ToolName,
  messagePrefix?: string,
): Promise<ToolExecutionResult<BroadcastResult>> {
  const prepared = requirePreparedTransaction(options, expectedTool);
  return broadcastPreparedTransaction(context, prepared, messagePrefix);
}

export async function broadcastPreparedTransaction(
  context: ToolExecutionContext,
  prepared: PreparedTransaction,
  messagePrefix?: string,
): Promise<ToolExecutionResult<BroadcastResult>> {
  const broadcast = await context.neo.signAndBroadcast(prepared);
  const message = messagePrefix
    ? `${messagePrefix} ${createBroadcastMessage(broadcast)}`
    : createBroadcastMessage(broadcast);

  return {
    message,
    data: broadcast,
    preparedTransaction: prepared,
  };
}

export function createPreparedTransactionResult(
  tool: ToolName,
  argumentsPayload: Record<string, unknown>,
  prepared: PreparedTransaction,
): ToolExecutionResult<PreparedTransaction> {
  return {
    message: `${prepared.summary} Reply with "Confirm" to sign and broadcast.`,
    data: prepared,
    requiresConfirmation: true,
    pendingAction: createPendingTransactionAction(
      tool,
      argumentsPayload,
      prepared,
    ),
  };
}

import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { hash256Schema } from "../core/validation";
import type { TransactionDetails } from "../neo/types";

const inputSchema = z.object({
  hash: hash256Schema,
});

type Input = z.infer<typeof inputSchema>;

export const getTransactionTool: ToolDefinition<Input, TransactionDetails> = {
  name: "getTransaction",
  description:
    "Fetch Neo N3 transaction details and application log by transaction hash.",
  argumentsDescription: '{ "hash": "transaction hash" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const details = await context.neo.getTransaction(parsed.hash);
    const vmState = extractVmState(details.applicationLog);
    const vmStateMessage = vmState ? ` VM state: ${vmState}.` : "";

    return {
      message: `Loaded Neo N3 transaction ${parsed.hash}.${vmStateMessage}`,
      data: details,
    };
  },
};

function extractVmState(
  applicationLog: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!applicationLog) {
    return undefined;
  }

  const executions = applicationLog.executions;

  if (!Array.isArray(executions) || executions.length === 0) {
    return undefined;
  }

  const firstExecution = executions[0];

  if (
    typeof firstExecution !== "object" ||
    firstExecution === null ||
    !("vmstate" in firstExecution) ||
    typeof firstExecution.vmstate !== "string"
  ) {
    return undefined;
  }

  return firstExecution.vmstate;
}

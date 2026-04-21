import { z } from "zod";

import { hash256Schema } from "../core/validation";
import type { ToolDefinition } from "../agent/types";

const inputSchema = z.object({
  hash: hash256Schema,
});

type Input = z.infer<typeof inputSchema>;

export const getTransactionTool: ToolDefinition<Input> = {
  name: "getTransaction",
  description:
    "Fetch Neo X transaction details and receipt by transaction hash.",
  argumentsDescription: '{ "hash": "32-byte transaction hash" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const details = await context.neo.getTransaction(parsed.hash);
    const receiptStatus =
      details.receipt &&
      typeof details.receipt.status !== "undefined" &&
      details.receipt.status !== null
        ? ` Receipt status: ${details.receipt.status}.`
        : "";

    return {
      message: `Loaded Neo X transaction ${parsed.hash}.${receiptStatus}`,
      data: details,
    };
  },
};

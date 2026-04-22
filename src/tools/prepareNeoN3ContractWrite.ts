import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { hash160Schema } from "../core/validation";
import {
  confirmPreparedTransaction,
  createPreparedTransactionResult,
} from "./confirmableTransaction";

const inputSchema = z.object({
  contractHash: hash160Schema,
  operation: z.string().trim().min(1, "operation is required."),
  args: z.array(z.unknown()).optional(),
  allowedContracts: z.array(hash160Schema).optional(),
});

type Input = z.infer<typeof inputSchema>;

export const prepareNeoN3ContractWriteTool: ToolDefinition<Input> = {
  name: "prepareNeoN3ContractWrite",
  description:
    "Prepare an unsigned Neo N3 contract write and require confirmation before broadcasting.",
  argumentsDescription:
    '{ "contractHash": "contract hash", "operation": "operation name", "args"?: [], "allowedContracts"?: ["contract hash"] }',
  readOnly: false,
  dangerous: true,
  schema: inputSchema,
  networks: ["neoN3"],
  async execute(input, context, options) {
    const parsed = inputSchema.parse(input);

    if (options?.confirm) {
      return confirmPreparedTransaction(
        context,
        options,
        "prepareNeoN3ContractWrite",
      );
    }

    const prepared = await context.neo.buildNeoN3ContractWrite(parsed);
    return createPreparedTransactionResult(
      "prepareNeoN3ContractWrite",
      parsed,
      prepared,
    );
  },
};

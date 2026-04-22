import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { hash160Schema } from "../core/validation";
import { createBroadcastMessage } from "../neo/broadcast";
import {
  createPendingTransactionAction,
  requirePreparedTransaction,
} from "./helpers";

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
      const prepared = requirePreparedTransaction(
        options,
        "prepareNeoN3ContractWrite",
      );
      const broadcast = await context.neo.signAndBroadcast(prepared);

      return {
        message: createBroadcastMessage(broadcast),
        data: broadcast,
      };
    }

    const prepared = await context.neo.buildNeoN3ContractWrite(parsed);
    const pendingAction = createPendingTransactionAction(
      "prepareNeoN3ContractWrite",
      parsed,
      prepared,
    );

    return {
      message: `${prepared.summary} Reply with "Confirm" to sign and broadcast.`,
      data: prepared,
      requiresConfirmation: true,
      pendingAction,
    };
  },
};

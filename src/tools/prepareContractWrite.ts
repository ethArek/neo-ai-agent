import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import {
  evmAddressSchema,
  positiveDecimalAmountSchema,
} from "../core/validation";
import { createBroadcastMessage } from "../neo/broadcast";
import {
  createPendingTransactionAction,
  requirePreparedTransaction,
} from "./helpers";

const inputSchema = z.object({
  contractAddress: evmAddressSchema,
  functionSignature: z.string().trim().min(1, "functionSignature is required."),
  args: z.array(z.unknown()).optional(),
  value: positiveDecimalAmountSchema.optional(),
});

type Input = z.infer<typeof inputSchema>;

export const prepareContractWriteTool: ToolDefinition<Input> = {
  name: "prepareContractWrite",
  description:
    "Prepare an unsigned Neo X contract write and require confirmation before broadcasting.",
  argumentsDescription:
    '{ "contractAddress": "contract address", "functionSignature": "function signature like approve(address,uint256)", "args"?: [], "value"?: "native GAS amount" }',
  readOnly: false,
  dangerous: true,
  schema: inputSchema,
  async execute(input, context, options) {
    const parsed = inputSchema.parse(input);

    if (options?.confirm) {
      const prepared = requirePreparedTransaction(
        options,
        "prepareContractWrite",
      );
      const broadcast = await context.neo.signAndBroadcast(prepared);

      return {
        message: createBroadcastMessage(broadcast),
        data: broadcast,
      };
    }

    const prepared = await context.neo.buildContractWrite(parsed);
    const pendingAction = createPendingTransactionAction(
      "prepareContractWrite",
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

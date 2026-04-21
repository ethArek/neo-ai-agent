import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { createBroadcastMessage } from "../neo/broadcast";
import {
  evmAddressSchema,
  positiveDecimalAmountSchema,
} from "../core/validation";
import {
  createPendingTransactionAction,
  requirePreparedTransaction,
} from "./helpers";

const inputSchema = z.object({
  to: evmAddressSchema,
  amount: positiveDecimalAmountSchema,
});

type Input = z.infer<typeof inputSchema>;

export const sendGasTool: ToolDefinition<Input> = {
  name: "sendGas",
  description:
    "Prepare and confirm a native GAS transfer from the loaded Neo X wallet.",
  argumentsDescription:
    '{ "to": "Neo X address", "amount": "decimal GAS amount" }',
  readOnly: false,
  dangerous: true,
  schema: inputSchema,
  async execute(input, context, options) {
    const parsed = inputSchema.parse(input);

    if (options?.confirm) {
      const prepared = requirePreparedTransaction(options, "sendGas");
      const broadcast = await context.neo.signAndBroadcast(prepared);

      return {
        message: createBroadcastMessage(broadcast),
        data: broadcast,
      };
    }

    const prepared = await context.neo.prepareGasTransfer(parsed);
    const pendingAction = createPendingTransactionAction(
      "sendGas",
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

import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { createBroadcastMessage } from "../neo/broadcast";
import { positiveDecimalAmountSchema } from "../core/validation";
import {
  createPendingTransactionAction,
  requirePreparedTransaction,
} from "./helpers";

const inputSchema = z.object({
  direction: z.enum(["neoN3ToNeoX", "neoXToNeoN3"]),
  amount: positiveDecimalAmountSchema,
  to: z.string().trim().min(1).optional(),
  maxFee: positiveDecimalAmountSchema.optional(),
});

type Input = z.infer<typeof inputSchema>;

export const bridgeGasTool: ToolDefinition<Input> = {
  name: "bridgeGas",
  description:
    "Prepare and confirm a GAS bridge transaction between Neo N3 and Neo X.",
  argumentsDescription:
    '{ "direction": "neoN3ToNeoX | neoXToNeoN3", "amount": "decimal GAS amount", "to": "optional destination address", "maxFee": "optional max bridge fee in GAS" }',
  readOnly: false,
  dangerous: true,
  schema: inputSchema,
  async execute(input, context, options) {
    const parsed = inputSchema.parse(input);

    if (options?.confirm) {
      const prepared = requirePreparedTransaction(options, "bridgeGas");
      const broadcast = await context.neo.signAndBroadcast(prepared);

      return {
        message: createBroadcastMessage(broadcast),
        data: broadcast,
      };
    }

    const prepared = await context.neo.prepareGasBridge(parsed);
    const pendingAction = createPendingTransactionAction(
      "bridgeGas",
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

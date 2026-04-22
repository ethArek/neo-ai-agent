import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import {
  neoN3AddressOrNeoNsSchema,
  positiveDecimalAmountSchema,
} from "../core/validation";
import { createBroadcastMessage } from "../neo/broadcast";
import {
  createPendingTransactionAction,
  requirePreparedTransaction,
} from "./helpers";

const inputSchema = z.object({
  to: neoN3AddressOrNeoNsSchema,
  amount: positiveDecimalAmountSchema,
});

type Input = z.infer<typeof inputSchema>;

export const sendNeoN3GasTool: ToolDefinition<Input> = {
  name: "sendNeoN3Gas",
  description:
    "Prepare and confirm a native GAS transfer from the loaded Neo N3 wallet, using a Neo N3 address or NeoNS name.",
  argumentsDescription:
    '{ "to": "Neo N3 address or NeoNS name", "amount": "decimal GAS amount" }',
  readOnly: false,
  dangerous: true,
  schema: inputSchema,
  networks: ["neoN3"],
  async execute(input, context, options) {
    const parsed = inputSchema.parse(input);

    if (options?.confirm) {
      const prepared = requirePreparedTransaction(options, "sendNeoN3Gas");
      const broadcast = await context.neo.signAndBroadcast(prepared);

      return {
        message: createBroadcastMessage(broadcast),
        data: broadcast,
      };
    }

    const prepared = await context.neo.prepareNeoN3GasTransfer(parsed);
    const pendingAction = createPendingTransactionAction(
      "sendNeoN3Gas",
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

import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { createBroadcastMessage } from "../neo/broadcast";
import {
  neoN3AddressOrNeoNsSchema,
  positiveDecimalAmountSchema,
} from "../core/validation";
import {
  createPendingTransactionAction,
  requirePreparedTransaction,
} from "./helpers";

const inputSchema = z.object({
  to: neoN3AddressOrNeoNsSchema,
  amount: positiveDecimalAmountSchema,
  token: z.string().trim().min(1, "Token symbol or contract hash is required."),
});

type Input = z.infer<typeof inputSchema>;

export const sendNeoN3TokenTool: ToolDefinition<Input> = {
  name: "sendNeoN3Token",
  description:
    "Prepare and confirm a Neo N3 NEP-17 transfer from the loaded Neo N3 wallet.",
  argumentsDescription:
    '{ "to": "Neo N3 address or NeoNS name", "amount": "decimal token amount", "token": "symbol or contract hash" }',
  readOnly: false,
  dangerous: true,
  schema: inputSchema,
  async execute(input, context, options) {
    const parsed = inputSchema.parse(input);

    if (options?.confirm) {
      const prepared = requirePreparedTransaction(options, "sendNeoN3Token");
      const broadcast = await context.neo.signAndBroadcast(prepared);

      return {
        message: createBroadcastMessage(broadcast),
        data: broadcast,
      };
    }

    const prepared = await context.neo.prepareNeoN3TokenTransfer(parsed);
    const pendingAction = createPendingTransactionAction(
      "sendNeoN3Token",
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

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
  token: z.string().trim().min(1, "Token symbol or address is required."),
});

type Input = z.infer<typeof inputSchema>;

export const sendErc20Tool: ToolDefinition<Input> = {
  name: "sendErc20",
  description:
    "Prepare and confirm an ERC-20 transfer from the loaded Neo X wallet.",
  argumentsDescription:
    '{ "to": "Neo X address", "amount": "decimal token amount", "token": "symbol or token address" }',
  readOnly: false,
  dangerous: true,
  schema: inputSchema,
  async execute(input, context, options) {
    const parsed = inputSchema.parse(input);

    if (options?.confirm) {
      const prepared = requirePreparedTransaction(options, "sendErc20");
      const broadcast = await context.neo.signAndBroadcast(prepared);

      return {
        message: createBroadcastMessage(broadcast),
        data: broadcast,
      };
    }

    const prepared = await context.neo.prepareErc20Transfer(parsed);
    const pendingAction = createPendingTransactionAction(
      "sendErc20",
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

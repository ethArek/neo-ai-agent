import type { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { createBroadcastMessage } from "../neo/broadcast";
import {
  createPendingTransactionAction,
  requirePreparedTransaction,
} from "./helpers";
import { erc20ApprovalInputSchema } from "./erc20Schemas";

const inputSchema = erc20ApprovalInputSchema;

type Input = z.infer<typeof inputSchema>;

export const approveErc20Tool: ToolDefinition<Input> = {
  name: "approveErc20",
  description: "Prepare and confirm an ERC-20 approval for a spender address.",
  argumentsDescription:
    '{ "token": "symbol or token address", "amount": "decimal token amount", "spender": "spender address" }',
  readOnly: false,
  dangerous: true,
  schema: inputSchema,
  async execute(input, context, options) {
    const parsed = inputSchema.parse(input);

    if (options?.confirm) {
      const prepared = requirePreparedTransaction(options, "approveErc20");
      const broadcast = await context.neo.signAndBroadcast(prepared);

      return {
        message: createBroadcastMessage(broadcast),
        data: broadcast,
      };
    }

    const prepared = await context.neo.prepareErc20Approval(parsed);
    const pendingAction = createPendingTransactionAction(
      "approveErc20",
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

import type { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { createBroadcastMessage } from "../neo/broadcast";
import {
  createPendingTransactionAction,
  requirePreparedTransaction,
} from "./helpers";
import { neoN3SwapInputSchema } from "./neoN3SwapSchemas";

type Input = z.infer<typeof neoN3SwapInputSchema>;

export const swapNeoN3TokenTool: ToolDefinition<Input> = {
  name: "swapNeoN3Token",
  description:
    "Prepare a Flamingo token swap on Neo N3 with best-route selection, slippage protection, and a deadline. When force is true, broadcast immediately instead of waiting for confirmation.",
  argumentsDescription:
    '{ "fromToken": "input token symbol or contract hash", "toToken": "output token symbol or contract hash", "amount": "decimal token amount", "slippagePercent"?: "optional percent like 1", "deadlineMinutes"?: 20, "force"?: true }',
  readOnly: false,
  dangerous: true,
  schema: neoN3SwapInputSchema,
  networks: ["neoN3"],
  async execute(input, context, options) {
    const parsed = neoN3SwapInputSchema.parse(input);

    if (options?.confirm) {
      const prepared = requirePreparedTransaction(options, "swapNeoN3Token");
      const broadcast = await context.neo.signAndBroadcast(prepared);

      return {
        message: createBroadcastMessage(broadcast),
        data: broadcast,
        preparedTransaction: prepared,
      };
    }

    if (parsed.force) {
      const prepared = await context.neo.prepareNeoN3TokenSwap(parsed);
      const broadcast = await context.neo.signAndBroadcast(prepared);

      return {
        message: `Force swap requested. ${createBroadcastMessage(broadcast)}`,
        data: broadcast,
        preparedTransaction: prepared,
      };
    }

    const prepared = await context.neo.prepareNeoN3TokenSwap(parsed);
    const pendingAction = createPendingTransactionAction(
      "swapNeoN3Token",
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

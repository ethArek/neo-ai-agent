import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { evmAddressSchema } from "../core/validation";

const inputSchema = z.object({
  address: evmAddressSchema,
  token: z.string().trim().min(1).optional(),
});

type Input = z.infer<typeof inputSchema>;

export const getTokenBalancesTool: ToolDefinition<Input> = {
  name: "getTokenBalances",
  description:
    "Fetch tracked ERC-20 balances for a Neo X address, or a specific token balance when token is provided.",
  argumentsDescription:
    '{ "address": "Neo X address", "token"?: "symbol or token address" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const balances = await context.neo.getTokenBalances(
      parsed.address,
      parsed.token,
    );
    const message =
      balances.length === 0
        ? `No tracked ERC-20 balances were found for ${parsed.address}.`
        : `Found ${balances.length} tracked ERC-20 balance${balances.length === 1 ? "" : "s"} for ${parsed.address}.`;

    return {
      message,
      data: balances,
    };
  },
};

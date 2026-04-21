import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { evmAddressSchema } from "../core/validation";

const inputSchema = z.object({
  address: evmAddressSchema,
});

type Input = z.infer<typeof inputSchema>;

export const getBalanceTool: ToolDefinition<Input> = {
  name: "getBalance",
  description: "Fetch the native GAS balance for a Neo X address.",
  argumentsDescription: '{ "address": "Neo X address" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const balance = await context.neo.getNativeBalance(parsed.address);

    return {
      message: `Native GAS balance for ${parsed.address}: ${balance.balance} ${balance.symbol}.`,
      data: balance,
    };
  },
};

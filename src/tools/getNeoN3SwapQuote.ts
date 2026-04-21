import type { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import type { NeoN3SwapQuote } from "../neo/types";
import { neoN3SwapInputSchema } from "./neoN3SwapSchemas";

type Input = z.infer<typeof neoN3SwapInputSchema>;

export const getNeoN3SwapQuoteTool: ToolDefinition<Input, NeoN3SwapQuote> = {
  name: "getNeoN3SwapQuote",
  description:
    "Estimate a Flamingo swap on Neo N3, including the best route, expected output, minimum received amount, slippage guard, and deadline.",
  argumentsDescription:
    '{ "fromToken": "input token symbol or contract hash", "toToken": "output token symbol or contract hash", "amount": "decimal token amount", "slippagePercent"?: "optional percent like 1", "deadlineMinutes"?: 20, "force"?: true }',
  readOnly: true,
  dangerous: false,
  schema: neoN3SwapInputSchema,
  networks: ["neoN3"],
  async execute(input, context) {
    const parsed = neoN3SwapInputSchema.parse(input);
    const quote = await context.neo.getNeoN3SwapQuote(parsed);

    return {
      message: `Loaded a Flamingo quote on Neo N3 for ${quote.amountIn} ${quote.fromToken.symbol} -> ${quote.toToken.symbol} via ${quote.routeSymbols.join(" -> ")}.`,
      data: quote,
    };
  },
};

import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import type { BridgeQuote } from "../neo/types";
import { positiveDecimalAmountSchema } from "../core/validation";

const inputSchema = z.object({
  direction: z.enum(["neoN3ToNeoX", "neoXToNeoN3"]),
  amount: positiveDecimalAmountSchema.optional(),
  to: z.string().trim().min(1).optional(),
  maxFee: positiveDecimalAmountSchema.optional(),
});

type Input = z.infer<typeof inputSchema>;

export const getGasBridgeQuoteTool: ToolDefinition<Input, BridgeQuote> = {
  name: "getGasBridgeQuote",
  description:
    "Estimate GAS bridge fee, limits, expected received amount, and heuristic ETA between Neo N3 and Neo X.",
  argumentsDescription:
    '{ "direction": "neoN3ToNeoX | neoXToNeoN3", "amount"?: "decimal GAS amount", "to"?: "optional destination address", "maxFee"?: "optional max bridge fee in GAS" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const quote = await context.neo.getGasBridgeQuote(parsed);
    const routeLabel =
      quote.direction === "neoXToNeoN3" ? "Neo X -> Neo N3" : "Neo N3 -> Neo X";

    return {
      message: quote.amount
        ? `Loaded a ${routeLabel} bridge quote for ${quote.amount} GAS.`
        : `Loaded current ${routeLabel} bridge parameters.`,
      data: quote,
    };
  },
};

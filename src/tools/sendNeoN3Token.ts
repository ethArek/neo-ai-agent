import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import {
  neoN3AddressOrNeoNsSchema,
  positiveDecimalAmountSchema,
} from "../core/validation";
import {
  confirmPreparedTransaction,
  createPreparedTransactionResult,
} from "./confirmableTransaction";

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
  networks: ["neoN3"],
  async execute(input, context, options) {
    const parsed = inputSchema.parse(input);

    if (options?.confirm) {
      return confirmPreparedTransaction(context, options, "sendNeoN3Token");
    }

    const prepared = await context.neo.prepareNeoN3TokenTransfer(parsed);
    return createPreparedTransactionResult("sendNeoN3Token", parsed, prepared);
  },
};

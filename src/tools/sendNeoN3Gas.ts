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
      return confirmPreparedTransaction(context, options, "sendNeoN3Gas");
    }

    const prepared = await context.neo.prepareNeoN3GasTransfer(parsed);
    return createPreparedTransactionResult("sendNeoN3Gas", parsed, prepared);
  },
};

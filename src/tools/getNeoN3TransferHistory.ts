import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { ValidationError } from "../core/errors";
import { neoN3AddressOrNeoNsSchema } from "../core/validation";
import type { NeoN3TransferHistory } from "../neo/types";

const inputSchema = z.object({
  address: neoN3AddressOrNeoNsSchema.optional(),
  token: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(20).default(5),
});

type Input = z.infer<typeof inputSchema>;

export const getNeoN3TransferHistoryTool: ToolDefinition<
  Input,
  NeoN3TransferHistory
> = {
  name: "getNeoN3TransferHistory",
  description:
    "Load recent Neo N3 NEP-17 transfer history for an address, with optional token filtering.",
  argumentsDescription:
    '{ "address"?: "Neo N3 address or NeoNS name", "token"?: "symbol or contract hash", "limit"?: number }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const address = parsed.address ?? context.neo.getNeoN3WalletAddress();

    if (!address) {
      throw new ValidationError(
        "Provide a Neo N3 address or set WALLET_WIF or WALLET_PRIVATE_KEY to load Neo N3 transfer history.",
      );
    }

    const history = await context.neo.getNeoN3TransferHistory({
      address,
      token: parsed.token,
      limit: parsed.limit,
    });

    return {
      message: parsed.token
        ? `Loaded ${history.count} Neo N3 transfer${history.count === 1 ? "" : "s"} for ${parsed.token} at ${history.address}.`
        : `Loaded ${history.count} recent Neo N3 transfer${history.count === 1 ? "" : "s"} for ${history.address}.`,
      data: history,
    };
  },
};

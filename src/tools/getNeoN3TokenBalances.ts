import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { ValidationError } from "../core/errors";
import { neoN3AddressOrNeoNsSchema } from "../core/validation";
import type { TokenBalance } from "../neo/types";

const inputSchema = z.object({
  address: neoN3AddressOrNeoNsSchema.optional(),
  token: z.string().trim().min(1).optional(),
});

type Input = z.infer<typeof inputSchema>;

export const getNeoN3TokenBalancesTool: ToolDefinition<Input, TokenBalance[]> =
  {
    name: "getNeoN3TokenBalances",
    description:
      "Fetch Neo N3 NEP-17 balances for a Neo N3 address, or a single token balance when token is provided.",
    argumentsDescription:
      '{ "address"?: "Neo N3 address or NeoNS name", "token"?: "symbol or contract hash" }',
    readOnly: true,
    dangerous: false,
    schema: inputSchema,
    async execute(input, context) {
      const parsed = inputSchema.parse(input);
      const address = parsed.address ?? context.neo.getNeoN3WalletAddress();

      if (!address) {
        throw new ValidationError(
          "Provide a Neo N3 address or set WALLET_WIF or WALLET_PRIVATE_KEY to load Neo N3 token balances.",
        );
      }

      const balances = await context.neo.getNeoN3TokenBalances(
        address,
        parsed.token,
      );
      const message =
        balances.length === 0
          ? parsed.token
            ? `No Neo N3 balance was found for ${parsed.token} at ${address}.`
            : `No Neo N3 token balances were found for ${address}.`
          : parsed.token
            ? `Loaded the Neo N3 balance for ${parsed.token} at ${address}.`
            : `Loaded ${balances.length} Neo N3 token balance${balances.length === 1 ? "" : "s"} for ${address}.`;

      return {
        message,
        data: balances,
      };
    },
  };

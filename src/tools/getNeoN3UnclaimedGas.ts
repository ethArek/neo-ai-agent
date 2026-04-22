import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { ValidationError } from "../core/errors";
import { neoN3AddressOrNeoNsSchema } from "../core/validation";
import type { NeoN3UnclaimedGas } from "../neo/types";

const inputSchema = z.object({
  address: neoN3AddressOrNeoNsSchema.optional(),
});

type Input = z.infer<typeof inputSchema>;

export const getNeoN3UnclaimedGasTool: ToolDefinition<
  Input,
  NeoN3UnclaimedGas
> = {
  name: "getNeoN3UnclaimedGas",
  networks: ["neoN3"],
  description: "Fetch the amount of unclaimed GAS for a Neo N3 address.",
  argumentsDescription: '{ "address"?: "Neo N3 address or NeoNS name" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const address = parsed.address ?? context.neo.getWalletAddress("neoN3");

    if (!address) {
      throw new ValidationError(
        "Provide a Neo N3 address or set WALLET_WIF or WALLET_PRIVATE_KEY to load Neo N3 unclaimed GAS.",
      );
    }

    const unclaimedGas = await context.neo.getNeoN3UnclaimedGas(address);

    return {
      message: `Loaded ${unclaimedGas.unclaimed} unclaimed GAS for ${unclaimedGas.address}.`,
      data: unclaimedGas,
    };
  },
};

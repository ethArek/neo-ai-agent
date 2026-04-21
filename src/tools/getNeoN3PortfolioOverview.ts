import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { ValidationError } from "../core/errors";
import { neoN3AddressOrNeoNsSchema } from "../core/validation";
import type { NeoN3PortfolioOverview } from "../neo/types";

const inputSchema = z.object({
  address: neoN3AddressOrNeoNsSchema.optional(),
});

type Input = z.infer<typeof inputSchema>;

export const getNeoN3PortfolioOverviewTool: ToolDefinition<
  Input,
  NeoN3PortfolioOverview
> = {
  name: "getNeoN3PortfolioOverview",
  networks: ["neoN3"],
  description:
    "Fetch a full Neo N3 portfolio overview including GAS, NEO, and tracked NEP-17 balances.",
  argumentsDescription: '{ "address"?: "Neo N3 address or NeoNS name" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const address = parsed.address ?? context.neo.getWalletAddress("neoN3");

    if (!address) {
      throw new ValidationError(
        "Provide a Neo N3 address or set WALLET_WIF or WALLET_PRIVATE_KEY to load a Neo N3 portfolio overview.",
      );
    }

    const overview = await context.neo.getNeoN3PortfolioOverview(address);
    const holdingCount = overview.tokenBalances.length + 2;

    return {
      message: `Loaded a Neo N3 portfolio overview for ${overview.address} with ${holdingCount} holding${holdingCount === 1 ? "" : "s"}.`,
      data: overview,
    };
  },
};

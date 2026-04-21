import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { ValidationError } from "../core/errors";
import {
  evmAddressSchema,
  neoN3AddressOrNeoNsSchema,
} from "../core/validation";
import type { PortfolioOverview } from "../neo/types";

const inputSchema = z.object({
  address: evmAddressSchema.optional(),
  neoN3Address: neoN3AddressOrNeoNsSchema.optional(),
});

type Input = z.infer<typeof inputSchema>;

export const getPortfolioOverviewTool: ToolDefinition<
  Input,
  PortfolioOverview
> = {
  name: "getPortfolioOverview",
  description:
    "Fetch a combined portfolio overview with Neo X balances and optional full Neo N3 balances.",
  argumentsDescription:
    '{ "address"?: "Neo X address", "neoN3Address"?: "Neo N3 address or NeoNS name" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const neoXAddress = parsed.address ?? context.session.neoXWalletAddress;
    const neoN3Address =
      parsed.neoN3Address ?? context.session.neoN3WalletAddress;
    const shouldLoadNeoX = Boolean(neoXAddress);
    const shouldLoadNeoN3 = Boolean(neoN3Address);

    if (!shouldLoadNeoX && !shouldLoadNeoN3) {
      throw new ValidationError(
        "Provide a Neo X address or a Neo N3 address, or configure a wallet to load a portfolio overview.",
      );
    }

    const [neoXPortfolio, neoN3Portfolio] = await Promise.all([
      shouldLoadNeoX
        ? Promise.all([
            context.neo.getNativeBalance(neoXAddress as string),
            context.neo.getTokenBalances(neoXAddress as string),
          ]).then(([nativeGas, tokenBalances]) => ({
            address: neoXAddress as string,
            nativeGas,
            tokenBalances,
          }))
        : undefined,
      shouldLoadNeoN3
        ? context.neo.getNeoN3PortfolioOverview(neoN3Address as string)
        : undefined,
    ]);
    const overview: PortfolioOverview = {};

    if (neoXPortfolio) {
      overview.neoX = neoXPortfolio;
    }

    if (neoN3Portfolio) {
      overview.neoN3 = neoN3Portfolio;
    }

    const neoXHoldingCount = neoXPortfolio
      ? neoXPortfolio.tokenBalances.length + 1
      : 0;
    const neoN3HoldingCount = neoN3Portfolio
      ? neoN3Portfolio.tokenBalances.length + 2
      : 0;
    const summaryParts = [
      neoXPortfolio
        ? `${neoXHoldingCount} Neo X holding${neoXHoldingCount === 1 ? "" : "s"}`
        : undefined,
      neoN3Portfolio
        ? `${neoN3HoldingCount} Neo N3 holding${neoN3HoldingCount === 1 ? "" : "s"}`
        : undefined,
    ].filter((part): part is string => Boolean(part));

    return {
      message: `Loaded a portfolio overview with ${summaryParts.join(" and ")}.`,
      data: overview,
    };
  },
};

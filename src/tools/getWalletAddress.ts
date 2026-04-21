import { z } from "zod";

import type { ToolDefinition } from "../agent/types";

const inputSchema = z.object({
  network: z.enum(["neoN3", "neoX"]).optional(),
});

type Input = z.infer<typeof inputSchema>;

export const getWalletAddressTool: ToolDefinition<Input> = {
  name: "getWalletAddress",
  description:
    "Show the loaded wallet addresses for Neo N3 and Neo X, defaulting to Neo N3 when available.",
  argumentsDescription: '{ "network"?: "neoN3 | neoX" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const neoXAddress = context.neo.walletEnabled()
      ? context.neo.getWalletAddress()
      : undefined;
    const neoN3Address = context.neo.neoN3WalletEnabled()
      ? context.neo.getNeoN3WalletAddress()
      : undefined;
    const preferredAddress =
      parsed.network === "neoX"
        ? neoXAddress
        : parsed.network === "neoN3"
          ? neoN3Address
          : (neoN3Address ?? neoXAddress);

    if (!preferredAddress) {
      const requestedNetworkLabel =
        parsed.network === "neoX"
          ? "Neo X"
          : parsed.network === "neoN3"
            ? "Neo N3"
            : undefined;

      return {
        message: requestedNetworkLabel
          ? `${requestedNetworkLabel} wallet address is not loaded. Add WALLET_WIF or WALLET_PRIVATE_KEY for Neo N3, or NEO_X_WALLET_PRIVATE_KEY for Neo X.`
          : "No wallet address is loaded. Add WALLET_WIF or WALLET_PRIVATE_KEY for Neo N3, or NEO_X_WALLET_PRIVATE_KEY for Neo X.",
        data: {
          address: undefined,
          neoXAddress,
          neoN3Address,
          primaryNetwork: undefined,
        },
      };
    }

    const primaryNetwork = preferredAddress === neoN3Address ? "neoN3" : "neoX";
    const explicitLabel =
      parsed.network === "neoX"
        ? "Neo X"
        : parsed.network === "neoN3"
          ? "Neo N3"
          : primaryNetwork === "neoN3"
            ? "Neo N3"
            : "Neo X";
    const secondaryMessage =
      neoN3Address && neoXAddress
        ? explicitLabel === "Neo N3"
          ? ` Neo X: ${neoXAddress}.`
          : ` Neo N3: ${neoN3Address}.`
        : "";

    return {
      message: `Loaded ${explicitLabel} wallet address: ${preferredAddress}.${secondaryMessage}`,
      data: {
        address: preferredAddress,
        neoXAddress,
        neoN3Address,
        primaryNetwork,
      },
    };
  },
};

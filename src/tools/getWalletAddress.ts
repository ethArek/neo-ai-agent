import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { neoNetworks, type NeoNetwork } from "../neo/types";

const inputSchema = z.object({
  network: z.enum(neoNetworks).optional(),
});

type Input = z.infer<typeof inputSchema>;

interface WalletAddressResult {
  address: string | null;
  network: NeoNetwork;
  implemented: boolean;
  walletEnabled: boolean;
}

export const getWalletAddressTool: ToolDefinition<Input, WalletAddressResult> =
  {
    name: "getWalletAddress",
    description:
      "Return the currently loaded wallet address for a requested Neo network, when that network is implemented.",
    argumentsDescription: '{ "network"?: "neoN3 | neoX" }',
    networks: ["neoN3"],
    readOnly: true,
    dangerous: false,
    schema: inputSchema,
    async execute(input, context) {
      const parsed = inputSchema.parse(input);
      const network = parsed.network ?? context.neo.getDefaultNetwork();
      const implemented = context.neo
        .getImplementedNetworks()
        .includes(network);
      const address = context.neo.getWalletAddress(network) ?? null;

      return {
        message: !implemented
          ? `Wallet support for ${formatNetworkLabel(network)} is planned but not implemented yet.`
          : address
            ? `Loaded ${formatNetworkLabel(network)} wallet address: ${address}.`
            : `No ${formatNetworkLabel(network)} wallet address is currently loaded.`,
        data: {
          address,
          network,
          implemented,
          walletEnabled: context.neo.walletEnabled(network),
        },
      };
    },
  };

function formatNetworkLabel(network: NeoNetwork): string {
  return network === "neoX" ? "Neo X" : "Neo N3";
}

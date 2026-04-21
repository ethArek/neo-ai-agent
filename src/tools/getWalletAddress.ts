import { z } from "zod";

import type { ToolDefinition } from "../agent/types";

const inputSchema = z.object({});

type Input = z.infer<typeof inputSchema>;

interface WalletAddressResult {
  address: string | null;
  network: "neoN3";
  walletEnabled: boolean;
}

export const getWalletAddressTool: ToolDefinition<Input, WalletAddressResult> =
  {
    name: "getWalletAddress",
    description: "Return the currently loaded Neo N3 wallet address, if any.",
    argumentsDescription: "{}",
    readOnly: true,
    dangerous: false,
    schema: inputSchema,
    async execute(input, context) {
      inputSchema.parse(input);
      const address = context.neo.getNeoN3WalletAddress() ?? null;

      return {
        message: address
          ? `Loaded Neo N3 wallet address: ${address}.`
          : "No Neo N3 wallet address is currently loaded.",
        data: {
          address,
          network: "neoN3",
          walletEnabled: context.neo.walletEnabled(),
        },
      };
    },
  };

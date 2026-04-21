import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { ValidationError } from "../core/errors";
import type { BridgeGasDirection, BridgeStatus } from "../neo/types";
import { hash256Schema, positiveDecimalAmountSchema } from "../core/validation";

const inputSchema = z.object({
  txHash: hash256Schema.optional(),
  direction: z.enum(["neoN3ToNeoX", "neoXToNeoN3"]).optional(),
  destinationAddress: z.string().trim().min(1).optional(),
  amount: positiveDecimalAmountSchema.optional(),
  maxFee: positiveDecimalAmountSchema.optional(),
});

type Input = z.infer<typeof inputSchema>;

function inferDirection(entry: {
  bridgeDirection?: BridgeGasDirection;
  network: "neoX" | "neoN3";
}): BridgeGasDirection {
  if (entry.bridgeDirection) {
    return entry.bridgeDirection;
  }

  return entry.network === "neoX" ? "neoXToNeoN3" : "neoN3ToNeoX";
}

export const getBridgeStatusTool: ToolDefinition<Input, BridgeStatus> = {
  name: "getBridgeStatus",
  description:
    "Track the last or specified GAS bridge transaction across source and destination networks.",
  argumentsDescription:
    '{ "txHash"?: "source transaction hash", "direction"?: "neoN3ToNeoX | neoXToNeoN3", "destinationAddress"?: "destination address", "amount"?: "bridged amount in GAS", "maxFee"?: "optional max bridge fee in GAS" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const recentBridge =
      context.session.recentBroadcasts.find(
        (entry) => entry.tool === "bridgeGas",
      ) ?? undefined;
    const matchingBridge = parsed.txHash
      ? context.session.recentBroadcasts.find(
          (entry) =>
            entry.tool === "bridgeGas" && entry.txHash === parsed.txHash,
        )
      : recentBridge;
    const txHash = parsed.txHash ?? matchingBridge?.txHash;
    const direction =
      parsed.direction ??
      (matchingBridge ? inferDirection(matchingBridge) : undefined);

    if (!txHash) {
      throw new ValidationError(
        "Provide a bridge txHash or run a bridge in this session before checking bridge status.",
      );
    }

    if (!direction) {
      throw new ValidationError(
        "Bridge direction is required when the transaction is not known in the current session.",
      );
    }

    const status = await context.neo.getBridgeStatus({
      txHash,
      direction,
      destinationAddress:
        parsed.destinationAddress ?? matchingBridge?.destinationAddress,
      amount: parsed.amount ?? matchingBridge?.amount,
      maxFee: parsed.maxFee ?? matchingBridge?.maxFee,
      createdAt: matchingBridge?.createdAt,
    });

    return {
      message: status.summary,
      data: status,
    };
  },
};

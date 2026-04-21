import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { ValidationError } from "../core/errors";
import type { BroadcastActivity, ToolExecutionResult } from "../agent/types";
import type { TransactionStatus } from "../neo/types";

const inputSchema = z.object({});

type Input = z.infer<typeof inputSchema>;

interface LastTransactionStatusResult {
  activity: BroadcastActivity;
  status: TransactionStatus;
}

export const getLastTransactionStatusTool: ToolDefinition<
  Input,
  LastTransactionStatusResult
> = {
  name: "getLastTransactionStatus",
  networks: ["neoN3"],
  description:
    "Fetch the current Neo N3 status for the most recent transaction broadcast in this session.",
  argumentsDescription: "{}",
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(
    input,
    context,
  ): Promise<ToolExecutionResult<LastTransactionStatusResult>> {
    inputSchema.parse(input);
    const activity = context.session.recentBroadcasts[0];

    if (!activity) {
      throw new ValidationError(
        "There is no Neo N3 transaction in this session history yet.",
      );
    }

    const status = await context.neo.getTransactionStatus({
      hash: activity.txHash,
      network: activity.network,
    });

    return {
      message: buildStatusMessage(status, activity),
      data: {
        activity,
        status,
      },
    };
  },
};

function buildStatusMessage(
  status: TransactionStatus,
  activity: BroadcastActivity,
): string {
  switch (status.status) {
    case "confirmed": {
      const blockSuffix =
        status.blockNumber !== undefined
          ? ` in block ${status.blockNumber}`
          : "";

      return `The latest Neo N3 transaction ${activity.txHash} is confirmed${blockSuffix}.`;
    }
    case "failed":
      return `The latest Neo N3 transaction ${activity.txHash} failed.`;
    case "pending":
      return `The latest Neo N3 transaction ${activity.txHash} is still pending.`;
    case "submitted":
      return `The latest Neo N3 transaction ${activity.txHash} was submitted and is waiting for confirmation.`;
    case "not_found":
      return `The latest Neo N3 transaction ${activity.txHash} is not visible on-chain yet.`;
    default:
      return `Loaded the latest Neo N3 transaction status for ${activity.txHash}.`;
  }
}

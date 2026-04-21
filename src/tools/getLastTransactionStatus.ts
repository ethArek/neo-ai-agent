import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import type { TransactionStatus } from "../neo/types";

const inputSchema = z.object({});

type Input = z.infer<typeof inputSchema>;

function buildStatusMessage(status: TransactionStatus): string {
  if (status.status === "confirmed") {
    return `The last transaction is confirmed on ${status.network}.`;
  }

  if (status.status === "failed") {
    return `The last transaction failed on ${status.network}.`;
  }

  if (status.status === "submitted") {
    return `The last transaction was submitted on ${status.network}, but the RPC has not indexed it yet.`;
  }

  if (status.status === "pending") {
    return `The last transaction is still pending on ${status.network}.`;
  }

  return `The last transaction could not be found on ${status.network}.`;
}

export const getLastTransactionStatusTool: ToolDefinition<
  Input,
  TransactionStatus | null
> = {
  name: "getLastTransactionStatus",
  description:
    "Check the status of the most recent broadcast transaction from the current session.",
  argumentsDescription: "{}",
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    inputSchema.parse(input);
    const lastBroadcast = context.session.recentBroadcasts[0];

    if (!lastBroadcast) {
      return {
        message: "No transaction has been broadcast in this session yet.",
        data: null,
      };
    }

    const status = await context.neo.getTransactionStatus({
      hash: lastBroadcast.txHash,
      network: lastBroadcast.network,
    });
    const normalizedStatus =
      status.status === "not_found"
        ? {
            ...status,
            status: "submitted" as const,
            summary: `${lastBroadcast.summary} The RPC has not indexed ${lastBroadcast.txHash} yet.`,
          }
        : status;

    return {
      message: `${buildStatusMessage(normalizedStatus)} Transaction hash: ${lastBroadcast.txHash}.`,
      data: normalizedStatus,
    };
  },
};

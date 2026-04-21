import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import type { TransactionStatusState } from "../neo/types";

const inputSchema = z.object({
  address: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(20).default(5),
});

interface RecentActionEntry {
  id: string;
  tool: string;
  txHash: string;
  network: "neoX" | "neoN3";
  sender: string;
  summary: string;
  createdAt: string;
  currentStatus: TransactionStatusState;
  statusSummary: string;
  lastCheckedAt: string;
  blockNumber?: number;
  to?: string;
  amount?: string;
  tokenSymbol?: string;
  toTokenSymbol?: string;
  amountOut?: string;
  minimumAmountOut?: string;
  slippagePercent?: string;
  routeSymbols?: string[];
  deadlineMinutes?: number;
  deadlineTimestamp?: number;
  destinationAddress?: string;
  bridgeDirection?: "neoN3ToNeoX" | "neoXToNeoN3";
  maxFee?: string;
  estimatedReceived?: string;
}

interface RecentActionsResult {
  count: number;
  actions: RecentActionEntry[];
}

type Input = z.infer<typeof inputSchema>;

function matchesAddress(
  address: string,
  entry: {
    sender: string;
    to?: string;
    destinationAddress?: string;
  },
): boolean {
  const normalizedAddress = address.toLowerCase();

  return (
    entry.sender.toLowerCase() === normalizedAddress ||
    entry.to?.toLowerCase() === normalizedAddress ||
    entry.destinationAddress?.toLowerCase() === normalizedAddress
  );
}

export const getRecentActionsTool: ToolDefinition<Input, RecentActionsResult> =
  {
    name: "getRecentActions",
    description:
      "List recent broadcast actions from the current session, with optional address filtering and fresh status checks.",
    argumentsDescription: '{ "address"?: "address filter", "limit"?: number }',
    readOnly: true,
    dangerous: false,
    schema: inputSchema,
    async execute(input, context) {
      const parsed = inputSchema.parse(input);
      const filteredActions = context.session.recentBroadcasts
        .filter((entry) =>
          parsed.address ? matchesAddress(parsed.address, entry) : true,
        )
        .slice(0, parsed.limit);

      if (filteredActions.length === 0) {
        return {
          message: parsed.address
            ? `No recent broadcast actions matched ${parsed.address} in this session.`
            : "No recent broadcast actions were found in this session.",
          data: {
            count: 0,
            actions: [],
          },
        };
      }

      const lastCheckedAt = new Date().toISOString();
      const actions = await Promise.all(
        filteredActions.map(async (entry) => {
          const status = await context.neo.getTransactionStatus({
            hash: entry.txHash,
            network: entry.network,
          });

          return {
            id: entry.id,
            tool: entry.tool,
            txHash: entry.txHash,
            network: entry.network,
            sender: entry.sender,
            summary: entry.summary,
            createdAt: entry.createdAt,
            currentStatus:
              status.status === "not_found" ? "submitted" : status.status,
            statusSummary:
              status.status === "not_found"
                ? `${entry.summary} The RPC has not indexed ${entry.txHash} yet.`
                : status.summary,
            blockNumber: status.blockNumber,
            to: entry.to,
            amount: entry.amount,
            tokenSymbol: entry.tokenSymbol,
            toTokenSymbol: entry.toTokenSymbol,
            amountOut: entry.amountOut,
            minimumAmountOut: entry.minimumAmountOut,
            slippagePercent: entry.slippagePercent,
            routeSymbols: entry.routeSymbols,
            deadlineMinutes: entry.deadlineMinutes,
            deadlineTimestamp: entry.deadlineTimestamp,
            destinationAddress: entry.destinationAddress,
            bridgeDirection: entry.bridgeDirection,
            maxFee: entry.maxFee,
            estimatedReceived: entry.estimatedReceived,
            lastCheckedAt,
          };
        }),
      );

      return {
        message: parsed.address
          ? `Loaded ${actions.length} recent broadcast action${actions.length === 1 ? "" : "s"} for ${parsed.address}.`
          : `Loaded ${actions.length} recent broadcast action${actions.length === 1 ? "" : "s"} from this session.`,
        data: {
          count: actions.length,
          actions,
        },
      };
    },
  };

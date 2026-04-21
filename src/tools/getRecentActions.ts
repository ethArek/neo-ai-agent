import { z } from "zod";

import type { BroadcastActivity, ToolDefinition } from "../agent/types";
import { neoN3AddressOrNeoNsSchema } from "../core/validation";
import type { TransactionStatus } from "../neo/types";

const inputSchema = z.object({
  address: neoN3AddressOrNeoNsSchema.optional(),
  limit: z.number().int().positive().max(20).optional(),
});

type Input = z.infer<typeof inputSchema>;

interface RecentActionRecord {
  activity: BroadcastActivity;
  status: TransactionStatus;
}

interface RecentActionsResult {
  count: number;
  actions: RecentActionRecord[];
}

export const getRecentActionsTool: ToolDefinition<Input, RecentActionsResult> =
  {
    name: "getRecentActions",
    description:
      "Return recent Neo N3 transaction broadcasts from the current session, optionally filtered by address.",
    argumentsDescription:
      '{ "address"?: "Neo N3 address or NeoNS name", "limit"?: 10 }',
    readOnly: true,
    dangerous: false,
    schema: inputSchema,
    async execute(input, context) {
      const parsed = inputSchema.parse(input);
      const filteredActivities = context.session.recentBroadcasts
        .filter((activity) => matchesAddress(activity, parsed.address))
        .slice(0, parsed.limit ?? 10);
      const actions = await Promise.all(
        filteredActivities.map(async (activity) => ({
          activity,
          status: await context.neo.getTransactionStatus(activity.txHash),
        })),
      );
      const filterMessage = parsed.address ? ` for ${parsed.address}` : "";

      return {
        message:
          actions.length === 0
            ? `No recent Neo N3 actions were found in this session${filterMessage}.`
            : `Loaded ${actions.length} recent Neo N3 action${actions.length === 1 ? "" : "s"} from this session${filterMessage}.`,
        data: {
          count: actions.length,
          actions,
        },
      };
    },
  };

function matchesAddress(
  activity: BroadcastActivity,
  address: string | undefined,
): boolean {
  if (!address) {
    return true;
  }

  const normalizedAddress = address.toLowerCase();

  return (
    activity.sender.toLowerCase() === normalizedAddress ||
    activity.to?.toLowerCase() === normalizedAddress
  );
}

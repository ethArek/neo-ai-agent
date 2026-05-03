import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { formatNetworkLabel } from "../core/formatting";
import { hash256Schema } from "../core/validation";
import { neoNetworks } from "../neo/types";

const inputSchema = z
  .object({
    height: z.number().int().nonnegative().optional(),
    hash: hash256Schema.optional(),
    network: z.enum(neoNetworks).optional(),
  })
  .superRefine((value, refinementContext) => {
    if (value.height === undefined && value.hash === undefined) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either a block height or block hash.",
      });
    }

    if (value.height !== undefined && value.hash !== undefined) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either a block height or block hash, not both.",
      });
    }
  });

type Input = z.infer<typeof inputSchema>;

export const getBlockTool: ToolDefinition<Input, unknown> = {
  name: "getBlock",
  networks: ["neoN3"],
  description: "Fetch Neo N3 block details by height or block hash.",
  argumentsDescription:
    '{ "height"?: 123456, "hash"?: "block hash", "network"?: "neoN3 | neoX" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const network = parsed.network ?? context.session.defaultNetwork;
    const reference = parsed.hash
      ? {
          hash: parsed.hash,
          network,
        }
      : {
          height: parsed.height,
          network,
        };
    const block = await context.neo.getBlock(reference);
    const label = parsed.hash
      ? `hash ${parsed.hash}`
      : `height ${parsed.height}`;

    return {
      message: `Loaded ${formatNetworkLabel(network)} block ${label}.`,
      data: block,
    };
  },
};

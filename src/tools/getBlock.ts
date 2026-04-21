import { z } from "zod";

import { hash256Schema } from "../core/validation";
import type { ToolDefinition } from "../agent/types";

const inputSchema = z
  .object({
    height: z.number().int().nonnegative().optional(),
    hash: hash256Schema.optional(),
  })
  .refine((value) => value.height !== undefined || value.hash !== undefined, {
    message: "Provide a block height or block hash.",
  });

type Input = z.infer<typeof inputSchema>;

export const getBlockTool: ToolDefinition<Input> = {
  name: "getBlock",
  description: "Fetch Neo X block details by height or block hash.",
  argumentsDescription: '{ "height"?: number, "hash"?: "32-byte block hash" }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const block = await context.neo.getBlock(parsed);
    const label =
      parsed.height !== undefined
        ? `height ${parsed.height}`
        : `hash ${parsed.hash}`;

    return {
      message: `Loaded block for ${label}.`,
      data: block,
    };
  },
};

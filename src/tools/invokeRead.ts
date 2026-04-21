import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { evmAddressSchema } from "../core/validation";

const inputSchema = z.object({
  contractAddress: evmAddressSchema,
  functionSignature: z.string().trim().min(1, "functionSignature is required."),
  args: z.array(z.unknown()).optional(),
});

type Input = z.infer<typeof inputSchema>;

export const invokeReadTool: ToolDefinition<Input> = {
  name: "invokeRead",
  description:
    "Invoke a read-only EVM contract function on Neo X and decode the response.",
  argumentsDescription:
    '{ "contractAddress": "contract address", "functionSignature": "function signature like balanceOf(address)", "args"?: [] }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const result = await context.neo.invokeRead(
      parsed.contractAddress,
      parsed.functionSignature,
      parsed.args,
    );

    return {
      message: `Invoked ${result.functionSignature} on ${parsed.contractAddress}.`,
      data: result,
    };
  },
};

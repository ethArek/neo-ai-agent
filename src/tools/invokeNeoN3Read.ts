import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import { hash160Schema } from "../core/validation";
import type { NeoN3ReadInvocationResult } from "../neo/types";

const inputSchema = z.object({
  contractHash: hash160Schema,
  operation: z.string().trim().min(1, "operation is required."),
  args: z.array(z.unknown()).optional(),
});

type Input = z.infer<typeof inputSchema>;

export const invokeNeoN3ReadTool: ToolDefinition<
  Input,
  NeoN3ReadInvocationResult
> = {
  name: "invokeNeoN3Read",
  description:
    "Invoke a read-only Neo N3 contract operation and decode the VM stack result.",
  argumentsDescription:
    '{ "contractHash": "contract hash", "operation": "operation name", "args"?: [] }',
  readOnly: true,
  dangerous: false,
  schema: inputSchema,
  networks: ["neoN3"],
  async execute(input, context) {
    const parsed = inputSchema.parse(input);
    const result = await context.neo.invokeNeoN3Read(
      parsed.contractHash,
      parsed.operation,
      parsed.args,
    );

    return {
      message: `Invoked Neo N3 operation ${result.operation} on ${result.contractHash}.`,
      data: result,
    };
  },
};

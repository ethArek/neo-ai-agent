import { z } from "zod";

import { positiveDecimalAmountSchema } from "../core/validation";

export const neoN3SwapInputSchema = z.object({
  fromToken: z
    .string()
    .trim()
    .min(1, "Input token symbol or contract hash is required."),
  toToken: z
    .string()
    .trim()
    .min(1, "Output token symbol or contract hash is required."),
  amount: positiveDecimalAmountSchema,
  slippagePercent: positiveDecimalAmountSchema.optional(),
  deadlineMinutes: z.number().int().positive().max(1_440).optional(),
  force: z.boolean().optional(),
});

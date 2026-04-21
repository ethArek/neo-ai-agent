import { z } from "zod";

import {
  evmAddressSchema,
  positiveDecimalAmountSchema,
} from "../core/validation";

export const erc20ApprovalInputSchema = z.object({
  token: z.string().trim().min(1, "token is required."),
  amount: positiveDecimalAmountSchema,
  spender: evmAddressSchema,
});

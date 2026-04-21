import type { z } from "zod";

import type {
  BroadcastResult,
  PreparedTransaction,
  TransactionStatusState,
} from "../neo/types";
import type { NeoProvider } from "../neo/types";

export const toolNames = [
  "getBalance",
  "getNeoN3PortfolioOverview",
  "getNeoN3TokenBalances",
  "getNeoN3TransferHistory",
  "getGasBridgeQuote",
  "getBridgeStatus",
  "getNeoN3SwapQuote",
  "getPortfolioOverview",
  "getTokenBalances",
  "getTransaction",
  "getLastTransactionStatus",
  "getRecentActions",
  "getBlock",
  "invokeRead",
  "invokeNeoN3Read",
  "prepareContractWrite",
  "prepareNeoN3ContractWrite",
  "getWalletAddress",
  "bridgeGas",
  "sendGas",
  "sendNeoN3Gas",
  "sendNeoN3Token",
  "swapNeoN3Token",
  "sendErc20",
  "approveErc20",
] as const;

export type ToolName = (typeof toolNames)[number];

export interface PendingToolAction {
  id: string;
  tool: ToolName;
  arguments: Record<string, unknown>;
  prepared: PreparedTransaction;
  createdAt: string;
}

export interface DraftToolAction {
  tool: ToolName;
  arguments: Record<string, unknown>;
  missingInputs: string[];
  createdAt: string;
}

export interface BroadcastActivity {
  id: string;
  tool: ToolName;
  arguments: Record<string, unknown>;
  txHash: string;
  network: BroadcastResult["network"];
  sender: string;
  summary: string;
  createdAt: string;
  status: TransactionStatusState;
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
  minimumAmount?: string;
  maximumAmount?: string;
  bridgeEtaLowMinutes?: number;
  bridgeEtaHighMinutes?: number;
}

export interface ToolSessionContext {
  id: string;
  walletAddress?: string;
  neoXWalletAddress?: string;
  neoN3WalletAddress?: string;
  lastReferencedAddress?: string;
  recentBroadcasts: BroadcastActivity[];
}

export interface ToolExecutionContext {
  neo: NeoProvider;
  session: ToolSessionContext;
}

export interface ToolExecutionOptions {
  confirm?: boolean;
  pendingAction?: PendingToolAction;
}

export interface ToolExecutionResult<TResult = unknown> {
  message: string;
  data: TResult;
  requiresConfirmation?: boolean;
  pendingAction?: PendingToolAction;
}

export interface PlannerToolDescriptor {
  name: ToolName;
  description: string;
  argumentsDescription: string;
  readOnly: boolean;
  dangerous: boolean;
}

export interface ToolDefinition<
  TInput = unknown,
  TResult = unknown,
> extends PlannerToolDescriptor {
  schema: z.ZodType<TInput>;
  execute(
    input: TInput,
    context: ToolExecutionContext,
    options?: ToolExecutionOptions,
  ): Promise<ToolExecutionResult<TResult>>;
}

export interface PlannerAction {
  intent: string;
  tool: ToolName | null;
  arguments: Record<string, unknown>;
  needsConfirmation: boolean;
  missingInputs: string[];
  explanation?: string;
}

export interface PlannerContext {
  walletEnabled: boolean;
  pendingAction?: PendingToolAction;
  draftAction?: DraftToolAction;
  walletAddress?: string;
  neoXWalletAddress?: string;
  neoN3WalletAddress?: string;
  lastReferencedAddress?: string;
}

export interface AgentResponse {
  sessionId: string;
  message: string;
  tool: ToolName | null;
  arguments: Record<string, unknown>;
  result: unknown;
  requiresConfirmation: boolean;
}

export interface ExecuteToolRequest {
  tool: ToolName;
  arguments: Record<string, unknown>;
  sessionId?: string;
  confirm?: boolean;
}

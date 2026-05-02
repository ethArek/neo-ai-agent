import type { z } from "zod";
import type {
  BroadcastResult,
  NeoNetwork,
  NeoProvider,
  NetworkAddressMap,
  PreparedTransaction,
  TransactionStatusState,
} from "../neo/types";

export const toolNames = [
  "getNeoN3PortfolioOverview",
  "getNeoN3TokenBalances",
  "getNeoN3UnclaimedGas",
  "getNeoN3TransferHistory",
  "getNeoN3SwapQuote",
  "getTransaction",
  "getLastTransactionStatus",
  "getRecentActions",
  "getBlock",
  "invokeNeoN3Read",
  "prepareNeoN3ContractWrite",
  "getWalletAddress",
  "sendNeoN3Gas",
  "sendNeoN3Token",
  "swapNeoN3Token",
  "neox_get_chain_info",
  "neox_get_native_balance",
  "neox_get_block",
  "neox_get_transaction",
  "neox_get_transaction_receipt",
  "neox_call_contract",
  "neox_get_erc20_balance",
  "neox_get_erc20_metadata",
  "neox_get_erc721_owner",
  "neox_prepare_native_transfer",
  "neox_prepare_erc20_transfer",
  "neox_prepare_contract_write",
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
  executionPolicy?: PlannerExecutionPolicy;
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
}

export interface ToolSessionContext {
  id: string;
  defaultNetwork: NeoNetwork;
  implementedNetworks: NeoNetwork[];
  walletAddress?: string;
  walletAddresses: NetworkAddressMap;
  lastReferencedAddress?: string;
  lastReferencedAddresses: NetworkAddressMap;
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
  preparedTransaction?: PreparedTransaction;
}

export interface PlannerToolDescriptor {
  name: ToolName;
  networks: NeoNetwork[];
  description: string;
  argumentsDescription: string;
  readOnly: boolean;
  dangerous: boolean;
}

export interface ToolDefinition<TInput = unknown, TResult = unknown>
  extends PlannerToolDescriptor {
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
  executionPolicy?: PlannerExecutionPolicy;
  explanation?: string;
}

export interface PlannerExecutionPolicy {
  allowForceSwap: boolean;
}

export interface PlannerContext {
  defaultNetwork: NeoNetwork;
  implementedNetworks: NeoNetwork[];
  walletEnabled: boolean;
  pendingAction?: PendingToolAction;
  draftAction?: DraftToolAction;
  walletAddress?: string;
  walletAddresses: NetworkAddressMap;
  lastReferencedAddress?: string;
  lastReferencedAddresses: NetworkAddressMap;
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

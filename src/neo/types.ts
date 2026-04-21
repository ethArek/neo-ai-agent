export interface TokenMetadata {
  contractAddress: string;
  symbol: string;
  decimals: number;
  name?: string;
  isNative?: boolean;
}

export interface TokenBalance extends TokenMetadata {
  owner: string;
  rawBalance: string;
  balance: string;
}

export interface ReadInvocationResult {
  contractAddress: string;
  functionSignature: string;
  args: unknown[];
  rawResult: string;
  result: unknown;
}

export interface NeoN3ReadInvocationResult {
  contractHash: string;
  operation: string;
  args: unknown[];
  rawResult: Record<string, unknown>;
  result: unknown;
}

export interface TransactionDetails {
  transaction: Record<string, unknown>;
  receipt?: Record<string, unknown> | null;
}

export type TransactionStatusState =
  | "submitted"
  | "pending"
  | "confirmed"
  | "failed"
  | "not_found";

export interface TransactionStatus {
  hash: string;
  network: "neoX" | "neoN3";
  status: TransactionStatusState;
  summary: string;
  blockNumber?: number;
  transaction?: Record<string, unknown> | null;
  receipt?: Record<string, unknown> | null;
  applicationLog?: Record<string, unknown> | null;
}

export interface BlockReference {
  height?: number;
  hash?: string;
}

export type BridgeGasDirection = "neoN3ToNeoX" | "neoXToNeoN3";

export interface BridgeQuote {
  direction: BridgeGasDirection;
  sourceNetwork: "neoX" | "neoN3";
  destinationNetwork: "neoX" | "neoN3";
  amount?: string;
  destinationAddress?: string;
  currentFee: string;
  effectiveMaxFee: string;
  minimumAmount?: string;
  maximumAmount?: string;
  estimatedReceived?: string;
  paused?: boolean;
  etaLowMinutes: number;
  etaHighMinutes: number;
  notes: string[];
}

export interface BridgeArrivalStatus {
  status: "unknown" | "pending" | "arrived";
  summary: string;
  detectionMethod:
    | "neoN3_transfer_history"
    | "neoX_balance_heuristic"
    | "unavailable";
  confidence: "low" | "medium" | "high";
  matchedTxHash?: string;
  matchedAmount?: string;
}

export interface BridgeStatus {
  txHash: string;
  direction: BridgeGasDirection;
  sourceNetwork: "neoX" | "neoN3";
  destinationNetwork: "neoX" | "neoN3";
  sourceStatus: TransactionStatus;
  destinationAddress?: string;
  amount?: string;
  currentFee?: string;
  effectiveMaxFee?: string;
  minimumAmount?: string;
  maximumAmount?: string;
  estimatedReceived?: string;
  etaLowMinutes: number;
  etaHighMinutes: number;
  arrival: BridgeArrivalStatus;
  summary: string;
}

export interface NeoN3SwapQuoteInput {
  fromToken: string;
  toToken: string;
  amount: string;
  slippagePercent?: string;
  deadlineMinutes?: number;
  force?: boolean;
}

export interface NeoN3SwapQuote {
  dex: "Flamingo";
  routerContract: string;
  brokerContract?: string;
  fromToken: TokenMetadata;
  toToken: TokenMetadata;
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  slippagePercent: string;
  slippageBps: number;
  routeSymbols: string[];
  routeContracts: string[];
  tradingPairIds?: number[];
  routeAmounts: string[];
  deadlineMinutes: number;
  deadlineTimestamp: number;
  deadlineIso: string;
  notes: string[];
}

export interface PreparedTransactionRequest {
  to: string;
  nonce: number;
  chainId: number;
  gasLimit: string;
  data?: string;
  value?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface GasBridgeInput {
  direction: BridgeGasDirection;
  amount: string;
  to?: string;
  maxFee?: string;
}

export interface GasBridgeQuoteInput {
  direction: BridgeGasDirection;
  amount?: string;
  to?: string;
  maxFee?: string;
}

export interface PreparedTransaction {
  kind: "transaction";
  action:
    | "sendGas"
    | "sendNeoN3Gas"
    | "sendNeoN3Token"
    | "swapNeoN3Token"
    | "sendErc20"
    | "approveErc20"
    | "prepareContractWrite"
    | "prepareNeoN3ContractWrite"
    | "bridgeGas";
  summary: string;
  unsignedTransaction: string;
  network?: "neoX" | "neoN3";
  sender: string;
  chainId?: number;
  networkMagic?: number;
  nonce?: number;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  to?: string;
  value?: string;
  data?: string;
  amount?: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  spender?: string;
  contractAddress?: string;
  functionSignature?: string;
  operation?: string;
  toTokenAddress?: string;
  toTokenSymbol?: string;
  amountOut?: string;
  minimumAmountOut?: string;
  slippagePercent?: string;
  routeSymbols?: string[];
  routeContracts?: string[];
  tradingPairIds?: number[];
  deadlineMinutes?: number;
  deadlineTimestamp?: number;
  bridgeDirection?: BridgeGasDirection;
  destinationAddress?: string;
  maxFee?: string;
  estimatedReceived?: string;
  minimumAmount?: string;
  maximumAmount?: string;
  bridgeEtaLowMinutes?: number;
  bridgeEtaHighMinutes?: number;
  bridgeContractAddress?: string;
  allowedContracts?: string[];
  request?: PreparedTransactionRequest;
}

export interface BroadcastResult {
  txHash: string;
  sender: string;
  summary: string;
  network: "neoX" | "neoN3";
}

export interface ContractWriteInput {
  contractAddress: string;
  functionSignature: string;
  args?: unknown[];
  value?: string;
}

export interface NeoN3PortfolioOverview {
  address: string;
  gasBalance: TokenBalance;
  neoBalance: TokenBalance;
  tokenBalances: TokenBalance[];
}

export interface PortfolioOverview {
  neoX?: {
    address: string;
    nativeGas: TokenBalance;
    tokenBalances: TokenBalance[];
  };
  neoN3?: NeoN3PortfolioOverview;
}

export interface Erc20TransferInput {
  to: string;
  amount: string;
  token: string;
}

export interface Erc20ApprovalInput {
  token: string;
  amount: string;
  spender: string;
}

export interface NeoN3TokenTransferInput {
  to: string;
  amount: string;
  token: string;
}

export interface NeoN3TokenSwapInput extends NeoN3SwapQuoteInput {}

export interface NeoN3ContractWriteInput {
  contractHash: string;
  operation: string;
  args?: unknown[];
  allowedContracts?: string[];
}

export interface NeoN3TransferHistoryEntry {
  direction: "sent" | "received";
  txHash: string;
  blockIndex: number;
  timestamp: number;
  counterparty: string;
  amount: string;
  token: TokenMetadata;
}

export interface NeoN3TransferHistory {
  address: string;
  count: number;
  transfers: NeoN3TransferHistoryEntry[];
}

export interface NeoProvider {
  validateAddress(address: string): Promise<boolean>;
  getTokenBalances(address: string, token?: string): Promise<TokenBalance[]>;
  getNativeBalance(address: string): Promise<TokenBalance>;
  getNeoN3GasBalance(address: string): Promise<TokenBalance>;
  getNeoN3TokenBalances(
    address: string,
    token?: string,
  ): Promise<TokenBalance[]>;
  getNeoN3PortfolioOverview(address: string): Promise<NeoN3PortfolioOverview>;
  getNeoN3TransferHistory(input: {
    address: string;
    token?: string;
    limit?: number;
  }): Promise<NeoN3TransferHistory>;
  getTransaction(hash: string): Promise<TransactionDetails>;
  getTransactionStatus(input: {
    hash: string;
    network: "neoX" | "neoN3";
  }): Promise<TransactionStatus>;
  getBlock(reference: BlockReference): Promise<unknown>;
  invokeRead(
    contractAddress: string,
    functionSignature: string,
    args?: unknown[],
  ): Promise<ReadInvocationResult>;
  resolveTokenMetadata(token: string): Promise<TokenMetadata>;
  resolveNeoN3TokenMetadata(token: string): Promise<TokenMetadata>;
  invokeNeoN3Read(
    contractHash: string,
    operation: string,
    args?: unknown[],
  ): Promise<NeoN3ReadInvocationResult>;
  buildContractWrite(input: ContractWriteInput): Promise<PreparedTransaction>;
  buildNeoN3ContractWrite(
    input: NeoN3ContractWriteInput,
  ): Promise<PreparedTransaction>;
  getGasBridgeQuote(input: GasBridgeQuoteInput): Promise<BridgeQuote>;
  getBridgeStatus(input: {
    txHash: string;
    direction: BridgeGasDirection;
    destinationAddress?: string;
    amount?: string;
    maxFee?: string;
    createdAt?: string;
  }): Promise<BridgeStatus>;
  getNeoN3SwapQuote(input: NeoN3SwapQuoteInput): Promise<NeoN3SwapQuote>;
  prepareGasBridge(input: GasBridgeInput): Promise<PreparedTransaction>;
  prepareGasTransfer(input: {
    to: string;
    amount: string;
  }): Promise<PreparedTransaction>;
  prepareNeoN3GasTransfer(input: {
    to: string;
    amount: string;
  }): Promise<PreparedTransaction>;
  prepareNeoN3TokenTransfer(
    input: NeoN3TokenTransferInput,
  ): Promise<PreparedTransaction>;
  prepareNeoN3TokenSwap(
    input: NeoN3TokenSwapInput,
  ): Promise<PreparedTransaction>;
  prepareErc20Transfer(input: Erc20TransferInput): Promise<PreparedTransaction>;
  prepareErc20Approval(input: Erc20ApprovalInput): Promise<PreparedTransaction>;
  signAndBroadcast(prepared: PreparedTransaction): Promise<BroadcastResult>;
  getWalletAddress(): string;
  getNeoN3WalletAddress(): string | undefined;
  walletEnabled(): boolean;
  neoN3WalletEnabled(): boolean;
}

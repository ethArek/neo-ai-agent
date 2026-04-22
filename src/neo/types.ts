export const neoNetworks = ["neoN3", "neoX"] as const;

export type NeoNetwork = (typeof neoNetworks)[number];

export type NetworkAddressMap = Partial<Record<NeoNetwork, string>>;

export interface ProviderReadiness {
  network: NeoNetwork;
  configuredNetwork: string;
  rpcUrl: string;
  rpcReachable: boolean;
  networkMagic?: number;
  networkMatchesConfiguration: boolean;
  walletEnabled: boolean;
  walletAddress?: string;
}

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

export interface NeoN3ReadInvocationResult {
  contractHash: string;
  operation: string;
  args: unknown[];
  rawResult: Record<string, unknown>;
  result: unknown;
}

export interface TransactionDetails {
  transaction: Record<string, unknown>;
  applicationLog?: Record<string, unknown> | null;
}

export type TransactionStatusState =
  | "submitted"
  | "pending"
  | "confirmed"
  | "failed"
  | "not_found";

export interface TransactionStatus {
  hash: string;
  network: NeoNetwork;
  status: TransactionStatusState;
  summary: string;
  blockNumber?: number;
  transaction?: Record<string, unknown> | null;
  applicationLog?: Record<string, unknown> | null;
}

export interface BlockReference {
  network?: NeoNetwork;
  height?: number;
  hash?: string;
}

export interface TransactionLookup {
  hash: string;
  network?: NeoNetwork;
}

export interface TransactionStatusLookup {
  hash: string;
  network: NeoNetwork;
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

export interface PreparedTransaction {
  kind: "transaction";
  action:
    | "sendNeoN3Gas"
    | "sendNeoN3Token"
    | "swapNeoN3Token"
    | "prepareNeoN3ContractWrite";
  summary: string;
  unsignedTransaction: string;
  network: NeoNetwork;
  sender: string;
  networkMagic?: number;
  nonce?: number;
  to?: string;
  amount?: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  contractAddress?: string;
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
  allowedContracts?: string[];
}

export interface BroadcastResult {
  txHash: string;
  sender: string;
  summary: string;
  network: NeoNetwork;
}

export interface NeoN3PortfolioOverview {
  address: string;
  gasBalance: TokenBalance;
  neoBalance: TokenBalance;
  tokenBalances: TokenBalance[];
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
  getImplementedNetworks(): NeoNetwork[];
  getDefaultNetwork(): NeoNetwork;
  getWalletAddresses(): NetworkAddressMap;
  getWalletAddress(network: NeoNetwork): string | undefined;
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
  getTransaction(input: TransactionLookup): Promise<TransactionDetails>;
  getTransactionStatus(
    input: TransactionStatusLookup,
  ): Promise<TransactionStatus>;
  getBlock(reference: BlockReference): Promise<unknown>;
  resolveNeoN3TokenMetadata(token: string): Promise<TokenMetadata>;
  invokeNeoN3Read(
    contractHash: string,
    operation: string,
    args?: unknown[],
  ): Promise<NeoN3ReadInvocationResult>;
  buildNeoN3ContractWrite(
    input: NeoN3ContractWriteInput,
  ): Promise<PreparedTransaction>;
  getNeoN3SwapQuote(input: NeoN3SwapQuoteInput): Promise<NeoN3SwapQuote>;
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
  signAndBroadcast(prepared: PreparedTransaction): Promise<BroadcastResult>;
  walletEnabled(network?: NeoNetwork): boolean;
  checkReadiness(): Promise<ProviderReadiness>;
}

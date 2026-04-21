import {
  CONST as neoConst,
  api as neoApi,
  experimental,
  rpc as neoRpc,
  sc as neoSc,
  tx as neoTx,
  wallet as neoWallet,
} from "@cityofzion/neon-js";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  type TransactionRequest,
} from "ethers";

import type { AppConfig } from "../core/config";
import {
  NotFoundError,
  NeoRpcError,
  ProviderCapabilityError,
  ValidationError,
  WalletUnavailableError,
} from "../core/errors";
import {
  evmAddressSchema,
  hash160Schema,
  hash256Schema,
  neoN3AddressSchema,
  neoN3AddressOrNeoNsSchema,
  isNeoNsName,
} from "../core/validation";
import { createBroadcastResult } from "./broadcast";
import type {
  BlockReference,
  BridgeQuote,
  BridgeGasDirection,
  BridgeStatus,
  BroadcastResult,
  ContractWriteInput,
  Erc20ApprovalInput,
  Erc20TransferInput,
  GasBridgeInput,
  GasBridgeQuoteInput,
  NeoProvider,
  NeoN3ContractWriteInput,
  NeoN3PortfolioOverview,
  NeoN3ReadInvocationResult,
  NeoN3SwapQuote,
  NeoN3SwapQuoteInput,
  NeoN3TokenTransferInput,
  NeoN3TokenSwapInput,
  NeoN3TransferHistory,
  PreparedTransaction,
  PreparedTransactionRequest,
  ReadInvocationResult,
  TokenBalance,
  TokenMetadata,
  TransactionDetails,
  TransactionStatus,
} from "./types";

const erc20Abi = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const neoXBridgeAbi = [
  "function nativeBridge() view returns (bool paused, (uint256 nonce, bytes32 root) depositState, (uint256 nonce, bytes32 root) withdrawalState, (uint256 fee, uint256 minAmount, uint256 maxAmount, uint256 maxDeposits, uint256 decimalScalingFactor) config)",
  "function withdrawNative(address _to, uint256 _maxFee) payable",
] as const;

const knownNeoN3TokenMetadataByContractHash: Readonly<
  Record<string, Pick<TokenMetadata, "symbol" | "decimals" | "name">>
> = Object.freeze({
  "0x48c40d4666f93408be1bef038b6722404d9a4c2a": {
    symbol: "bNEO",
    decimals: 8,
    name: "bNEO",
  },
  "0x833b3d6854d5bc44cab40ab9b46560d25c72562c": {
    symbol: "bNEO",
    decimals: 8,
    name: "bNEO",
  },
});

const neoN3MainnetNetworkMagic = 860_833_102;
const neoN3TestnetNetworkMagic = 894_710_606;
const defaultNeoN3MainnetFlamingoBrokerContract =
  "0xec268e9c642b7d09d10fe658bcb1cc63c0895d4d";
const defaultNeoN3TestnetFlamingoBrokerContract =
  "0xb5e260839b427ef72faf5e563a241922da9c6cc8";
const defaultNeoN3MainnetFlamingoConvertContract =
  "0xf40f694362957d56801a8cef7e62a83f7f1b7b0f";
const defaultNeoN3TestnetFlamingoConvertContract =
  "0x160f5d64947b2d71d949c2e751d5cf13bfb2e199";
const defaultNeoN3MainnetFlamingoRouterContract =
  "0xde3a4b093abbd07e9a69cdec88a54d9a1fe14975";
const defaultNeoN3TestnetFlamingoRouterContract =
  "0x9f4dd9684638f839f3f62cc3440c3f1c8bad541b";

interface PreparedTransactionInput {
  action: PreparedTransaction["action"];
  summary: string;
  network?: "neoX";
  to: string;
  data?: string;
  value?: string;
  amount?: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  spender?: string;
  contractAddress?: string;
  functionSignature?: string;
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
}

interface ResolvedBridgeFee {
  decimal: string;
  raw: bigint;
}

interface ResolvedBridgeConfig extends ResolvedBridgeFee {
  minimumAmount?: string;
  minimumRaw?: bigint;
  maximumAmount?: string;
  maximumRaw?: bigint;
  paused?: boolean;
}

interface ResolvedNeoN3SwapPath {
  routeContracts: string[];
  routeSymbols: string[];
  tradingPairIds: number[];
  routeAmountsRaw: bigint[];
}

interface NeoN3FlamingoTradingPair {
  pairId: number;
  baseTokenHash: string;
  quoteTokenHash: string;
}

const neoN3StructuredArgumentTypes = [
  "Address",
  "Hash160",
  "Hash256",
  "String",
  "Integer",
  "Boolean",
  "ByteArray",
  "PublicKey",
  "Array",
  "Any",
] as const;

type NeoN3StructuredArgumentType =
  (typeof neoN3StructuredArgumentTypes)[number];

interface NeoN3StructuredArgument {
  type: NeoN3StructuredArgumentType;
  value?: unknown;
}

const neoNsTextRecordType = "16";

function ensureFunctionDeclaration(signature: string): string {
  return signature.trim().startsWith("function ")
    ? signature.trim()
    : `function ${signature.trim()}`;
}

function normalizeResult(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeResult(entry));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        normalizeResult(entry),
      ]),
    );
  }

  return value;
}

function isNeoN3StructuredArgument(
  value: unknown,
): value is NeoN3StructuredArgument {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("type" in value) || typeof value.type !== "string") {
    return false;
  }

  return (neoN3StructuredArgumentTypes as readonly string[]).includes(
    value.type,
  );
}

export class NeoXProvider implements NeoProvider {
  private readonly config: AppConfig;
  private readonly provider: JsonRpcProvider;
  private readonly wallet?: Wallet;
  private readonly neoN3RpcClient?: InstanceType<typeof neoRpc.RPCClient>;
  private readonly neoN3Wallet?: InstanceType<typeof neoWallet.Account>;
  private readonly tokenMetadataCache = new Map<
    string,
    Promise<TokenMetadata>
  >();
  private readonly neoN3TokenMetadataCache = new Map<
    string,
    Promise<TokenMetadata>
  >();
  private readonly erc20Interface = new Interface(erc20Abi);
  private readonly neoXBridgeInterface = new Interface(neoXBridgeAbi);
  private chainIdPromise?: Promise<number>;
  private neoN3NetworkMagicPromise?: Promise<number>;
  private neoN3FlamingoTradingPairsPromise?: Promise<
    NeoN3FlamingoTradingPair[]
  >;
  private neoN3ResolvedFlamingoBrokerContractPromise?: Promise<string>;
  private neoN3ResolvedFlamingoConvertContractPromise?: Promise<string>;
  private neoN3ResolvedFlamingoRouterContractPromise?: Promise<string>;

  public constructor(config: AppConfig) {
    this.config = config;
    this.provider = new JsonRpcProvider(config.neoXRpcUrl, config.neoXChainId);
    this.wallet = config.walletPrivateKey
      ? new Wallet(config.walletPrivateKey, this.provider)
      : undefined;
    this.neoN3RpcClient = config.neoN3.rpcUrl
      ? new neoRpc.RPCClient(config.neoN3.rpcUrl)
      : undefined;
    this.neoN3Wallet = config.neoN3.walletPrivateKey
      ? new neoWallet.Account(config.neoN3.walletPrivateKey)
      : undefined;
  }

  public async validateAddress(address: string): Promise<boolean> {
    return isAddress(address);
  }

  public async getTokenBalances(
    address: string,
    token?: string,
  ): Promise<TokenBalance[]> {
    const owner = evmAddressSchema.parse(address);

    if (token) {
      return [
        await this.getTokenBalance(
          owner,
          await this.resolveTokenMetadata(token),
        ),
      ];
    }

    const configuredAddresses = [
      ...new Set(Object.values(this.config.erc20.tokenMap)),
    ];
    const balances = await Promise.all(
      configuredAddresses.map(async (contractAddress) =>
        this.getTokenBalance(
          owner,
          await this.resolveTokenMetadata(contractAddress),
        ),
      ),
    );

    return balances.filter((balance) => balance.rawBalance !== "0");
  }

  public async getNativeBalance(address: string): Promise<TokenBalance> {
    const owner = evmAddressSchema.parse(address);
    const rawBalance = await this.provider.getBalance(owner);
    const nativeToken = this.getNativeGasToken();

    return {
      ...nativeToken,
      owner,
      rawBalance: rawBalance.toString(),
      balance: formatUnits(rawBalance, nativeToken.decimals),
    };
  }

  public async getNeoN3GasBalance(address: string): Promise<TokenBalance> {
    const owner = await this.resolveNeoN3AddressOrName(address);
    const gasToken = this.getNeoN3GasToken();

    return this.getNeoN3TokenBalance(owner, gasToken);
  }

  public async getNeoN3TokenBalances(
    address: string,
    token?: string,
  ): Promise<TokenBalance[]> {
    const owner = await this.resolveNeoN3AddressOrName(address);
    const tokenReference = token?.trim();

    if (tokenReference) {
      const metadata = await this.resolveNeoN3TokenMetadata(tokenReference);
      const balance = await this.getNeoN3TokenBalance(owner, metadata);

      return balance.rawBalance === "0" ? [] : [balance];
    }

    try {
      const nep17Balances =
        await this.requireNeoN3RpcClient().getNep17Balances(owner);
      const balances = await Promise.all(
        nep17Balances.balance.map(async (entry) => {
          const metadata = await this.safeResolveNeoN3TokenMetadata(
            entry.assethash,
          );

          return {
            ...metadata,
            owner,
            rawBalance: parseUnits(entry.amount, metadata.decimals).toString(),
            balance: entry.amount,
          };
        }),
      );

      return balances.filter((balance) => balance.rawBalance !== "0");
    } catch {
      const overview = await this.getNeoN3PortfolioOverview(owner);

      return [
        overview.gasBalance,
        overview.neoBalance,
        ...overview.tokenBalances,
      ].filter((balance, index, allBalances) => {
        return (
          balance.rawBalance !== "0" &&
          allBalances.findIndex(
            (candidate) =>
              candidate.contractAddress === balance.contractAddress,
          ) === index
        );
      });
    }
  }

  public async getNeoN3PortfolioOverview(
    address: string,
  ): Promise<NeoN3PortfolioOverview> {
    const owner = await this.resolveNeoN3AddressOrName(address);
    const extraContracts = this.getTrackedNeoN3TokenContracts();
    const [gasBalance, neoBalance, tokenBalances] = await Promise.all([
      this.getNeoN3TokenBalance(owner, this.getNeoN3GasToken()),
      this.getNeoN3TokenBalance(owner, this.getNeoN3NeoToken()),
      this.getNeoN3TrackedTokenBalances(owner, extraContracts),
    ]);

    return {
      address: owner,
      gasBalance,
      neoBalance,
      tokenBalances,
    };
  }

  public async getNeoN3TransferHistory(input: {
    address: string;
    token?: string;
    limit?: number;
  }): Promise<NeoN3TransferHistory> {
    const owner = await this.resolveNeoN3AddressOrName(input.address);
    const tokenFilter = input.token
      ? await this.resolveNeoN3TokenMetadata(input.token)
      : undefined;
    let transferHistory: Awaited<
      ReturnType<InstanceType<typeof neoRpc.RPCClient>["getNep17Transfers"]>
    >;

    try {
      transferHistory =
        await this.requireNeoN3RpcClient().getNep17Transfers(owner);
    } catch (error) {
      throw new ProviderCapabilityError(
        "Neo N3 transfer history requires the TokenTracker RPC plugin.",
        error instanceof Error ? error.message : error,
      );
    }

    const allTransfers = [
      ...transferHistory.sent.map((entry) => ({
        direction: "sent" as const,
        entry,
      })),
      ...transferHistory.received.map((entry) => ({
        direction: "received" as const,
        entry,
      })),
    ]
      .filter(({ entry }) => {
        if (!tokenFilter) {
          return true;
        }

        return (
          hash160Schema.parse(entry.assethash) === tokenFilter.contractAddress
        );
      })
      .sort((left, right) => right.entry.timestamp - left.entry.timestamp);
    const limitedTransfers = allTransfers.slice(0, input.limit ?? 10);
    const transfers = await Promise.all(
      limitedTransfers.map(async ({ direction, entry }) => ({
        direction,
        txHash: hash256Schema.parse(entry.txhash),
        blockIndex: entry.blockindex,
        timestamp: entry.timestamp,
        counterparty: entry.transferaddress,
        amount: entry.amount,
        token: await this.safeResolveNeoN3TokenMetadata(entry.assethash),
      })),
    );

    return {
      address: owner,
      count: transfers.length,
      transfers,
    };
  }

  public async getTransaction(hash: string): Promise<TransactionDetails> {
    const normalizedHash = hash256Schema.parse(hash);
    const transaction = await this.provider.getTransaction(normalizedHash);

    if (!transaction) {
      throw new NotFoundError(
        `Transaction ${normalizedHash} was not found on Neo X.`,
      );
    }

    const receipt = await this.provider.getTransactionReceipt(normalizedHash);
    const serializedTransaction =
      typeof transaction.toJSON === "function"
        ? transaction.toJSON()
        : transaction;
    const serializedReceipt =
      receipt && typeof receipt.toJSON === "function"
        ? receipt.toJSON()
        : receipt;

    return {
      transaction: normalizeResult(serializedTransaction) as Record<
        string,
        unknown
      >,
      receipt: serializedReceipt
        ? (normalizeResult(serializedReceipt) as Record<string, unknown>)
        : null,
    };
  }

  public async getTransactionStatus(input: {
    hash: string;
    network: "neoX" | "neoN3";
  }): Promise<TransactionStatus> {
    const normalizedHash = hash256Schema.parse(input.hash);

    if (input.network === "neoN3") {
      return this.getNeoN3TransactionStatus(normalizedHash);
    }

    return this.getNeoXTransactionStatus(normalizedHash);
  }

  private async getNeoXTransactionStatus(
    hash: string,
  ): Promise<TransactionStatus> {
    const transaction = await this.provider.getTransaction(hash);

    if (!transaction) {
      return {
        hash,
        network: "neoX",
        status: "not_found",
        summary: `Neo X transaction ${hash} was not found.`,
        transaction: null,
        receipt: null,
      };
    }

    const receipt = await this.provider.getTransactionReceipt(hash);
    const serializedTransaction = this.normalizeRecord(transaction);
    const serializedReceipt = receipt ? this.normalizeRecord(receipt) : null;

    if (!receipt) {
      return {
        hash,
        network: "neoX",
        status: "pending",
        summary: `Neo X transaction ${hash} is pending.`,
        transaction: serializedTransaction,
        receipt: null,
      };
    }

    const status = this.isSuccessfulReceiptStatus(receipt.status)
      ? "confirmed"
      : "failed";

    return {
      hash,
      network: "neoX",
      status,
      summary:
        status === "confirmed"
          ? `Neo X transaction ${hash} is confirmed.`
          : `Neo X transaction ${hash} failed.`,
      blockNumber:
        typeof receipt.blockNumber === "number"
          ? receipt.blockNumber
          : undefined,
      transaction: serializedTransaction,
      receipt: serializedReceipt,
    };
  }

  private async getNeoN3TransactionStatus(
    hash: string,
  ): Promise<TransactionStatus> {
    let transaction: unknown;

    try {
      transaction = await this.requireNeoN3RpcClient().getRawTransaction(
        hash,
        true,
      );
    } catch {
      return {
        hash,
        network: "neoN3",
        status: "not_found",
        summary: `Neo N3 transaction ${hash} was not found.`,
        transaction: null,
        applicationLog: null,
      };
    }

    let applicationLog: unknown;

    try {
      applicationLog =
        await this.requireNeoN3RpcClient().getApplicationLog(hash);
    } catch {
      applicationLog = null;
    }

    const serializedTransaction = this.normalizeUnknownRecord(transaction);
    const serializedApplicationLog =
      this.normalizeUnknownRecord(applicationLog);
    const vmState = this.extractNeoN3VmState(serializedApplicationLog);
    let status: TransactionStatus["status"] = "pending";

    if (vmState === "HALT") {
      status = "confirmed";
    } else if (vmState) {
      status = "failed";
    }

    return {
      hash,
      network: "neoN3",
      status,
      summary:
        status === "confirmed"
          ? `Neo N3 transaction ${hash} is confirmed.`
          : status === "failed"
            ? `Neo N3 transaction ${hash} failed.`
            : `Neo N3 transaction ${hash} is pending.`,
      blockNumber: this.extractBlockNumber(serializedTransaction),
      transaction: serializedTransaction,
      applicationLog: serializedApplicationLog,
    };
  }

  public async getBlock(reference: BlockReference): Promise<unknown> {
    const block =
      reference.height !== undefined
        ? await this.provider.getBlock(reference.height)
        : await this.provider.getBlock(
            hash256Schema.parse(reference.hash ?? ""),
          );

    if (!block) {
      throw new NotFoundError("The requested block was not found on Neo X.");
    }

    return normalizeResult(
      typeof block.toJSON === "function" ? block.toJSON() : block,
    );
  }

  public async invokeRead(
    contractAddress: string,
    functionSignature: string,
    args: unknown[] = [],
  ): Promise<ReadInvocationResult> {
    const target = evmAddressSchema.parse(contractAddress);
    const interfaceInstance = new Interface([
      ensureFunctionDeclaration(functionSignature),
    ]);
    const fragment = interfaceInstance.getFunction(functionSignature.trim());

    if (!fragment) {
      throw new ValidationError(
        `Unable to resolve function signature '${functionSignature}'.`,
      );
    }

    const rawResult = await this.provider.call({
      to: target,
      data: interfaceInstance.encodeFunctionData(fragment, args),
    });
    const decodedResult = interfaceInstance.decodeFunctionResult(
      fragment,
      rawResult,
    );

    return {
      contractAddress: target,
      functionSignature: fragment.format("sighash"),
      args,
      rawResult,
      result:
        decodedResult.length === 1
          ? normalizeResult(decodedResult[0])
          : normalizeResult([...decodedResult]),
    };
  }

  public async resolveNeoN3TokenMetadata(
    token: string,
  ): Promise<TokenMetadata> {
    const tokenReference = token.trim();
    const normalizedSymbol = tokenReference.toUpperCase();

    if (normalizedSymbol === "GAS") {
      return this.getNeoN3GasToken();
    }

    if (normalizedSymbol === "NEO") {
      return this.getNeoN3NeoToken();
    }

    if (hash160Schema.safeParse(tokenReference).success) {
      return this.loadNeoN3Metadata(tokenReference);
    }

    const configuredHash = this.config.neoN3.tokenMap[normalizedSymbol];

    if (!configuredHash) {
      throw new NotFoundError(
        `Unable to resolve Neo N3 token '${tokenReference}'. Add it to NEO_N3_TOKEN_MAP_JSON or use a contract hash.`,
      );
    }

    return this.loadNeoN3Metadata(configuredHash);
  }

  public async invokeNeoN3Read(
    contractHash: string,
    operation: string,
    args: unknown[] = [],
  ): Promise<NeoN3ReadInvocationResult> {
    const target = hash160Schema.parse(contractHash);
    const normalizedOperation = operation.trim();
    const result = await this.requireNeoN3RpcClient().invokeFunction(
      target,
      normalizedOperation,
      args.map((arg) => this.toNeoN3ContractParam(arg)),
    );

    if (result.state !== "HALT") {
      throw new NeoRpcError(
        `Neo N3 call '${normalizedOperation}' failed.`,
        result.exception ?? result,
      );
    }

    return {
      contractHash: target,
      operation: normalizedOperation,
      args,
      rawResult: this.normalizeUnknownRecord(result) ?? {},
      result: this.normalizeNeoN3InvokeResult(result.stack),
    };
  }

  public async resolveTokenMetadata(token: string): Promise<TokenMetadata> {
    const tokenReference = token.trim();
    const normalizedSymbol = tokenReference.toUpperCase();

    if (normalizedSymbol === "GAS") {
      return this.getNativeGasToken();
    }

    if (normalizedSymbol === "WGAS" || normalizedSymbol === "WETH") {
      return this.loadErc20Metadata(this.config.erc20.wrappedGasAddress);
    }

    if (isAddress(tokenReference)) {
      return this.loadErc20Metadata(getAddress(tokenReference));
    }

    const configuredAddress = this.config.erc20.tokenMap[normalizedSymbol];

    if (!configuredAddress) {
      throw new NotFoundError(
        `Unable to resolve token '${tokenReference}'. Add it to ERC20_TOKEN_MAP_JSON or use an address.`,
      );
    }

    return this.loadErc20Metadata(configuredAddress);
  }

  public async buildContractWrite(
    input: ContractWriteInput,
  ): Promise<PreparedTransaction> {
    const target = evmAddressSchema.parse(input.contractAddress);
    const interfaceInstance = new Interface([
      ensureFunctionDeclaration(input.functionSignature),
    ]);
    const fragment = interfaceInstance.getFunction(
      input.functionSignature.trim(),
    );

    if (!fragment) {
      throw new ValidationError(
        `Unable to resolve function signature '${input.functionSignature}'.`,
      );
    }

    const encodedData = interfaceInstance.encodeFunctionData(
      fragment,
      input.args ?? [],
    );
    const summary = `Prepared a contract write for ${fragment.format("sighash")} on ${target}.`;

    return this.buildPreparedTransaction({
      action: "prepareContractWrite",
      summary,
      to: target,
      data: encodedData,
      value: input.value
        ? parseUnits(input.value, this.getNativeGasToken().decimals).toString()
        : undefined,
      contractAddress: target,
      functionSignature: fragment.format("sighash"),
      allowedContracts: [target],
    });
  }

  public async buildNeoN3ContractWrite(
    input: NeoN3ContractWriteInput,
  ): Promise<PreparedTransaction> {
    const account = this.requireNeoN3Wallet();
    const networkMagic = await this.getNeoN3NetworkMagic();
    const contractHash = hash160Schema.parse(input.contractHash);
    const allowedContracts = [
      contractHash,
      ...(input.allowedContracts ?? []).map((entry) =>
        hash160Schema.parse(entry),
      ),
    ];
    const signer = new neoTx.Signer({
      account: account.scriptHash,
      scopes:
        allowedContracts.length > 1
          ? neoTx.WitnessScope.CustomContracts
          : neoTx.WitnessScope.CalledByEntry,
      allowedContracts:
        allowedContracts.length > 1
          ? [...new Set(allowedContracts)]
          : undefined,
    });
    const scriptBuilder = new neoSc.ScriptBuilder();

    scriptBuilder.emitAppCall(contractHash, input.operation.trim(), [
      ...(input.args ?? []).map((arg) => this.toNeoN3ContractParam(arg)),
    ]);

    const transaction = new neoTx.Transaction({
      script: scriptBuilder.build(),
      signers: [signer],
    });
    const transactionConfig = {
      account,
      networkMagic,
      rpcAddress: this.requireNeoN3RpcUrl(),
    };

    await experimental.txHelpers.setBlockExpiry(transaction, transactionConfig);
    await experimental.txHelpers.addFees(transaction, transactionConfig);

    return this.buildNeoN3PreparedTransaction({
      action: "prepareNeoN3ContractWrite",
      summary: `Prepared a Neo N3 contract write for ${input.operation.trim()} on ${contractHash}.`,
      transaction,
      sender: account.address,
      networkMagic,
      to: contractHash,
      contractAddress: contractHash,
      operation: input.operation.trim(),
      allowedContracts:
        allowedContracts.length > 1
          ? [...new Set(allowedContracts)]
          : [contractHash],
    });
  }

  public async getNeoN3SwapQuote(
    input: NeoN3SwapQuoteInput,
  ): Promise<NeoN3SwapQuote> {
    const [convertContract, brokerContract] = await Promise.all([
      this.resolveNeoN3FlamingoConvertContractAddress(),
      this.resolveNeoN3FlamingoBrokerContractAddress(),
    ]);
    const [fromToken, toToken] = await Promise.all([
      this.resolveNeoN3TokenMetadata(input.fromToken),
      this.resolveNeoN3TokenMetadata(input.toToken),
    ]);

    if (fromToken.contractAddress === toToken.contractAddress) {
      throw new ValidationError(
        "Neo N3 swaps require different input and output tokens.",
      );
    }

    const rawAmountIn = parseUnits(input.amount, fromToken.decimals);
    const slippagePercent = this.normalizeSwapSlippagePercent(
      input.slippagePercent,
    );
    const slippageBps = this.toBasisPoints(slippagePercent);
    const deadlineMinutes = input.deadlineMinutes ?? 20;
    const deadlineTimestamp = Date.now() + deadlineMinutes * 60_000;
    const route = await this.resolveBestNeoN3SwapPath({
      amountInRaw: rawAmountIn,
      fromToken,
      toToken,
    });
    const amountOutRaw =
      route.routeAmountsRaw[route.routeAmountsRaw.length - 1];
    const minimumAmountOutRaw = this.applySlippage(amountOutRaw, slippageBps);
    const routeTokens = await Promise.all(
      route.routeContracts.map((contractHash) =>
        this.safeResolveNeoN3TokenMetadata(contractHash),
      ),
    );
    const routeAmounts = route.routeAmountsRaw.map((amount, index) =>
      formatUnits(amount, routeTokens[index]?.decimals ?? toToken.decimals),
    );
    const notes: string[] = [];

    if (route.routeContracts.length > 2) {
      notes.push(
        `Best Flamingo route uses ${route.routeContracts.length - 1} hops.`,
      );
    } else {
      notes.push("Best Flamingo route is a direct pool swap.");
    }

    if (input.force) {
      notes.push(
        "Force mode requested, so the best available route and default safeguards were selected automatically.",
      );
    }

    return {
      dex: "Flamingo",
      routerContract: convertContract,
      brokerContract,
      fromToken,
      toToken,
      amountIn: input.amount,
      amountOut: formatUnits(amountOutRaw, toToken.decimals),
      minimumAmountOut: formatUnits(minimumAmountOutRaw, toToken.decimals),
      slippagePercent,
      slippageBps,
      routeSymbols: route.routeSymbols,
      routeContracts: route.routeContracts,
      tradingPairIds: route.tradingPairIds,
      routeAmounts,
      deadlineMinutes,
      deadlineTimestamp,
      deadlineIso: new Date(deadlineTimestamp).toISOString(),
      notes,
    };
  }

  public async prepareNeoN3TokenSwap(
    input: NeoN3TokenSwapInput,
  ): Promise<PreparedTransaction> {
    const quote = await this.getNeoN3SwapQuote(input);
    const account = this.requireNeoN3Wallet();
    const networkMagic = await this.getNeoN3NetworkMagic();
    const rawAmountIn = parseUnits(input.amount, quote.fromToken.decimals);
    const rawMinimumAmountOut = parseUnits(
      quote.minimumAmountOut,
      quote.toToken.decimals,
    );
    const balance = await this.getNeoN3TokenBalance(
      account.address,
      quote.fromToken,
    );

    if (BigInt(balance.rawBalance) < rawAmountIn) {
      throw new ValidationError(
        `The loaded Neo N3 wallet has ${balance.balance} ${quote.fromToken.symbol}, which is not enough to swap ${input.amount} ${quote.fromToken.symbol}.`,
      );
    }

    const allowedContracts = [
      ...new Set(
        [
          quote.brokerContract,
          quote.routerContract,
          quote.fromToken.contractAddress,
        ].filter((entry): entry is string => Boolean(entry)),
      ),
    ];
    const signer = new neoTx.Signer({
      account: account.scriptHash,
      scopes: neoTx.WitnessScope.CustomContracts,
      allowedContracts,
    });
    const scriptBuilder = new neoSc.ScriptBuilder();
    scriptBuilder.emitAppCall(quote.routerContract, "standardConvert", [
      neoSc.ContractParam.hash160(account.scriptHash),
      neoSc.ContractParam.integer(rawAmountIn.toString()),
      neoSc.ContractParam.integer(rawMinimumAmountOut.toString()),
      neoSc.ContractParam.array(
        ...quote.routeContracts.map((contractHash) =>
          neoSc.ContractParam.hash160(contractHash),
        ),
      ),
      neoSc.ContractParam.array(
        ...(quote.tradingPairIds ?? []).map((pairId) =>
          neoSc.ContractParam.integer(pairId),
        ),
      ),
    ]);
    scriptBuilder.emit(neoSc.OpCode.ASSERT);

    const transaction = new neoTx.Transaction({
      script: scriptBuilder.build(),
      signers: [signer],
    });
    const transactionConfig = {
      account,
      networkMagic,
      rpcAddress: this.requireNeoN3RpcUrl(),
    };

    await experimental.txHelpers.setBlockExpiry(transaction, transactionConfig);
    await experimental.txHelpers.addFees(transaction, transactionConfig);

    return this.buildNeoN3PreparedTransaction({
      action: "swapNeoN3Token",
      summary: `Prepared a Flamingo swap on Neo N3 from ${input.amount} ${quote.fromToken.symbol} to about ${quote.amountOut} ${quote.toToken.symbol} via ${quote.routeSymbols.join(" -> ")} with minimum received ${quote.minimumAmountOut} ${quote.toToken.symbol}, slippage ${quote.slippagePercent}%, and a quote window of ${quote.deadlineMinutes} minutes.`,
      transaction,
      sender: account.address,
      networkMagic,
      to: quote.routerContract,
      amount: input.amount,
      tokenSymbol: quote.fromToken.symbol,
      tokenAddress: quote.fromToken.contractAddress,
      toTokenSymbol: quote.toToken.symbol,
      toTokenAddress: quote.toToken.contractAddress,
      amountOut: quote.amountOut,
      minimumAmountOut: quote.minimumAmountOut,
      slippagePercent: quote.slippagePercent,
      routeSymbols: quote.routeSymbols,
      routeContracts: quote.routeContracts,
      tradingPairIds: quote.tradingPairIds,
      deadlineMinutes: quote.deadlineMinutes,
      deadlineTimestamp: quote.deadlineTimestamp,
      contractAddress: quote.routerContract,
      operation: "standardConvert",
      allowedContracts,
    });
  }

  public async getGasBridgeQuote(
    input: GasBridgeQuoteInput,
  ): Promise<BridgeQuote> {
    const sourceNetwork = input.direction === "neoXToNeoN3" ? "neoX" : "neoN3";
    const destinationNetwork =
      input.direction === "neoXToNeoN3" ? "neoN3" : "neoX";
    const config =
      input.direction === "neoXToNeoN3"
        ? await this.getNeoXBridgeConfig()
        : await this.getNeoN3BridgeConfig();
    const destinationAddress =
      input.direction === "neoXToNeoN3"
        ? input.to
          ? await this.resolveNeoN3BridgeDestination(input.to)
          : this.neoN3Wallet?.address
        : input.to
          ? this.resolveNeoXBridgeDestination(input.to)
          : this.wallet?.address;
    const effectiveMaxFee = input.maxFee ?? config.decimal;
    const notes: string[] = [];
    let estimatedReceived: string | undefined;

    if (config.minimumAmount) {
      notes.push(
        `Minimum amount on the current bridge route is ${config.minimumAmount} GAS.`,
      );
    }

    if (config.maximumAmount) {
      notes.push(
        `Maximum amount on the current bridge route is ${config.maximumAmount} GAS.`,
      );
    }

    if (config.paused) {
      notes.push("The bridge currently reports a paused state.");
    }

    if (input.amount) {
      const decimals = sourceNetwork === "neoX" ? 18 : 8;
      const rawAmount = parseUnits(input.amount, decimals);
      const rawFee = parseUnits(effectiveMaxFee, decimals);

      if (config.minimumRaw !== undefined && rawAmount < config.minimumRaw) {
        notes.push(
          `Requested amount ${input.amount} GAS is below the current minimum.`,
        );
      }

      if (config.maximumRaw !== undefined && rawAmount > config.maximumRaw) {
        notes.push(
          `Requested amount ${input.amount} GAS is above the current maximum.`,
        );
      }

      estimatedReceived =
        rawAmount > rawFee ? formatUnits(rawAmount - rawFee, decimals) : "0";
      notes.push(
        `Estimated received amount assumes the bridge charges ${effectiveMaxFee} GAS.`,
      );
    }

    return {
      direction: input.direction,
      sourceNetwork,
      destinationNetwork,
      amount: input.amount,
      destinationAddress,
      currentFee: config.decimal,
      effectiveMaxFee,
      minimumAmount: config.minimumAmount,
      maximumAmount: config.maximumAmount,
      estimatedReceived,
      paused: config.paused,
      etaLowMinutes: 5,
      etaHighMinutes: 30,
      notes,
    };
  }

  public async getBridgeStatus(input: {
    txHash: string;
    direction: BridgeGasDirection;
    destinationAddress?: string;
    amount?: string;
    maxFee?: string;
    createdAt?: string;
  }): Promise<BridgeStatus> {
    const quote = await this.getGasBridgeQuote({
      direction: input.direction,
      amount: input.amount ?? "1",
      to: input.destinationAddress,
      maxFee: input.maxFee,
    });
    const sourceStatus = await this.getTransactionStatus({
      hash: input.txHash,
      network: quote.sourceNetwork,
    });
    const arrival =
      quote.destinationNetwork === "neoN3"
        ? await this.detectNeoN3BridgeArrival({
            destinationAddress: input.destinationAddress,
            amount: input.amount,
            estimatedReceived: input.amount
              ? quote.estimatedReceived
              : undefined,
            createdAt: input.createdAt,
            sourceStatus,
          })
        : await this.detectNeoXBridgeArrival({
            destinationAddress: input.destinationAddress,
            amount: input.amount,
            estimatedReceived: input.amount
              ? quote.estimatedReceived
              : undefined,
            sourceStatus,
          });

    return {
      txHash: input.txHash,
      direction: input.direction,
      sourceNetwork: quote.sourceNetwork,
      destinationNetwork: quote.destinationNetwork,
      sourceStatus,
      destinationAddress: input.destinationAddress,
      amount: input.amount,
      currentFee: quote.currentFee,
      effectiveMaxFee: quote.effectiveMaxFee,
      minimumAmount: quote.minimumAmount,
      maximumAmount: quote.maximumAmount,
      estimatedReceived: input.amount ? quote.estimatedReceived : undefined,
      etaLowMinutes:
        arrival.status === "arrived"
          ? 0
          : sourceStatus.status === "confirmed"
            ? 3
            : quote.etaLowMinutes,
      etaHighMinutes:
        arrival.status === "arrived"
          ? 0
          : sourceStatus.status === "confirmed"
            ? 15
            : quote.etaHighMinutes,
      arrival,
      summary: this.buildBridgeStatusSummary(
        input.direction,
        sourceStatus,
        arrival,
      ),
    };
  }

  public async prepareGasBridge(
    input: GasBridgeInput,
  ): Promise<PreparedTransaction> {
    if (input.direction === "neoXToNeoN3") {
      return this.prepareNeoXGasBridge(input);
    }

    return this.prepareNeoN3GasBridge(input);
  }

  public async prepareGasTransfer(input: {
    to: string;
    amount: string;
  }): Promise<PreparedTransaction> {
    const recipient = evmAddressSchema.parse(input.to);
    const summary = `Prepared a transfer of ${input.amount} GAS to ${recipient}.`;

    return this.buildPreparedTransaction({
      action: "sendGas",
      summary,
      to: recipient,
      value: parseUnits(
        input.amount,
        this.getNativeGasToken().decimals,
      ).toString(),
      amount: input.amount,
      tokenSymbol: "GAS",
      allowedContracts: [recipient],
    });
  }

  public async prepareNeoN3GasTransfer(input: {
    to: string;
    amount: string;
  }): Promise<PreparedTransaction> {
    const account = this.requireNeoN3Wallet();
    const networkMagic = await this.getNeoN3NetworkMagic();
    const recipient = await this.resolveNeoN3AddressOrName(input.to);
    const signer = new neoTx.Signer({
      account: account.scriptHash,
      scopes: neoTx.WitnessScope.CalledByEntry,
    });
    const scriptBuilder = new neoSc.ScriptBuilder();

    scriptBuilder.emitAppCall(
      this.config.bridge.neoN3GasTokenContract,
      "transfer",
      [
        neoSc.ContractParam.hash160(account.scriptHash),
        neoSc.ContractParam.hash160(
          neoWallet.getScriptHashFromAddress(recipient),
        ),
        neoSc.ContractParam.integer(parseUnits(input.amount, 8).toString()),
        neoSc.ContractParam.any(null),
      ],
    );
    scriptBuilder.emit(neoSc.OpCode.ASSERT);

    const transaction = new neoTx.Transaction({
      script: scriptBuilder.build(),
      signers: [signer],
    });
    const transactionConfig = {
      account,
      networkMagic,
      rpcAddress: this.requireNeoN3RpcUrl(),
    };

    await experimental.txHelpers.setBlockExpiry(transaction, transactionConfig);
    await experimental.txHelpers.addFees(transaction, transactionConfig);

    return this.buildNeoN3PreparedTransaction({
      action: "sendNeoN3Gas",
      summary: `Prepared a Neo N3 GAS transfer of ${input.amount} GAS to ${recipient}.`,
      transaction,
      sender: account.address,
      networkMagic,
      to: recipient,
      amount: input.amount,
      tokenSymbol: "GAS",
      contractAddress: this.config.bridge.neoN3GasTokenContract,
      allowedContracts: [this.config.bridge.neoN3GasTokenContract],
    });
  }

  public async prepareNeoN3TokenTransfer(
    input: NeoN3TokenTransferInput,
  ): Promise<PreparedTransaction> {
    const token = await this.resolveNeoN3TokenMetadata(input.token);

    if (token.symbol === "GAS") {
      throw new ValidationError(
        "Use sendNeoN3Gas for native GAS transfers on Neo N3.",
      );
    }

    const account = this.requireNeoN3Wallet();
    const networkMagic = await this.getNeoN3NetworkMagic();
    const recipient = await this.resolveNeoN3AddressOrName(input.to);
    const signer = new neoTx.Signer({
      account: account.scriptHash,
      scopes: neoTx.WitnessScope.CalledByEntry,
    });
    const scriptBuilder = new neoSc.ScriptBuilder();

    scriptBuilder.emitAppCall(token.contractAddress, "transfer", [
      neoSc.ContractParam.hash160(account.scriptHash),
      neoSc.ContractParam.hash160(
        neoWallet.getScriptHashFromAddress(recipient),
      ),
      neoSc.ContractParam.integer(
        parseUnits(input.amount, token.decimals).toString(),
      ),
      neoSc.ContractParam.any(null),
    ]);
    scriptBuilder.emit(neoSc.OpCode.ASSERT);

    const transaction = new neoTx.Transaction({
      script: scriptBuilder.build(),
      signers: [signer],
    });
    const transactionConfig = {
      account,
      networkMagic,
      rpcAddress: this.requireNeoN3RpcUrl(),
    };

    await experimental.txHelpers.setBlockExpiry(transaction, transactionConfig);
    await experimental.txHelpers.addFees(transaction, transactionConfig);

    return this.buildNeoN3PreparedTransaction({
      action: "sendNeoN3Token",
      summary: `Prepared a Neo N3 transfer of ${input.amount} ${token.symbol} to ${recipient}.`,
      transaction,
      sender: account.address,
      networkMagic,
      to: recipient,
      amount: input.amount,
      tokenSymbol: token.symbol,
      tokenAddress: token.contractAddress,
      contractAddress: token.contractAddress,
      allowedContracts: [token.contractAddress],
    });
  }

  public async prepareErc20Transfer(
    input: Erc20TransferInput,
  ): Promise<PreparedTransaction> {
    const recipient = evmAddressSchema.parse(input.to);
    const token = await this.resolveTokenMetadata(input.token);

    if (token.isNative) {
      throw new ValidationError(
        "Use sendGas for native GAS transfers on Neo X.",
      );
    }

    const rawAmount = parseUnits(input.amount, token.decimals);
    const data = this.erc20Interface.encodeFunctionData("transfer", [
      recipient,
      rawAmount,
    ]);
    const summary = `Prepared a transfer of ${input.amount} ${token.symbol} to ${recipient}.`;

    return this.buildPreparedTransaction({
      action: "sendErc20",
      summary,
      to: token.contractAddress,
      data,
      amount: input.amount,
      tokenAddress: token.contractAddress,
      tokenSymbol: token.symbol,
      allowedContracts: [token.contractAddress, recipient],
    });
  }

  public async prepareErc20Approval(
    input: Erc20ApprovalInput,
  ): Promise<PreparedTransaction> {
    const token = await this.resolveTokenMetadata(input.token);

    if (token.isNative) {
      throw new ValidationError(
        "Native GAS does not require ERC-20 approval on Neo X.",
      );
    }

    const spender = evmAddressSchema.parse(input.spender);
    const rawAmount = parseUnits(input.amount, token.decimals);
    const data = this.erc20Interface.encodeFunctionData("approve", [
      spender,
      rawAmount,
    ]);
    const summary = `Prepared an approval of ${input.amount} ${token.symbol} for ${spender}.`;

    return this.buildPreparedTransaction({
      action: "approveErc20",
      summary,
      to: token.contractAddress,
      data,
      amount: input.amount,
      tokenAddress: token.contractAddress,
      tokenSymbol: token.symbol,
      spender,
      allowedContracts: [token.contractAddress, spender],
    });
  }

  public async signAndBroadcast(
    prepared: PreparedTransaction,
  ): Promise<BroadcastResult> {
    if (prepared.network === "neoN3") {
      const account = this.requireNeoN3Wallet();
      const rpcClient = this.requireNeoN3RpcClient();
      const transaction = neoTx.Transaction.deserialize(
        prepared.unsignedTransaction,
      );

      transaction.sign(account, await this.getNeoN3NetworkMagic());

      return createBroadcastResult(
        prepared,
        await rpcClient.sendRawTransaction(transaction),
      );
    }

    const wallet = this.requireWallet();
    const request = prepared.request;

    if (!request) {
      throw new ValidationError(
        "The prepared Neo X transaction is missing its request payload.",
      );
    }

    const response = await wallet.sendTransaction(
      this.toTransactionRequest(request),
    );

    return createBroadcastResult(prepared, response.hash);
  }

  public getWalletAddress(): string {
    return this.requireWallet().address;
  }

  public getNeoN3WalletAddress(): string | undefined {
    return this.neoN3Wallet?.address;
  }

  public walletEnabled(): boolean {
    return Boolean(this.wallet);
  }

  public neoN3WalletEnabled(): boolean {
    return Boolean(this.neoN3Wallet);
  }

  private async prepareNeoXGasBridge(
    input: GasBridgeInput,
  ): Promise<PreparedTransaction> {
    const bridgeContractAddress = this.requireNeoXBridgeContractAddress();
    const quote = await this.getGasBridgeQuote(input);
    const destinationAddress = await this.resolveNeoN3BridgeDestination(
      input.to,
    );
    const maxFee = await this.resolveNeoXBridgeFee(input.maxFee);
    const data = this.neoXBridgeInterface.encodeFunctionData("withdrawNative", [
      this.toNeoN3ScriptHash(destinationAddress),
      maxFee.raw,
    ]);
    const summary = `Prepared a Neo X -> Neo N3 bridge of ${input.amount} GAS to ${destinationAddress}.`;

    return this.buildPreparedTransaction({
      action: "bridgeGas",
      summary,
      to: bridgeContractAddress,
      data,
      value: parseUnits(
        input.amount,
        this.getNativeGasToken().decimals,
      ).toString(),
      amount: input.amount,
      tokenSymbol: "GAS",
      bridgeDirection: "neoXToNeoN3",
      destinationAddress,
      maxFee: maxFee.decimal,
      estimatedReceived: quote.estimatedReceived,
      minimumAmount: quote.minimumAmount,
      maximumAmount: quote.maximumAmount,
      bridgeEtaLowMinutes: quote.etaLowMinutes,
      bridgeEtaHighMinutes: quote.etaHighMinutes,
      bridgeContractAddress,
      allowedContracts: [bridgeContractAddress],
    });
  }

  private async prepareNeoN3GasBridge(
    input: GasBridgeInput,
  ): Promise<PreparedTransaction> {
    const bridgeContractAddress = this.requireNeoN3BridgeContractAddress();
    const quote = await this.getGasBridgeQuote(input);
    const account = this.requireNeoN3Wallet();
    const networkMagic = await this.getNeoN3NetworkMagic();
    const maxFee = await this.resolveNeoN3BridgeFee(input.maxFee);
    const destinationAddress = this.resolveNeoXBridgeDestination(input.to);
    const signer = new neoTx.Signer({
      account: account.scriptHash,
      scopes: neoTx.WitnessScope.CustomContracts,
      allowedContracts: [
        bridgeContractAddress,
        this.config.bridge.neoN3GasTokenContract,
      ],
    });
    const scriptBuilder = new neoSc.ScriptBuilder();

    scriptBuilder.emitAppCall(bridgeContractAddress, "depositNative", [
      neoSc.ContractParam.hash160(account.scriptHash),
      neoSc.ContractParam.hash160(destinationAddress),
      neoSc.ContractParam.integer(parseUnits(input.amount, 8).toString()),
      neoSc.ContractParam.integer(maxFee.raw.toString()),
    ]);

    const transaction = new neoTx.Transaction({
      script: scriptBuilder.build(),
      signers: [signer],
    });
    const bridgeConfig = {
      account,
      networkMagic,
      rpcAddress: this.requireNeoN3RpcUrl(),
    };

    await experimental.txHelpers.setBlockExpiry(transaction, bridgeConfig);
    await experimental.txHelpers.addFees(transaction, bridgeConfig);

    return this.buildNeoN3PreparedTransaction({
      action: "bridgeGas",
      summary: `Prepared a Neo N3 -> Neo X bridge of ${input.amount} GAS to ${destinationAddress}.`,
      transaction,
      sender: account.address,
      networkMagic,
      to: bridgeContractAddress,
      amount: input.amount,
      tokenSymbol: "GAS",
      destinationAddress,
      maxFee: maxFee.decimal,
      estimatedReceived: quote.estimatedReceived,
      minimumAmount: quote.minimumAmount,
      maximumAmount: quote.maximumAmount,
      bridgeEtaLowMinutes: quote.etaLowMinutes,
      bridgeEtaHighMinutes: quote.etaHighMinutes,
      bridgeDirection: "neoN3ToNeoX",
      bridgeContractAddress,
      allowedContracts: [
        bridgeContractAddress,
        this.config.bridge.neoN3GasTokenContract,
      ],
    });
  }

  private buildNeoN3PreparedTransaction(input: {
    action: PreparedTransaction["action"];
    summary: string;
    transaction: InstanceType<typeof neoTx.Transaction>;
    sender: string;
    networkMagic: number;
    to: string;
    amount?: string;
    tokenSymbol?: string;
    tokenAddress?: string;
    toTokenSymbol?: string;
    toTokenAddress?: string;
    amountOut?: string;
    minimumAmountOut?: string;
    slippagePercent?: string;
    routeSymbols?: string[];
    routeContracts?: string[];
    tradingPairIds?: number[];
    deadlineMinutes?: number;
    deadlineTimestamp?: number;
    destinationAddress?: string;
    maxFee?: string;
    estimatedReceived?: string;
    minimumAmount?: string;
    maximumAmount?: string;
    bridgeEtaLowMinutes?: number;
    bridgeEtaHighMinutes?: number;
    bridgeDirection?: BridgeGasDirection;
    bridgeContractAddress?: string;
    contractAddress?: string;
    operation?: string;
    allowedContracts: string[];
  }): PreparedTransaction {
    return {
      kind: "transaction",
      action: input.action,
      summary: input.summary,
      unsignedTransaction: input.transaction.serialize(false),
      network: "neoN3",
      sender: input.sender,
      networkMagic: input.networkMagic,
      nonce: input.transaction.nonce,
      to: input.to,
      amount: input.amount,
      tokenAddress: input.tokenAddress,
      tokenSymbol: input.tokenSymbol,
      toTokenAddress: input.toTokenAddress,
      toTokenSymbol: input.toTokenSymbol,
      amountOut: input.amountOut,
      minimumAmountOut: input.minimumAmountOut,
      slippagePercent: input.slippagePercent,
      routeSymbols: input.routeSymbols,
      routeContracts: input.routeContracts,
      tradingPairIds: input.tradingPairIds,
      deadlineMinutes: input.deadlineMinutes,
      deadlineTimestamp: input.deadlineTimestamp,
      contractAddress: input.contractAddress,
      operation: input.operation,
      bridgeDirection: input.bridgeDirection,
      destinationAddress: input.destinationAddress,
      maxFee: input.maxFee,
      estimatedReceived: input.estimatedReceived,
      minimumAmount: input.minimumAmount,
      maximumAmount: input.maximumAmount,
      bridgeEtaLowMinutes: input.bridgeEtaLowMinutes,
      bridgeEtaHighMinutes: input.bridgeEtaHighMinutes,
      bridgeContractAddress: input.bridgeContractAddress,
      allowedContracts: input.allowedContracts,
    };
  }

  private async resolveNeoN3BridgeDestination(
    destination?: string,
  ): Promise<string> {
    if (destination) {
      return this.resolveNeoN3AddressOrName(destination);
    }

    if (this.neoN3Wallet) {
      return this.neoN3Wallet.address;
    }

    throw new ValidationError(
      "Provide a Neo N3 destination address or set WALLET_WIF or WALLET_PRIVATE_KEY.",
    );
  }

  private resolveNeoXBridgeDestination(destination?: string): string {
    if (destination) {
      return evmAddressSchema.parse(destination);
    }

    if (this.wallet) {
      return this.wallet.address;
    }

    throw new ValidationError(
      "Provide a Neo X destination address or set NEO_X_WALLET_PRIVATE_KEY.",
    );
  }

  private async resolveNeoXBridgeFee(
    requestedMaxFee?: string,
  ): Promise<ResolvedBridgeFee> {
    const currentFee = await this.getNeoXBridgeFee();

    if (!requestedMaxFee) {
      return currentFee;
    }

    const requestedFee = parseUnits(
      requestedMaxFee,
      this.getNativeGasToken().decimals,
    );

    if (requestedFee < currentFee.raw) {
      throw new ValidationError(
        `Requested maxFee ${requestedMaxFee} GAS is lower than the current Neo X bridge fee ${currentFee.decimal} GAS.`,
      );
    }

    return {
      decimal: requestedMaxFee,
      raw: requestedFee,
    };
  }

  private async resolveNeoN3BridgeFee(
    requestedMaxFee?: string,
  ): Promise<ResolvedBridgeFee> {
    const currentFee = await this.getNeoN3BridgeFee();

    if (!requestedMaxFee) {
      return currentFee;
    }

    const requestedFee = parseUnits(requestedMaxFee, 8);

    if (requestedFee < currentFee.raw) {
      throw new ValidationError(
        `Requested maxFee ${requestedMaxFee} GAS is lower than the current Neo N3 bridge fee ${currentFee.decimal} GAS.`,
      );
    }

    return {
      decimal: requestedMaxFee,
      raw: requestedFee,
    };
  }

  private async getNeoXBridgeConfig(): Promise<ResolvedBridgeConfig> {
    const contract = new Contract(
      this.requireNeoXBridgeContractAddress(),
      neoXBridgeAbi,
      this.provider,
    );
    const nativeBridge = (await contract.nativeBridge()) as readonly [
      boolean,
      unknown,
      unknown,
      readonly [bigint, bigint, bigint, bigint, bigint] & {
        fee?: bigint;
        minAmount?: bigint;
        maxAmount?: bigint;
      },
    ];
    const fee =
      nativeBridge[3].fee !== undefined
        ? nativeBridge[3].fee
        : nativeBridge[3][0];
    const minimumRaw =
      nativeBridge[3].minAmount !== undefined
        ? nativeBridge[3].minAmount
        : nativeBridge[3][1];
    const maximumRaw =
      nativeBridge[3].maxAmount !== undefined
        ? nativeBridge[3].maxAmount
        : nativeBridge[3][2];

    return {
      decimal: formatUnits(fee, this.getNativeGasToken().decimals),
      raw: fee,
      minimumAmount: formatUnits(minimumRaw, this.getNativeGasToken().decimals),
      minimumRaw,
      maximumAmount: formatUnits(maximumRaw, this.getNativeGasToken().decimals),
      maximumRaw,
      paused: nativeBridge[0],
    };
  }

  private async getNeoN3BridgeConfig(): Promise<ResolvedBridgeConfig> {
    const fee = await this.getNeoN3BridgeFee();
    const minimumRaw = await this.tryGetNeoN3BridgeInteger(
      "nativeDepositMinAmount",
    );
    const maximumRaw = await this.tryGetNeoN3BridgeInteger(
      "nativeDepositMaxAmount",
    );

    return {
      ...fee,
      minimumAmount:
        minimumRaw !== undefined ? formatUnits(minimumRaw, 8) : undefined,
      minimumRaw,
      maximumAmount:
        maximumRaw !== undefined ? formatUnits(maximumRaw, 8) : undefined,
      maximumRaw,
    };
  }

  private async getNeoXBridgeFee(): Promise<ResolvedBridgeFee> {
    const config = await this.getNeoXBridgeConfig();

    return {
      decimal: config.decimal,
      raw: config.raw,
    };
  }

  private async getNeoN3BridgeFee(): Promise<ResolvedBridgeFee> {
    const result = await this.requireNeoN3RpcClient().invokeFunction(
      this.requireNeoN3BridgeContractAddress(),
      "nativeDepositFee",
    );
    const fee = this.parseNeoN3IntegerResult(result, "nativeDepositFee");

    return {
      decimal: formatUnits(fee, 8),
      raw: fee,
    };
  }

  private async tryGetNeoN3BridgeInteger(
    operation: string,
  ): Promise<bigint | undefined> {
    try {
      const result = await this.requireNeoN3RpcClient().invokeFunction(
        this.requireNeoN3BridgeContractAddress(),
        operation,
      );

      return this.parseNeoN3IntegerResult(result, operation);
    } catch {
      return undefined;
    }
  }

  private async detectNeoN3BridgeArrival(input: {
    destinationAddress?: string;
    amount?: string;
    estimatedReceived?: string;
    createdAt?: string;
    sourceStatus: TransactionStatus;
  }): Promise<BridgeStatus["arrival"]> {
    if (!input.destinationAddress) {
      return {
        status: "unknown",
        summary:
          "The bridge destination address is missing, so arrival on Neo N3 cannot be checked.",
        detectionMethod: "unavailable",
        confidence: "low",
      };
    }

    const history = await this.getNeoN3TransferHistory({
      address: input.destinationAddress,
      token: "GAS",
      limit: 10,
    });
    const createdAtMs = input.createdAt
      ? Date.parse(input.createdAt)
      : undefined;
    const matchingTransfer = history.transfers.find((transfer) => {
      if (transfer.direction !== "received") {
        return false;
      }

      if (
        createdAtMs !== undefined &&
        Number.isFinite(createdAtMs) &&
        transfer.timestamp + 60_000 < createdAtMs
      ) {
        return false;
      }

      if (
        input.estimatedReceived &&
        this.amountEquals(transfer.amount, input.estimatedReceived, 8)
      ) {
        return true;
      }

      if (input.amount && this.amountEquals(transfer.amount, input.amount, 8)) {
        return true;
      }

      return false;
    });

    if (matchingTransfer) {
      return {
        status: "arrived",
        summary: `Detected the bridged GAS on Neo N3 in transfer ${matchingTransfer.txHash}.`,
        detectionMethod: "neoN3_transfer_history",
        confidence: "high",
        matchedTxHash: matchingTransfer.txHash,
        matchedAmount: matchingTransfer.amount,
      };
    }

    return {
      status: input.sourceStatus.status === "confirmed" ? "pending" : "unknown",
      summary:
        input.sourceStatus.status === "confirmed"
          ? "The source bridge transaction is confirmed, but the destination transfer has not been detected on Neo N3 yet."
          : "The source bridge transaction has not confirmed yet, so arrival on Neo N3 cannot be verified.",
      detectionMethod: "neoN3_transfer_history",
      confidence: "high",
    };
  }

  private async detectNeoXBridgeArrival(input: {
    destinationAddress?: string;
    amount?: string;
    estimatedReceived?: string;
    sourceStatus: TransactionStatus;
  }): Promise<BridgeStatus["arrival"]> {
    if (!input.destinationAddress) {
      return {
        status: "unknown",
        summary:
          "The bridge destination address is missing, so arrival on Neo X cannot be checked.",
        detectionMethod: "unavailable",
        confidence: "low",
      };
    }

    const balance = await this.getNativeBalance(input.destinationAddress);
    const targetAmount = input.estimatedReceived ?? input.amount;

    if (targetAmount && this.amountGte(balance.balance, targetAmount, 18)) {
      return {
        status: "arrived",
        summary:
          "Detected that the Neo X destination balance is at least the expected bridge output. This is a balance-based heuristic and may include prior funds.",
        detectionMethod: "neoX_balance_heuristic",
        confidence: "low",
        matchedAmount: balance.balance,
      };
    }

    return {
      status: input.sourceStatus.status === "confirmed" ? "pending" : "unknown",
      summary:
        input.sourceStatus.status === "confirmed"
          ? "The source bridge transaction is confirmed, but arrival on Neo X could not be verified exactly yet."
          : "The source bridge transaction has not confirmed yet, so arrival on Neo X cannot be verified.",
      detectionMethod: "neoX_balance_heuristic",
      confidence: "low",
    };
  }

  private buildBridgeStatusSummary(
    direction: BridgeGasDirection,
    sourceStatus: TransactionStatus,
    arrival: BridgeStatus["arrival"],
  ): string {
    const routeLabel =
      direction === "neoXToNeoN3" ? "Neo X -> Neo N3" : "Neo N3 -> Neo X";

    if (arrival.status === "arrived") {
      return `${routeLabel} bridge is complete. ${arrival.summary}`;
    }

    if (sourceStatus.status === "failed") {
      return `${routeLabel} bridge failed on the source network.`;
    }

    if (sourceStatus.status === "confirmed") {
      return `${routeLabel} bridge is confirmed on the source network and waiting for destination arrival.`;
    }

    if (
      sourceStatus.status === "pending" ||
      sourceStatus.status === "submitted"
    ) {
      return `${routeLabel} bridge is still pending on the source network.`;
    }

    return `${routeLabel} bridge could not be found on the source network.`;
  }

  private amountEquals(left: string, right: string, decimals: number): boolean {
    return parseUnits(left, decimals) === parseUnits(right, decimals);
  }

  private amountGte(left: string, right: string, decimals: number): boolean {
    return parseUnits(left, decimals) >= parseUnits(right, decimals);
  }

  private async resolveNeoN3AddressOrName(
    destination: string,
  ): Promise<string> {
    const normalizedDestination = neoN3AddressOrNeoNsSchema.parse(destination);

    if (!isNeoNsName(normalizedDestination)) {
      return neoN3AddressSchema.parse(normalizedDestination);
    }

    const resolvedValue = await this.resolveNeoNsTextRecord(
      normalizedDestination,
    );

    try {
      return neoN3AddressSchema.parse(resolvedValue);
    } catch {
      throw new ValidationError(
        `NeoNS name '${normalizedDestination}' did not resolve to a valid Neo N3 address.`,
      );
    }
  }

  private async resolveNeoNsTextRecord(name: string): Promise<string> {
    const result = await this.requireNeoN3RpcClient().invokeFunction(
      this.requireNeoN3NameServiceContractAddress(),
      "resolve",
      [
        neoSc.ContractParam.string(name),
        neoSc.ContractParam.integer(neoNsTextRecordType),
      ],
    );
    const value = this.parseNeoN3StringResult(result, "resolve").trim();

    if (value === "") {
      throw new NotFoundError(
        `NeoNS name '${name}' does not have a text record.`,
      );
    }

    return value;
  }

  private parseNeoN3IntegerResult(
    result: {
      state: string;
      stack?: Array<{
        value?: unknown;
      }>;
      exception?: string | null;
    },
    operation: string,
  ): bigint {
    if (result.state !== "HALT") {
      throw new NeoRpcError(
        `Neo N3 call '${operation}' failed.`,
        result.exception ?? result,
      );
    }

    const value = result.stack?.[0]?.value;

    if (typeof value !== "string") {
      throw new NeoRpcError(
        `Neo N3 call '${operation}' did not return an integer value.`,
        result,
      );
    }

    return BigInt(value);
  }

  private parseNeoN3StringResult(
    result: {
      state: string;
      stack?: Array<{
        type?: string;
        value?: unknown;
      }>;
      exception?: string | null;
    },
    operation: string,
  ): string {
    if (result.state !== "HALT") {
      throw new NeoRpcError(
        `Neo N3 call '${operation}' failed.`,
        result.exception ?? result,
      );
    }

    const item = result.stack?.[0];

    if (!item || typeof item.value !== "string") {
      throw new NeoRpcError(
        `Neo N3 call '${operation}' did not return a string value.`,
        result,
      );
    }

    if (item.type === "ByteString" || item.type === "Buffer") {
      return Buffer.from(item.value, "base64").toString("utf8");
    }

    return item.value;
  }

  private normalizeRecord(value: {
    toJSON?: () => unknown;
  }): Record<string, unknown> {
    const normalizedValue =
      typeof value.toJSON === "function" ? value.toJSON() : value;

    return normalizeResult(normalizedValue) as Record<string, unknown>;
  }

  private normalizeUnknownRecord(
    value: unknown,
  ): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null) {
      return null;
    }

    return normalizeResult(value) as Record<string, unknown>;
  }

  private isSuccessfulReceiptStatus(status: unknown): boolean {
    if (typeof status === "number") {
      return status === 1;
    }

    if (typeof status === "bigint") {
      return status === 1n;
    }

    if (typeof status === "string") {
      return status === "1" || status.toLowerCase() === "0x1";
    }

    return status === true;
  }

  private extractNeoN3VmState(
    applicationLog: Record<string, unknown> | null,
  ): string | undefined {
    if (!applicationLog) {
      return undefined;
    }

    const executions = applicationLog.executions;

    if (!Array.isArray(executions) || executions.length === 0) {
      return undefined;
    }

    const firstExecution = executions[0];

    if (typeof firstExecution !== "object" || firstExecution === null) {
      return undefined;
    }

    if (
      "vmstate" in firstExecution &&
      typeof firstExecution.vmstate === "string"
    ) {
      return firstExecution.vmstate;
    }

    if (
      "vmState" in firstExecution &&
      typeof firstExecution.vmState === "string"
    ) {
      return firstExecution.vmState;
    }

    return undefined;
  }

  private extractBlockNumber(
    transaction: Record<string, unknown> | null,
  ): number | undefined {
    if (!transaction) {
      return undefined;
    }

    const blockIndex = transaction.blockindex;

    if (typeof blockIndex === "number") {
      return blockIndex;
    }

    if (typeof blockIndex === "string") {
      const parsed = Number(blockIndex);

      if (Number.isInteger(parsed)) {
        return parsed;
      }
    }

    return undefined;
  }

  private toNeoN3ScriptHash(address: string): string {
    return `0x${neoWallet.getScriptHashFromAddress(address)}`;
  }

  private async loadErc20Metadata(
    contractAddress: string,
  ): Promise<TokenMetadata> {
    const normalizedAddress = getAddress(contractAddress);
    const cached = this.tokenMetadataCache.get(normalizedAddress);

    if (cached) {
      return cached;
    }

    const task = (async () => {
      const contract = new Contract(normalizedAddress, erc20Abi, this.provider);
      const [symbol, decimals, name] = await Promise.all([
        contract.symbol(),
        contract.decimals(),
        contract.name().catch(() => undefined),
      ]);

      return {
        contractAddress: normalizedAddress,
        symbol: String(symbol).trim(),
        decimals: Number(decimals),
        name: name ? String(name).trim() : undefined,
      };
    })();

    this.tokenMetadataCache.set(normalizedAddress, task);

    return task;
  }

  private async loadNeoN3Metadata(
    contractHash: string,
  ): Promise<TokenMetadata> {
    const normalizedHash = hash160Schema.parse(contractHash);
    const cached = this.neoN3TokenMetadataCache.get(normalizedHash);
    const knownMetadata = this.getKnownNeoN3TokenMetadata(normalizedHash);

    if (cached) {
      return cached;
    }

    if (knownMetadata) {
      const knownMetadataTask = Promise.resolve(knownMetadata);

      this.neoN3TokenMetadataCache.set(normalizedHash, knownMetadataTask);

      return knownMetadataTask;
    }

    const task = (async () => {
      try {
        return await this.loadNeoN3MetadataFromApi(normalizedHash);
      } catch (apiError) {
        try {
          return await this.loadNeoN3MetadataFromContract(normalizedHash);
        } catch (contractError) {
          throw new ProviderCapabilityError(
            `Unable to load Neo N3 token metadata for ${normalizedHash}.`,
            {
              apiError: apiError instanceof Error ? apiError.message : apiError,
              contractError:
                contractError instanceof Error
                  ? contractError.message
                  : contractError,
            },
          );
        }
      }
    })();

    this.neoN3TokenMetadataCache.set(normalizedHash, task);

    return task;
  }

  private async loadNeoN3MetadataFromApi(
    contractHash: string,
  ): Promise<TokenMetadata> {
    const [info] = await neoApi.getTokenInfos(
      [contractHash],
      this.requireNeoN3RpcClient(),
    );

    return {
      contractAddress: contractHash,
      symbol: info.symbol.trim(),
      decimals: info.decimals,
    };
  }

  private async loadNeoN3MetadataFromContract(
    contractHash: string,
  ): Promise<TokenMetadata> {
    const rpcClient = this.requireNeoN3RpcClient();
    const [symbolResult, decimalsResult] = await Promise.all([
      rpcClient.invokeFunction(contractHash, "symbol"),
      rpcClient.invokeFunction(contractHash, "decimals"),
    ]);
    const symbol = this.parseNeoN3StringResult(symbolResult, "symbol").trim();
    const decimals = Number(
      this.parseNeoN3IntegerResult(decimalsResult, "decimals"),
    );

    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
      throw new NeoRpcError(
        `Neo N3 token ${contractHash} returned an invalid decimals value.`,
        {
          decimals,
        },
      );
    }

    return {
      contractAddress: contractHash,
      symbol,
      decimals,
    };
  }

  private getKnownNeoN3TokenMetadata(
    contractHash: string,
  ): TokenMetadata | undefined {
    const normalizedHash = hash160Schema.parse(contractHash);
    const metadata = knownNeoN3TokenMetadataByContractHash[normalizedHash];

    if (!metadata) {
      return undefined;
    }

    return {
      contractAddress: normalizedHash,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      name: metadata.name,
    };
  }

  private getNativeGasToken(): TokenMetadata {
    return {
      contractAddress: this.config.erc20.wrappedGasAddress,
      symbol: "GAS",
      decimals: 18,
      name: "Gas",
      isNative: true,
    };
  }

  private getNeoN3GasToken(): TokenMetadata {
    return {
      contractAddress: this.config.bridge.neoN3GasTokenContract,
      symbol: "GAS",
      decimals: 8,
      name: "Gas",
      isNative: true,
    };
  }

  private getNeoN3NeoToken(): TokenMetadata {
    return {
      contractAddress: `0x${neoConst.NATIVE_CONTRACT_HASH.NeoToken}`,
      symbol: "NEO",
      decimals: 0,
      name: "Neo",
      isNative: true,
    };
  }

  private async getTokenBalance(
    owner: string,
    token: TokenMetadata,
  ): Promise<TokenBalance> {
    if (token.isNative) {
      return this.getNativeBalance(owner);
    }

    const contract = new Contract(
      token.contractAddress,
      erc20Abi,
      this.provider,
    );
    const rawBalance = (await contract.balanceOf(owner)) as bigint;

    return {
      ...token,
      owner,
      rawBalance: rawBalance.toString(),
      balance: formatUnits(rawBalance, token.decimals),
    };
  }

  private async getNeoN3TokenBalance(
    owner: string,
    token: TokenMetadata,
  ): Promise<TokenBalance> {
    const result = await this.requireNeoN3RpcClient().invokeFunction(
      token.contractAddress,
      "balanceOf",
      [neoSc.ContractParam.hash160(neoWallet.getScriptHashFromAddress(owner))],
    );
    const rawBalance = this.parseNeoN3IntegerResult(result, "balanceOf");

    return {
      ...token,
      owner,
      rawBalance: rawBalance.toString(),
      balance: formatUnits(rawBalance, token.decimals),
    };
  }

  private async safeResolveNeoN3TokenMetadata(
    token: string,
  ): Promise<TokenMetadata> {
    try {
      return await this.resolveNeoN3TokenMetadata(token);
    } catch {
      const contractHash = hash160Schema.parse(token);
      const knownMetadata = this.getKnownNeoN3TokenMetadata(contractHash);

      if (knownMetadata) {
        return knownMetadata;
      }

      return {
        contractAddress: contractHash,
        symbol: contractHash.slice(0, 10),
        decimals: 0,
      };
    }
  }

  private async getNeoN3TrackedTokenBalances(
    owner: string,
    contracts: string[],
  ): Promise<TokenBalance[]> {
    if (contracts.length === 0) {
      return [];
    }

    const rpcClient = this.requireNeoN3RpcClient();
    const [balances, metadata] = await Promise.all([
      neoApi.getTokenBalances(owner, contracts, rpcClient),
      Promise.all(
        contracts.map((contractHash) =>
          this.safeResolveNeoN3TokenMetadata(contractHash),
        ),
      ),
    ]);

    return metadata
      .map((token, index) => {
        const balance = balances[index];
        const rawBalance = parseUnits(balance, token.decimals);

        return {
          ...token,
          owner,
          rawBalance: rawBalance.toString(),
          balance,
        };
      })
      .filter((balance) => balance.rawBalance !== "0");
  }

  private getTrackedNeoN3TokenContracts(): string[] {
    const nativeNeoHash = this.getNeoN3NeoToken().contractAddress;
    const nativeGasHash = this.getNeoN3GasToken().contractAddress;

    return [...new Set(Object.values(this.config.neoN3.tokenMap))]
      .map((contractHash) => hash160Schema.parse(contractHash))
      .filter(
        (contractHash) =>
          contractHash !== nativeGasHash && contractHash !== nativeNeoHash,
      );
  }

  private async resolveBestNeoN3SwapPath(input: {
    amountInRaw: bigint;
    fromToken: TokenMetadata;
    toToken: TokenMetadata;
  }): Promise<ResolvedNeoN3SwapPath> {
    const candidates = await this.buildNeoN3SwapCandidates(
      input.fromToken,
      input.toToken,
    );
    const quotes = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const routeAmountsRaw = await this.getNeoN3SwapPathQuote(
            input.amountInRaw,
            candidate.routeContracts,
            candidate.tradingPairIds,
          );
          const routeTokens = await Promise.all(
            candidate.routeContracts.map((contractHash) =>
              this.safeResolveNeoN3TokenMetadata(contractHash),
            ),
          );

          return {
            routeContracts: candidate.routeContracts,
            routeSymbols: routeTokens.map((token) => token.symbol),
            tradingPairIds: candidate.tradingPairIds,
            routeAmountsRaw,
          };
        } catch {
          return undefined;
        }
      }),
    );
    const viableQuotes = quotes.filter(
      (quote): quote is ResolvedNeoN3SwapPath => quote !== undefined,
    );

    if (viableQuotes.length === 0) {
      throw new NotFoundError(
        `No Flamingo route was found for ${input.fromToken.symbol} -> ${input.toToken.symbol} on Neo N3.`,
      );
    }

    viableQuotes.sort((left, right) => {
      const leftAmount = left.routeAmountsRaw[left.routeAmountsRaw.length - 1];
      const rightAmount =
        right.routeAmountsRaw[right.routeAmountsRaw.length - 1];

      if (leftAmount === rightAmount) {
        return left.routeContracts.length - right.routeContracts.length;
      }

      return leftAmount > rightAmount ? -1 : 1;
    });

    return viableQuotes[0];
  }

  private async buildNeoN3SwapCandidates(
    fromToken: TokenMetadata,
    toToken: TokenMetadata,
  ): Promise<
    Array<{
      routeContracts: string[];
      tradingPairIds: number[];
    }>
  > {
    const tradingPairs = await this.getNeoN3FlamingoTradingPairs();
    const candidates: Array<{
      routeContracts: string[];
      tradingPairIds: number[];
    }> = [];
    const directPair = this.findNeoN3FlamingoTradingPair(
      tradingPairs,
      fromToken.contractAddress,
      toToken.contractAddress,
    );

    if (directPair) {
      candidates.push({
        routeContracts: [fromToken.contractAddress, toToken.contractAddress],
        tradingPairIds: [directPair.pairId],
      });
    }

    const fusdContractHash = this.config.neoN3.tokenMap.FUSD;

    if (
      fusdContractHash &&
      fusdContractHash !== fromToken.contractAddress &&
      fusdContractHash !== toToken.contractAddress
    ) {
      const firstHopPair = this.findNeoN3FlamingoTradingPair(
        tradingPairs,
        fromToken.contractAddress,
        fusdContractHash,
      );
      const secondHopPair = this.findNeoN3FlamingoTradingPair(
        tradingPairs,
        fusdContractHash,
        toToken.contractAddress,
      );

      if (firstHopPair && secondHopPair) {
        candidates.push({
          routeContracts: [
            fromToken.contractAddress,
            fusdContractHash,
            toToken.contractAddress,
          ],
          tradingPairIds: [firstHopPair.pairId, secondHopPair.pairId],
        });
      }
    }

    return candidates.filter((candidate, index, entries) => {
      const signature = [
        candidate.routeContracts.join(">"),
        candidate.tradingPairIds.join(">"),
      ].join("|");

      return (
        index ===
        entries.findIndex((entry) => {
          return (
            [
              entry.routeContracts.join(">"),
              entry.tradingPairIds.join(">"),
            ].join("|") === signature
          );
        })
      );
    });
  }

  private async getNeoN3SwapPathQuote(
    amountInRaw: bigint,
    routeContracts: string[],
    tradingPairIds: number[],
  ): Promise<bigint[]> {
    const routeAmountsRaw = [amountInRaw];

    for (let index = 0; index < tradingPairIds.length; index += 1) {
      const amountOutRaw = await this.getNeoN3ConvertAmountOut(
        amountInRaw,
        routeContracts.slice(0, index + 2),
        tradingPairIds.slice(0, index + 1),
      );

      routeAmountsRaw.push(amountOutRaw);
    }

    return routeAmountsRaw;
  }

  private async getNeoN3ConvertAmountOut(
    amountInRaw: bigint,
    routeContracts: string[],
    tradingPairIds: number[],
  ): Promise<bigint> {
    const result = await this.invokeNeoN3Read(
      await this.resolveNeoN3FlamingoConvertContractAddress(),
      "emulateStandardConvert",
      [
        {
          type: "Integer",
          value: amountInRaw.toString(),
        },
        {
          type: "Integer",
          value: "0",
        },
        {
          type: "Array",
          value: routeContracts.map((contractHash) => ({
            type: "Hash160",
            value: contractHash,
          })),
        },
        {
          type: "Array",
          value: tradingPairIds.map((pairId) => ({
            type: "Integer",
            value: String(pairId),
          })),
        },
      ],
    );

    return this.parseNeoN3ConvertAmountResult(
      result.result,
      "emulateStandardConvert",
    );
  }

  private parseNeoN3ConvertAmountResult(
    value: unknown,
    operation: string,
  ): bigint {
    if (typeof value !== "string") {
      throw new NeoRpcError(
        `Neo N3 call '${operation}' did not return an integer result.`,
        value,
      );
    }

    return BigInt(value);
  }

  private normalizeSwapSlippagePercent(requested?: string): string {
    if (!requested) {
      return "1";
    }

    const value = Number(requested);

    if (!Number.isFinite(value) || value <= 0 || value > 50) {
      throw new ValidationError(
        "Swap slippagePercent must be a decimal percent between 0 and 50.",
      );
    }

    return requested;
  }

  private toBasisPoints(percent: string): number {
    return Math.round(Number(percent) * 100);
  }

  private applySlippage(amount: bigint, slippageBps: number): bigint {
    return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
  }

  private toNeoN3ContractParam(
    argument: unknown,
  ): InstanceType<typeof neoSc.ContractParam> {
    if (isNeoN3StructuredArgument(argument)) {
      const value = argument.value;

      if (argument.type === "Address") {
        if (typeof value !== "string") {
          throw new ValidationError(
            "Neo N3 Address arguments must provide a string value.",
          );
        }

        return neoSc.ContractParam.hash160(
          neoWallet.getScriptHashFromAddress(neoN3AddressSchema.parse(value)),
        );
      }

      if (argument.type === "Hash160") {
        return neoSc.ContractParam.hash160(hash160Schema.parse(String(value)));
      }

      if (argument.type === "Hash256") {
        return neoSc.ContractParam.hash256(hash256Schema.parse(String(value)));
      }

      if (argument.type === "String") {
        return neoSc.ContractParam.string(String(value ?? ""));
      }

      if (argument.type === "Integer") {
        if (
          typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "bigint"
        ) {
          throw new ValidationError(
            "Neo N3 Integer arguments must provide a string, number, or bigint value.",
          );
        }

        return neoSc.ContractParam.integer(
          typeof value === "bigint" ? value.toString() : value,
        );
      }

      if (argument.type === "Boolean") {
        if (
          typeof value !== "boolean" &&
          typeof value !== "string" &&
          typeof value !== "number"
        ) {
          throw new ValidationError(
            "Neo N3 Boolean arguments must provide a boolean-like value.",
          );
        }

        return neoSc.ContractParam.boolean(value);
      }

      if (argument.type === "ByteArray") {
        return neoSc.ContractParam.byteArray(String(value ?? ""));
      }

      if (argument.type === "PublicKey") {
        return neoSc.ContractParam.publicKey(String(value ?? ""));
      }

      if (argument.type === "Array") {
        if (!Array.isArray(value)) {
          throw new ValidationError(
            "Neo N3 Array arguments must provide an array value.",
          );
        }

        return neoSc.ContractParam.array(
          ...value.map((entry) => this.toNeoN3ContractParam(entry)),
        );
      }

      return neoSc.ContractParam.any(
        value === undefined || value === null ? null : String(value),
      );
    }

    if (argument === null) {
      return neoSc.ContractParam.any(null);
    }

    if (typeof argument === "boolean") {
      return neoSc.ContractParam.boolean(argument);
    }

    if (typeof argument === "number") {
      return neoSc.ContractParam.integer(argument);
    }

    if (typeof argument === "bigint") {
      return neoSc.ContractParam.integer(argument.toString());
    }

    if (Array.isArray(argument)) {
      return neoSc.ContractParam.array(
        ...argument.map((entry) => this.toNeoN3ContractParam(entry)),
      );
    }

    if (typeof argument === "string") {
      return neoSc.ContractParam.string(argument);
    }

    throw new ValidationError(
      "Unsupported Neo N3 contract argument. Use primitives or { type, value } objects.",
    );
  }

  private normalizeNeoN3InvokeResult(stack?: unknown[]): unknown {
    if (!Array.isArray(stack) || stack.length === 0) {
      return null;
    }

    if (stack.length === 1) {
      return this.normalizeNeoN3StackItem(stack[0]);
    }

    return stack.map((item) => this.normalizeNeoN3StackItem(item));
  }

  private normalizeNeoN3StackItem(item: unknown): unknown {
    if (typeof item !== "object" || item === null) {
      return item;
    }

    if (!("type" in item) || typeof item.type !== "string") {
      return normalizeResult(item);
    }

    if (!("value" in item)) {
      return null;
    }

    if (item.type === "Integer") {
      return String(item.value);
    }

    if (item.type === "Boolean") {
      if (typeof item.value === "boolean") {
        return item.value;
      }

      if (typeof item.value === "string") {
        return item.value.toLowerCase() === "true" || item.value === "1";
      }
    }

    if (item.type === "ByteString" || item.type === "Buffer") {
      if (typeof item.value === "string") {
        const bytes = Buffer.from(item.value, "base64");
        const decoded = bytes.toString("utf8");

        if (/^[\x20-\x7E]*$/.test(decoded)) {
          return decoded;
        }

        return `0x${bytes.toString("hex")}`;
      }
    }

    if (
      (item.type === "Array" || item.type === "Struct") &&
      Array.isArray(item.value)
    ) {
      return item.value.map((entry) => this.normalizeNeoN3StackItem(entry));
    }

    if (item.type === "Map" && Array.isArray(item.value)) {
      return item.value.map((entry) => {
        if (typeof entry !== "object" || entry === null) {
          return normalizeResult(entry);
        }

        return {
          key:
            "key" in entry
              ? this.normalizeNeoN3StackItem(entry.key)
              : undefined,
          value:
            "value" in entry
              ? this.normalizeNeoN3StackItem(entry.value)
              : undefined,
        };
      });
    }

    return normalizeResult(item.value);
  }

  private async buildPreparedTransaction(
    input: PreparedTransactionInput,
  ): Promise<PreparedTransaction> {
    const wallet = this.requireWallet();
    const sender = wallet.address;
    const chainId = await this.getChainId();
    const nonce = await this.provider.getTransactionCount(sender, "pending");
    const feeData = await this.provider.getFeeData();
    const estimationRequest: TransactionRequest = {
      from: sender,
      to: getAddress(input.to),
      data: input.data,
      value: input.value ? BigInt(input.value) : undefined,
      nonce,
      chainId,
    };

    if (
      feeData.maxFeePerGas !== null &&
      feeData.maxPriorityFeePerGas !== null
    ) {
      estimationRequest.maxFeePerGas = feeData.maxFeePerGas;
      estimationRequest.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    } else if (feeData.gasPrice !== null) {
      estimationRequest.gasPrice = feeData.gasPrice;
    }

    const gasLimit = await this.provider.estimateGas(estimationRequest);
    const request: PreparedTransactionRequest = {
      to: getAddress(input.to),
      nonce,
      chainId,
      gasLimit: gasLimit.toString(),
      data: input.data,
      value: input.value,
      gasPrice: estimationRequest.gasPrice?.toString(),
      maxFeePerGas: estimationRequest.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: estimationRequest.maxPriorityFeePerGas?.toString(),
    };

    return {
      kind: "transaction",
      action: input.action,
      summary: input.summary,
      unsignedTransaction: JSON.stringify(request),
      network: input.network ?? "neoX",
      sender,
      chainId,
      nonce,
      gasLimit: request.gasLimit,
      gasPrice: request.gasPrice,
      maxFeePerGas: request.maxFeePerGas,
      maxPriorityFeePerGas: request.maxPriorityFeePerGas,
      to: request.to,
      value: request.value,
      data: request.data,
      amount: input.amount,
      tokenAddress: input.tokenAddress,
      tokenSymbol: input.tokenSymbol,
      toTokenAddress: input.toTokenAddress,
      toTokenSymbol: input.toTokenSymbol,
      amountOut: input.amountOut,
      minimumAmountOut: input.minimumAmountOut,
      slippagePercent: input.slippagePercent,
      routeSymbols: input.routeSymbols,
      routeContracts: input.routeContracts,
      deadlineMinutes: input.deadlineMinutes,
      deadlineTimestamp: input.deadlineTimestamp,
      spender: input.spender,
      contractAddress: input.contractAddress,
      functionSignature: input.functionSignature,
      bridgeDirection: input.bridgeDirection,
      destinationAddress: input.destinationAddress,
      maxFee: input.maxFee,
      estimatedReceived: input.estimatedReceived,
      minimumAmount: input.minimumAmount,
      maximumAmount: input.maximumAmount,
      bridgeEtaLowMinutes: input.bridgeEtaLowMinutes,
      bridgeEtaHighMinutes: input.bridgeEtaHighMinutes,
      bridgeContractAddress: input.bridgeContractAddress,
      allowedContracts: input.allowedContracts,
      request,
    };
  }

  private toTransactionRequest(
    request: PreparedTransactionRequest,
  ): TransactionRequest {
    const transactionRequest: TransactionRequest = {
      to: request.to,
      nonce: request.nonce,
      chainId: request.chainId,
      gasLimit: BigInt(request.gasLimit),
      data: request.data,
      value: request.value ? BigInt(request.value) : undefined,
    };

    if (request.maxFeePerGas && request.maxPriorityFeePerGas) {
      transactionRequest.maxFeePerGas = BigInt(request.maxFeePerGas);
      transactionRequest.maxPriorityFeePerGas = BigInt(
        request.maxPriorityFeePerGas,
      );
    } else if (request.gasPrice) {
      transactionRequest.gasPrice = BigInt(request.gasPrice);
    }

    return transactionRequest;
  }

  private async getChainId(): Promise<number> {
    if (!this.chainIdPromise) {
      this.chainIdPromise = (async () => {
        const network = await this.provider.getNetwork();
        const chainId = Number(network.chainId);

        if (chainId !== this.config.neoXChainId) {
          throw new ProviderCapabilityError(
            `Connected chain ID ${chainId} does not match configured NEOX_CHAIN_ID ${this.config.neoXChainId}.`,
          );
        }

        return chainId;
      })();
    }

    return this.chainIdPromise;
  }

  private async getNeoN3NetworkMagic(): Promise<number> {
    if (!this.neoN3NetworkMagicPromise) {
      this.neoN3NetworkMagicPromise = (async () => {
        const version = await this.requireNeoN3RpcClient().getVersion();
        const networkMagic = Number(version.protocol.network);

        if (!Number.isInteger(networkMagic) || networkMagic <= 0) {
          throw new NeoRpcError(
            "Neo N3 RPC did not return a valid network magic value.",
            version,
          );
        }

        return networkMagic;
      })();
    }

    return this.neoN3NetworkMagicPromise;
  }

  private requireNeoXBridgeContractAddress(): string {
    const bridgeContractAddress = this.config.bridge.neoXContract;

    if (!bridgeContractAddress) {
      throw new ProviderCapabilityError(
        "Neo X bridge is not configured. Set NEOX_BRIDGE_CONTRACT to enable Neo X -> Neo N3 bridging.",
      );
    }

    return bridgeContractAddress;
  }

  private requireNeoN3BridgeContractAddress(): string {
    const bridgeContractAddress = this.config.bridge.neoN3Contract;

    if (!bridgeContractAddress) {
      throw new ProviderCapabilityError(
        "Neo N3 bridge is not configured. Set NEO_N3_BRIDGE_CONTRACT to enable Neo N3 -> Neo X bridging.",
      );
    }

    return bridgeContractAddress;
  }

  private requireNeoN3NameServiceContractAddress(): string {
    const nnsContractAddress = this.config.neoN3.nnsContract;

    if (!nnsContractAddress) {
      throw new ProviderCapabilityError(
        "NeoNS resolution is not configured. Set NEO_N3_NNS_CONTRACT to enable NeoNS recipients.",
      );
    }

    return nnsContractAddress;
  }

  private async resolveNeoN3FlamingoRouterContractAddress(): Promise<string> {
    if (!this.neoN3ResolvedFlamingoRouterContractPromise) {
      this.neoN3ResolvedFlamingoRouterContractPromise =
        this.resolveNeoN3FlamingoContractAddress({
          configuredAddress: this.config.neoN3.flamingoRouterContract,
          operationNames: ["getAmountsOut", "getBrokerContract"],
          environmentVariableName: "NEO_N3_FLAMINGO_ROUTER_CONTRACT",
          defaultByNetworkMagic: {
            [neoN3MainnetNetworkMagic]:
              defaultNeoN3MainnetFlamingoRouterContract,
            [neoN3TestnetNetworkMagic]:
              defaultNeoN3TestnetFlamingoRouterContract,
          },
        });
    }

    return this.neoN3ResolvedFlamingoRouterContractPromise;
  }

  private async resolveNeoN3FlamingoBrokerContractAddress(): Promise<string> {
    if (!this.neoN3ResolvedFlamingoBrokerContractPromise) {
      this.neoN3ResolvedFlamingoBrokerContractPromise =
        this.resolveNeoN3FlamingoContractAddress({
          configuredAddress: this.config.neoN3.flamingoBrokerContract,
          operationNames: ["getPairCounter", "getBaseToken", "getQuoteToken"],
          environmentVariableName: "NEO_N3_FLAMINGO_BROKER_CONTRACT",
          defaultByNetworkMagic: {
            [neoN3MainnetNetworkMagic]:
              defaultNeoN3MainnetFlamingoBrokerContract,
            [neoN3TestnetNetworkMagic]:
              defaultNeoN3TestnetFlamingoBrokerContract,
          },
        });
    }

    return this.neoN3ResolvedFlamingoBrokerContractPromise;
  }

  private async resolveNeoN3FlamingoConvertContractAddress(): Promise<string> {
    if (!this.neoN3ResolvedFlamingoConvertContractPromise) {
      this.neoN3ResolvedFlamingoConvertContractPromise =
        this.resolveNeoN3FlamingoContractAddress({
          configuredAddress: this.config.neoN3.flamingoConvertContract,
          operationNames: ["standardConvert", "emulateStandardConvert"],
          environmentVariableName: "NEO_N3_FLAMINGO_CONVERT_CONTRACT",
          defaultByNetworkMagic: {
            [neoN3MainnetNetworkMagic]:
              defaultNeoN3MainnetFlamingoConvertContract,
            [neoN3TestnetNetworkMagic]:
              defaultNeoN3TestnetFlamingoConvertContract,
          },
        });
    }

    return this.neoN3ResolvedFlamingoConvertContractPromise;
  }

  private async getNeoN3FlamingoTradingPairs(): Promise<
    NeoN3FlamingoTradingPair[]
  > {
    if (!this.neoN3FlamingoTradingPairsPromise) {
      this.neoN3FlamingoTradingPairsPromise = (async () => {
        const pairCounter = Number(
          await this.invokeNeoN3IntegerRead(
            await this.resolveNeoN3FlamingoBrokerContractAddress(),
            "getPairCounter",
          ),
        );

        if (!Number.isInteger(pairCounter) || pairCounter <= 0) {
          return [];
        }

        const pairIds = Array.from({ length: pairCounter }, (_, index) => {
          return index + 1;
        });
        const pairs = await Promise.all(
          pairIds.map(async (pairId) => {
            const [baseTokenHash, quoteTokenHash] = await Promise.all([
              this.invokeNeoN3Hash160Read(
                await this.resolveNeoN3FlamingoBrokerContractAddress(),
                "getBaseToken",
                [{ type: "Integer", value: String(pairId) }],
              ),
              this.invokeNeoN3Hash160Read(
                await this.resolveNeoN3FlamingoBrokerContractAddress(),
                "getQuoteToken",
                [{ type: "Integer", value: String(pairId) }],
              ),
            ]);

            return {
              pairId,
              baseTokenHash,
              quoteTokenHash,
            };
          }),
        );

        return pairs.filter((pair) => {
          return pair.baseTokenHash !== pair.quoteTokenHash;
        });
      })();
    }

    return this.neoN3FlamingoTradingPairsPromise;
  }

  private findNeoN3FlamingoTradingPair(
    tradingPairs: NeoN3FlamingoTradingPair[],
    leftTokenHash: string,
    rightTokenHash: string,
  ): NeoN3FlamingoTradingPair | undefined {
    return tradingPairs.find((pair) => {
      return (
        (pair.baseTokenHash === leftTokenHash &&
          pair.quoteTokenHash === rightTokenHash) ||
        (pair.baseTokenHash === rightTokenHash &&
          pair.quoteTokenHash === leftTokenHash)
      );
    });
  }

  private async invokeNeoN3IntegerRead(
    contractHash: string,
    operation: string,
    args: unknown[] = [],
  ): Promise<bigint> {
    const target = hash160Schema.parse(contractHash);
    const result = await this.requireNeoN3RpcClient().invokeFunction(
      target,
      operation.trim(),
      args.map((arg) => this.toNeoN3ContractParam(arg)),
    );

    if (result.state !== "HALT") {
      throw new NeoRpcError(
        `Neo N3 call '${operation}' failed.`,
        result.exception ?? result,
      );
    }

    return this.parseNeoN3IntegerResult(result, operation);
  }

  private async invokeNeoN3Hash160Read(
    contractHash: string,
    operation: string,
    args: unknown[] = [],
  ): Promise<string> {
    const target = hash160Schema.parse(contractHash);
    const result = await this.requireNeoN3RpcClient().invokeFunction(
      target,
      operation.trim(),
      args.map((arg) => this.toNeoN3ContractParam(arg)),
    );

    if (result.state !== "HALT") {
      throw new NeoRpcError(
        `Neo N3 call '${operation}' failed.`,
        result.exception ?? result,
      );
    }

    const [firstStackItem] = result.stack ?? [];

    if (
      !firstStackItem ||
      typeof firstStackItem !== "object" ||
      firstStackItem === null ||
      !("value" in firstStackItem) ||
      typeof firstStackItem.value !== "string"
    ) {
      throw new NeoRpcError(
        `Neo N3 call '${operation}' did not return a hash160 result.`,
        result,
      );
    }

    const decodedHash = Buffer.from(firstStackItem.value, "base64")
      .reverse()
      .toString("hex");

    return hash160Schema.parse(`0x${decodedHash}`);
  }

  private async resolveNeoN3FlamingoContractAddress(input: {
    configuredAddress?: string;
    operationNames: string[];
    environmentVariableName: string;
    defaultByNetworkMagic: Record<number, string>;
  }): Promise<string> {
    const networkMagic = await this.getNeoN3NetworkMagic();
    const defaultAddress = input.defaultByNetworkMagic[networkMagic];
    const candidates = [input.configuredAddress, defaultAddress].filter(
      (entry): entry is string => Boolean(entry),
    );

    for (const candidate of [...new Set(candidates)]) {
      if (
        await this.neoN3ContractSupportsOperations(
          candidate,
          input.operationNames,
        )
      ) {
        return candidate;
      }
    }

    throw new ProviderCapabilityError(
      `Flamingo swap is not configured for the active Neo N3 network. Set ${input.environmentVariableName} to a valid contract hash for this RPC endpoint.`,
      {
        networkMagic,
        configuredAddress: input.configuredAddress,
        defaultAddress,
      },
    );
  }

  private async neoN3ContractSupportsOperations(
    contractHash: string,
    operationNames: string[],
  ): Promise<boolean> {
    try {
      const contractState =
        await this.requireNeoN3RpcClient().getContractState(contractHash);
      const contractOperations = new Set(
        contractState.manifest.abi.methods.map((method) => method.name),
      );

      return operationNames.every((operationName) => {
        return contractOperations.has(operationName);
      });
    } catch {
      return false;
    }
  }

  private requireNeoN3RpcUrl(): string {
    const rpcUrl = this.config.neoN3.rpcUrl;

    if (!rpcUrl) {
      throw new ProviderCapabilityError(
        "Neo N3 RPC is not configured. Set NEO_N3_RPC_URL to enable Neo N3 bridging.",
      );
    }

    return rpcUrl;
  }

  private requireNeoN3RpcClient(): InstanceType<typeof neoRpc.RPCClient> {
    if (!this.neoN3RpcClient) {
      throw new ProviderCapabilityError(
        "Neo N3 RPC is not configured. Set NEO_N3_RPC_URL to enable Neo N3 bridging.",
      );
    }

    return this.neoN3RpcClient;
  }

  private requireNeoN3Wallet(): InstanceType<typeof neoWallet.Account> {
    if (!this.neoN3Wallet) {
      throw new WalletUnavailableError(
        "Set WALLET_WIF or WALLET_PRIVATE_KEY to enable Neo N3 write actions.",
      );
    }

    return this.neoN3Wallet;
  }

  private requireWallet(): Wallet {
    if (!this.wallet) {
      throw new WalletUnavailableError(
        "Set NEO_X_WALLET_PRIVATE_KEY to enable Neo X write actions.",
      );
    }

    return this.wallet;
  }
}

export function createNeoProvider(config: AppConfig): NeoProvider {
  return new NeoXProvider(config);
}

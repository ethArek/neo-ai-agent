import {
  experimental,
  api as neoApi,
  CONST as neoConst,
  rpc as neoRpc,
  sc as neoSc,
  tx as neoTx,
  wallet as neoWallet,
} from "@cityofzion/neon-js";

import {
  type AppConfig,
  defaultNeoN3FlamingoContractsByNetwork,
} from "../core/config";
import {
  NeoRpcError,
  NotFoundError,
  ProviderCapabilityError,
  ValidationError,
  WalletUnavailableError,
} from "../core/errors";
import {
  hash160Schema,
  hash256Schema,
  isNeoNsName,
  neoN3AddressOrNeoNsSchema,
  neoN3AddressSchema,
} from "../core/validation";
import { createBroadcastResult } from "./broadcast";
import type {
  BlockReference,
  BroadcastResult,
  NeoN3ContractWriteInput,
  NeoN3PortfolioOverview,
  NeoN3ReadInvocationResult,
  NeoN3SwapQuote,
  NeoN3SwapQuoteInput,
  NeoN3TokenSwapInput,
  NeoN3TokenTransferInput,
  NeoN3TransferHistory,
  NeoN3UnclaimedGas,
  NeoNetwork,
  NeoProvider,
  NetworkAddressMap,
  PreparedTransaction,
  ProviderReadiness,
  TokenBalance,
  TokenMetadata,
  TransactionDetails,
  TransactionLookup,
  TransactionStatus,
  TransactionStatusLookup,
} from "./types";

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

interface PreparedTransactionInput {
  action: PreparedTransaction["action"];
  summary: string;
  transaction: InstanceType<typeof neoTx.Transaction>;
  sender: string;
  networkMagic: number;
  to: string;
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
  allowedContracts: string[];
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
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

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

function parseDecimalAmount(value: string, decimals: number): bigint {
  const normalizedValue = value.trim();

  if (!decimalPattern.test(normalizedValue)) {
    throw new ValidationError(`Invalid decimal amount '${value}'.`);
  }

  const [wholePart, fractionalPart = ""] = normalizedValue.split(".");

  if (fractionalPart.length > decimals) {
    throw new ValidationError(
      `Amount '${value}' exceeds the supported ${decimals} decimal places.`,
    );
  }

  const paddedFraction = fractionalPart.padEnd(decimals, "0");
  const combined = `${wholePart}${paddedFraction}`.replace(/^0+(?=\d)/, "");

  return BigInt(combined === "" ? "0" : combined);
}

function formatDecimalAmount(value: bigint, decimals: number): string {
  if (decimals === 0) {
    return value.toString();
  }

  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const digits = absolute.toString().padStart(decimals + 1, "0");
  const wholePart = digits.slice(0, -decimals) || "0";
  const fractionalPart = digits.slice(-decimals).replace(/0+$/, "");
  const formatted = fractionalPart
    ? `${wholePart}.${fractionalPart}`
    : wholePart;

  return negative ? `-${formatted}` : formatted;
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

export class NeoN3Provider implements NeoProvider {
  private readonly config: AppConfig;
  private readonly neoN3RpcClient: InstanceType<typeof neoRpc.RPCClient>;
  private readonly neoN3Wallet?: InstanceType<typeof neoWallet.Account>;
  private readonly neoN3TokenMetadataCache = new Map<
    string,
    Promise<TokenMetadata>
  >();
  private neoN3NetworkMagicPromise?: Promise<number>;
  private neoN3FlamingoTradingPairsPromise?: Promise<
    NeoN3FlamingoTradingPair[]
  >;
  private neoN3ResolvedFlamingoBrokerContractPromise?: Promise<string>;
  private neoN3ResolvedFlamingoConvertContractPromise?: Promise<string>;

  public constructor(config: AppConfig) {
    this.config = config;
    this.neoN3RpcClient = new neoRpc.RPCClient(config.neoN3.rpcUrl);
    this.neoN3Wallet = config.neoN3.walletPrivateKey
      ? new neoWallet.Account(config.neoN3.walletPrivateKey)
      : undefined;
  }

  public getImplementedNetworks(): NeoNetwork[] {
    return ["neoN3"];
  }

  public getDefaultNetwork(): NeoNetwork {
    return "neoN3";
  }

  public getWalletAddresses(): NetworkAddressMap {
    const neoN3Address = this.getWalletAddress("neoN3");

    return neoN3Address
      ? {
          neoN3: neoN3Address,
        }
      : {};
  }

  public getWalletAddress(network: NeoNetwork): string | undefined {
    return network === "neoN3" ? this.neoN3Wallet?.address : undefined;
  }

  public async getNeoN3GasBalance(address: string): Promise<TokenBalance> {
    const owner = await this.resolveNeoN3AddressOrName(address);

    return this.getNeoN3TokenBalance(owner, this.getNeoN3GasToken());
  }

  public async getNeoN3UnclaimedGas(
    address: string,
  ): Promise<NeoN3UnclaimedGas> {
    const owner = await this.resolveNeoN3AddressOrName(address);
    const gasToken = this.getNeoN3GasToken();
    const rawUnclaimed = BigInt(
      await this.neoN3RpcClient.getUnclaimedGas(owner),
    );

    return {
      address: owner,
      symbol: "GAS",
      decimals: gasToken.decimals,
      rawUnclaimed: rawUnclaimed.toString(),
      unclaimed: formatDecimalAmount(rawUnclaimed, gasToken.decimals),
    };
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
      const nep17Balances = await this.neoN3RpcClient.getNep17Balances(owner);
      const balances = await Promise.all(
        nep17Balances.balance.map(async (entry) => {
          const metadata = await this.safeResolveNeoN3TokenMetadata(
            entry.assethash,
          );

          return {
            ...metadata,
            owner,
            rawBalance: parseDecimalAmount(
              entry.amount,
              metadata.decimals,
            ).toString(),
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
      transferHistory = await this.neoN3RpcClient.getNep17Transfers(owner);
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

  public async getTransaction(
    input: TransactionLookup,
  ): Promise<TransactionDetails> {
    this.requireImplementedNetwork(input.network, "transaction lookups");
    const normalizedHash = hash256Schema.parse(input.hash);
    let transaction: unknown;

    try {
      transaction = await this.neoN3RpcClient.getRawTransaction(
        normalizedHash,
        true,
      );
    } catch {
      throw new NotFoundError(
        `Transaction ${normalizedHash} was not found on Neo N3.`,
      );
    }

    let applicationLog: unknown;

    try {
      applicationLog =
        await this.neoN3RpcClient.getApplicationLog(normalizedHash);
    } catch {
      applicationLog = null;
    }

    return {
      transaction: this.normalizeUnknownRecord(transaction) ?? {},
      applicationLog: this.normalizeUnknownRecord(applicationLog),
    };
  }

  public async getTransactionStatus(
    input: TransactionStatusLookup,
  ): Promise<TransactionStatus> {
    this.requireImplementedNetwork(input.network, "transaction status checks");
    const normalizedHash = hash256Schema.parse(input.hash);
    let transaction: unknown;

    try {
      transaction = await this.neoN3RpcClient.getRawTransaction(
        normalizedHash,
        true,
      );
    } catch {
      return {
        hash: normalizedHash,
        network: "neoN3",
        status: "not_found",
        summary: `Neo N3 transaction ${normalizedHash} was not found.`,
        transaction: null,
        applicationLog: null,
      };
    }

    let applicationLog: unknown;

    try {
      applicationLog =
        await this.neoN3RpcClient.getApplicationLog(normalizedHash);
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
      hash: normalizedHash,
      network: "neoN3",
      status,
      summary:
        status === "confirmed"
          ? `Neo N3 transaction ${normalizedHash} is confirmed.`
          : status === "failed"
            ? `Neo N3 transaction ${normalizedHash} failed.`
            : `Neo N3 transaction ${normalizedHash} is pending.`,
      blockNumber: this.extractBlockNumber(serializedTransaction),
      transaction: serializedTransaction,
      applicationLog: serializedApplicationLog,
    };
  }

  public async getBlock(reference: BlockReference): Promise<unknown> {
    this.requireImplementedNetwork(reference.network, "block lookups");

    try {
      const block =
        reference.height !== undefined
          ? await this.neoN3RpcClient.getBlock(reference.height, true)
          : await this.neoN3RpcClient.getBlock(
              hash256Schema.parse(reference.hash ?? ""),
              true,
            );

      return normalizeResult(block);
    } catch {
      throw new NotFoundError("The requested block was not found on Neo N3.");
    }
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
    const result = await this.neoN3RpcClient.invokeFunction(
      target,
      normalizedOperation,
      args.map((arg) => this.toNeoN3ContractParam(arg)),
    );

    if (result.state !== "HALT") {
      throw new NeoRpcError(
        this.buildNeoN3CallFailureMessage(
          normalizedOperation,
          result.exception,
        ),
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
      rpcAddress: this.config.neoN3.rpcUrl,
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

    const rawAmountIn = parseDecimalAmount(input.amount, fromToken.decimals);
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
      formatDecimalAmount(
        amount,
        routeTokens[index]?.decimals ?? toToken.decimals,
      ),
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
      amountOut: formatDecimalAmount(amountOutRaw, toToken.decimals),
      minimumAmountOut: formatDecimalAmount(
        minimumAmountOutRaw,
        toToken.decimals,
      ),
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

    scriptBuilder.emitAppCall(this.config.neoN3.gasTokenContract, "transfer", [
      neoSc.ContractParam.hash160(account.scriptHash),
      neoSc.ContractParam.hash160(
        neoWallet.getScriptHashFromAddress(recipient),
      ),
      neoSc.ContractParam.integer(
        parseDecimalAmount(input.amount, 8).toString(),
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
      rpcAddress: this.config.neoN3.rpcUrl,
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
      contractAddress: this.config.neoN3.gasTokenContract,
      allowedContracts: [this.config.neoN3.gasTokenContract],
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
        parseDecimalAmount(input.amount, token.decimals).toString(),
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
      rpcAddress: this.config.neoN3.rpcUrl,
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

  public async prepareNeoN3TokenSwap(
    input: NeoN3TokenSwapInput,
  ): Promise<PreparedTransaction> {
    const quote = await this.getNeoN3SwapQuote(input);
    const account = this.requireNeoN3Wallet();
    const networkMagic = await this.getNeoN3NetworkMagic();
    const rawAmountIn = parseDecimalAmount(
      input.amount,
      quote.fromToken.decimals,
    );
    const rawMinimumAmountOut = parseDecimalAmount(
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
      rpcAddress: this.config.neoN3.rpcUrl,
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

  public async signAndBroadcast(
    prepared: PreparedTransaction,
  ): Promise<BroadcastResult> {
    const account = this.requireNeoN3Wallet();
    const transaction = neoTx.Transaction.deserialize(
      prepared.unsignedTransaction,
    );

    transaction.sign(account, await this.getNeoN3NetworkMagic());

    return createBroadcastResult(
      prepared,
      await this.neoN3RpcClient.sendRawTransaction(transaction),
    );
  }

  public walletEnabled(network?: NeoNetwork): boolean {
    if (!network) {
      return Boolean(this.neoN3Wallet);
    }

    return network === "neoN3" ? Boolean(this.neoN3Wallet) : false;
  }

  public async checkReadiness(): Promise<ProviderReadiness> {
    const networkMagic = await this.getNeoN3NetworkMagic();
    const expectedMagic =
      this.config.neoN3.network === "testnet"
        ? neoN3TestnetNetworkMagic
        : neoN3MainnetNetworkMagic;

    return {
      network: "neoN3",
      configuredNetwork: this.config.neoN3.network,
      rpcUrl: this.config.neoN3.rpcUrl,
      rpcReachable: true,
      networkMagic,
      networkMatchesConfiguration: networkMagic === expectedMagic,
      walletEnabled: this.walletEnabled("neoN3"),
      walletAddress: this.neoN3Wallet?.address,
    };
  }

  private buildNeoN3PreparedTransaction(
    input: PreparedTransactionInput,
  ): PreparedTransaction {
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
      contractAddress: input.contractAddress,
      operation: input.operation,
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
      allowedContracts: input.allowedContracts,
    };
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
    try {
      const result = await this.neoN3RpcClient.invokeFunction(
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
    } catch (error) {
      if (this.isExpiredNeoNsError(error)) {
        throw new ValidationError(`NeoNS name '${name}' has expired.`);
      }

      throw error;
    }
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
        this.buildNeoN3CallFailureMessage(operation, result.exception),
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
        this.buildNeoN3CallFailureMessage(operation, result.exception),
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

  private normalizeUnknownRecord(
    value: unknown,
  ): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null) {
      return null;
    }

    return normalizeResult(value) as Record<string, unknown>;
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
      const task = Promise.resolve(knownMetadata);

      this.neoN3TokenMetadataCache.set(normalizedHash, task);

      return task;
    }

    return this.getOrCreateMapCachedPromise(
      this.neoN3TokenMetadataCache,
      normalizedHash,
      async () => {
        try {
          return await this.loadNeoN3MetadataFromApi(normalizedHash);
        } catch (apiError) {
          try {
            return await this.loadNeoN3MetadataFromContract(normalizedHash);
          } catch (contractError) {
            throw new ProviderCapabilityError(
              `Unable to load Neo N3 token metadata for ${normalizedHash}.`,
              {
                apiError:
                  apiError instanceof Error ? apiError.message : apiError,
                contractError:
                  contractError instanceof Error
                    ? contractError.message
                    : contractError,
              },
            );
          }
        }
      },
    );
  }

  private async loadNeoN3MetadataFromApi(
    contractHash: string,
  ): Promise<TokenMetadata> {
    const [info] = await neoApi.getTokenInfos(
      [contractHash],
      this.neoN3RpcClient,
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
    const [symbolResult, decimalsResult] = await Promise.all([
      this.neoN3RpcClient.invokeFunction(contractHash, "symbol"),
      this.neoN3RpcClient.invokeFunction(contractHash, "decimals"),
    ]);
    const symbol = this.parseNeoN3StringResult(symbolResult, "symbol").trim();
    const decimals = Number(
      this.parseNeoN3IntegerResult(decimalsResult, "decimals"),
    );

    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
      throw new NeoRpcError(
        `Neo N3 token ${contractHash} returned an invalid decimals value.`,
        { decimals },
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

  private getNeoN3GasToken(): TokenMetadata {
    return {
      contractAddress: this.config.neoN3.gasTokenContract,
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

  private async getNeoN3TokenBalance(
    owner: string,
    token: TokenMetadata,
  ): Promise<TokenBalance> {
    const result = await this.neoN3RpcClient.invokeFunction(
      token.contractAddress,
      "balanceOf",
      [neoSc.ContractParam.hash160(neoWallet.getScriptHashFromAddress(owner))],
    );
    const rawBalance = this.parseNeoN3IntegerResult(result, "balanceOf");

    return {
      ...token,
      owner,
      rawBalance: rawBalance.toString(),
      balance: formatDecimalAmount(rawBalance, token.decimals),
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

    const [balances, metadata] = await Promise.all([
      neoApi.getTokenBalances(owner, contracts, this.neoN3RpcClient),
      Promise.all(
        contracts.map((contractHash) =>
          this.safeResolveNeoN3TokenMetadata(contractHash),
        ),
      ),
    ]);

    return metadata
      .map((token, index) => {
        const balance = balances[index];
        const rawBalance = parseDecimalAmount(balance, token.decimals);

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
  }): Promise<{
    routeContracts: string[];
    routeSymbols: string[];
    tradingPairIds: number[];
    routeAmountsRaw: bigint[];
  }> {
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
      (
        quote,
      ): quote is {
        routeContracts: string[];
        routeSymbols: string[];
        tradingPairIds: number[];
        routeAmountsRaw: bigint[];
      } => quote !== undefined,
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

  protected async getNeoN3SwapPathQuote(
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

  protected async getNeoN3ConvertAmountOut(
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
    const normalizedRequested = requested ?? "1";
    const value = Number(normalizedRequested);

    if (!Number.isFinite(value) || value < 0.01 || value > 50) {
      throw new ValidationError(
        "Swap slippagePercent must be a decimal percent between 0.01 and 50 with up to 2 decimal places.",
      );
    }

    try {
      const basisPoints = parseDecimalAmount(normalizedRequested, 2);

      if (basisPoints <= 0n || basisPoints > 5_000n) {
        throw new ValidationError(
          "Swap slippagePercent must be a decimal percent between 0.01 and 50 with up to 2 decimal places.",
        );
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new ValidationError(
          "Swap slippagePercent must be a decimal percent between 0.01 and 50 with up to 2 decimal places.",
        );
      }

      throw error;
    }

    return normalizedRequested;
  }

  private toBasisPoints(percent: string): number {
    return Number(parseDecimalAmount(percent, 2));
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

  private async getNeoN3NetworkMagic(): Promise<number> {
    return this.getOrCreateCachedPromise(
      () => this.neoN3NetworkMagicPromise,
      (promise) => {
        this.neoN3NetworkMagicPromise = promise;
      },
      async () => {
        const version = await this.neoN3RpcClient.getVersion();
        const networkMagic = Number(version.protocol.network);

        if (!Number.isInteger(networkMagic) || networkMagic <= 0) {
          throw new NeoRpcError(
            "Neo N3 RPC did not return a valid network magic value.",
            version,
          );
        }

        return networkMagic;
      },
    );
  }

  private requireImplementedNetwork(
    network: NeoNetwork | undefined,
    capability: string,
  ): "neoN3" {
    const resolvedNetwork = network ?? this.getDefaultNetwork();

    if (resolvedNetwork !== "neoN3") {
      throw new ProviderCapabilityError(
        `${this.formatNetworkLabel(resolvedNetwork)} ${capability} are not implemented yet.`,
      );
    }

    return resolvedNetwork;
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

  private async resolveNeoN3FlamingoBrokerContractAddress(): Promise<string> {
    return this.getOrCreateCachedPromise(
      () => this.neoN3ResolvedFlamingoBrokerContractPromise,
      (promise) => {
        this.neoN3ResolvedFlamingoBrokerContractPromise = promise;
      },
      () => {
        return this.resolveNeoN3FlamingoContractAddress({
          configuredAddress: this.config.neoN3.flamingoBrokerContract,
          operationNames: ["getPairCounter", "getBaseToken", "getQuoteToken"],
          environmentVariableName: "NEO_N3_FLAMINGO_BROKER_CONTRACT",
          defaultByNetworkMagic: {
            [neoN3MainnetNetworkMagic]:
              defaultNeoN3FlamingoContractsByNetwork.mainnet.broker,
            [neoN3TestnetNetworkMagic]:
              defaultNeoN3FlamingoContractsByNetwork.testnet.broker,
          },
        });
      },
    );
  }

  private async resolveNeoN3FlamingoConvertContractAddress(): Promise<string> {
    return this.getOrCreateCachedPromise(
      () => this.neoN3ResolvedFlamingoConvertContractPromise,
      (promise) => {
        this.neoN3ResolvedFlamingoConvertContractPromise = promise;
      },
      () => {
        return this.resolveNeoN3FlamingoContractAddress({
          configuredAddress: this.config.neoN3.flamingoConvertContract,
          operationNames: ["standardConvert", "emulateStandardConvert"],
          environmentVariableName: "NEO_N3_FLAMINGO_CONVERT_CONTRACT",
          defaultByNetworkMagic: {
            [neoN3MainnetNetworkMagic]:
              defaultNeoN3FlamingoContractsByNetwork.mainnet.convert,
            [neoN3TestnetNetworkMagic]:
              defaultNeoN3FlamingoContractsByNetwork.testnet.convert,
          },
        });
      },
    );
  }

  private async getNeoN3FlamingoTradingPairs(): Promise<
    NeoN3FlamingoTradingPair[]
  > {
    return this.getOrCreateCachedPromise(
      () => this.neoN3FlamingoTradingPairsPromise,
      (promise) => {
        this.neoN3FlamingoTradingPairsPromise = promise;
      },
      async () => {
        const brokerContract =
          await this.resolveNeoN3FlamingoBrokerContractAddress();
        const pairCounter = Number(
          await this.invokeNeoN3IntegerRead(brokerContract, "getPairCounter"),
        );

        if (!Number.isInteger(pairCounter) || pairCounter <= 0) {
          return [];
        }

        const pairIds = Array.from(
          { length: pairCounter },
          (_, index) => index + 1,
        );
        const pairs = await Promise.all(
          pairIds.map(async (pairId) => {
            const [baseTokenHash, quoteTokenHash] = await Promise.all([
              this.invokeNeoN3Hash160Read(brokerContract, "getBaseToken", [
                { type: "Integer", value: String(pairId) },
              ]),
              this.invokeNeoN3Hash160Read(brokerContract, "getQuoteToken", [
                { type: "Integer", value: String(pairId) },
              ]),
            ]);

            return {
              pairId,
              baseTokenHash,
              quoteTokenHash,
            };
          }),
        );

        return pairs.filter(
          (pair) => pair.baseTokenHash !== pair.quoteTokenHash,
        );
      },
    );
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
    const result = await this.neoN3RpcClient.invokeFunction(
      target,
      operation.trim(),
      args.map((arg) => this.toNeoN3ContractParam(arg)),
    );

    if (result.state !== "HALT") {
      throw new NeoRpcError(
        this.buildNeoN3CallFailureMessage(operation, result.exception),
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
    const result = await this.neoN3RpcClient.invokeFunction(
      target,
      operation.trim(),
      args.map((arg) => this.toNeoN3ContractParam(arg)),
    );

    if (result.state !== "HALT") {
      throw new NeoRpcError(
        this.buildNeoN3CallFailureMessage(operation, result.exception),
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

  private buildNeoN3CallFailureMessage(
    operation: string,
    exception?: string | null,
  ): string {
    if (typeof exception !== "string" || exception.trim() === "") {
      return `Neo N3 call '${operation}' failed.`;
    }

    const normalizedException = exception
      .replace(/^An unhandled exception was thrown\.\s*/i, "")
      .trim();

    return `Neo N3 call '${operation}' failed: ${normalizedException}`;
  }

  private isExpiredNeoNsError(error: unknown): boolean {
    if (!(error instanceof NeoRpcError)) {
      return false;
    }

    if (error.message.includes("The name has expired")) {
      return true;
    }

    return (
      typeof error.details === "string" &&
      error.details.includes("The name has expired")
    );
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

  private getOrCreateCachedPromise<T>(
    getCachedPromise: () => Promise<T> | undefined,
    setCachedPromise: (promise: Promise<T> | undefined) => void,
    factory: () => Promise<T>,
  ): Promise<T> {
    const cachedPromise = getCachedPromise();

    if (cachedPromise) {
      return cachedPromise;
    }

    let task: Promise<T>;
    task = factory().catch((error: unknown) => {
      if (getCachedPromise() === task) {
        setCachedPromise(undefined);
      }

      throw error;
    });
    setCachedPromise(task);

    return task;
  }

  private getOrCreateMapCachedPromise<K, T>(
    cache: Map<K, Promise<T>>,
    key: K,
    factory: () => Promise<T>,
  ): Promise<T> {
    const cachedPromise = cache.get(key);

    if (cachedPromise) {
      return cachedPromise;
    }

    let task: Promise<T>;
    task = factory().catch((error: unknown) => {
      if (cache.get(key) === task) {
        cache.delete(key);
      }

      throw error;
    });
    cache.set(key, task);

    return task;
  }

  private async neoN3ContractSupportsOperations(
    contractHash: string,
    operationNames: string[],
  ): Promise<boolean> {
    try {
      const contractState =
        await this.neoN3RpcClient.getContractState(contractHash);
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

  private requireNeoN3Wallet(): InstanceType<typeof neoWallet.Account> {
    if (!this.neoN3Wallet) {
      throw new WalletUnavailableError(
        "Set WALLET_WIF or WALLET_PRIVATE_KEY to enable Neo N3 write actions.",
      );
    }

    return this.neoN3Wallet;
  }

  private formatNetworkLabel(network: NeoNetwork): string {
    return network === "neoX" ? "Neo X" : "Neo N3";
  }
}

export function createNeoProvider(config: AppConfig): NeoProvider {
  return new NeoN3Provider(config);
}

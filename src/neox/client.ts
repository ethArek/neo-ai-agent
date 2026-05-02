import type { AppConfig } from "../core/config";
import type { ChainAdapter } from "../chains/types";
import {
  NeoRpcError,
  NotFoundError,
  ProviderCapabilityError,
  ValidationError,
  WalletUnavailableError,
} from "../core/errors";
import {
  evmAddressSchema,
  evmTransactionHashSchema,
  positiveDecimalAmountSchema,
} from "../core/validation";
import { createBroadcastResult } from "../neo/broadcast";
import type {
  BroadcastResult,
  NeoXBlockReference,
  NeoXChainInfo,
  NeoXContractCallInput,
  NeoXContractCallResult,
  NeoXContractWriteInput,
  NeoXErc20Balance,
  NeoXErc20Metadata,
  NeoXErc20TransferInput,
  NeoXErc721Owner,
  NeoXNativeBalance,
  NeoXNativeTransferInput,
  NeoXNetwork,
  NeoXNetworkConfig,
  PreparedTransaction,
  TransactionStatus,
  TransactionStatusLookup,
} from "../neo/types";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  parseEther,
  parseUnits,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

interface ResolvedNeoXClient {
  network: NeoXNetwork;
  config: NeoXNetworkConfig;
  chain: Chain;
  client: PublicClient;
  rpcUrlAlias: string;
}

interface PreparedFeeFields {
  gas?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

const erc721OwnerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
]);
const decimalIntegerPattern = /^(?:0|[1-9]\d*)$/;

export class NeoXProvider implements ChainAdapter {
  public readonly chainType = "neo-x";

  private readonly config: AppConfig;
  private readonly account?: PrivateKeyAccount;
  private readonly clients = new Map<NeoXNetwork, ResolvedNeoXClient>();

  public constructor(config: AppConfig) {
    this.config = config;
    this.account = config.neoX.walletPrivateKey
      ? privateKeyToAccount(config.neoX.walletPrivateKey as Hex)
      : undefined;
  }

  public getDefaultNetwork(): NeoXNetwork {
    return this.config.neoX.defaultNetwork;
  }

  public getImplementedNetwork(): "neoX" {
    return "neoX";
  }

  public walletEnabled(): boolean {
    return Boolean(this.account);
  }

  public getWalletAddress(): string | undefined {
    return this.account?.address;
  }

  public async getChainInfo(network?: NeoXNetwork): Promise<NeoXChainInfo> {
    const resolved = this.getResolvedClient(network);
    const [chainId, latestBlock] = await Promise.all([
      resolved.client.getChainId(),
      resolved.client.getBlockNumber(),
    ]);

    return {
      chain: "neo-x",
      network: resolved.network,
      chainId,
      configuredChainId: resolved.config.chainId,
      rpcReachable: true,
      latestBlock: latestBlock.toString(),
      rpcUrlAlias: resolved.rpcUrlAlias,
      explorerBaseUrl: resolved.config.explorerBaseUrl,
    };
  }

  public async getNativeBalance(
    address: string,
    network?: NeoXNetwork,
  ): Promise<NeoXNativeBalance> {
    const owner = evmAddressSchema.parse(address);
    const resolved = this.getResolvedClient(network);
    const [chainId, rawBalance] = await Promise.all([
      resolved.client.getChainId(),
      resolved.client.getBalance({
        address: owner as Address,
      }),
    ]);

    return {
      chain: "neo-x",
      network: resolved.network,
      chainId,
      owner,
      symbol: this.config.neoX.nativeCurrencySymbol,
      rawBalanceWei: rawBalance.toString(),
      balance: formatEther(rawBalance),
      rpcUrlAlias: resolved.rpcUrlAlias,
      explorerUrl: this.buildExplorerUrl(resolved.config, "address", owner),
    };
  }

  public async getBlock(reference: NeoXBlockReference): Promise<unknown> {
    const resolved = this.getResolvedClient(reference.network);

    try {
      let block: unknown;

      if (reference.hash) {
        block = await resolved.client.getBlock({
          blockHash: evmTransactionHashSchema.parse(reference.hash) as Hex,
          includeTransactions: true,
        });
      } else if (reference.number !== undefined) {
        block = await resolved.client.getBlock({
          blockNumber: parseBlockNumber(reference.number),
          includeTransactions: true,
        });
      } else {
        block = await resolved.client.getBlock({
          blockTag: "latest",
          includeTransactions: true,
        });
      }

      return {
        chain: "neo-x",
        network: resolved.network,
        chainId: resolved.config.chainId,
        rpcUrlAlias: resolved.rpcUrlAlias,
        block: normalizeRpcResult(block),
      };
    } catch (error) {
      throw new NotFoundError(
        `The requested block was not found on Neo X ${resolved.network}.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  public async getTransaction(input: {
    hash: string;
    network?: NeoXNetwork;
  }): Promise<unknown> {
    const resolved = this.getResolvedClient(input.network);
    const hash = evmTransactionHashSchema.parse(input.hash);

    try {
      const transaction = await resolved.client.getTransaction({
        hash: hash as Hex,
      });

      return {
        chain: "neo-x",
        network: resolved.network,
        chainId: resolved.config.chainId,
        rpcUrlAlias: resolved.rpcUrlAlias,
        explorerUrl: this.buildExplorerUrl(resolved.config, "tx", hash),
        transaction: normalizeRpcResult(transaction),
      };
    } catch (error) {
      throw new NotFoundError(
        `Transaction ${hash} was not found on Neo X ${resolved.network}.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  public async getTransactionReceipt(input: {
    hash: string;
    network?: NeoXNetwork;
  }): Promise<unknown> {
    const resolved = this.getResolvedClient(input.network);
    const hash = evmTransactionHashSchema.parse(input.hash);

    try {
      const receipt = await resolved.client.getTransactionReceipt({
        hash: hash as Hex,
      });

      return {
        chain: "neo-x",
        network: resolved.network,
        chainId: resolved.config.chainId,
        rpcUrlAlias: resolved.rpcUrlAlias,
        explorerUrl: this.buildExplorerUrl(resolved.config, "tx", hash),
        receipt: normalizeRpcResult(receipt),
      };
    } catch (error) {
      throw new NotFoundError(
        `Transaction receipt ${hash} was not found on Neo X ${resolved.network}.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  public async getTransactionStatus(
    input: TransactionStatusLookup,
  ): Promise<TransactionStatus> {
    const hash = evmTransactionHashSchema.parse(input.hash);

    try {
      const resolved = this.getResolvedClient();
      const receipt = await resolved.client.getTransactionReceipt({
        hash: hash as Hex,
      });
      const status = receipt.status === "success" ? "confirmed" : "failed";

      return {
        hash,
        network: "neoX",
        status,
        summary:
          status === "confirmed"
            ? `Neo X transaction ${hash} is confirmed.`
            : `Neo X transaction ${hash} failed.`,
        blockNumber: Number(receipt.blockNumber),
        transaction: null,
        applicationLog: normalizeRpcResult(receipt) as Record<string, unknown>,
      };
    } catch {
      return {
        hash,
        network: "neoX",
        status: "not_found",
        summary: `Neo X transaction ${hash} was not found.`,
        transaction: null,
        applicationLog: null,
      };
    }
  }

  public async callContract(
    input: NeoXContractCallInput,
  ): Promise<NeoXContractCallResult> {
    const resolved = this.getResolvedClient(input.network);
    const contractAddress = evmAddressSchema.parse(input.contractAddress);
    const abi = normalizeAbi(input.abi, input.functionName);
    const args = input.args ?? [];
    const [chainId, result] = await Promise.all([
      resolved.client.getChainId(),
      resolved.client.readContract({
        address: contractAddress as Address,
        abi,
        functionName: input.functionName,
        args,
      }),
    ]);

    return {
      chain: "neo-x",
      network: resolved.network,
      chainId,
      contractAddress,
      functionName: input.functionName,
      args,
      result: normalizeRpcResult(result),
      rpcUrlAlias: resolved.rpcUrlAlias,
    };
  }

  public async getErc20Metadata(
    tokenContract: string,
    network?: NeoXNetwork,
  ): Promise<NeoXErc20Metadata> {
    const resolved = this.getResolvedClient(network);
    const contractAddress = evmAddressSchema.parse(tokenContract);
    const [chainId, name, symbol, decimals] = await Promise.all([
      resolved.client.getChainId(),
      this.readErc20String(resolved, contractAddress, "name"),
      this.readErc20String(resolved, contractAddress, "symbol"),
      this.readErc20Decimals(resolved, contractAddress),
    ]);

    return {
      chain: "neo-x",
      network: resolved.network,
      chainId,
      contractAddress,
      name,
      symbol,
      decimals,
      rpcUrlAlias: resolved.rpcUrlAlias,
      explorerUrl: this.buildExplorerUrl(
        resolved.config,
        "address",
        contractAddress,
      ),
    };
  }

  public async getErc20Balance(input: {
    tokenContract: string;
    owner: string;
    network?: NeoXNetwork;
  }): Promise<NeoXErc20Balance> {
    const owner = evmAddressSchema.parse(input.owner);
    const metadata = await this.getErc20Metadata(
      input.tokenContract,
      input.network,
    );
    const resolved = this.getResolvedClient(input.network);
    const rawBalance = await resolved.client.readContract({
      address: metadata.contractAddress as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner as Address],
    });

    if (typeof rawBalance !== "bigint") {
      throw new NeoRpcError(
        "Neo X ERC-20 balanceOf returned a malformed value.",
      );
    }

    return {
      ...metadata,
      owner,
      rawBalance: rawBalance.toString(),
      formattedBalance: formatUnits(rawBalance, metadata.decimals),
    };
  }

  public async getErc721Owner(input: {
    contractAddress: string;
    tokenId: string;
    network?: NeoXNetwork;
  }): Promise<NeoXErc721Owner> {
    const resolved = this.getResolvedClient(input.network);
    const contractAddress = evmAddressSchema.parse(input.contractAddress);
    const tokenId = parseBlockNumber(input.tokenId);
    const [chainId, owner] = await Promise.all([
      resolved.client.getChainId(),
      resolved.client.readContract({
        address: contractAddress as Address,
        abi: erc721OwnerAbi,
        functionName: "ownerOf",
        args: [tokenId],
      }),
    ]);

    if (typeof owner !== "string") {
      throw new NeoRpcError(
        "Neo X ERC-721 ownerOf returned a malformed value.",
      );
    }

    return {
      chain: "neo-x",
      network: resolved.network,
      chainId,
      contractAddress,
      tokenId: tokenId.toString(),
      owner: evmAddressSchema.parse(owner),
      rpcUrlAlias: resolved.rpcUrlAlias,
      explorerUrl: this.buildExplorerUrl(
        resolved.config,
        "address",
        contractAddress,
      ),
    };
  }

  public async prepareNativeTransfer(
    input: NeoXNativeTransferInput,
  ): Promise<PreparedTransaction> {
    const account = this.requireWallet();
    const resolved = this.getResolvedClient(input.network);
    const to = evmAddressSchema.parse(input.to);
    const amount = positiveDecimalAmountSchema.parse(input.amount);
    const valueWei = parseEther(amount);
    const fees = await this.estimateTransaction(resolved, {
      account: account.address,
      to: to as Address,
      value: valueWei,
    });

    return this.createPreparedTransaction({
      action: "neox_prepare_native_transfer",
      summary: `Prepared a Neo X ${resolved.network} GAS transfer of ${amount} GAS to ${to}.`,
      resolved,
      sender: account.address,
      to,
      amount,
      tokenSymbol: this.config.neoX.nativeCurrencySymbol,
      valueWei,
      fees,
      request: {
        from: account.address,
        to,
        value: valueWei,
      },
    });
  }

  public async prepareErc20Transfer(
    input: NeoXErc20TransferInput,
  ): Promise<PreparedTransaction> {
    const account = this.requireWallet();
    const resolved = this.getResolvedClient(input.network);
    const token = await this.getErc20Metadata(
      input.tokenContract,
      resolved.network,
    );
    const to = evmAddressSchema.parse(input.to);
    const amount = positiveDecimalAmountSchema.parse(input.amount);
    const rawAmount = parseUnits(amount, token.decimals);
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as Address, rawAmount],
    });
    const fees = await this.estimateTransaction(resolved, {
      account: account.address,
      to: token.contractAddress as Address,
      data,
      value: 0n,
    });

    return this.createPreparedTransaction({
      action: "neox_prepare_erc20_transfer",
      summary: `Prepared a Neo X ${resolved.network} ERC-20 transfer of ${amount} ${token.symbol} to ${to}.`,
      resolved,
      sender: account.address,
      to,
      amount,
      tokenAddress: token.contractAddress,
      tokenSymbol: token.symbol,
      contractAddress: token.contractAddress,
      operation: "transfer",
      functionName: "transfer",
      decodedArgs: [to, rawAmount.toString()],
      valueWei: 0n,
      data,
      fees,
      request: {
        from: account.address,
        to: token.contractAddress,
        data,
        value: 0n,
      },
    });
  }

  public async prepareContractWrite(
    input: NeoXContractWriteInput,
  ): Promise<PreparedTransaction> {
    const account = this.requireWallet();
    const resolved = this.getResolvedClient(input.network);
    const contractAddress = evmAddressSchema.parse(input.contractAddress);
    const abi = normalizeAbi(input.abi, input.functionName);
    const args = input.args ?? [];
    const valueWei = input.value ? parseEther(input.value) : 0n;
    const data = encodeFunctionData({
      abi,
      functionName: input.functionName,
      args,
    });
    const fees = await this.estimateTransaction(resolved, {
      account: account.address,
      to: contractAddress as Address,
      data,
      value: valueWei,
    });

    return this.createPreparedTransaction({
      action: "neox_prepare_contract_write",
      summary: `Prepared a Neo X ${resolved.network} contract write ${input.functionName} on ${contractAddress}.`,
      resolved,
      sender: account.address,
      to: contractAddress,
      amount: input.value,
      contractAddress,
      operation: input.functionName,
      functionName: input.functionName,
      decodedArgs: args,
      valueWei,
      data,
      fees,
      request: {
        from: account.address,
        to: contractAddress,
        data,
        value: valueWei,
      },
    });
  }

  public async signAndBroadcast(
    prepared: PreparedTransaction,
  ): Promise<BroadcastResult> {
    const account = this.requireWallet();
    const resolved = this.getResolvedClient(prepared.rpcNetwork);
    const walletClient = createWalletClient({
      account,
      chain: resolved.chain,
      transport: http(this.requireRpcUrl(resolved.config)),
    });
    const request = this.parsePreparedTransactionRequest(prepared);
    const txHash = await walletClient.sendTransaction(request);

    return createBroadcastResult(prepared, txHash);
  }

  private getResolvedClient(network?: NeoXNetwork): ResolvedNeoXClient {
    const resolvedNetwork = network ?? this.config.neoX.defaultNetwork;
    const cached = this.clients.get(resolvedNetwork);

    if (cached) {
      return cached;
    }

    const config = this.config.neoX.networks[resolvedNetwork];
    const rpcUrl = this.requireRpcUrl(config);
    const chainId = this.requireChainId(config);
    const chain = defineChain({
      id: chainId,
      name:
        resolvedNetwork === "custom"
          ? "Neo X Custom"
          : `Neo X ${resolvedNetwork}`,
      nativeCurrency: {
        name: this.config.neoX.nativeCurrencySymbol,
        symbol: this.config.neoX.nativeCurrencySymbol,
        decimals: 18,
      },
      rpcUrls: {
        default: {
          http: [rpcUrl],
        },
      },
      blockExplorers: config.explorerBaseUrl
        ? {
            default: {
              name: "Neo X Explorer",
              url: config.explorerBaseUrl,
            },
          }
        : undefined,
    });
    const resolved = {
      network: resolvedNetwork,
      config,
      chain,
      client: createPublicClient({
        chain,
        transport: http(rpcUrl),
      }),
      rpcUrlAlias: this.getRpcUrlAlias(resolvedNetwork),
    };

    this.clients.set(resolvedNetwork, resolved);

    return resolved;
  }

  private requireRpcUrl(config: NeoXNetworkConfig): string {
    if (config.rpcUrl) {
      return config.rpcUrl;
    }

    throw new ProviderCapabilityError(
      `Neo X ${config.name} RPC is not configured. Set ${this.getRpcUrlAlias(config.name)} before using Neo X tools.`,
    );
  }

  private requireChainId(config: NeoXNetworkConfig): number {
    if (config.chainId) {
      return config.chainId;
    }

    throw new ProviderCapabilityError(
      `Neo X ${config.name} chain ID is not configured. Set NEOX_CUSTOM_CHAIN_ID for custom Neo X networks.`,
    );
  }

  private getRpcUrlAlias(network: NeoXNetwork): string {
    switch (network) {
      case "mainnet":
        return "NEOX_MAINNET_RPC_URL";
      case "testnet":
        return "NEOX_TESTNET_RPC_URL";
      case "custom":
        return "NEOX_CUSTOM_RPC_URL";
      default:
        return "NEOX_MAINNET_RPC_URL";
    }
  }

  private requireWallet(): PrivateKeyAccount {
    if (!this.account) {
      throw new WalletUnavailableError(
        "Set NEOX_PRIVATE_KEY to enable Neo X transaction preparation and confirmed broadcasts.",
      );
    }

    return this.account;
  }

  private async readErc20String(
    resolved: ResolvedNeoXClient,
    contractAddress: string,
    functionName: "name" | "symbol",
  ): Promise<string> {
    const value = await resolved.client.readContract({
      address: contractAddress as Address,
      abi: erc20Abi,
      functionName,
    });

    if (typeof value !== "string") {
      throw new NeoRpcError(
        `Neo X ERC-20 ${functionName} returned a malformed value.`,
      );
    }

    return value;
  }

  private async readErc20Decimals(
    resolved: ResolvedNeoXClient,
    contractAddress: string,
  ): Promise<number> {
    const value = await resolved.client.readContract({
      address: contractAddress as Address,
      abi: erc20Abi,
      functionName: "decimals",
    });

    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new NeoRpcError(
        "Neo X ERC-20 decimals returned a malformed value.",
      );
    }

    return value;
  }

  private async estimateTransaction(
    resolved: ResolvedNeoXClient,
    request: {
      account: Address;
      to: Address;
      value?: bigint;
      data?: Hex;
    },
  ): Promise<PreparedFeeFields> {
    const gas = await resolved.client.estimateGas(request);
    const gasPrice = await resolved.client.getGasPrice().catch(() => undefined);
    const fees = await resolved.client.estimateFeesPerGas().catch(() => null);

    return {
      gas,
      gasPrice,
      maxFeePerGas: fees?.maxFeePerGas,
      maxPriorityFeePerGas: fees?.maxPriorityFeePerGas,
    };
  }

  private createPreparedTransaction(input: {
    action: PreparedTransaction["action"];
    summary: string;
    resolved: ResolvedNeoXClient;
    sender: string;
    to: string;
    amount?: string;
    tokenAddress?: string;
    tokenSymbol?: string;
    contractAddress?: string;
    operation?: string;
    functionName?: string;
    decodedArgs?: unknown[];
    valueWei: bigint;
    data?: string;
    fees: PreparedFeeFields;
    request: Record<string, unknown>;
  }): PreparedTransaction {
    const normalizedRequest = normalizeRpcResult({
      ...input.request,
      chainId: input.resolved.config.chainId,
      gas: input.fees.gas,
      gasPrice: input.fees.gasPrice,
      maxFeePerGas: input.fees.maxFeePerGas,
      maxPriorityFeePerGas: input.fees.maxPriorityFeePerGas,
    }) as Record<string, unknown>;

    return {
      kind: "transaction",
      action: input.action,
      summary: input.summary,
      unsignedTransaction: JSON.stringify(normalizedRequest),
      network: "neoX",
      rpcNetwork: input.resolved.network,
      chainId: input.resolved.config.chainId,
      sender: input.sender,
      to: input.to,
      amount: input.amount,
      tokenAddress: input.tokenAddress,
      tokenSymbol: input.tokenSymbol,
      contractAddress: input.contractAddress,
      operation: input.operation,
      functionName: input.functionName,
      decodedArgs: input.decodedArgs,
      valueWei: input.valueWei.toString(),
      gas: input.fees.gas?.toString(),
      gasPrice: input.fees.gasPrice?.toString(),
      maxFeePerGas: input.fees.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: input.fees.maxPriorityFeePerGas?.toString(),
      data: input.data,
      rpcUrlAlias: input.resolved.rpcUrlAlias,
      explorerUrl: this.buildExplorerUrl(
        input.resolved.config,
        "address",
        input.to,
      ),
      transactionRequest: normalizedRequest,
    };
  }

  private parsePreparedTransactionRequest(prepared: PreparedTransaction): {
    to: Address;
    value?: bigint;
    data?: Hex;
    gas?: bigint;
  } {
    if (prepared.network !== "neoX" || !prepared.to) {
      throw new ValidationError("Prepared transaction is not a Neo X request.");
    }

    return {
      to: evmAddressSchema.parse(prepared.to) as Address,
      value: prepared.valueWei ? BigInt(prepared.valueWei) : undefined,
      data: prepared.data as Hex | undefined,
      gas: prepared.gas ? BigInt(prepared.gas) : undefined,
    };
  }

  private buildExplorerUrl(
    config: NeoXNetworkConfig,
    kind: "tx" | "address",
    value: string,
  ): string | undefined {
    if (!config.explorerBaseUrl) {
      return undefined;
    }

    return `${config.explorerBaseUrl.replace(/\/+$/, "")}/${kind}/${value}`;
  }
}

function normalizeAbi(abiInput: unknown, functionName: string): Abi {
  let abi: Abi;

  try {
    if (typeof abiInput === "string") {
      const trimmedAbi = abiInput.trim();
      const parsedJson = trimmedAbi.startsWith("[")
        ? (JSON.parse(trimmedAbi) as unknown)
        : undefined;

      abi =
        parsedJson !== undefined
          ? normalizeAbi(parsedJson, functionName)
          : parseAbi([trimmedAbi]);
    } else if (
      Array.isArray(abiInput) &&
      abiInput.every((entry) => typeof entry === "string")
    ) {
      abi = parseAbi(abiInput);
    } else if (Array.isArray(abiInput)) {
      abi = abiInput as Abi;
    } else {
      throw new Error("ABI input is not supported.");
    }
  } catch (error) {
    throw new ValidationError(
      "ABI must be a JSON ABI array or human-readable function signature.",
      error instanceof Error ? error.message : error,
    );
  }

  const hasFunction = abi.some((entry) => {
    return (
      typeof entry === "object" &&
      entry !== null &&
      "type" in entry &&
      entry.type === "function" &&
      "name" in entry &&
      entry.name === functionName
    );
  });

  if (!hasFunction) {
    throw new ValidationError(
      `ABI does not contain function '${functionName}'.`,
    );
  }

  return abi;
}

function parseBlockNumber(value: string): bigint {
  const normalized = value.trim();

  if (!decimalIntegerPattern.test(normalized)) {
    throw new ValidationError("Block number and token IDs must be integers.");
  }

  return BigInt(normalized);
}

function normalizeRpcResult(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeRpcResult(entry));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        normalizeRpcResult(entry),
      ]),
    );
  }

  return value;
}

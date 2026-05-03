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
  evmBlockHashSchema,
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
  ProviderReadiness,
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

interface VerifiedNeoXClient {
  resolved: ResolvedNeoXClient;
  chainId: number;
}

const erc721OwnerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
]);
const decimalIntegerPattern = /^(?:0|[1-9]\d*)$/;

function extractRpcHost(rpcUrl: string | undefined): string | undefined {
  if (!rpcUrl) {
    return undefined;
  }

  try {
    return new URL(rpcUrl).host;
  } catch {
    return undefined;
  }
}

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
    const { resolved, chainId } = await this.getVerifiedClient(network);
    const rawBalance = await resolved.client.getBalance({
      address: owner as Address,
    });

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
    const blockHash = reference.hash
      ? (evmBlockHashSchema.parse(reference.hash) as Hex)
      : undefined;
    const blockNumber =
      reference.number !== undefined
        ? parseBlockNumber(reference.number, "Block number")
        : undefined;
    const { resolved, chainId } = await this.getVerifiedClient(
      reference.network,
    );

    try {
      let block: unknown;

      if (blockHash) {
        block = await resolved.client.getBlock({
          blockHash,
          includeTransactions: true,
        });
      } else if (blockNumber !== undefined) {
        block = await resolved.client.getBlock({
          blockNumber,
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
        chainId,
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
    const hash = evmTransactionHashSchema.parse(input.hash);
    const { resolved, chainId } = await this.getVerifiedClient(input.network);

    try {
      const transaction = await resolved.client.getTransaction({
        hash: hash as Hex,
      });

      return {
        chain: "neo-x",
        network: resolved.network,
        chainId,
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
    const hash = evmTransactionHashSchema.parse(input.hash);
    const { resolved, chainId } = await this.getVerifiedClient(input.network);

    try {
      const receipt = await resolved.client.getTransactionReceipt({
        hash: hash as Hex,
      });

      return {
        chain: "neo-x",
        network: resolved.network,
        chainId,
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
    const { resolved } = await this.getVerifiedClient(input.rpcNetwork);

    try {
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
        blockNumber: receipt.blockNumber.toString(),
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
    const contractAddress = evmAddressSchema.parse(input.contractAddress);
    const abi = normalizeAbi(input.abi, input.functionName);
    const args = input.args ?? [];
    const { resolved, chainId } = await this.getVerifiedClient(input.network);
    const result = await resolved.client.readContract({
      address: contractAddress as Address,
      abi,
      functionName: input.functionName,
      args,
    });

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
    const { resolved, chainId } = await this.getVerifiedClient(network);
    const contractAddress = evmAddressSchema.parse(tokenContract);
    const [name, symbol, decimals] = await Promise.all([
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
    const { resolved } = await this.getVerifiedClient(input.network);
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
    const contractAddress = evmAddressSchema.parse(input.contractAddress);
    const tokenId = parseBlockNumber(input.tokenId, "tokenId");
    const { resolved, chainId } = await this.getVerifiedClient(input.network);
    const owner = await resolved.client.readContract({
      address: contractAddress as Address,
      abi: erc721OwnerAbi,
      functionName: "ownerOf",
      args: [tokenId],
    });

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
    const to = evmAddressSchema.parse(input.to);
    const amount = positiveDecimalAmountSchema.parse(input.amount);
    const { resolved } = await this.getVerifiedClient(input.network);
    const valueWei = this.parseNativeAmount(amount);
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
    const token = await this.getErc20Metadata(
      input.tokenContract,
      input.network,
    );
    const { resolved } = await this.getVerifiedClient(token.network);
    const to = evmAddressSchema.parse(input.to);
    const amount = positiveDecimalAmountSchema.parse(input.amount);
    const rawAmount = this.parseTokenAmount(
      amount,
      token.decimals,
      token.symbol,
    );
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
    const contractAddress = evmAddressSchema.parse(input.contractAddress);
    const abi = normalizeAbi(input.abi, input.functionName);
    const args = input.args ?? [];
    const { resolved } = await this.getVerifiedClient(input.network);
    const valueWei = input.value ? this.parseNativeAmount(input.value) : 0n;
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
    const { resolved } = await this.getVerifiedClient(prepared.rpcNetwork);
    const walletClient = createWalletClient({
      account,
      chain: resolved.chain,
      transport: http(this.requireRpcUrl(resolved.config)),
    });
    const request = buildPreparedNeoXTransactionRequest(prepared);
    const txHash =
      request.maxFeePerGas !== undefined ||
      request.maxPriorityFeePerGas !== undefined
        ? await walletClient.sendTransaction({
            to: request.to,
            value: request.value,
            data: request.data,
            gas: request.gas,
            maxFeePerGas: request.maxFeePerGas,
            maxPriorityFeePerGas: request.maxPriorityFeePerGas,
          })
        : await walletClient.sendTransaction({
            to: request.to,
            value: request.value,
            data: request.data,
            gas: request.gas,
            gasPrice: request.gasPrice,
          });

    return createBroadcastResult(prepared, txHash);
  }

  public async checkReadiness(): Promise<ProviderReadiness> {
    const network = this.config.neoX.defaultNetwork;
    const config = this.config.neoX.networks[network];
    const rpcUrlAlias = this.getRpcUrlAlias(network);
    const rpcHost = extractRpcHost(config.rpcUrl);
    const configuredChainId = config.chainId;
    const walletEnabled = this.walletEnabled();
    const walletAddress = this.getWalletAddress();
    const enabled = Boolean(config.rpcUrl || walletEnabled);

    if (!config.rpcUrl) {
      return {
        network: "neoX",
        enabled,
        configuredNetwork: network,
        rpcUrlAlias,
        rpcHost,
        rpcReachable: false,
        configuredChainId,
        networkMatchesConfiguration: !enabled,
        walletEnabled,
        walletAddress,
        reason: `Neo X ${network} RPC is not configured.`,
      };
    }

    if (!configuredChainId) {
      return {
        network: "neoX",
        enabled,
        configuredNetwork: network,
        rpcUrlAlias,
        rpcHost,
        rpcReachable: false,
        networkMatchesConfiguration: !enabled,
        walletEnabled,
        walletAddress,
        reason: `Neo X ${network} chain ID is not configured.`,
      };
    }

    try {
      const resolved = this.getResolvedClient(network);
      const chainId = await resolved.client.getChainId();
      const networkMatchesConfiguration = chainId === configuredChainId;

      return {
        network: "neoX",
        enabled,
        configuredNetwork: network,
        rpcUrlAlias,
        rpcHost,
        rpcReachable: true,
        chainId,
        configuredChainId,
        networkMatchesConfiguration,
        walletEnabled,
        walletAddress,
        reason: networkMatchesConfiguration
          ? undefined
          : `Configured Neo X ${network} chain ID ${configuredChainId} does not match the connected RPC chain ID ${chainId}.`,
      };
    } catch (error) {
      return {
        network: "neoX",
        enabled,
        configuredNetwork: network,
        rpcUrlAlias,
        rpcHost,
        rpcReachable: false,
        configuredChainId,
        networkMatchesConfiguration: false,
        walletEnabled,
        walletAddress,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
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

    if (fees?.maxFeePerGas || fees?.maxPriorityFeePerGas) {
      return {
        gas,
        maxFeePerGas: fees?.maxFeePerGas,
        maxPriorityFeePerGas: fees?.maxPriorityFeePerGas,
      };
    }

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

  private async getVerifiedClient(
    network?: NeoXNetwork,
  ): Promise<VerifiedNeoXClient> {
    const resolved = this.getResolvedClient(network);
    const chainId = await resolved.client.getChainId();

    if (chainId !== resolved.config.chainId) {
      throw new NeoRpcError(
        `Configured Neo X ${resolved.network} chain ID ${resolved.config.chainId} does not match the connected RPC chain ID ${chainId}.`,
      );
    }

    return {
      resolved,
      chainId,
    };
  }

  private parseNativeAmount(amount: string): bigint {
    try {
      return parseEther(amount);
    } catch (error) {
      throw new ValidationError(
        "Amount must be a valid GAS decimal string with up to 18 decimal places.",
        error instanceof Error ? error.message : error,
      );
    }
  }

  private parseTokenAmount(
    amount: string,
    decimals: number,
    symbol: string,
  ): bigint {
    try {
      return parseUnits(amount, decimals);
    } catch (error) {
      throw new ValidationError(
        `Amount must be a valid ${symbol} decimal string with up to ${decimals} decimal places.`,
        error instanceof Error ? error.message : error,
      );
    }
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

export function buildPreparedNeoXTransactionRequest(
  prepared: PreparedTransaction,
): {
  to: Address;
  value?: bigint;
  data?: Hex;
  gas?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
} {
  if (prepared.network !== "neoX" || !prepared.to) {
    throw new ValidationError("Prepared transaction is not a Neo X request.");
  }

  return {
    to: evmAddressSchema.parse(prepared.to) as Address,
    value: prepared.valueWei ? BigInt(prepared.valueWei) : undefined,
    data: prepared.data as Hex | undefined,
    gas: prepared.gas ? BigInt(prepared.gas) : undefined,
    gasPrice: prepared.gasPrice ? BigInt(prepared.gasPrice) : undefined,
    maxFeePerGas: prepared.maxFeePerGas
      ? BigInt(prepared.maxFeePerGas)
      : undefined,
    maxPriorityFeePerGas: prepared.maxPriorityFeePerGas
      ? BigInt(prepared.maxPriorityFeePerGas)
      : undefined,
  };
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
      validateJsonAbi(abiInput);
      abi = abiInput as Abi;
    } else {
      throw new Error("ABI input is not supported.");
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

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

function validateJsonAbi(abi: unknown[]): void {
  abi.forEach((entry, index) => {
    validateJsonAbiEntry(entry, `ABI entry ${index}`);
  });
}

function validateJsonAbiEntry(value: unknown, label: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${label} must be a JSON object.`);
  }

  const entry = value as Record<string, unknown>;

  if (typeof entry.type !== "string" || entry.type.trim() === "") {
    throw new ValidationError(`${label} must include a string 'type' field.`);
  }

  const entryType = entry.type.trim();

  if (["function", "constructor", "event", "error"].includes(entryType)) {
    if (!Array.isArray(entry.inputs)) {
      throw new ValidationError(`${label} must include an 'inputs' array.`);
    }

    entry.inputs.forEach((input, index) => {
      validateJsonAbiParameter(input, `${label} input ${index}`);
    });
  }

  if (entryType === "function") {
    if (typeof entry.name !== "string" || entry.name.trim() === "") {
      throw new ValidationError(`${label} must include a function name.`);
    }

    if (entry.outputs !== undefined) {
      if (!Array.isArray(entry.outputs)) {
        throw new ValidationError(`${label} outputs must be an array.`);
      }

      entry.outputs.forEach((output, index) => {
        validateJsonAbiParameter(output, `${label} output ${index}`);
      });
    }

    if (
      entry.stateMutability !== undefined &&
      !["pure", "view", "nonpayable", "payable"].includes(
        String(entry.stateMutability),
      )
    ) {
      throw new ValidationError(
        `${label} has an invalid stateMutability value.`,
      );
    }
  }

  if (entryType === "event" || entryType === "error") {
    if (typeof entry.name !== "string" || entry.name.trim() === "") {
      throw new ValidationError(`${label} must include a name.`);
    }
  }
}

function validateJsonAbiParameter(value: unknown, label: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${label} must be a JSON object.`);
  }

  const parameter = value as Record<string, unknown>;

  if (typeof parameter.type !== "string" || parameter.type.trim() === "") {
    throw new ValidationError(`${label} must include a string 'type' field.`);
  }

  if (parameter.name !== undefined && typeof parameter.name !== "string") {
    throw new ValidationError(`${label} name must be a string.`);
  }

  if (
    parameter.internalType !== undefined &&
    typeof parameter.internalType !== "string"
  ) {
    throw new ValidationError(`${label} internalType must be a string.`);
  }

  if (parameter.components !== undefined) {
    if (!Array.isArray(parameter.components)) {
      throw new ValidationError(`${label} components must be an array.`);
    }

    parameter.components.forEach((component, index) => {
      validateJsonAbiParameter(component, `${label} component ${index}`);
    });
  }
}

function parseBlockNumber(value: string, label: string): bigint {
  const normalized = value.trim();

  if (!decimalIntegerPattern.test(normalized)) {
    throw new ValidationError(
      `${label} must be a non-negative integer string.`,
    );
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

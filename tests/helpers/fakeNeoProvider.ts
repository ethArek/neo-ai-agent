import { wallet as neoWallet } from "@cityofzion/neon-js";

import { createBroadcastResult } from "../../src/neo/broadcast";
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
  NeoNetwork,
  NeoProvider,
  NetworkAddressMap,
  PreparedTransaction,
  ProviderReadinessStatus,
  TokenBalance,
  TokenMetadata,
  TransactionDetails,
  TransactionLookup,
  TransactionStatus,
  TransactionStatusLookup,
} from "../../src/neo/types";

const gasContract = "0xd2a4cff31913016155e38e474a2c06d08be276cf";
const neoContract = "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5";
const fusdContract = "0x1005d400bcc2a56b7352f09e273be3f9933a5fb1";
const flmContract = "0xf0151f528127558851b39c2cd8aa47da7418ab28";
const flamingoBrokerContract = "0xec268e9c642b7d09d10fe658bcb1cc63c0895d4d";
const flamingoRouterContract = "0xde3a4b093abbd07e9a69cdec88a54d9a1fe14975";
const neoXTokenContract = "0x1111111111111111111111111111111111111111";
const neoXNftContract = "0x2222222222222222222222222222222222222222";
const neoXRecipientAddress = "0x3333333333333333333333333333333333333333";

function createPreparedTransaction(
  input: Omit<
    PreparedTransaction,
    "kind" | "network" | "unsignedTransaction"
  > & {
    network?: NeoNetwork;
    unsignedTransaction?: string;
  },
): PreparedTransaction {
  return {
    ...input,
    kind: "transaction",
    network: input.network ?? "neoN3",
    unsignedTransaction: input.unsignedTransaction ?? "00c0ffee",
  };
}

export class FakeNeoProvider implements NeoProvider {
  public readonly neoN3Address = new neoWallet.Account().address;
  public readonly neoXAddress = "0xAA00000000000000000000000000000000000001";
  public readonly recipientAddress = new neoWallet.Account().address;
  public readonly neoXRecipientAddress = neoXRecipientAddress;
  public readonly neoXTokenContract = neoXTokenContract;
  public readonly neoXNftContract = neoXNftContract;
  public readonly neoNsName = "arkadiusz.neo";
  public readonly latestTxHash = `0x${"c".repeat(64)}`;
  public readonly latestNeoXTxHash = `0x${"f".repeat(64)}`;

  public getImplementedNetworks(): NeoNetwork[] {
    return ["neoN3", "neoX"];
  }

  public getDefaultNetwork(): NeoNetwork {
    return "neoN3";
  }

  public getWalletAddresses(): NetworkAddressMap {
    return {
      neoN3: this.neoN3Address,
      neoX: this.neoXAddress,
    };
  }

  public getWalletAddress(network: NeoNetwork): string | undefined {
    return network === "neoN3" ? this.neoN3Address : this.neoXAddress;
  }

  public async getNeoN3GasBalance(address: string): Promise<TokenBalance> {
    const owner = this.normalizeAddress(address);

    return {
      contractAddress: gasContract,
      symbol: "GAS",
      decimals: 8,
      name: "Gas",
      isNative: true,
      owner,
      rawBalance: "456000000",
      balance: "4.56",
    };
  }

  public async getNeoN3UnclaimedGas(
    address: string,
  ): Promise<NeoN3UnclaimedGas> {
    const owner = this.normalizeAddress(address);

    return {
      address: owner,
      symbol: "GAS",
      decimals: 8,
      rawUnclaimed: "123456789",
      unclaimed: "1.23456789",
    };
  }

  public async getNeoN3TokenBalances(
    address: string,
    token?: string,
  ): Promise<TokenBalance[]> {
    const owner = this.normalizeAddress(address);
    const allBalances: TokenBalance[] = [
      await this.getNeoN3GasBalance(owner),
      {
        contractAddress: neoContract,
        symbol: "NEO",
        decimals: 0,
        name: "Neo",
        isNative: true,
        owner,
        rawBalance: "12",
        balance: "12",
      },
      {
        contractAddress: fusdContract,
        symbol: "FUSD",
        decimals: 8,
        name: "Flamingo USD",
        owner,
        rawBalance: "1250000000",
        balance: "12.5",
      },
      {
        contractAddress: flmContract,
        symbol: "FLM",
        decimals: 8,
        name: "Flamingo",
        owner,
        rawBalance: "5000000000",
        balance: "50",
      },
    ];

    if (!token) {
      return allBalances;
    }

    const normalizedToken = token.trim().toUpperCase();

    return allBalances.filter(
      (balance) =>
        balance.symbol === normalizedToken ||
        balance.contractAddress.toLowerCase() === token.toLowerCase(),
    );
  }

  public async getNeoN3PortfolioOverview(
    address: string,
  ): Promise<NeoN3PortfolioOverview> {
    const owner = this.normalizeAddress(address);
    const balances = await this.getNeoN3TokenBalances(owner);
    const gasBalance = balances.find((balance) => balance.symbol === "GAS");
    const neoBalance = balances.find((balance) => balance.symbol === "NEO");

    if (!gasBalance || !neoBalance) {
      throw new Error("Expected GAS and NEO balances in the fake provider.");
    }

    return {
      address: owner,
      gasBalance,
      neoBalance,
      tokenBalances: balances.filter(
        (balance) => balance.symbol !== "GAS" && balance.symbol !== "NEO",
      ),
    };
  }

  public async getNeoN3TransferHistory(input: {
    address: string;
    token?: string;
    limit?: number;
  }): Promise<NeoN3TransferHistory> {
    const address = this.normalizeAddress(input.address);
    const transfers = [
      {
        direction: "received" as const,
        txHash: `0x${"d".repeat(64)}`,
        blockIndex: 123,
        timestamp: 1_710_000_100_000,
        counterparty: new neoWallet.Account().address,
        amount: "5",
        token: {
          contractAddress: fusdContract,
          symbol: "FUSD",
          decimals: 8,
          name: "Flamingo USD",
        },
      },
      {
        direction: "sent" as const,
        txHash: `0x${"e".repeat(64)}`,
        blockIndex: 122,
        timestamp: 1_710_000_000_000,
        counterparty: new neoWallet.Account().address,
        amount: "1",
        token: {
          contractAddress: neoContract,
          symbol: "NEO",
          decimals: 0,
          name: "Neo",
          isNative: true,
        },
      },
    ].filter((entry) => {
      if (!input.token) {
        return true;
      }

      return entry.token.symbol === input.token.trim().toUpperCase();
    });
    const limitedTransfers = transfers.slice(0, input.limit ?? 10);

    return {
      address,
      count: limitedTransfers.length,
      transfers: limitedTransfers,
    };
  }

  public async getTransaction(
    input: TransactionLookup,
  ): Promise<TransactionDetails> {
    return {
      transaction: {
        hash: input.hash,
        sender: this.neoN3Address,
        script: "00c0ffee",
      },
      applicationLog: {
        executions: [
          {
            vmstate: "HALT",
          },
        ],
      },
    };
  }

  public async getTransactionStatus(
    input: TransactionStatusLookup,
  ): Promise<TransactionStatus> {
    if (input.network === "neoX") {
      return {
        hash: input.hash,
        network: input.network,
        status: "confirmed",
        summary: `Neo X transaction ${input.hash} is confirmed.`,
        blockNumber: "654",
        transaction: {
          hash: input.hash,
          from: this.neoXAddress,
        },
        applicationLog: {
          status: "success",
        },
      };
    }

    return {
      hash: input.hash,
      network: input.network,
      status: "confirmed",
      summary: `Neo N3 transaction ${input.hash} is confirmed.`,
      blockNumber: 456,
      transaction: {
        hash: input.hash,
        sender: this.neoN3Address,
      },
      applicationLog: {
        executions: [
          {
            vmstate: "HALT",
          },
        ],
      },
    };
  }

  public async getBlock(reference: BlockReference): Promise<unknown> {
    return {
      hash: reference.hash ?? `0x${"b".repeat(64)}`,
      index: reference.height ?? 321,
      network: reference.network ?? "neoN3",
    };
  }

  public async resolveNeoN3TokenMetadata(
    token: string,
  ): Promise<TokenMetadata> {
    const normalizedToken = token.trim().toUpperCase();

    if (normalizedToken === "GAS") {
      return {
        contractAddress: gasContract,
        symbol: "GAS",
        decimals: 8,
        name: "Gas",
        isNative: true,
      };
    }

    if (normalizedToken === "NEO") {
      return {
        contractAddress: neoContract,
        symbol: "NEO",
        decimals: 0,
        name: "Neo",
        isNative: true,
      };
    }

    if (normalizedToken === "FLM") {
      return {
        contractAddress: flmContract,
        symbol: "FLM",
        decimals: 8,
        name: "Flamingo",
      };
    }

    return {
      contractAddress: fusdContract,
      symbol: normalizedToken,
      decimals: 8,
      name: normalizedToken,
    };
  }

  public async invokeNeoN3Read(
    contractHash: string,
    operation: string,
    args: unknown[] = [],
  ): Promise<NeoN3ReadInvocationResult> {
    return {
      contractHash,
      operation,
      args,
      rawResult: {
        state: "HALT",
        stack: [
          {
            type: "Integer",
            value: "42",
          },
        ],
      },
      result: "42",
    };
  }

  public async buildNeoN3ContractWrite(
    input: NeoN3ContractWriteInput,
  ): Promise<PreparedTransaction> {
    return createPreparedTransaction({
      action: "prepareNeoN3ContractWrite",
      summary: `Prepared a Neo N3 contract write for ${input.operation} on ${input.contractHash}.`,
      sender: this.neoN3Address,
      networkMagic: 860_833_102,
      nonce: 1,
      to: input.contractHash,
      contractAddress: input.contractHash,
      operation: input.operation,
      allowedContracts: input.allowedContracts ?? [input.contractHash],
    });
  }

  public async getNeoN3SwapQuote(
    input: NeoN3SwapQuoteInput,
  ): Promise<NeoN3SwapQuote> {
    const fromToken = await this.resolveNeoN3TokenMetadata(input.fromToken);
    const toToken = await this.resolveNeoN3TokenMetadata(input.toToken);
    const routeSymbols =
      fromToken.symbol === "GAS" && toToken.symbol === "FUSD"
        ? ["GAS", "FLM", "FUSD"]
        : [fromToken.symbol, toToken.symbol];
    const routeContracts = routeSymbols.map((symbol) => {
      if (symbol === "GAS") {
        return gasContract;
      }

      if (symbol === "FLM") {
        return flmContract;
      }

      return fusdContract;
    });
    const amountOut =
      fromToken.symbol === "GAS" && toToken.symbol === "FUSD" ? "2.4" : "1.5";
    const slippagePercent = input.slippagePercent ?? "1";
    const slippageBps = Math.round(Number(slippagePercent) * 100);
    const minimumAmountOut = (
      Number(amountOut) *
      ((10_000 - slippageBps) / 10_000)
    ).toFixed(3);
    const deadlineMinutes = input.deadlineMinutes ?? 20;
    const deadlineTimestamp = 1_900_000_000 + deadlineMinutes * 60;

    return {
      dex: "Flamingo",
      routerContract: flamingoRouterContract,
      brokerContract: flamingoBrokerContract,
      fromToken,
      toToken,
      amountIn: input.amount,
      amountOut,
      minimumAmountOut,
      slippagePercent,
      slippageBps,
      routeSymbols,
      routeContracts,
      tradingPairIds: routeSymbols.length === 3 ? [11, 14] : [15],
      routeAmounts:
        routeSymbols.length === 3
          ? [input.amount, "12.0", amountOut]
          : [input.amount, amountOut],
      deadlineMinutes,
      deadlineTimestamp,
      deadlineIso: new Date(deadlineTimestamp * 1000).toISOString(),
      notes: input.force
        ? ["Force mode selected the best route automatically."]
        : ["Best Flamingo route loaded from the fake provider."],
    };
  }

  public async prepareNeoN3GasTransfer(input: {
    to: string;
    amount: string;
  }): Promise<PreparedTransaction> {
    const recipient = this.normalizeAddress(input.to);

    return createPreparedTransaction({
      action: "sendNeoN3Gas",
      summary: `Prepared a Neo N3 GAS transfer of ${input.amount} GAS to ${recipient}.`,
      sender: this.neoN3Address,
      networkMagic: 860_833_102,
      nonce: 1,
      to: recipient,
      amount: input.amount,
      tokenAddress: gasContract,
      tokenSymbol: "GAS",
      contractAddress: gasContract,
      allowedContracts: [gasContract],
    });
  }

  public async prepareNeoN3TokenTransfer(
    input: NeoN3TokenTransferInput,
  ): Promise<PreparedTransaction> {
    const recipient = this.normalizeAddress(input.to);
    const metadata = await this.resolveNeoN3TokenMetadata(input.token);

    return createPreparedTransaction({
      action: "sendNeoN3Token",
      summary: `Prepared a Neo N3 transfer of ${input.amount} ${metadata.symbol} to ${recipient}.`,
      sender: this.neoN3Address,
      networkMagic: 860_833_102,
      nonce: 1,
      to: recipient,
      amount: input.amount,
      tokenAddress: metadata.contractAddress,
      tokenSymbol: metadata.symbol,
      contractAddress: metadata.contractAddress,
      allowedContracts: [metadata.contractAddress],
    });
  }

  public async prepareNeoN3TokenSwap(
    input: NeoN3TokenSwapInput,
  ): Promise<PreparedTransaction> {
    const quote = await this.getNeoN3SwapQuote(input);

    return createPreparedTransaction({
      action: "swapNeoN3Token",
      summary: `Prepared a Flamingo swap on Neo N3 from ${input.amount} ${quote.fromToken.symbol} to about ${quote.amountOut} ${quote.toToken.symbol} via ${quote.routeSymbols.join(" -> ")} with minimum received ${quote.minimumAmountOut} ${quote.toToken.symbol}, slippage ${quote.slippagePercent}%, and deadline ${quote.deadlineMinutes} minutes.`,
      sender: this.neoN3Address,
      networkMagic: 860_833_102,
      nonce: 1,
      to: quote.routerContract,
      amount: input.amount,
      tokenAddress: quote.fromToken.contractAddress,
      tokenSymbol: quote.fromToken.symbol,
      contractAddress: quote.routerContract,
      operation: "standardConvert",
      toTokenAddress: quote.toToken.contractAddress,
      toTokenSymbol: quote.toToken.symbol,
      amountOut: quote.amountOut,
      minimumAmountOut: quote.minimumAmountOut,
      slippagePercent: quote.slippagePercent,
      routeSymbols: quote.routeSymbols,
      routeContracts: quote.routeContracts,
      tradingPairIds: quote.tradingPairIds,
      deadlineMinutes: quote.deadlineMinutes,
      deadlineTimestamp: quote.deadlineTimestamp,
      allowedContracts: [
        quote.brokerContract ?? flamingoBrokerContract,
        quote.routerContract,
        quote.fromToken.contractAddress,
      ],
    });
  }

  public async getNeoXChainInfo(
    network: NeoXNetwork = "testnet",
  ): Promise<NeoXChainInfo> {
    return {
      chain: "neo-x",
      network,
      chainId: this.getNeoXChainId(network),
      configuredChainId: this.getNeoXChainId(network),
      rpcReachable: true,
      latestBlock: "123456",
      rpcUrlAlias:
        network === "mainnet" ? "NEOX_MAINNET_RPC_URL" : "NEOX_TESTNET_RPC_URL",
      explorerBaseUrl: "https://xexplorer.example.com",
    };
  }

  public async getNeoXNativeBalance(
    address: string,
    network: NeoXNetwork = "testnet",
  ): Promise<NeoXNativeBalance> {
    return {
      chain: "neo-x",
      network,
      chainId: this.getNeoXChainId(network),
      owner: address,
      symbol: "GAS",
      rawBalanceWei: "1230000000000000000",
      balance: "1.23",
      rpcUrlAlias:
        network === "mainnet" ? "NEOX_MAINNET_RPC_URL" : "NEOX_TESTNET_RPC_URL",
      explorerUrl: `https://xexplorer.example.com/address/${address}`,
    };
  }

  public async getNeoXBlock(reference: NeoXBlockReference): Promise<unknown> {
    return {
      chain: "neo-x",
      network: reference.network ?? "testnet",
      number: reference.number ?? "123456",
      hash: reference.hash ?? `0x${"b".repeat(64)}`,
    };
  }

  public async getNeoXTransaction(input: {
    hash: string;
    network?: NeoXNetwork;
  }): Promise<unknown> {
    return {
      chain: "neo-x",
      network: input.network ?? "testnet",
      transaction: {
        hash: input.hash,
        from: this.neoXAddress,
        to: neoXRecipientAddress,
        value: "1000000000000000000",
      },
    };
  }

  public async getNeoXTransactionReceipt(input: {
    hash: string;
    network?: NeoXNetwork;
  }): Promise<unknown> {
    return {
      chain: "neo-x",
      network: input.network ?? "testnet",
      receipt: {
        transactionHash: input.hash,
        status: "success",
        blockNumber: "123456",
      },
    };
  }

  public async callNeoXContract(
    input: NeoXContractCallInput,
  ): Promise<NeoXContractCallResult> {
    return {
      chain: "neo-x",
      network: input.network ?? "testnet",
      chainId: this.getNeoXChainId(input.network ?? "testnet"),
      contractAddress: input.contractAddress,
      functionName: input.functionName,
      args: input.args ?? [],
      result: "42",
      rpcUrlAlias: "NEOX_TESTNET_RPC_URL",
    };
  }

  public async getNeoXErc20Metadata(
    tokenContract: string,
    network: NeoXNetwork = "testnet",
  ): Promise<NeoXErc20Metadata> {
    return {
      chain: "neo-x",
      network,
      chainId: this.getNeoXChainId(network),
      contractAddress: tokenContract,
      name: "Neo X Test Token",
      symbol: "XTT",
      decimals: 18,
      rpcUrlAlias:
        network === "mainnet" ? "NEOX_MAINNET_RPC_URL" : "NEOX_TESTNET_RPC_URL",
      explorerUrl: `https://xexplorer.example.com/address/${tokenContract}`,
    };
  }

  public async getNeoXErc20Balance(input: {
    tokenContract: string;
    owner: string;
    network?: NeoXNetwork;
  }): Promise<NeoXErc20Balance> {
    const metadata = await this.getNeoXErc20Metadata(
      input.tokenContract,
      input.network,
    );

    return {
      ...metadata,
      owner: input.owner,
      rawBalance: "2500000000000000000",
      formattedBalance: "2.5",
    };
  }

  public async getNeoXErc721Owner(input: {
    contractAddress: string;
    tokenId: string;
    network?: NeoXNetwork;
  }): Promise<NeoXErc721Owner> {
    const network = input.network ?? "testnet";

    return {
      chain: "neo-x",
      network,
      chainId: this.getNeoXChainId(network),
      contractAddress: input.contractAddress,
      tokenId: input.tokenId,
      owner: this.neoXAddress,
      rpcUrlAlias: "NEOX_TESTNET_RPC_URL",
      explorerUrl: `https://xexplorer.example.com/address/${input.contractAddress}`,
    };
  }

  public async prepareNeoXNativeTransfer(
    input: NeoXNativeTransferInput,
  ): Promise<PreparedTransaction> {
    const network = input.network ?? "testnet";

    return createPreparedTransaction({
      action: "neox_prepare_native_transfer",
      summary: `Prepared a Neo X ${network} GAS transfer of ${input.amount} GAS to ${input.to}.`,
      network: "neoX",
      rpcNetwork: network,
      chainId: this.getNeoXChainId(network),
      sender: this.neoXAddress,
      to: input.to,
      amount: input.amount,
      tokenSymbol: "GAS",
      valueWei: "1000000000000000000",
      gas: "21000",
      maxFeePerGas: "1000000000",
      rpcUrlAlias: "NEOX_TESTNET_RPC_URL",
      transactionRequest: {
        from: this.neoXAddress,
        to: input.to,
      },
    });
  }

  public async prepareNeoXErc20Transfer(
    input: NeoXErc20TransferInput,
  ): Promise<PreparedTransaction> {
    const metadata = await this.getNeoXErc20Metadata(
      input.tokenContract,
      input.network,
    );

    return createPreparedTransaction({
      action: "neox_prepare_erc20_transfer",
      summary: `Prepared a Neo X ${metadata.network} ERC-20 transfer of ${input.amount} ${metadata.symbol} to ${input.to}.`,
      network: "neoX",
      rpcNetwork: metadata.network,
      chainId: metadata.chainId,
      sender: this.neoXAddress,
      to: input.to,
      amount: input.amount,
      tokenAddress: input.tokenContract,
      tokenSymbol: metadata.symbol,
      contractAddress: input.tokenContract,
      operation: "transfer",
      functionName: "transfer",
      decodedArgs: [input.to, input.amount],
      valueWei: "0",
      gas: "65000",
      maxFeePerGas: "1000000000",
      rpcUrlAlias: metadata.rpcUrlAlias,
      transactionRequest: {
        from: this.neoXAddress,
        to: input.tokenContract,
      },
    });
  }

  public async prepareNeoXContractWrite(
    input: NeoXContractWriteInput,
  ): Promise<PreparedTransaction> {
    const network = input.network ?? "testnet";

    return createPreparedTransaction({
      action: "neox_prepare_contract_write",
      summary: `Prepared a Neo X ${network} contract write ${input.functionName} on ${input.contractAddress}.`,
      network: "neoX",
      rpcNetwork: network,
      chainId: this.getNeoXChainId(network),
      sender: this.neoXAddress,
      to: input.contractAddress,
      amount: input.value,
      contractAddress: input.contractAddress,
      operation: input.functionName,
      functionName: input.functionName,
      decodedArgs: input.args ?? [],
      valueWei: "0",
      gas: "80000",
      maxFeePerGas: "1000000000",
      rpcUrlAlias: "NEOX_TESTNET_RPC_URL",
      transactionRequest: {
        from: this.neoXAddress,
        to: input.contractAddress,
      },
    });
  }

  public async signAndBroadcast(
    prepared: PreparedTransaction,
  ): Promise<BroadcastResult> {
    return createBroadcastResult(
      prepared,
      prepared.network === "neoX" ? this.latestNeoXTxHash : this.latestTxHash,
    );
  }

  public walletEnabled(network?: NeoNetwork): boolean {
    if (!network) {
      return true;
    }

    return network === "neoN3" || network === "neoX";
  }

  public async checkReadiness(): Promise<ProviderReadinessStatus> {
    return {
      neoN3: {
        network: "neoN3",
        enabled: true,
        configuredNetwork: "mainnet",
        rpcUrlAlias: "NEO_N3_RPC_URL",
        rpcHost: "n3.example.com",
        rpcReachable: true,
        networkMagic: 860_833_102,
        networkMatchesConfiguration: true,
        walletEnabled: true,
        walletAddress: this.neoN3Address,
      },
      neoX: {
        network: "neoX",
        enabled: true,
        configuredNetwork: "testnet",
        rpcUrlAlias: "NEOX_TESTNET_RPC_URL",
        rpcHost: "x.example.com",
        rpcReachable: true,
        chainId: this.getNeoXChainId("testnet"),
        configuredChainId: this.getNeoXChainId("testnet"),
        networkMatchesConfiguration: true,
        walletEnabled: true,
        walletAddress: this.neoXAddress,
      },
    };
  }

  private normalizeAddress(address: string): string {
    return address === this.neoNsName ? this.neoN3Address : address;
  }

  private getNeoXChainId(network: NeoXNetwork): number {
    return network === "mainnet" ? 47_763 : 12_227_332;
  }
}

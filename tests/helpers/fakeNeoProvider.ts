import { wallet as neoWallet } from "@cityofzion/neon-js";
import { Wallet } from "ethers";

import { createBroadcastResult } from "../../src/neo/broadcast";
import type {
  BlockReference,
  BridgeQuote,
  BridgeStatus,
  BroadcastResult,
  ContractWriteInput,
  Erc20ApprovalInput,
  Erc20TransferInput,
  GasBridgeInput,
  GasBridgeQuoteInput,
  NeoN3ContractWriteInput,
  NeoN3PortfolioOverview,
  NeoN3ReadInvocationResult,
  NeoN3SwapQuote,
  NeoN3SwapQuoteInput,
  NeoN3TokenTransferInput,
  NeoN3TokenSwapInput,
  NeoN3TransferHistory,
  NeoProvider,
  PreparedTransaction,
  PreparedTransactionRequest,
  ReadInvocationResult,
  TokenBalance,
  TokenMetadata,
  TransactionDetails,
  TransactionStatus,
} from "../../src/neo/types";

const gasWrappedAddress = "0xdE41591ED1f8ED1484aC2CD8ca0876428de60EfF";
const usdtAddress = "0x1111111111111111111111111111111111111111";
const neoN3FusdContract = "0x1111111111111111111111111111111111111111";
const neoN3FlmContract = "0x2222222222222222222222222222222222222222";
const neoN3FlamingoBrokerContract =
  "0x4444444444444444444444444444444444444444";
const neoN3FlamingoRouterContract =
  "0x3333333333333333333333333333333333333333";

function createRequest(
  to: string,
  data?: string,
  value?: string,
): PreparedTransactionRequest {
  return {
    to,
    nonce: 1,
    chainId: 47_763,
    gasLimit: "21000",
    data,
    value,
    maxFeePerGas: "1000000000",
    maxPriorityFeePerGas: "100000000",
  };
}

function createPreparedTransaction(
  input: Omit<
    PreparedTransaction,
    "kind" | "request" | "unsignedTransaction"
  > & {
    request?: PreparedTransactionRequest;
    unsignedTransaction?: string;
  },
): PreparedTransaction {
  const request =
    input.request ??
    (input.network === "neoN3"
      ? undefined
      : createRequest(input.to ?? usdtAddress, input.data, input.value));

  return {
    ...input,
    kind: "transaction",
    request,
    unsignedTransaction:
      input.unsignedTransaction ??
      (request ? JSON.stringify(request) : "00c0ffee"),
  };
}

export class FakeNeoProvider implements NeoProvider {
  public readonly senderAddress = Wallet.createRandom().address;
  public readonly recipientAddress = Wallet.createRandom().address;
  public readonly neoN3Address = new neoWallet.Account().address;
  public readonly neoNsName = "arkadiusz.neo";
  public readonly neoXBridgeDestination = Wallet.createRandom().address;

  public async validateAddress(): Promise<boolean> {
    return true;
  }

  public async getTokenBalances(
    address: string,
    token?: string,
  ): Promise<TokenBalance[]> {
    return [
      {
        contractAddress: usdtAddress,
        symbol: token?.toUpperCase() ?? "USDT",
        decimals: 18,
        name: "Tether USD",
        owner: address,
        rawBalance: "25000000000000000000",
        balance: "25.0",
      },
    ];
  }

  public async getNativeBalance(address: string): Promise<TokenBalance> {
    return {
      contractAddress: gasWrappedAddress,
      symbol: "GAS",
      decimals: 18,
      name: "Gas",
      isNative: true,
      owner: address,
      rawBalance: "1230000000000000000",
      balance: "1.23",
    };
  }

  public async getNeoN3GasBalance(address: string): Promise<TokenBalance> {
    const owner = address === this.neoNsName ? this.neoN3Address : address;

    return {
      contractAddress: "0xd2a4cff31913016155e38e474a2c06d08be276cf",
      symbol: "GAS",
      decimals: 8,
      name: "Gas",
      isNative: true,
      owner,
      rawBalance: "456000000",
      balance: "4.56",
    };
  }

  public async getNeoN3TokenBalances(
    address: string,
    token?: string,
  ): Promise<TokenBalance[]> {
    const owner = address === this.neoNsName ? this.neoN3Address : address;

    if (token && token.trim().toUpperCase() === "NEO") {
      return [
        {
          contractAddress: "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5",
          symbol: "NEO",
          decimals: 0,
          name: "Neo",
          isNative: true,
          owner,
          rawBalance: "12",
          balance: "12",
        },
      ];
    }

    if (token && token.trim().toUpperCase() === "FUSD") {
      return [
        {
          contractAddress: neoN3FusdContract,
          symbol: "FUSD",
          decimals: 8,
          name: "FUSD",
          owner,
          rawBalance: "1250000000",
          balance: "12.5",
        },
      ];
    }

    if (token && token.trim().toUpperCase() === "FLM") {
      return [
        {
          contractAddress: neoN3FlmContract,
          symbol: "FLM",
          decimals: 8,
          name: "Flamingo",
          owner,
          rawBalance: "5000000000",
          balance: "50",
        },
      ];
    }

    return [
      await this.getNeoN3GasBalance(owner),
      {
        contractAddress: "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5",
        symbol: "NEO",
        decimals: 0,
        name: "Neo",
        isNative: true,
        owner,
        rawBalance: "12",
        balance: "12",
      },
      {
        contractAddress: neoN3FusdContract,
        symbol: "FUSD",
        decimals: 8,
        name: "FUSD",
        owner,
        rawBalance: "1250000000",
        balance: "12.5",
      },
      {
        contractAddress: neoN3FlmContract,
        symbol: "FLM",
        decimals: 8,
        name: "Flamingo",
        owner,
        rawBalance: "5000000000",
        balance: "50",
      },
    ];
  }

  public async getNeoN3PortfolioOverview(
    address: string,
  ): Promise<NeoN3PortfolioOverview> {
    const owner = address === this.neoNsName ? this.neoN3Address : address;

    return {
      address: owner,
      gasBalance: {
        contractAddress: "0xd2a4cff31913016155e38e474a2c06d08be276cf",
        symbol: "GAS",
        decimals: 8,
        name: "Gas",
        isNative: true,
        owner,
        rawBalance: "456000000",
        balance: "4.56",
      },
      neoBalance: {
        contractAddress: "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5",
        symbol: "NEO",
        decimals: 0,
        name: "Neo",
        isNative: true,
        owner,
        rawBalance: "12",
        balance: "12",
      },
      tokenBalances: [
        {
          contractAddress: neoN3FusdContract,
          symbol: "FUSD",
          decimals: 8,
          name: "FUSD",
          owner,
          rawBalance: "1250000000",
          balance: "12.5",
        },
        {
          contractAddress: neoN3FlmContract,
          symbol: "FLM",
          decimals: 8,
          name: "Flamingo",
          owner,
          rawBalance: "5000000000",
          balance: "50",
        },
      ],
    };
  }

  public async getNeoN3TransferHistory(input: {
    address: string;
    token?: string;
    limit?: number;
  }): Promise<NeoN3TransferHistory> {
    const address =
      input.address === this.neoNsName ? this.neoN3Address : input.address;
    const transfers = [
      {
        direction: "received" as const,
        txHash: `0x${"d".repeat(64)}`,
        blockIndex: 123,
        timestamp: 1_710_000_100_000,
        counterparty: new neoWallet.Account().address,
        amount: "5",
        token: {
          contractAddress: neoN3FusdContract,
          symbol: "FUSD",
          decimals: 8,
          name: "FUSD",
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
          contractAddress: "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5",
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

  public async getTransaction(): Promise<TransactionDetails> {
    return {
      transaction: {
        hash: `0x${"a".repeat(64)}`,
        from: this.senderAddress,
        to: this.recipientAddress,
      },
      receipt: {
        status: 1,
        transactionHash: `0x${"a".repeat(64)}`,
      },
    };
  }

  public async getTransactionStatus(input: {
    hash: string;
    network: "neoX" | "neoN3";
  }): Promise<TransactionStatus> {
    return {
      hash: input.hash,
      network: input.network,
      status: "confirmed",
      summary: `${input.network} transaction ${input.hash} is confirmed.`,
      blockNumber: input.network === "neoX" ? 123 : 456,
      transaction: {
        hash: input.hash,
        from: input.network === "neoX" ? this.senderAddress : this.neoN3Address,
      },
      receipt:
        input.network === "neoX"
          ? {
              status: 1,
              transactionHash: input.hash,
            }
          : null,
      applicationLog:
        input.network === "neoN3"
          ? {
              executions: [
                {
                  vmstate: "HALT",
                },
              ],
            }
          : null,
    };
  }

  public async getBlock(reference: BlockReference): Promise<unknown> {
    return {
      reference,
      hash: `0x${"b".repeat(64)}`,
    };
  }

  public async invokeRead(
    contractAddress: string,
    functionSignature: string,
    args: unknown[] = [],
  ): Promise<ReadInvocationResult> {
    return {
      contractAddress,
      functionSignature,
      args,
      rawResult: "0x01",
      result: "ok",
    };
  }

  public async resolveNeoN3TokenMetadata(
    token: string,
  ): Promise<TokenMetadata> {
    const normalized = token.trim().toUpperCase();

    if (normalized === "GAS") {
      return {
        contractAddress: "0xd2a4cff31913016155e38e474a2c06d08be276cf",
        symbol: "GAS",
        decimals: 8,
        name: "Gas",
        isNative: true,
      };
    }

    if (normalized === "NEO") {
      return {
        contractAddress: "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5",
        symbol: "NEO",
        decimals: 0,
        name: "Neo",
        isNative: true,
      };
    }

    if (normalized === "FLM") {
      return {
        contractAddress: neoN3FlmContract,
        symbol: "FLM",
        decimals: 8,
        name: "Flamingo",
      };
    }

    return {
      contractAddress: neoN3FusdContract,
      symbol: normalized,
      decimals: 8,
      name: normalized,
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

  public async resolveTokenMetadata(token: string): Promise<TokenMetadata> {
    if (token.trim().toUpperCase() === "GAS") {
      return {
        contractAddress: gasWrappedAddress,
        symbol: "GAS",
        decimals: 18,
        name: "Gas",
        isNative: true,
      };
    }

    return {
      contractAddress: usdtAddress,
      symbol: token.trim().toUpperCase(),
      decimals: 18,
      name: "Test Token",
    };
  }

  public async buildContractWrite(
    input: ContractWriteInput,
  ): Promise<PreparedTransaction> {
    return createPreparedTransaction({
      action: "prepareContractWrite",
      summary: `Prepared a contract write for ${input.functionSignature} on ${input.contractAddress}.`,
      sender: this.senderAddress,
      chainId: 47_763,
      nonce: 1,
      gasLimit: "90000",
      to: input.contractAddress,
      contractAddress: input.contractAddress,
      functionSignature: input.functionSignature,
      data: "0xdeadbeef",
    });
  }

  public async buildNeoN3ContractWrite(
    input: NeoN3ContractWriteInput,
  ): Promise<PreparedTransaction> {
    return createPreparedTransaction({
      action: "prepareNeoN3ContractWrite",
      summary: `Prepared a Neo N3 contract write for ${input.operation} on ${input.contractHash}.`,
      network: "neoN3",
      sender: this.neoN3Address,
      networkMagic: 860_833_102,
      nonce: 1,
      to: input.contractHash,
      contractAddress: input.contractHash,
      operation: input.operation,
      unsignedTransaction: "00c0ffee",
      allowedContracts: [input.contractHash],
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
        return "0xd2a4cff31913016155e38e474a2c06d08be276cf";
      }

      if (symbol === "FLM") {
        return neoN3FlmContract;
      }

      return neoN3FusdContract;
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
      routerContract: neoN3FlamingoRouterContract,
      brokerContract: neoN3FlamingoBrokerContract,
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

  public async prepareNeoN3TokenSwap(
    input: NeoN3TokenSwapInput,
  ): Promise<PreparedTransaction> {
    const quote = await this.getNeoN3SwapQuote(input);

    return createPreparedTransaction({
      action: "swapNeoN3Token",
      summary: `Prepared a Flamingo swap on Neo N3 from ${input.amount} ${quote.fromToken.symbol} to about ${quote.amountOut} ${quote.toToken.symbol} via ${quote.routeSymbols.join(" -> ")} with minimum received ${quote.minimumAmountOut} ${quote.toToken.symbol}, slippage ${quote.slippagePercent}%, and deadline ${quote.deadlineMinutes} minutes.`,
      network: "neoN3",
      sender: this.neoN3Address,
      networkMagic: 860_833_102,
      nonce: 1,
      to: quote.routerContract,
      amount: input.amount,
      tokenAddress: quote.fromToken.contractAddress,
      tokenSymbol: quote.fromToken.symbol,
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
      contractAddress: quote.routerContract,
      operation: "standardConvert",
      unsignedTransaction: "00c0ffee",
      allowedContracts: [
        quote.brokerContract ?? neoN3FlamingoBrokerContract,
        quote.routerContract,
        quote.fromToken.contractAddress,
      ],
    });
  }

  public async getGasBridgeQuote(
    input: GasBridgeQuoteInput,
  ): Promise<BridgeQuote> {
    const direction = input.direction;

    return {
      direction,
      sourceNetwork: direction === "neoXToNeoN3" ? "neoX" : "neoN3",
      destinationNetwork: direction === "neoXToNeoN3" ? "neoN3" : "neoX",
      amount: input.amount,
      destinationAddress:
        input.to ??
        (direction === "neoXToNeoN3"
          ? this.neoN3Address
          : this.neoXBridgeDestination),
      currentFee: "0.1",
      effectiveMaxFee: input.maxFee ?? "0.1",
      minimumAmount: "0.01",
      maximumAmount: "1000",
      estimatedReceived: input.amount
        ? `${Number(input.amount) - Number(input.maxFee ?? "0.1")}`
        : undefined,
      paused: false,
      etaLowMinutes: 5,
      etaHighMinutes: 30,
      notes: ["Bridge quote loaded from the fake provider."],
    };
  }

  public async getBridgeStatus(input: {
    txHash: string;
    direction: "neoN3ToNeoX" | "neoXToNeoN3";
    destinationAddress?: string;
    amount?: string;
    maxFee?: string;
    createdAt?: string;
  }): Promise<BridgeStatus> {
    return {
      txHash: input.txHash,
      direction: input.direction,
      sourceNetwork: input.direction === "neoXToNeoN3" ? "neoX" : "neoN3",
      destinationNetwork: input.direction === "neoXToNeoN3" ? "neoN3" : "neoX",
      sourceStatus: await this.getTransactionStatus({
        hash: input.txHash,
        network: input.direction === "neoXToNeoN3" ? "neoX" : "neoN3",
      }),
      destinationAddress:
        input.destinationAddress ??
        (input.direction === "neoXToNeoN3"
          ? this.neoN3Address
          : this.neoXBridgeDestination),
      amount: input.amount,
      currentFee: "0.1",
      effectiveMaxFee: input.maxFee ?? "0.1",
      minimumAmount: "0.01",
      maximumAmount: "1000",
      estimatedReceived: input.amount
        ? `${Number(input.amount) - Number(input.maxFee ?? "0.1")}`
        : undefined,
      etaLowMinutes: 0,
      etaHighMinutes: 0,
      arrival: {
        status: "arrived",
        summary: "Detected bridged funds on the destination network.",
        detectionMethod:
          input.direction === "neoXToNeoN3"
            ? "neoN3_transfer_history"
            : "neoX_balance_heuristic",
        confidence: input.direction === "neoXToNeoN3" ? "high" : "low",
        matchedTxHash:
          input.direction === "neoXToNeoN3" ? `0x${"d".repeat(64)}` : undefined,
        matchedAmount: input.amount
          ? `${Number(input.amount) - Number(input.maxFee ?? "0.1")}`
          : undefined,
      },
      summary:
        input.direction === "neoXToNeoN3"
          ? "Neo X -> Neo N3 bridge is complete."
          : "Neo N3 -> Neo X bridge is complete.",
    };
  }

  public async prepareGasBridge(
    input: GasBridgeInput,
  ): Promise<PreparedTransaction> {
    const destination =
      input.to ??
      (input.direction === "neoXToNeoN3"
        ? this.neoN3Address
        : this.recipientAddress);
    const summary =
      input.direction === "neoXToNeoN3"
        ? `Prepared a Neo X -> Neo N3 bridge of ${input.amount} GAS to ${destination}.`
        : `Prepared a Neo N3 -> Neo X bridge of ${input.amount} GAS to ${destination}.`;

    return createPreparedTransaction({
      action: "bridgeGas",
      summary,
      network: input.direction === "neoXToNeoN3" ? "neoX" : "neoN3",
      sender:
        input.direction === "neoXToNeoN3"
          ? this.senderAddress
          : this.neoN3Address,
      chainId: input.direction === "neoXToNeoN3" ? 47_763 : undefined,
      networkMagic: input.direction === "neoN3ToNeoX" ? 860_833_102 : undefined,
      nonce: 1,
      gasLimit: input.direction === "neoXToNeoN3" ? "180000" : undefined,
      to:
        input.direction === "neoXToNeoN3"
          ? "0x1212000000000000000000000000000000000004"
          : "0xbb19cfc864b73159277e1fd39694b3fd5fc613d2",
      amount: input.amount,
      tokenSymbol: "GAS",
      bridgeDirection: input.direction,
      destinationAddress: destination,
      maxFee: input.maxFee ?? "0.1",
      estimatedReceived:
        input.amount &&
        `${Number(input.amount) - Number(input.maxFee ?? "0.1")}`,
      minimumAmount: "0.01",
      maximumAmount: "1000",
      bridgeEtaLowMinutes: 5,
      bridgeEtaHighMinutes: 30,
      bridgeContractAddress:
        input.direction === "neoXToNeoN3"
          ? "0x1212000000000000000000000000000000000004"
          : "0xbb19cfc864b73159277e1fd39694b3fd5fc613d2",
      data: input.direction === "neoXToNeoN3" ? "0xbridge" : undefined,
      value:
        input.direction === "neoXToNeoN3" ? "1000000000000000000" : undefined,
      unsignedTransaction:
        input.direction === "neoXToNeoN3" ? undefined : "00c0ffee",
      request:
        input.direction === "neoXToNeoN3"
          ? createRequest(
              "0x1212000000000000000000000000000000000004",
              "0xbridge",
              "1000000000000000000",
            )
          : undefined,
    });
  }

  public async prepareGasTransfer(input: {
    to: string;
    amount: string;
  }): Promise<PreparedTransaction> {
    return createPreparedTransaction({
      action: "sendGas",
      summary: `Prepared a transfer of ${input.amount} GAS to ${input.to}.`,
      sender: this.senderAddress,
      chainId: 47_763,
      nonce: 1,
      gasLimit: "21000",
      to: input.to,
      amount: input.amount,
      tokenSymbol: "GAS",
      value: "1000000000000000000",
    });
  }

  public async prepareNeoN3GasTransfer(input: {
    to: string;
    amount: string;
  }): Promise<PreparedTransaction> {
    const recipient =
      input.to === this.neoNsName ? this.neoN3Address : input.to;

    return createPreparedTransaction({
      action: "sendNeoN3Gas",
      summary: `Prepared a Neo N3 GAS transfer of ${input.amount} GAS to ${recipient}.`,
      network: "neoN3",
      sender: this.neoN3Address,
      networkMagic: 860_833_102,
      nonce: 1,
      to: recipient,
      amount: input.amount,
      tokenSymbol: "GAS",
      contractAddress: "0xd2a4cff31913016155e38e474a2c06d08be276cf",
      unsignedTransaction: "00c0ffee",
      allowedContracts: ["0xd2a4cff31913016155e38e474a2c06d08be276cf"],
    });
  }

  public async prepareNeoN3TokenTransfer(
    input: NeoN3TokenTransferInput,
  ): Promise<PreparedTransaction> {
    const recipient =
      input.to === this.neoNsName ? this.neoN3Address : input.to;

    return createPreparedTransaction({
      action: "sendNeoN3Token",
      summary: `Prepared a Neo N3 transfer of ${input.amount} ${input.token.toUpperCase()} to ${recipient}.`,
      network: "neoN3",
      sender: this.neoN3Address,
      networkMagic: 860_833_102,
      nonce: 1,
      to: recipient,
      amount: input.amount,
      tokenAddress: neoN3FusdContract,
      tokenSymbol: input.token.toUpperCase(),
      contractAddress: neoN3FusdContract,
      unsignedTransaction: "00c0ffee",
      allowedContracts: [neoN3FusdContract],
    });
  }

  public async prepareErc20Transfer(
    input: Erc20TransferInput,
  ): Promise<PreparedTransaction> {
    return createPreparedTransaction({
      action: "sendErc20",
      summary: `Prepared a transfer of ${input.amount} ${input.token} to ${input.to}.`,
      sender: this.senderAddress,
      chainId: 47_763,
      nonce: 1,
      gasLimit: "70000",
      to: usdtAddress,
      amount: input.amount,
      tokenAddress: usdtAddress,
      tokenSymbol: input.token.toUpperCase(),
      data: "0xtransfer",
    });
  }

  public async prepareErc20Approval(
    input: Erc20ApprovalInput,
  ): Promise<PreparedTransaction> {
    return createPreparedTransaction({
      action: "approveErc20",
      summary: `Prepared an approval of ${input.amount} ${input.token} for ${input.spender}.`,
      sender: this.senderAddress,
      chainId: 47_763,
      nonce: 1,
      gasLimit: "65000",
      to: usdtAddress,
      amount: input.amount,
      tokenAddress: usdtAddress,
      tokenSymbol: input.token.toUpperCase(),
      spender: input.spender,
      data: "0xapprove",
    });
  }

  public async signAndBroadcast(
    prepared: PreparedTransaction,
  ): Promise<BroadcastResult> {
    return createBroadcastResult(prepared, `0x${"c".repeat(64)}`);
  }

  public getWalletAddress(): string {
    return this.senderAddress;
  }

  public getNeoN3WalletAddress(): string | undefined {
    return this.neoN3Address;
  }

  public walletEnabled(): boolean {
    return true;
  }

  public neoN3WalletEnabled(): boolean {
    return true;
  }
}

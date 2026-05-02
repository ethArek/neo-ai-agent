import {
  experimental,
  CONST as neoConst,
  rpc as neoRpc,
  wallet as neoWallet,
} from "@cityofzion/neon-js";

import {
  type AppConfig,
  defaultNeoN3FlamingoContractsByNetwork,
} from "../src/core/config";
import { ValidationError } from "../src/core/errors";
import { createNeoProvider, NeoN3Provider } from "../src/neo/client";

const neoN3MainnetNnsContract = "0x50ac1c37690cc2cfc594472833cf57505d5f46de";
const neoN3GasTokenContract = "0xd2a4cff31913016155e38e474a2c06d08be276cf";
const neoN3NeoTokenContract = `0x${neoConst.NATIVE_CONTRACT_HASH.NeoToken}`;
const bNeoMainnetContract = "0x48c40d4666f93408be1bef038b6722404d9a4c2a";

function createConfig(n3WalletPrivateKey: string): AppConfig {
  return {
    port: 3000,
    api: {
      host: "127.0.0.1",
    },
    session: {
      maxAgeMs: 60 * 60 * 1000,
    },
    nodeEnv: "test",
    neoN3: {
      network: "mainnet",
      rpcUrl: "https://n3.example.com",
      walletPrivateKey: n3WalletPrivateKey,
      walletEnabled: true,
      gasTokenContract: neoN3GasTokenContract,
      nnsContract: neoN3MainnetNnsContract,
      flamingoBrokerContract:
        defaultNeoN3FlamingoContractsByNetwork.mainnet.broker,
      flamingoConvertContract:
        defaultNeoN3FlamingoContractsByNetwork.mainnet.convert,
      flamingoRouterContract:
        defaultNeoN3FlamingoContractsByNetwork.mainnet.router,
      tokenMap: {},
      flamingoPairs: [],
    },
    neoX: {
      defaultNetwork: "testnet",
      nativeCurrencySymbol: "GAS",
      walletPrivateKey: undefined,
      walletEnabled: false,
      networks: {
        mainnet: {
          name: "mainnet",
          chainId: 47763,
          rpcUrl: "https://neox-mainnet.example.com",
        },
        testnet: {
          name: "testnet",
          chainId: 12_227_332,
          rpcUrl: "https://neox-testnet.example.com",
        },
        custom: {
          name: "custom",
        },
      },
    },
    openAiModel: "gpt-5-mini",
    geminiModel: "gemini-2.5-flash",
    walletEnabled: true,
    llmEnabled: false,
  };
}

class SwapQuoteTestNeoProvider extends NeoN3Provider {
  public async getNeoN3SwapPathQuoteForTest(
    amountInRaw: bigint,
    routeContracts: string[],
    tradingPairIds: number[],
  ): Promise<bigint[]> {
    return this.getNeoN3SwapPathQuote(
      amountInRaw,
      routeContracts,
      tradingPairIds,
    );
  }

  public override async getNeoN3ConvertAmountOut(
    amountInRaw: bigint,
    routeContracts: string[],
    tradingPairIds: number[],
  ): Promise<bigint> {
    return super.getNeoN3ConvertAmountOut(
      amountInRaw,
      routeContracts,
      tradingPairIds,
    );
  }

  public async getNeoN3NetworkMagicForTest(): Promise<number> {
    const method = Reflect.get(this, "getNeoN3NetworkMagic");

    if (typeof method !== "function") {
      throw new Error("Expected getNeoN3NetworkMagic to be a function.");
    }

    const value = await method.call(this);

    if (typeof value !== "number") {
      throw new Error("Expected getNeoN3NetworkMagic to resolve to a number.");
    }

    return value;
  }

  public async resolveNeoN3FlamingoBrokerContractAddressForTest(): Promise<string> {
    const method = Reflect.get(
      this,
      "resolveNeoN3FlamingoBrokerContractAddress",
    );

    if (typeof method !== "function") {
      throw new Error(
        "Expected resolveNeoN3FlamingoBrokerContractAddress to be a function.",
      );
    }

    const value = await method.call(this);

    if (typeof value !== "string") {
      throw new Error(
        "Expected resolveNeoN3FlamingoBrokerContractAddress to resolve to a string.",
      );
    }

    return value;
  }

  public async getNeoN3FlamingoTradingPairsForTest(): Promise<
    Array<{
      pairId: number;
      baseTokenHash: string;
      quoteTokenHash: string;
    }>
  > {
    const method = Reflect.get(this, "getNeoN3FlamingoTradingPairs");

    if (typeof method !== "function") {
      throw new Error(
        "Expected getNeoN3FlamingoTradingPairs to be a function.",
      );
    }

    const value = await method.call(this);

    if (!Array.isArray(value)) {
      throw new Error(
        "Expected getNeoN3FlamingoTradingPairs to resolve to an array.",
      );
    }

    return value.map((entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("pairId" in entry) ||
        typeof entry.pairId !== "number" ||
        !("baseTokenHash" in entry) ||
        typeof entry.baseTokenHash !== "string" ||
        !("quoteTokenHash" in entry) ||
        typeof entry.quoteTokenHash !== "string"
      ) {
        throw new Error(
          "Expected getNeoN3FlamingoTradingPairs entries to include pairId, baseTokenHash, and quoteTokenHash.",
        );
      }

      return {
        pairId: entry.pairId,
        baseTokenHash: entry.baseTokenHash,
        quoteTokenHash: entry.quoteTokenHash,
      };
    });
  }

  public normalizeSwapSlippagePercentForTest(requested?: string): string {
    const method = Reflect.get(this, "normalizeSwapSlippagePercent");

    if (typeof method !== "function") {
      throw new Error(
        "Expected normalizeSwapSlippagePercent to be a function.",
      );
    }

    const value = method.call(this, requested);

    if (typeof value !== "string") {
      throw new Error(
        "Expected normalizeSwapSlippagePercent to return a string.",
      );
    }

    return value;
  }

  public toBasisPointsForTest(percent: string): number {
    const method = Reflect.get(this, "toBasisPoints");

    if (typeof method !== "function") {
      throw new Error("Expected toBasisPoints to be a function.");
    }

    const value = method.call(this, percent);

    if (typeof value !== "number") {
      throw new Error("Expected toBasisPoints to return a number.");
    }

    return value;
  }
}

function createVersionResponse(networkMagic: number) {
  return {
    tcpport: 10333,
    wsport: 10334,
    nonce: 1,
    useragent: "/Neo:test/",
    protocol: {
      addressversion: 53,
      network: networkMagic,
      validatorscount: 7,
      msperblock: 15000,
      maxtraceableblocks: 2_102_400,
      maxvaliduntilblockincrement: 5_760,
      maxtransactionsperblock: 512,
      memorypoolmaxtransactions: 50_000,
      initialgasdistribution: 5_200_000_000_000_000,
    },
  };
}

function createContractStateWithMethods(
  methodNames: string[],
): Awaited<
  ReturnType<InstanceType<typeof neoRpc.RPCClient>["getContractState"]>
> {
  return {
    id: 1,
    updatecounter: 0,
    hash: defaultNeoN3FlamingoContractsByNetwork.mainnet.broker,
    nef: {
      magic: 860833102,
      compiler: "test",
      script: "",
      tokens: [],
      source: "",
      checksum: 0,
    },
    manifest: {
      name: "test-contract",
      groups: [],
      features: {},
      supportedstandards: [],
      abi: {
        methods: methodNames.map((name) => ({
          name,
          offset: 0,
          parameters: [],
          returntype: "Integer",
          safe: true,
        })),
        events: [],
      },
      permissions: [],
      trusts: [],
    },
  };
}

function createIntegerInvokeResult(
  value: string,
): Awaited<
  ReturnType<InstanceType<typeof neoRpc.RPCClient>["invokeFunction"]>
> {
  return {
    script: "00",
    state: "HALT",
    gasconsumed: "0",
    stack: [
      {
        type: "Integer",
        value,
      },
    ],
    exception: null,
    notifications: [],
  };
}

function createHash160InvokeResult(
  value: string,
): Awaited<
  ReturnType<InstanceType<typeof neoRpc.RPCClient>["invokeFunction"]>
> {
  const bytes = Buffer.from(value.slice(2), "hex").reverse();

  return {
    script: "00",
    state: "HALT",
    gasconsumed: "0",
    stack: [
      {
        type: "ByteString",
        value: bytes.toString("base64"),
      },
    ],
    exception: null,
    notifications: [],
  };
}

describe("NeoProvider", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports Neo N3 and Neo X as implemented networks", () => {
    const account = new neoWallet.Account();
    const provider = createNeoProvider(createConfig(account.WIF));

    expect(provider.getImplementedNetworks()).toEqual(["neoN3", "neoX"]);
    expect(provider.getDefaultNetwork()).toBe("neoN3");
    expect(provider.getWalletAddresses()).toEqual({
      neoN3: account.address,
    });
    expect(provider.getWalletAddress("neoN3")).toBe(account.address);
    expect(provider.getWalletAddress("neoX")).toBeUndefined();
    expect(provider.walletEnabled("neoN3")).toBe(true);
    expect(provider.walletEnabled("neoX")).toBe(false);
  });

  it("loads unclaimed GAS through the Neo RPC endpoint", async () => {
    const account = new neoWallet.Account();
    const provider = createNeoProvider(createConfig(account.WIF));
    const getUnclaimedGasSpy = jest
      .spyOn(neoRpc.RPCClient.prototype, "getUnclaimedGas")
      .mockResolvedValue("123456789");

    await expect(
      provider.getNeoN3UnclaimedGas(account.address),
    ).resolves.toEqual({
      address: account.address,
      symbol: "GAS",
      decimals: 8,
      rawUnclaimed: "123456789",
      unclaimed: "1.23456789",
    });
    expect(getUnclaimedGasSpy).toHaveBeenCalledWith(account.address);
  });

  it("surfaces expired NeoNS names as a validation error", async () => {
    const account = new neoWallet.Account();
    const provider = createNeoProvider(createConfig(account.WIF));

    jest
      .spyOn(neoRpc.RPCClient.prototype, "invokeFunction")
      .mockImplementation(async (_contractHash, operation) => {
        if (operation === "resolve") {
          return {
            script: "00",
            state: "FAULT",
            gasconsumed: "0",
            exception:
              "An unhandled exception was thrown. The name has expired.",
            notifications: [],
            stack: [],
          };
        }

        throw new Error(`Unexpected operation '${operation}'.`);
      });

    await expect(
      provider.getNeoN3UnclaimedGas("arkadiusz.neo"),
    ).rejects.toThrow(ValidationError);
    await expect(
      provider.getNeoN3UnclaimedGas("arkadiusz.neo"),
    ).rejects.toThrow("NeoNS name 'arkadiusz.neo' has expired.");
  });

  it("quotes each cumulative Flamingo route prefix from the original input amount", async () => {
    const account = new neoWallet.Account();
    const provider = new SwapQuoteTestNeoProvider(createConfig(account.WIF));
    const convertAmountOutSpy = jest
      .spyOn(provider, "getNeoN3ConvertAmountOut")
      .mockImplementation(async (amountInRaw, routeContracts) => {
        if (routeContracts.length === 2) {
          expect(amountInRaw).toBe(100n);

          return 60n;
        }

        if (routeContracts.length === 3) {
          expect(amountInRaw).toBe(100n);

          return 90n;
        }

        throw new Error("Unexpected route length.");
      });

    const routeAmountsRaw = await provider.getNeoN3SwapPathQuoteForTest(
      100n,
      [
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
        "0x0000000000000000000000000000000000000003",
      ],
      [1, 2],
    );

    expect(routeAmountsRaw).toEqual([100n, 60n, 90n]);
    expect(convertAmountOutSpy).toHaveBeenNthCalledWith(
      1,
      100n,
      [
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
      ],
      [1],
    );
    expect(convertAmountOutSpy).toHaveBeenNthCalledWith(
      2,
      100n,
      [
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
        "0x0000000000000000000000000000000000000003",
      ],
      [1, 2],
    );
  });

  it("resolves a NeoNS name before preparing a Neo N3 GAS transfer", async () => {
    const account = new neoWallet.Account();
    const recipient = new neoWallet.Account().address;
    const invokeFunctionSpy = jest
      .spyOn(neoRpc.RPCClient.prototype, "invokeFunction")
      .mockImplementation(async (_contractHash, operation) => {
        if (operation === "resolve") {
          return {
            script: "00",
            state: "HALT",
            gasconsumed: "0",
            exception: null,
            notifications: [],
            stack: [
              {
                type: "ByteString",
                value: Buffer.from(recipient, "utf8").toString("base64"),
              },
            ],
          };
        }

        throw new Error(`Unexpected operation '${operation}'.`);
      });

    jest
      .spyOn(neoRpc.RPCClient.prototype, "getVersion")
      .mockImplementation(async () => ({
        tcpport: 10333,
        wsport: 10334,
        nonce: 1,
        useragent: "/Neo:test/",
        protocol: {
          addressversion: 53,
          network: 860_833_102,
          validatorscount: 7,
          msperblock: 15000,
          maxtraceableblocks: 2_102_400,
          maxvaliduntilblockincrement: 5_760,
          maxtransactionsperblock: 512,
          memorypoolmaxtransactions: 50_000,
          initialgasdistribution: 5_200_000_000_000_000,
        },
      }));
    jest
      .spyOn(experimental.txHelpers, "setBlockExpiry")
      .mockImplementation(async () => undefined);
    jest
      .spyOn(experimental.txHelpers, "addFees")
      .mockImplementation(async () => undefined);

    const provider = createNeoProvider(createConfig(account.WIF));
    const prepared = await provider.prepareNeoN3GasTransfer({
      amount: "1",
      to: "arkadiusz.neo",
    });

    expect(invokeFunctionSpy).toHaveBeenCalledWith(
      neoN3MainnetNnsContract,
      "resolve",
      expect.any(Array),
    );
    expect(prepared.action).toBe("sendNeoN3Gas");
    expect(prepared.network).toBe("neoN3");
    expect(prepared.sender).toBe(account.address);
    expect(prepared.to).toBe(recipient);
    expect(prepared.contractAddress).toBe(neoN3GasTokenContract);
    expect(prepared.summary).toContain(recipient);
  });

  it("returns known production metadata for bNEO without RPC lookups", async () => {
    const account = new neoWallet.Account();
    const invokeFunctionSpy = jest
      .spyOn(neoRpc.RPCClient.prototype, "invokeFunction")
      .mockImplementation(async (_contractHash, operation) => {
        throw new Error(`Unexpected operation '${operation}'.`);
      });

    const provider = createNeoProvider(createConfig(account.WIF));
    const metadata =
      await provider.resolveNeoN3TokenMetadata(bNeoMainnetContract);

    expect(metadata).toMatchObject({
      contractAddress: bNeoMainnetContract,
      symbol: "bNEO",
      decimals: 8,
    });
    expect(invokeFunctionSpy).not.toHaveBeenCalled();
  });

  it("retries the network magic lookup after a failed cached attempt", async () => {
    const account = new neoWallet.Account();
    const provider = new SwapQuoteTestNeoProvider(createConfig(account.WIF));
    const getVersionSpy = jest
      .spyOn(neoRpc.RPCClient.prototype, "getVersion")
      .mockRejectedValueOnce(new Error("RPC unavailable"))
      .mockResolvedValueOnce(createVersionResponse(860_833_102));

    await expect(provider.getNeoN3NetworkMagicForTest()).rejects.toThrow(
      "RPC unavailable",
    );

    await expect(provider.getNeoN3NetworkMagicForTest()).resolves.toBe(
      860_833_102,
    );
    expect(getVersionSpy).toHaveBeenCalledTimes(2);
  });

  it("returns non-zero NEP-17 balances from the TokenTracker RPC plugin", async () => {
    const account = new neoWallet.Account();
    const provider = createNeoProvider(createConfig(account.WIF));

    jest
      .spyOn(neoRpc.RPCClient.prototype, "getNep17Balances")
      .mockResolvedValue({
        address: account.address,
        balance: [
          {
            assethash: bNeoMainnetContract,
            amount: "1.5",
            lastupdatedblock: 1,
          },
          {
            assethash: "0x833b3d6854d5bc44cab40ab9b46560d25c72562c",
            amount: "0",
            lastupdatedblock: 1,
          },
        ],
      });

    await expect(
      provider.getNeoN3TokenBalances(account.address),
    ).resolves.toEqual([
      expect.objectContaining({
        contractAddress: bNeoMainnetContract,
        symbol: "bNEO",
        balance: "1.5",
        rawBalance: "150000000",
      }),
    ]);
  });

  it("falls back to the portfolio overview when the TokenTracker RPC plugin is unavailable", async () => {
    const account = new neoWallet.Account();
    const portfolioSpy = jest
      .spyOn(NeoN3Provider.prototype, "getNeoN3PortfolioOverview")
      .mockResolvedValue({
        address: account.address,
        gasBalance: {
          contractAddress: neoN3GasTokenContract,
          symbol: "GAS",
          decimals: 8,
          owner: account.address,
          rawBalance: "100000000",
          balance: "1",
        },
        neoBalance: {
          contractAddress: neoN3NeoTokenContract,
          symbol: "NEO",
          decimals: 0,
          owner: account.address,
          rawBalance: "0",
          balance: "0",
        },
        tokenBalances: [
          {
            contractAddress: bNeoMainnetContract,
            symbol: "bNEO",
            decimals: 8,
            owner: account.address,
            rawBalance: "200000000",
            balance: "2",
          },
        ],
      });
    const provider = createNeoProvider(createConfig(account.WIF));

    jest
      .spyOn(neoRpc.RPCClient.prototype, "getNep17Balances")
      .mockRejectedValue(new Error("TokenTracker unavailable"));

    await expect(
      provider.getNeoN3TokenBalances(account.address),
    ).resolves.toEqual([
      expect.objectContaining({
        contractAddress: neoN3GasTokenContract,
        symbol: "GAS",
        balance: "1",
      }),
      expect.objectContaining({
        contractAddress: bNeoMainnetContract,
        symbol: "bNEO",
        balance: "2",
      }),
    ]);
    expect(portfolioSpy).toHaveBeenCalledWith(account.address);
  });

  it("retries Flamingo broker contract resolution after a failed cached attempt", async () => {
    const account = new neoWallet.Account();
    const provider = new SwapQuoteTestNeoProvider(createConfig(account.WIF));

    jest
      .spyOn(neoRpc.RPCClient.prototype, "getVersion")
      .mockResolvedValue(createVersionResponse(860_833_102));
    const getContractStateSpy = jest
      .spyOn(neoRpc.RPCClient.prototype, "getContractState")
      .mockRejectedValueOnce(new Error("Contract not reachable"))
      .mockResolvedValueOnce(
        createContractStateWithMethods([
          "getPairCounter",
          "getBaseToken",
          "getQuoteToken",
        ]),
      );

    await expect(
      provider.resolveNeoN3FlamingoBrokerContractAddressForTest(),
    ).rejects.toThrow("Flamingo swap is not configured");

    await expect(
      provider.resolveNeoN3FlamingoBrokerContractAddressForTest(),
    ).resolves.toBe(defaultNeoN3FlamingoContractsByNetwork.mainnet.broker);
    expect(getContractStateSpy).toHaveBeenCalledTimes(2);
  });

  it("retries Flamingo trading pair loading after a failed cached attempt", async () => {
    const account = new neoWallet.Account();
    const provider = new SwapQuoteTestNeoProvider(createConfig(account.WIF));

    jest
      .spyOn(neoRpc.RPCClient.prototype, "getVersion")
      .mockResolvedValue(createVersionResponse(860_833_102));
    jest
      .spyOn(neoRpc.RPCClient.prototype, "getContractState")
      .mockResolvedValue(
        createContractStateWithMethods([
          "getPairCounter",
          "getBaseToken",
          "getQuoteToken",
        ]),
      );
    const invokeFunctionSpy = jest
      .spyOn(neoRpc.RPCClient.prototype, "invokeFunction")
      .mockRejectedValueOnce(new Error("Temporary pair lookup failure"))
      .mockResolvedValueOnce(createIntegerInvokeResult("1"))
      .mockResolvedValueOnce(
        createHash160InvokeResult(
          defaultNeoN3FlamingoContractsByNetwork.mainnet.broker,
        ),
      )
      .mockResolvedValueOnce(createHash160InvokeResult(bNeoMainnetContract));

    await expect(
      provider.getNeoN3FlamingoTradingPairsForTest(),
    ).rejects.toThrow("Temporary pair lookup failure");

    await expect(
      provider.getNeoN3FlamingoTradingPairsForTest(),
    ).resolves.toEqual([
      {
        pairId: 1,
        baseTokenHash: defaultNeoN3FlamingoContractsByNetwork.mainnet.broker,
        quoteTokenHash: bNeoMainnetContract,
      },
    ]);
    expect(invokeFunctionSpy).toHaveBeenCalledTimes(4);
  });

  it("rejects swap slippage below one basis point", () => {
    const account = new neoWallet.Account();
    const provider = new SwapQuoteTestNeoProvider(createConfig(account.WIF));

    expect(() => {
      provider.normalizeSwapSlippagePercentForTest("0.001");
    }).toThrow(
      "Swap slippagePercent must be a decimal percent between 0.01 and 50 with up to 2 decimal places.",
    );
    expect(provider.normalizeSwapSlippagePercentForTest("0.01")).toBe("0.01");
    expect(provider.toBasisPointsForTest("0.01")).toBe(1);
  });

  it("returns not_found transaction status when the transaction is missing", async () => {
    const account = new neoWallet.Account();
    const provider = createNeoProvider(createConfig(account.WIF));
    const hash =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    jest
      .spyOn(neoRpc.RPCClient.prototype, "getRawTransaction")
      .mockRejectedValue(new Error("Missing transaction"));

    await expect(
      provider.getTransactionStatus({
        hash,
        network: "neoN3",
      }),
    ).resolves.toMatchObject({
      hash,
      network: "neoN3",
      status: "not_found",
      transaction: null,
      applicationLog: null,
    });
  });

  it("returns confirmed transaction status when the application log halts successfully", async () => {
    const account = new neoWallet.Account();
    const provider = createNeoProvider(createConfig(account.WIF));
    const hash =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    const rawTransaction = {
      hash,
      blockhash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      confirmations: 1,
      blocktime: 1_700_000_000_000,
      vm_state: "HALT" as const,
      size: 1,
      version: 0,
      nonce: 1,
      sender: account.address,
      sysfee: "0",
      netfee: "0",
      validuntilblock: 42,
      signers: [],
      attributes: [],
      script: "00",
      witnesses: [],
    };

    Object.defineProperty(rawTransaction, "blockindex", {
      value: "42",
      enumerable: true,
    });

    jest
      .spyOn(neoRpc.RPCClient.prototype, "getRawTransaction")
      .mockResolvedValue(rawTransaction);
    jest
      .spyOn(neoRpc.RPCClient.prototype, "getApplicationLog")
      .mockResolvedValue({
        txid: hash,
        executions: [
          {
            trigger: "Application",
            vmstate: "HALT",
            gasconsumed: "0.1",
            stack: [],
            notifications: [],
          },
        ],
      });

    await expect(
      provider.getTransactionStatus({
        hash,
        network: "neoN3",
      }),
    ).resolves.toMatchObject({
      hash,
      network: "neoN3",
      status: "confirmed",
      blockNumber: 42,
      summary: `Neo N3 transaction ${hash} is confirmed.`,
    });
  });

  it("reports Neo N3 readiness for the configured mainnet", async () => {
    const account = new neoWallet.Account();
    const provider = createNeoProvider(createConfig(account.WIF));

    jest
      .spyOn(neoRpc.RPCClient.prototype, "getVersion")
      .mockResolvedValue(createVersionResponse(860_833_102));

    await expect(provider.checkReadiness()).resolves.toMatchObject({
      network: "neoN3",
      configuredNetwork: "mainnet",
      rpcReachable: true,
      networkMagic: 860_833_102,
      networkMatchesConfiguration: true,
      walletEnabled: true,
      walletAddress: account.address,
    });
  });

  it("marks readiness as degraded when the RPC network magic mismatches the configured network", async () => {
    const account = new neoWallet.Account();
    const provider = createNeoProvider(createConfig(account.WIF));

    jest
      .spyOn(neoRpc.RPCClient.prototype, "getVersion")
      .mockResolvedValue(createVersionResponse(894_710_606));

    await expect(provider.checkReadiness()).resolves.toMatchObject({
      configuredNetwork: "mainnet",
      networkMagic: 894_710_606,
      networkMatchesConfiguration: false,
    });
  });

  it("reports wallet-disabled readiness when no Neo N3 private key is configured", async () => {
    const provider = createNeoProvider(createConfig(""));

    jest
      .spyOn(neoRpc.RPCClient.prototype, "getVersion")
      .mockResolvedValue(createVersionResponse(860_833_102));

    await expect(provider.checkReadiness()).resolves.toMatchObject({
      walletEnabled: false,
      walletAddress: undefined,
    });
  });
});

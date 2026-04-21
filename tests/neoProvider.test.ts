import {
  experimental,
  rpc as neoRpc,
  wallet as neoWallet,
} from "@cityofzion/neon-js";

import type { AppConfig } from "../src/core/config";
import { createNeoProvider } from "../src/neo/client";

const neoN3MainnetNnsContract = "0x50ac1c37690cc2cfc594472833cf57505d5f46de";
const neoN3GasTokenContract = "0xd2a4cff31913016155e38e474a2c06d08be276cf";
const bNeoMainnetContract = "0x48c40d4666f93408be1bef038b6722404d9a4c2a";

type SwapQuoteTestProvider = ReturnType<typeof createNeoProvider> & {
  getNeoN3ConvertAmountOut(
    amountInRaw: bigint,
    routeContracts: string[],
    tradingPairIds: number[],
  ): Promise<bigint>;
  getNeoN3SwapPathQuote(
    amountInRaw: bigint,
    routeContracts: string[],
    tradingPairIds: number[],
  ): Promise<bigint[]>;
};

function createConfig(n3WalletPrivateKey: string): AppConfig {
  return {
    port: 3000,
    api: {
      host: "127.0.0.1",
    },
    nodeEnv: "test",
    neoN3: {
      network: "mainnet",
      rpcUrl: "https://n3.example.com",
      walletPrivateKey: n3WalletPrivateKey,
      walletEnabled: true,
      gasTokenContract: neoN3GasTokenContract,
      nnsContract: neoN3MainnetNnsContract,
      flamingoBrokerContract: "0xec268e9c642b7d09d10fe658bcb1cc63c0895d4d",
      flamingoConvertContract: "0xf40f694362957d56801a8cef7e62a83f7f1b7b0f",
      flamingoRouterContract: "0xde3a4b093abbd07e9a69cdec88a54d9a1fe14975",
      tokenMap: {},
      flamingoPairs: [],
    },
    openAiModel: "gpt-4.1-mini",
    geminiModel: "gemini-2.5-flash",
    walletEnabled: true,
    llmEnabled: false,
  };
}

describe("NeoProvider", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports Neo N3 as the only implemented network for now", () => {
    const account = new neoWallet.Account();
    const provider = createNeoProvider(createConfig(account.WIF));

    expect(provider.getImplementedNetworks()).toEqual(["neoN3"]);
    expect(provider.getDefaultNetwork()).toBe("neoN3");
    expect(provider.getWalletAddresses()).toEqual({
      neoN3: account.address,
    });
    expect(provider.getWalletAddress("neoN3")).toBe(account.address);
    expect(provider.getWalletAddress("neoX")).toBeUndefined();
    expect(provider.walletEnabled("neoN3")).toBe(true);
    expect(provider.walletEnabled("neoX")).toBe(false);
  });

  it("quotes each cumulative Flamingo route prefix from the original input amount", async () => {
    const account = new neoWallet.Account();
    const provider = createNeoProvider(
      createConfig(account.WIF),
    ) as unknown as SwapQuoteTestProvider;
    const convertAmountOutSpy = jest
      .spyOn(provider, "getNeoN3ConvertAmountOut")
      .mockImplementation(async (...args: unknown[]) => {
        const [amountInRaw, routeContracts] = args as [bigint, string[]];

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

    const routeAmountsRaw = await provider.getNeoN3SwapPathQuote(
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
});

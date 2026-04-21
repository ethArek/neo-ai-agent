import {
  experimental,
  rpc as neoRpc,
  wallet as neoWallet,
} from "@cityofzion/neon-js";
import { Wallet } from "ethers";

import type { AppConfig } from "../src/core/config";
import { createNeoProvider } from "../src/neo/client";

const neoN3MainnetNnsContract = "0x50ac1c37690cc2cfc594472833cf57505d5f46de";
const neoN3GasTokenContract = "0xd2a4cff31913016155e38e474a2c06d08be276cf";
const bNeoMainnetContract = "0x48c40d4666f93408be1bef038b6722404d9a4c2a";
const wrappedGasAddress = "0xdE41591ED1f8ED1484aC2CD8ca0876428de60EfF";

function createConfig(n3WalletPrivateKey: string): AppConfig {
  return {
    port: 3000,
    api: {
      host: "127.0.0.1",
    },
    nodeEnv: "test",
    neoXRpcUrl: "https://example.com",
    neoXChainId: 47_763,
    neoN3: {
      rpcUrl: "https://n3.example.com",
      walletPrivateKey: n3WalletPrivateKey,
      walletEnabled: true,
      nnsContract: neoN3MainnetNnsContract,
      tokenMap: {},
      flamingoPairs: [],
    },
    openAiModel: "gpt-4.1-mini",
    geminiModel: "gemini-2.5-flash",
    walletPrivateKey: Wallet.createRandom().privateKey,
    walletEnabled: true,
    llmEnabled: false,
    bridge: {
      neoN3GasTokenContract,
    },
    erc20: {
      wrappedGasAddress,
      tokenMap: {},
    },
  };
}

describe("NeoXProvider", () => {
  afterEach(() => {
    jest.restoreAllMocks();
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

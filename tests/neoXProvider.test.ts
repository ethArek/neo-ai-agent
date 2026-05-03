import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { encodeFunctionResult, erc20Abi } from "viem";
import * as viem from "viem";

import type { AppConfig } from "../src/core/config";
import { ProviderCapabilityError, ValidationError } from "../src/core/errors";
import {
  buildPreparedNeoXTransactionRequest,
  NeoXProvider,
} from "../src/neox/client";

interface JsonRpcRequest {
  id?: string | number | null;
  method: string;
  params?: unknown[];
}

const chainId = 12_227_332;
const tokenContract = "0x1111111111111111111111111111111111111111";
const ownerAddress = "0xAA00000000000000000000000000000000000001";
const privateKey =
  "0x59c6995e998f97a5a0044966f094538b292d0e54077c41f46d5b8c93f940e9d8";

function createConfig(input: {
  rpcUrl?: string;
  walletPrivateKey?: string;
  customRpcUrl?: string;
  customChainId?: number;
  defaultNetwork?: "mainnet" | "testnet" | "custom";
}): AppConfig {
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
      walletPrivateKey: undefined,
      walletEnabled: false,
      gasTokenContract: "0xd2a4cff31913016155e38e474a2c06d08be276cf",
      nnsContract: "0x50ac1c37690cc2cfc594472833cf57505d5f46de",
      flamingoBrokerContract: "0xec268e9c642b7d09d10fe658bcb1cc63c0895d4d",
      flamingoConvertContract: "0xf40f694362957d56801a8cef7e62a83f7f1b7b0f",
      flamingoRouterContract: "0xde3a4b093abbd07e9a69cdec88a54d9a1fe14975",
      tokenMap: {},
      flamingoPairs: [],
    },
    neoX: {
      defaultNetwork: input.defaultNetwork ?? "testnet",
      nativeCurrencySymbol: "GAS",
      walletPrivateKey: input.walletPrivateKey,
      walletEnabled: Boolean(input.walletPrivateKey),
      networks: {
        mainnet: {
          name: "mainnet",
          chainId: 47_763,
        },
        testnet: {
          name: "testnet",
          chainId,
          rpcUrl: input.rpcUrl,
          explorerBaseUrl: "https://xexplorer.example.com",
        },
        custom: {
          name: "custom",
          rpcUrl: input.customRpcUrl,
          chainId: input.customChainId,
        },
      },
    },
    openAiModel: "gpt-5-mini",
    geminiModel: "gemini-2.5-flash",
    walletEnabled: Boolean(input.walletPrivateKey),
    llmEnabled: false,
  };
}

function toHexQuantity(value: bigint | number): string {
  return `0x${BigInt(value).toString(16)}`;
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "method" in value &&
    typeof value.method === "string"
  );
}

async function readJsonRequest(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function createRpcServer(
  handler: (request: JsonRpcRequest) => unknown,
): Promise<{
  server: Server;
  url: string;
}> {
  const server = createServer(async (request, response) => {
    const payload = await readJsonRequest(request);
    const rpcRequest = isJsonRpcRequest(payload) ? payload : undefined;
    const id = rpcRequest?.id ?? null;

    if (!rpcRequest) {
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32600,
            message: "Invalid request",
          },
        }),
      );

      return;
    }

    try {
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: handler(rpcRequest),
        }),
      );
    } catch (error) {
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "RPC error",
          },
        }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected an IPv4 server address.");
  }

  return {
    server,
    url: `http://127.0.0.1:${(address as AddressInfo).port}`,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });
}

function getCallData(request: JsonRpcRequest): string | undefined {
  const [call] = request.params ?? [];

  if (typeof call !== "object" || call === null || !("data" in call)) {
    return undefined;
  }

  return typeof call.data === "string" ? call.data : undefined;
}

function createHappyRpcHandler(request: JsonRpcRequest): unknown {
  switch (request.method) {
    case "eth_chainId":
      return toHexQuantity(chainId);
    case "eth_blockNumber":
      return toHexQuantity(123_456);
    case "eth_getBalance":
      return toHexQuantity(1_230_000_000_000_000_000n);
    case "eth_estimateGas":
      return toHexQuantity(21_000);
    case "eth_gasPrice":
      return toHexQuantity(1_000_000_000);
    case "eth_call": {
      const data = getCallData(request);

      if (data?.startsWith("0x06fdde03")) {
        return encodeFunctionResult({
          abi: erc20Abi,
          functionName: "name",
          result: "Neo X Test Token",
        });
      }

      if (data?.startsWith("0x95d89b41")) {
        return encodeFunctionResult({
          abi: erc20Abi,
          functionName: "symbol",
          result: "XTT",
        });
      }

      if (data?.startsWith("0x313ce567")) {
        return encodeFunctionResult({
          abi: erc20Abi,
          functionName: "decimals",
          result: 18,
        });
      }

      if (data?.startsWith("0x70a08231")) {
        return encodeFunctionResult({
          abi: erc20Abi,
          functionName: "balanceOf",
          result: 2_500_000_000_000_000_000n,
        });
      }

      throw new Error("Unsupported eth_call data.");
    }
    default:
      throw new Error(`Unsupported RPC method ${request.method}.`);
  }
}

describe("NeoXProvider", () => {
  it("loads chain info from a mocked Neo X RPC", async () => {
    const rpc = await createRpcServer(createHappyRpcHandler);

    try {
      const provider = new NeoXProvider(createConfig({ rpcUrl: rpc.url }));

      await expect(provider.getChainInfo()).resolves.toMatchObject({
        chain: "neo-x",
        network: "testnet",
        chainId,
        latestBlock: "123456",
        rpcUrlAlias: "NEOX_TESTNET_RPC_URL",
      });
    } finally {
      await closeServer(rpc.server);
    }
  });

  it("formats native GAS balances safely", async () => {
    const rpc = await createRpcServer(createHappyRpcHandler);

    try {
      const provider = new NeoXProvider(createConfig({ rpcUrl: rpc.url }));
      const balance = await provider.getNativeBalance(ownerAddress);

      expect(balance).toMatchObject({
        owner: ownerAddress,
        rawBalanceWei: "1230000000000000000",
        balance: "1.23",
        symbol: "GAS",
      });
    } finally {
      await closeServer(rpc.server);
    }
  });

  it("loads ERC-20 metadata and balances", async () => {
    const rpc = await createRpcServer(createHappyRpcHandler);

    try {
      const provider = new NeoXProvider(createConfig({ rpcUrl: rpc.url }));

      await expect(
        provider.getErc20Metadata(tokenContract),
      ).resolves.toMatchObject({
        name: "Neo X Test Token",
        symbol: "XTT",
        decimals: 18,
      });
      await expect(
        provider.getErc20Balance({
          tokenContract,
          owner: ownerAddress,
        }),
      ).resolves.toMatchObject({
        rawBalance: "2500000000000000000",
        formattedBalance: "2.5",
      });
    } finally {
      await closeServer(rpc.server);
    }
  });

  it("generates Neo X native transfer previews without broadcasting", async () => {
    const rpc = await createRpcServer(createHappyRpcHandler);

    try {
      const provider = new NeoXProvider(
        createConfig({
          rpcUrl: rpc.url,
          walletPrivateKey: privateKey,
        }),
      );
      const prepared = await provider.prepareNativeTransfer({
        to: ownerAddress,
        amount: "1",
      });

      expect(prepared).toMatchObject({
        action: "neox_prepare_native_transfer",
        network: "neoX",
        rpcNetwork: "testnet",
        chainId,
        to: ownerAddress,
        amount: "1",
        valueWei: "1000000000000000000",
        gas: "21000",
      });
      expect(buildPreparedNeoXTransactionRequest(prepared)).toMatchObject({
        gas: 21_000n,
        gasPrice: 1_000_000_000n,
      });
    } finally {
      await closeServer(rpc.server);
    }
  });

  it("passes the previewed fee fields into the Neo X broadcast request", async () => {
    const rpc = await createRpcServer(createHappyRpcHandler);

    try {
      const provider = new NeoXProvider(
        createConfig({
          rpcUrl: rpc.url,
          walletPrivateKey: privateKey,
        }),
      );
      const prepared = await provider.prepareNativeTransfer({
        to: ownerAddress,
        amount: "1",
      });
      const sendTransaction = jest
        .fn<Promise<string>, [Record<string, unknown>]>()
        .mockResolvedValue(`0x${"a".repeat(64)}`);
      const walletClientSpy = jest
        .spyOn(viem, "createWalletClient")
        .mockReturnValue({
          sendTransaction,
        } as never);

      try {
        await expect(
          provider.signAndBroadcast(prepared),
        ).resolves.toMatchObject({
          txHash: `0x${"a".repeat(64)}`,
          network: "neoX",
          rpcNetwork: "testnet",
        });
      } finally {
        walletClientSpy.mockRestore();
      }

      expect(sendTransaction).toHaveBeenCalledWith({
        to: ownerAddress,
        value: 1_000_000_000_000_000_000n,
        data: undefined,
        gas: 21_000n,
        gasPrice: 1_000_000_000n,
      });
    } finally {
      await closeServer(rpc.server);
    }
  });

  it("fails closed when the connected Neo X chain ID does not match configuration", async () => {
    const methods: string[] = [];
    const rpc = await createRpcServer((request) => {
      methods.push(request.method);

      if (request.method === "eth_chainId") {
        return toHexQuantity(47_763);
      }

      return createHappyRpcHandler(request);
    });

    try {
      const provider = new NeoXProvider(createConfig({ rpcUrl: rpc.url }));

      await expect(provider.getNativeBalance(ownerAddress)).rejects.toThrow(
        "Configured Neo X testnet chain ID 12227332 does not match the connected RPC chain ID 47763.",
      );
      expect(methods).toEqual(["eth_chainId"]);
    } finally {
      await closeServer(rpc.server);
    }
  });

  it("rejects malformed JSON ABI entries before making Neo X RPC calls", async () => {
    const methods: string[] = [];
    const rpc = await createRpcServer((request) => {
      methods.push(request.method);

      return createHappyRpcHandler(request);
    });

    try {
      const provider = new NeoXProvider(createConfig({ rpcUrl: rpc.url }));

      await expect(
        provider.callContract({
          contractAddress: tokenContract,
          abi: [
            {
              type: "function",
              name: "balanceOf",
            },
          ],
          functionName: "balanceOf",
          args: [ownerAddress],
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        provider.callContract({
          contractAddress: tokenContract,
          abi: [
            {
              type: "function",
              name: "balanceOf",
            },
          ],
          functionName: "balanceOf",
          args: [ownerAddress],
        }),
      ).rejects.toThrow("ABI entry 0 must include an 'inputs' array.");
      expect(methods).toEqual([]);
    } finally {
      await closeServer(rpc.server);
    }
  });

  it("returns block-specific validation messages for invalid block references", async () => {
    const methods: string[] = [];
    const rpc = await createRpcServer((request) => {
      methods.push(request.method);

      return createHappyRpcHandler(request);
    });

    try {
      const provider = new NeoXProvider(createConfig({ rpcUrl: rpc.url }));

      await expect(provider.getBlock({ number: "abc" })).rejects.toThrow(
        "Block number must be a non-negative integer string.",
      );
      await expect(provider.getBlock({ hash: "0x1234" })).rejects.toThrow(
        "Invalid EVM block hash.",
      );
      await expect(
        provider.getErc721Owner({
          contractAddress: tokenContract,
          tokenId: "abc",
        }),
      ).rejects.toThrow("tokenId must be a non-negative integer string.");
      expect(methods).toEqual([]);
    } finally {
      await closeServer(rpc.server);
    }
  });

  it("returns clear errors when Neo X RPC configuration is missing", async () => {
    const provider = new NeoXProvider(createConfig({}));

    await expect(provider.getChainInfo()).rejects.toThrow(
      ProviderCapabilityError,
    );
    await expect(provider.getChainInfo()).rejects.toThrow(
      "Neo X testnet RPC is not configured.",
    );
  });

  it("rejects custom Neo X requests when the custom RPC URL is missing", async () => {
    const provider = new NeoXProvider(
      createConfig({ rpcUrl: "http://unused" }),
    );

    await expect(
      provider.getNativeBalance(ownerAddress, "custom"),
    ).rejects.toThrow(ProviderCapabilityError);
    await expect(
      provider.getNativeBalance(ownerAddress, "custom"),
    ).rejects.toThrow(
      "Neo X custom RPC is not configured. Set NEOX_CUSTOM_RPC_URL before using Neo X tools.",
    );
  });

  it("rejects custom Neo X requests when the custom chain ID is missing", async () => {
    const provider = new NeoXProvider(
      createConfig({
        rpcUrl: "http://unused",
        customRpcUrl: "http://127.0.0.1:8545",
      }),
    );

    await expect(
      provider.getNativeBalance(ownerAddress, "custom"),
    ).rejects.toThrow(ProviderCapabilityError);
    await expect(
      provider.getNativeBalance(ownerAddress, "custom"),
    ).rejects.toThrow(
      "Neo X custom chain ID is not configured. Set NEOX_CUSTOM_CHAIN_ID for custom Neo X networks.",
    );
  });

  it("surfaces malformed RPC responses", async () => {
    const rpc = await createRpcServer((request) => {
      if (request.method === "eth_getBalance") {
        return "not-a-hex-value";
      }

      return createHappyRpcHandler(request);
    });

    try {
      const provider = new NeoXProvider(createConfig({ rpcUrl: rpc.url }));

      await expect(provider.getNativeBalance(ownerAddress)).rejects.toThrow();
    } finally {
      await closeServer(rpc.server);
    }
  });

  it("surfaces mocked RPC failures", async () => {
    const rpc = await createRpcServer((request) => {
      if (request.method === "eth_chainId") {
        throw new Error("RPC unavailable");
      }

      return createHappyRpcHandler(request);
    });

    try {
      const provider = new NeoXProvider(createConfig({ rpcUrl: rpc.url }));

      await expect(provider.getChainInfo()).rejects.toThrow("RPC unavailable");
    } finally {
      await closeServer(rpc.server);
    }
  });
});

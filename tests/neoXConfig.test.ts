import { loadConfig } from "../src/core/config";
import { ValidationError } from "../src/core/errors";

const managedEnvKeys = [
  "LLM_PROVIDER",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "WALLET_WIF",
  "WALLET_PRIVATE_KEY",
  "N3_WALLET_PRIVATE_KEY",
  "NEOX_MAINNET_RPC_URL",
  "NEOX_TESTNET_RPC_URL",
  "NEOX_CUSTOM_RPC_URL",
  "NEOX_DEFAULT_NETWORK",
  "NEOX_EXPLORER_BASE_URL",
  "NEOX_MAINNET_CHAIN_ID",
  "NEOX_TESTNET_CHAIN_ID",
  "NEOX_CUSTOM_CHAIN_ID",
  "NEOX_PRIVATE_KEY",
  "NEOX_WALLET_PRIVATE_KEY",
] as const;

describe("Neo X config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of managedEnvKeys) {
      delete process.env[key];
    }

    process.env.NODE_ENV = "test";
    process.env.NEO_N3_NETWORK = "mainnet";
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }

    Object.assign(process.env, originalEnv);
  });

  it("loads Neo X testnet RPC configuration", () => {
    process.env.NEOX_DEFAULT_NETWORK = "testnet";
    process.env.NEOX_TESTNET_RPC_URL = "https://neox-testnet.example.com";
    process.env.NEOX_EXPLORER_BASE_URL = "https://xexplorer.example.com";

    const config = loadConfig();

    expect(config.neoX.defaultNetwork).toBe("testnet");
    expect(config.neoX.networks.testnet).toMatchObject({
      chainId: 12_227_332,
      rpcUrl: "https://neox-testnet.example.com",
      explorerBaseUrl: "https://xexplorer.example.com",
    });
  });

  it("throws a clear error when the selected Neo X RPC is missing", () => {
    process.env.NEOX_DEFAULT_NETWORK = "testnet";

    expect(() => {
      loadConfig();
    }).toThrow(ValidationError);
    expect(() => {
      loadConfig();
    }).toThrow(
      "NEOX_DEFAULT_NETWORK is set to testnet, but the matching Neo X RPC URL is missing.",
    );
  });

  it("loads custom Neo X networks with custom chain IDs", () => {
    process.env.NEOX_DEFAULT_NETWORK = "custom";
    process.env.NEOX_CUSTOM_RPC_URL = "http://127.0.0.1:8545";
    process.env.NEOX_CUSTOM_CHAIN_ID = "777";

    const config = loadConfig();

    expect(config.neoX.networks.custom).toMatchObject({
      chainId: 777,
      rpcUrl: "http://127.0.0.1:8545",
    });
  });
});

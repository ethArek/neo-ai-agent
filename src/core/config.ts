import { CONST as neoConst, wallet as neoWallet } from "@cityofzion/neon-js";
import dotenv from "dotenv";
import { z } from "zod";

import { ValidationError } from "./errors";
import { hash160Schema } from "./validation";

dotenv.config();

const defaultNeoN3MainnetRpcUrl = "https://n3seed1.ngd.network:10332";
const defaultNeoN3TestnetRpcUrl = "https://rpc.t5.n3.nspcc.ru:20331/";
const defaultNeoN3GasTokenContract = `0x${neoConst.NATIVE_CONTRACT_HASH.GasToken}`;
const defaultNeoN3MainnetNnsContract =
  "0x50ac1c37690cc2cfc594472833cf57505d5f46de";
const defaultNeoN3TestnetNnsContract =
  "0x538355b776538a5da0b2a08c139b9900b9c0cbb6";
const defaultNeoXMainnetChainId = 47763;
const defaultNeoXTestnetChainId = 12_227_332;
const defaultNeoXNativeCurrencySymbol = "GAS";
export const defaultNeoN3FlamingoContractsByNetwork = Object.freeze({
  mainnet: Object.freeze({
    broker: "0xec268e9c642b7d09d10fe658bcb1cc63c0895d4d",
    convert: "0xf40f694362957d56801a8cef7e62a83f7f1b7b0f",
    router: "0xde3a4b093abbd07e9a69cdec88a54d9a1fe14975",
  }),
  testnet: Object.freeze({
    broker: "0xb5e260839b427ef72faf5e563a241922da9c6cc8",
    convert: "0x160f5d64947b2d71d949c2e751d5cf13bfb2e199",
    router: "0x9f4dd9684638f839f3f62cc3440c3f1c8bad541b",
  }),
});
const defaultNeoN3MainnetTokenMap = Object.freeze({
  FLM: "0xf0151f528127558851b39c2cd8aa47da7418ab28",
  FUSD: "0x1005d400bcc2a56b7352f09e273be3f9933a5fb1",
  BNEO: "0x48c40d4666f93408be1bef038b6722404d9a4c2a",
  NEO: "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5",
  GAS: "0xd2a4cff31913016155e38e474a2c06d08be276cf",
  USDT: "0x68b938cc42b6a2d54fb9040f5facf4290ebb8c5f",
  USDC: "0x6627a4a0dfcb409bf1e0fb3e217441f3f9809fce",
  WETH: "0xd3a41b53888a733b549f5d4146e7a98d3285fa21",
  WBTC: "0x4548a3bcb3c2b5ce42bf0559b1cf2f1ec97a51d0",
  ONT: "0x0a1328bffb804ad7bb342673da82a972cc7af86c",
  WINGV2: "0x948a60635d1f7921063d04be8f6cb35c741df566",
  BNB: "0x00fb9575f220727f71a1537f75e83af9387628ff",
  CAKE: "0x570c27653683788177f05740257d88fed76bf74b",
  SWTH: "0x78e1330db47634afdb5ea455302ba2d12b8d549f",
  GM: "0x9b049f1283515eef1d3f6ac610e1595ed25ca3e9",
  NUDES: "0x340720c7107ef5721e44ed2ea8e314cce5c130fa",
  SOM: "0x2d4c6cf0417209a7eb410160344e224e74f87195",
  CANDY: "0x88da18a5bca86ec8206d9b4960a7d0c4355a432f",
  FDE: "0x9770f4d78a19d1a6fa94b472bcedffcc06b56c49",
  FRANK: "0xa06cfd7ae9dd7befb7bf8e5b8c5902c969182de0",
  HD: "0x4b027a8320d5705802e5efbb51f6231ebf412cf6",
  NDMEME: "0x57d1761945697a2257be76b756dcc9c19b512ff1",
  APE: "0x63f1a9c6bef178f54a6332b874407068d9a99e50",
  NRP: "0x789518aa302b571e3e825f2c85a01ad731014a45",
} satisfies Record<string, string>);
const defaultNeoN3TestnetTokenMap = Object.freeze({
  FLM: "0x0fe2dfce9043293a40ce1bc226bdf89376b03a57",
  FUSD: "0xd903a107ff2a780660240efe2b02d41e04f3ad54",
  BNEO: "0x833b3d6854d5bc44cab40ab9b46560d25c72562c",
  NEO: "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5",
  GAS: "0xd2a4cff31913016155e38e474a2c06d08be276cf",
  USDT: "0x2e519772b391eeb290445c3427fff5074d61e079",
  USDC: "0x256084744001a70e43bc977bdd0c526dd43d2054",
  WETH: "0x98e193848f489e90a99d354e8493e94edf30f028",
  WBTC: "0x8ae214ea1878709c3e6e0c9de3492a8c4dbbe4be",
  ONT: "0x6a1713bd1ba9f2f6f22fd34ddd0838d31c53b9a4",
  WINGV2: "0x83d82f298dd562ddce9192965b93473414bd706f",
  BNB: "0x8d3088c4a76243833a3b3ee6f383a469f498127a",
  CAKE: "0xbddbdc199bf23d0b02c22bf854d0b45bac1a3fce",
  SWTH: "0x4d24049b8b7f85bb4958c7f01e1e072ac0d8dd9b",
  GM: "0xa017f74ad8f4d802047c014e0e2978a543566d51",
  NUDES: "0x0fc9aea4da4b249076c7bf94b6c9dcab63295f15",
  SOM: "0x88b096f274b12bdcdd7c3ab3d7209d5638a456d9",
  CANDY: "0xe4466665ae8a1af1bd411a0411daf275fe32a523",
  FDE: "0xd2ba26fa39ba3b6b8f04a63eb65e9b9cb8a06879",
  FRANK: "0x4b421252d8f7abaf4598349aa998a7c711b2368b",
  HD: "0x6722c2eb8b3fddc2508ef22129525bd0e417ba83",
  NDMEME: "0x4db8edfc1367e957e6000937ad808f89b4b79bf6",
  APE: "0x7d90f0ce93bbafa7dec486c693fe3c311790fa19",
} satisfies Record<string, string>);
const defaultNeoN3MainnetFlamingoPairs = Object.freeze([
  ["BNEO", "FLM"],
  ["FLM", "WBTC"],
  ["FLM", "FUSD"],
  ["FUSD", "USDT"],
  ["FUSD", "USDC"],
  ["WBTC", "FUSD"],
  ["WETH", "FUSD"],
  ["BNEO", "FUSD"],
  ["GAS", "FUSD"],
  ["BNEO", "GAS"],
  ["BNB", "FUSD"],
  ["CAKE", "FUSD"],
  ["WINGV2", "FUSD"],
  ["GM", "FUSD"],
  ["SWTH", "FUSD"],
  ["ONT", "FUSD"],
  ["NUDES", "FUSD"],
  ["FRANK", "FUSD"],
  ["NDMEME", "FUSD"],
  ["FDE", "FUSD"],
  ["SOM", "FUSD"],
  ["CANDY", "FUSD"],
  ["APE", "FUSD"],
  ["NRP", "FUSD"],
] satisfies Array<readonly [string, string]>);
const defaultNeoN3TestnetFlamingoPairs = Object.freeze([
  ["BNEO", "FLM"],
  ["FLM", "WBTC"],
  ["FLM", "FUSD"],
  ["FUSD", "USDT"],
  ["FUSD", "USDC"],
  ["WBTC", "FUSD"],
  ["WETH", "FUSD"],
  ["BNEO", "FUSD"],
  ["GAS", "FUSD"],
  ["BNEO", "GAS"],
  ["BNB", "FUSD"],
  ["CAKE", "FUSD"],
  ["WINGV2", "FUSD"],
  ["SWTH", "FUSD"],
  ["ONT", "FUSD"],
  ["NUDES", "FUSD"],
  ["FRANK", "FUSD"],
  ["NDMEME", "FUSD"],
  ["SOM", "FUSD"],
  ["CANDY", "FUSD"],
  ["APE", "FUSD"],
] satisfies Array<readonly [string, string]>);

const optionalNonEmptyString = z
  .string()
  .optional()
  .transform((value) => {
    if (!value) {
      return undefined;
    }

    return value.trim() === "" ? undefined : value.trim();
  });

const hash160MapSchema = z
  .string()
  .optional()
  .transform((value, context): Record<string, string> => {
    if (!value || value.trim() === "") {
      return {};
    }

    try {
      const parsed = JSON.parse(value) as unknown;

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "NEO_N3_TOKEN_MAP_JSON must be a JSON object.",
        });

        return z.NEVER;
      }

      return Object.entries(parsed).reduce<Record<string, string>>(
        (accumulator, [symbol, address]) => {
          if (typeof address !== "string") {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `NEO_N3_TOKEN_MAP_JSON.${symbol} must be a string contract hash.`,
            });

            return accumulator;
          }

          const parsedAddress = hash160Schema.safeParse(address);

          if (!parsedAddress.success) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `NEO_N3_TOKEN_MAP_JSON.${symbol} must be a valid 20-byte hash.`,
            });

            return accumulator;
          }

          accumulator[symbol.trim().toUpperCase()] = parsedAddress.data;

          return accumulator;
        },
        {},
      );
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NEO_N3_TOKEN_MAP_JSON must contain valid JSON.",
      });

      return z.NEVER;
    }
  });

const stringTuplePairListSchema = z
  .string()
  .optional()
  .transform((value, context): Array<[string, string]> => {
    if (!value || value.trim() === "") {
      return [];
    }

    try {
      const parsed = JSON.parse(value) as unknown;

      if (!Array.isArray(parsed)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "NEO_N3_FLAMINGO_PAIRS_JSON must be a JSON array.",
        });

        return z.NEVER;
      }

      return parsed.reduce<Array<[string, string]>>((accumulator, entry) => {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== "string" ||
          typeof entry[1] !== "string"
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "NEO_N3_FLAMINGO_PAIRS_JSON items must be [fromToken, toToken] string tuples.",
          });

          return accumulator;
        }

        accumulator.push([
          entry[0].trim().toUpperCase(),
          entry[1].trim().toUpperCase(),
        ]);

        return accumulator;
      }, []);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NEO_N3_FLAMINGO_PAIRS_JSON must contain valid JSON.",
      });

      return z.NEVER;
    }
  });

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().trim().min(1).default("0.0.0.0"),
  API_BEARER_TOKEN: optionalNonEmptyString,
  SESSION_MAX_AGE_MINUTES: z.coerce.number().positive().default(60),
  SESSION_MAX_ACTIVE_SESSIONS: z.coerce.number().int().positive().optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEO_RPC_URL: optionalNonEmptyString,
  NEO_N3_RPC_URL: optionalNonEmptyString,
  NEO_N3_NETWORK: z.enum(["mainnet", "testnet"]).default("mainnet"),
  LLM_PROVIDER: z.enum(["openai", "gemini"]).optional(),
  OPENAI_API_KEY: optionalNonEmptyString,
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  GEMINI_API_KEY: optionalNonEmptyString,
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  WALLET_WIF: optionalNonEmptyString,
  WALLET_PRIVATE_KEY: optionalNonEmptyString,
  N3_WALLET_PRIVATE_KEY: optionalNonEmptyString,
  NEO_N3_GAS_TOKEN_CONTRACT: optionalNonEmptyString,
  NEO_N3_NNS_CONTRACT: optionalNonEmptyString,
  NEO_N3_FLAMINGO_BROKER_CONTRACT: optionalNonEmptyString,
  NEO_N3_FLAMINGO_CONVERT_CONTRACT: optionalNonEmptyString,
  NEO_N3_FLAMINGO_ROUTER_CONTRACT: optionalNonEmptyString,
  NEO_N3_TOKEN_MAP_JSON: hash160MapSchema,
  NEO_N3_FLAMINGO_PAIRS_JSON: stringTuplePairListSchema,
  NEOX_MAINNET_RPC_URL: optionalNonEmptyString,
  NEOX_TESTNET_RPC_URL: optionalNonEmptyString,
  NEOX_CUSTOM_RPC_URL: optionalNonEmptyString,
  NEOX_DEFAULT_NETWORK: z
    .enum(["mainnet", "testnet", "custom"])
    .default("mainnet"),
  NEOX_EXPLORER_BASE_URL: optionalNonEmptyString,
  NEOX_MAINNET_CHAIN_ID: z.coerce
    .number()
    .int()
    .positive()
    .default(defaultNeoXMainnetChainId),
  NEOX_TESTNET_CHAIN_ID: z.coerce
    .number()
    .int()
    .positive()
    .default(defaultNeoXTestnetChainId),
  NEOX_CUSTOM_CHAIN_ID: z.coerce.number().int().positive().optional(),
  NEOX_PRIVATE_KEY: optionalNonEmptyString,
  NEOX_WALLET_PRIVATE_KEY: optionalNonEmptyString,
});

export interface AppConfig {
  port: number;
  api: {
    host: string;
    bearerToken?: string;
  };
  session: {
    maxAgeMs: number;
    maxActiveSessions?: number;
  };
  nodeEnv: "development" | "test" | "production";
  neoN3: {
    network: "mainnet" | "testnet";
    rpcUrl: string;
    walletPrivateKey?: string;
    walletEnabled: boolean;
    gasTokenContract: string;
    nnsContract?: string;
    flamingoBrokerContract?: string;
    flamingoConvertContract?: string;
    flamingoRouterContract?: string;
    tokenMap: Record<string, string>;
    flamingoPairs: Array<[string, string]>;
  };
  neoX: {
    defaultNetwork: "mainnet" | "testnet" | "custom";
    nativeCurrencySymbol: "GAS";
    walletPrivateKey?: string;
    walletEnabled: boolean;
    networks: {
      mainnet: {
        name: "mainnet";
        chainId: number;
        rpcUrl?: string;
        explorerBaseUrl?: string;
      };
      testnet: {
        name: "testnet";
        chainId: number;
        rpcUrl?: string;
        explorerBaseUrl?: string;
      };
      custom: {
        name: "custom";
        chainId?: number;
        rpcUrl?: string;
        explorerBaseUrl?: string;
      };
    };
  };
  llmProvider?: "openai" | "gemini";
  openAiApiKey?: string;
  openAiModel: string;
  geminiApiKey?: string;
  geminiModel: string;
  walletEnabled: boolean;
  llmEnabled: boolean;
}

function parseOptionalHash160(
  value: string | undefined,
  fieldName: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return hash160Schema.parse(value);
  } catch {
    throw new ValidationError(`${fieldName} must be a valid 20-byte hash.`);
  }
}

function parseOptionalNeoN3PrivateKey(
  value: string | undefined,
  fieldName: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  if (neoWallet.isPrivateKey(value) || neoWallet.isWIF(value)) {
    return value;
  }

  throw new ValidationError(
    `${fieldName} must be a Neo N3 raw private key or WIF.`,
  );
}

function parseOptionalEvmPrivateKey(
  value: string | undefined,
  fieldName: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return value;
  }

  throw new ValidationError(
    `${fieldName} must be a 0x-prefixed 32-byte EVM private key.`,
  );
}

function parseOptionalUrl(
  value: string | undefined,
  fieldName: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return z.string().url(`${fieldName} must be a valid URL.`).parse(value);
  } catch {
    throw new ValidationError(`${fieldName} must be a valid URL.`);
  }
}

export function resolveLlmProviderSelection(input: {
  preferredProvider?: "openai" | "gemini";
  openAiApiKey?: string;
  geminiApiKey?: string;
}): "openai" | "gemini" | undefined {
  if (input.preferredProvider === "openai") {
    if (!input.openAiApiKey) {
      throw new ValidationError(
        "LLM_PROVIDER is set to openai, but OPENAI_API_KEY is missing.",
      );
    }

    return "openai";
  }

  if (input.preferredProvider === "gemini") {
    if (!input.geminiApiKey) {
      throw new ValidationError(
        "LLM_PROVIDER is set to gemini, but GEMINI_API_KEY is missing.",
      );
    }

    return "gemini";
  }

  if (input.openAiApiKey) {
    return "openai";
  }

  if (input.geminiApiKey) {
    return "gemini";
  }

  return undefined;
}

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  const llmProvider = resolveLlmProviderSelection({
    preferredProvider: env.LLM_PROVIDER,
    openAiApiKey: env.OPENAI_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY,
  });
  const network = env.NEO_N3_NETWORK;
  const neoN3RpcUrl = env.NEO_N3_RPC_URL ?? env.NEO_RPC_URL;
  const parsedNeoN3RpcUrl = z
    .string()
    .url("NEO_N3_RPC_URL must be a valid URL.")
    .parse(
      neoN3RpcUrl ??
        (network === "testnet"
          ? defaultNeoN3TestnetRpcUrl
          : defaultNeoN3MainnetRpcUrl),
    );
  const neoN3WalletPrivateKey = parseOptionalNeoN3PrivateKey(
    env.WALLET_WIF ?? env.WALLET_PRIVATE_KEY ?? env.N3_WALLET_PRIVATE_KEY,
    "WALLET_WIF, WALLET_PRIVATE_KEY, or N3_WALLET_PRIVATE_KEY",
  );
  const defaultNeoN3TokenMap =
    network === "testnet"
      ? defaultNeoN3TestnetTokenMap
      : defaultNeoN3MainnetTokenMap;
  const defaultNeoN3FlamingoPairs =
    network === "testnet"
      ? defaultNeoN3TestnetFlamingoPairs
      : defaultNeoN3MainnetFlamingoPairs;
  const configuredNeoN3TokenMap =
    Object.keys(env.NEO_N3_TOKEN_MAP_JSON).length > 0
      ? env.NEO_N3_TOKEN_MAP_JSON
      : defaultNeoN3TokenMap;
  const configuredNeoN3FlamingoPairs =
    env.NEO_N3_FLAMINGO_PAIRS_JSON.length > 0
      ? env.NEO_N3_FLAMINGO_PAIRS_JSON
      : defaultNeoN3FlamingoPairs.map((pair): [string, string] => [
          pair[0],
          pair[1],
        ]);
  const neoXDefaultNetwork = env.NEOX_DEFAULT_NETWORK;
  const neoXSelectedRpcUrl =
    neoXDefaultNetwork === "mainnet"
      ? env.NEOX_MAINNET_RPC_URL
      : neoXDefaultNetwork === "testnet"
        ? env.NEOX_TESTNET_RPC_URL
        : env.NEOX_CUSTOM_RPC_URL;

  if (process.env.NEOX_DEFAULT_NETWORK && !neoXSelectedRpcUrl) {
    throw new ValidationError(
      `NEOX_DEFAULT_NETWORK is set to ${neoXDefaultNetwork}, but the matching Neo X RPC URL is missing.`,
    );
  }

  if (
    neoXDefaultNetwork === "custom" &&
    process.env.NEOX_DEFAULT_NETWORK &&
    !env.NEOX_CUSTOM_CHAIN_ID
  ) {
    throw new ValidationError(
      "NEOX_DEFAULT_NETWORK is set to custom, but NEOX_CUSTOM_CHAIN_ID is missing.",
    );
  }

  const neoXWalletPrivateKey = parseOptionalEvmPrivateKey(
    env.NEOX_PRIVATE_KEY ?? env.NEOX_WALLET_PRIVATE_KEY,
    "NEOX_PRIVATE_KEY or NEOX_WALLET_PRIVATE_KEY",
  );
  const neoXMainnetRpcUrl = parseOptionalUrl(
    env.NEOX_MAINNET_RPC_URL,
    "NEOX_MAINNET_RPC_URL",
  );
  const neoXTestnetRpcUrl = parseOptionalUrl(
    env.NEOX_TESTNET_RPC_URL,
    "NEOX_TESTNET_RPC_URL",
  );
  const neoXCustomRpcUrl = parseOptionalUrl(
    env.NEOX_CUSTOM_RPC_URL,
    "NEOX_CUSTOM_RPC_URL",
  );
  const neoXExplorerBaseUrl = parseOptionalUrl(
    env.NEOX_EXPLORER_BASE_URL,
    "NEOX_EXPLORER_BASE_URL",
  );

  return {
    port: env.PORT,
    api: {
      host: env.API_HOST,
      bearerToken: env.API_BEARER_TOKEN,
    },
    session: {
      maxAgeMs: Math.round(env.SESSION_MAX_AGE_MINUTES * 60_000),
      maxActiveSessions: env.SESSION_MAX_ACTIVE_SESSIONS,
    },
    nodeEnv: env.NODE_ENV,
    neoN3: {
      network,
      rpcUrl: parsedNeoN3RpcUrl,
      walletPrivateKey: neoN3WalletPrivateKey,
      walletEnabled: Boolean(neoN3WalletPrivateKey),
      gasTokenContract: parseOptionalHash160(
        env.NEO_N3_GAS_TOKEN_CONTRACT ?? defaultNeoN3GasTokenContract,
        "NEO_N3_GAS_TOKEN_CONTRACT",
      ) as string,
      nnsContract: parseOptionalHash160(
        env.NEO_N3_NNS_CONTRACT ??
          (network === "testnet"
            ? defaultNeoN3TestnetNnsContract
            : defaultNeoN3MainnetNnsContract),
        "NEO_N3_NNS_CONTRACT",
      ),
      flamingoBrokerContract: parseOptionalHash160(
        env.NEO_N3_FLAMINGO_BROKER_CONTRACT ??
          (network === "testnet"
            ? defaultNeoN3FlamingoContractsByNetwork.testnet.broker
            : defaultNeoN3FlamingoContractsByNetwork.mainnet.broker),
        "NEO_N3_FLAMINGO_BROKER_CONTRACT",
      ),
      flamingoConvertContract: parseOptionalHash160(
        env.NEO_N3_FLAMINGO_CONVERT_CONTRACT ??
          (network === "testnet"
            ? defaultNeoN3FlamingoContractsByNetwork.testnet.convert
            : defaultNeoN3FlamingoContractsByNetwork.mainnet.convert),
        "NEO_N3_FLAMINGO_CONVERT_CONTRACT",
      ),
      flamingoRouterContract: parseOptionalHash160(
        env.NEO_N3_FLAMINGO_ROUTER_CONTRACT ??
          (network === "testnet"
            ? defaultNeoN3FlamingoContractsByNetwork.testnet.router
            : defaultNeoN3FlamingoContractsByNetwork.mainnet.router),
        "NEO_N3_FLAMINGO_ROUTER_CONTRACT",
      ),
      tokenMap: configuredNeoN3TokenMap,
      flamingoPairs: configuredNeoN3FlamingoPairs,
    },
    neoX: {
      defaultNetwork: neoXDefaultNetwork,
      nativeCurrencySymbol: defaultNeoXNativeCurrencySymbol,
      walletPrivateKey: neoXWalletPrivateKey,
      walletEnabled: Boolean(neoXWalletPrivateKey),
      networks: {
        mainnet: {
          name: "mainnet",
          chainId: env.NEOX_MAINNET_CHAIN_ID,
          rpcUrl: neoXMainnetRpcUrl,
          explorerBaseUrl: neoXExplorerBaseUrl,
        },
        testnet: {
          name: "testnet",
          chainId: env.NEOX_TESTNET_CHAIN_ID,
          rpcUrl: neoXTestnetRpcUrl,
          explorerBaseUrl: neoXExplorerBaseUrl,
        },
        custom: {
          name: "custom",
          chainId: env.NEOX_CUSTOM_CHAIN_ID,
          rpcUrl: neoXCustomRpcUrl,
          explorerBaseUrl: neoXExplorerBaseUrl,
        },
      },
    },
    llmProvider,
    openAiApiKey: env.OPENAI_API_KEY,
    openAiModel: env.OPENAI_MODEL,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    walletEnabled: Boolean(neoN3WalletPrivateKey || neoXWalletPrivateKey),
    llmEnabled: Boolean(llmProvider),
  };
}

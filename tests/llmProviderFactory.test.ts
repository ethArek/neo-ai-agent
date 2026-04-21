import {
  resolveLlmProviderSelection,
  type AppConfig,
} from "../src/core/config";
import { ValidationError } from "../src/core/errors";
import { createLlmProvider } from "../src/llm/createProvider";
import { GeminiProvider } from "../src/llm/geminiProvider";
import { OpenAiProvider } from "../src/llm/openaiProvider";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3000,
    api: {
      host: "127.0.0.1",
    },
    nodeEnv: "test",
    neoXRpcUrl: "https://example.com",
    neoXChainId: 47763,
    neoN3: {
      rpcUrl: "https://n3.example.com",
      walletPrivateKey: undefined,
      walletEnabled: false,
      tokenMap: {},
      flamingoPairs: [],
    },
    llmProvider: undefined,
    openAiApiKey: undefined,
    openAiModel: "gpt-4.1-mini",
    geminiApiKey: undefined,
    geminiModel: "gemini-2.5-flash",
    walletPrivateKey: undefined,
    walletEnabled: false,
    llmEnabled: false,
    bridge: {
      neoXContract: "0x1212000000000000000000000000000000000004",
      neoN3Contract: "0xbb19cfc864b73159277e1fd39694b3fd5fc613d2",
      neoN3GasTokenContract: "0xd2a4cff31913016155e38e474a2c06d08be276cf",
    },
    erc20: {
      wrappedGasAddress: "0xdE41591ED1f8ED1484aC2CD8ca0876428de60EfF",
      tokenMap: {},
    },
    ...overrides,
  };
}

describe("resolveLlmProviderSelection", () => {
  it("returns undefined when no LLM credentials are configured", () => {
    expect(resolveLlmProviderSelection({})).toBeUndefined();
  });

  it("prefers OpenAI when both providers are available and no preference is set", () => {
    expect(
      resolveLlmProviderSelection({
        openAiApiKey: "openai-key",
        geminiApiKey: "gemini-key",
      }),
    ).toBe("openai");
  });

  it("returns Gemini when only Gemini is configured", () => {
    expect(
      resolveLlmProviderSelection({
        geminiApiKey: "gemini-key",
      }),
    ).toBe("gemini");
  });

  it("throws when Gemini is explicitly selected without a Gemini key", () => {
    expect(() => {
      resolveLlmProviderSelection({
        preferredProvider: "gemini",
        openAiApiKey: "openai-key",
      });
    }).toThrow(ValidationError);
  });
});

describe("createLlmProvider", () => {
  it("returns undefined when no provider is selected", () => {
    expect(createLlmProvider(createConfig())).toBeUndefined();
  });

  it("creates an OpenAI provider when OpenAI is selected", () => {
    const provider = createLlmProvider(
      createConfig({
        llmProvider: "openai",
        llmEnabled: true,
        openAiApiKey: "openai-key",
      }),
    );

    expect(provider).toBeInstanceOf(OpenAiProvider);
  });

  it("creates a Gemini provider when Gemini is selected", () => {
    const provider = createLlmProvider(
      createConfig({
        llmProvider: "gemini",
        llmEnabled: true,
        geminiApiKey: "gemini-key",
      }),
    );

    expect(provider).toBeInstanceOf(GeminiProvider);
  });
});

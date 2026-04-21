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
    llmProvider: undefined,
    openAiApiKey: undefined,
    openAiModel: "gpt-4.1-mini",
    geminiApiKey: undefined,
    geminiModel: "gemini-2.5-flash",
    walletEnabled: false,
    llmEnabled: false,
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

import { AppError, serializeError } from "../src/core/errors";
import { sanitizeForLogs, sanitizeStringValue } from "../src/core/logger";

describe("sanitizeForLogs", () => {
  it("keeps token symbols readable in operational logs", () => {
    expect(
      sanitizeForLogs({
        token: "GAS",
        tokenSymbol: "GAS",
        fromTokenSymbol: "GAS",
        toTokenSymbol: "BNEO",
        requestedToken: "FUSD",
        routeSymbols: ["GAS", "FLM", "BNEO"],
      }),
    ).toEqual({
      token: "GAS",
      tokenSymbol: "GAS",
      fromTokenSymbol: "GAS",
      toTokenSymbol: "BNEO",
      requestedToken: "FUSD",
      routeSymbols: ["GAS", "FLM", "BNEO"],
    });
  });

  it("still masks secret-like credentials", () => {
    expect(
      sanitizeForLogs({
        apiKey: "openai-secret-key",
        bearerToken: "super-secret-bearer-token",
        authorization: "Bearer secret-token",
        nested: {
          refreshToken: "refresh-secret-token",
          wif: "L123456789",
        },
      }),
    ).toEqual({
      apiKey: "open****-key",
      bearerToken: "supe****oken",
      authorization: "Bear****oken",
      nested: {
        refreshToken: "refr****oken",
        wif: "L123****6789",
      },
    });
  });

  it("redacts secrets embedded in freeform strings and URLs", () => {
    expect(
      sanitizeForLogs({
        error:
          "RPC failed for https://user:pass@example.com/path?api_key=secret&token=another-secret with Bearer super-secret-token",
      }),
    ).toEqual({
      error:
        "RPC failed for https://********:********@example.com/path?api_key=********&token=******** with Bearer supe****oken",
    });
    expect(
      sanitizeStringValue(
        "authorization: Bearer secret-token privateKey=0x59c6995e998f97a5a0044966f094538b292d0e54077c41f46d5b8c93f940e9d8",
      ),
    ).toBe("authorization: Bearer secr****oken privateKey=0x59****e9d8");
    expect(
      sanitizeStringValue(
        "RPC failed for https://provider.example.com/secret-token-123",
      ),
    ).toBe("RPC failed for https://provider.example.com/********");
  });

  it("sanitizes exposed AppError messages and details", () => {
    const serialized = serializeError(
      new AppError(
        "RPC failed for https://provider.example.com/secret-token-123",
        {
          code: "TEST_ERROR",
          statusCode: 502,
          expose: true,
          details: {
            error:
              "upstream https://user:pass@example.com/path?api_key=secret&token=another-secret",
          },
        },
      ),
    );

    expect(serialized).toEqual({
      message: "RPC failed for https://provider.example.com/********",
      code: "TEST_ERROR",
      statusCode: 502,
      details: {
        error:
          "upstream https://********:********@example.com/path?api_key=********&token=********",
      },
    });
  });
});

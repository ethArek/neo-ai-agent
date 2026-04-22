import { sanitizeForLogs } from "../src/core/logger";

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
});

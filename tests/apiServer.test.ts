import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { PlannerService } from "../src/agent/planner";
import { AgentRuntime } from "../src/agent/runtime";
import { SessionStore } from "../src/agent/sessionStore";
import { ToolRegistry } from "../src/agent/toolRegistry";
import { createApiServer } from "../src/api/server";
import { AppError } from "../src/core/errors";
import { FakeNeoProvider } from "./helpers/fakeNeoProvider";

async function createTestServer() {
  const provider = new FakeNeoProvider();
  const registry = new ToolRegistry();
  const runtime = new AgentRuntime({
    planner: new PlannerService({
      tools: registry.listPlannerTools(),
    }),
    registry,
    neo: provider,
    sessions: new SessionStore(),
  });
  const server = createApiServer({
    runtime,
    registry,
    host: "127.0.0.1",
    port: 0,
    bearerToken: "test-token",
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
    throw new Error("Expected an IPv4 test server address.");
  }

  return {
    provider,
    server,
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
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

describe("REST API server", () => {
  it("returns the available Neo N3 tools when authorized", async () => {
    const setup = await createTestServer();

    try {
      const response = await fetch(`${setup.baseUrl}/api/tools`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      });
      const payload = (await response.json()) as {
        tools: Array<{ name: string }>;
      };

      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      expect(payload.tools.some((tool) => tool.name === "sendNeoN3Gas")).toBe(
        true,
      );
    } finally {
      await closeServer(setup.server);
    }
  });

  it("serves experimental Swagger/OpenAPI docs", async () => {
    const setup = await createTestServer();

    try {
      const response = await fetch(`${setup.baseUrl}/swagger.json`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      });
      const payload = (await response.json()) as {
        info: {
          title: string;
          description: string;
          "x-experimental": boolean;
        };
        paths: Record<string, unknown>;
      };

      expect(response.status).toBe(200);
      expect(payload.info.title).toBe("Neo AI Agent REST API");
      expect(payload.info.description).toContain("Experimental REST API");
      expect(payload.info["x-experimental"]).toBe(true);
      expect(payload.paths["/api/tools/{toolName}"]).toBeDefined();
    } finally {
      await closeServer(setup.server);
    }
  });

  it("prepares and confirms a Neo N3 GAS transfer through HTTP", async () => {
    const setup = await createTestServer();
    const prepareSpy = jest.spyOn(setup.provider, "prepareNeoN3GasTransfer");
    const signSpy = jest.spyOn(setup.provider, "signAndBroadcast");

    try {
      const prepareResponse = await fetch(
        `${setup.baseUrl}/api/tools/sendNeoN3Gas`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            arguments: {
              amount: "0.1",
              to: setup.provider.neoNsName,
            },
          }),
        },
      );
      const preparedPayload = (await prepareResponse.json()) as {
        sessionId: string;
        requiresConfirmation: boolean;
        result: {
          action: string;
        };
      };

      expect(prepareResponse.status).toBe(200);
      expect(preparedPayload.requiresConfirmation).toBe(true);
      expect(preparedPayload.result.action).toBe("sendNeoN3Gas");
      expect(prepareSpy).toHaveBeenCalledWith({
        amount: "0.1",
        to: setup.provider.neoNsName,
      });

      const confirmResponse = await fetch(
        `${setup.baseUrl}/api/sessions/${preparedPayload.sessionId}/confirm`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
          },
        },
      );
      const confirmedPayload = (await confirmResponse.json()) as {
        message: string;
        requiresConfirmation: boolean;
      };

      expect(confirmResponse.status).toBe(200);
      expect(confirmedPayload.requiresConfirmation).toBe(false);
      expect(confirmedPayload.message).toContain(
        "Submitted a Neo N3 GAS transfer",
      );
      expect(signSpy).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(setup.server);
    }
  });

  it("prepares and confirms a Neo X native GAS transfer through HTTP", async () => {
    const setup = await createTestServer();
    const prepareSpy = jest.spyOn(setup.provider, "prepareNeoXNativeTransfer");
    const signSpy = jest.spyOn(setup.provider, "signAndBroadcast");

    try {
      const prepareResponse = await fetch(`${setup.baseUrl}/api/messages`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `prepare 1 GAS on Neo X testnet to ${setup.provider.neoXRecipientAddress}`,
        }),
      });
      const preparedPayload = (await prepareResponse.json()) as {
        sessionId: string;
        tool: string | null;
        requiresConfirmation: boolean;
        result: {
          action: string;
          rpcNetwork?: string;
        };
      };

      expect(prepareResponse.status).toBe(200);
      expect(preparedPayload.tool).toBe("neox_prepare_native_transfer");
      expect(preparedPayload.requiresConfirmation).toBe(true);
      expect(preparedPayload.result.action).toBe(
        "neox_prepare_native_transfer",
      );
      expect(preparedPayload.result.rpcNetwork).toBe("testnet");
      expect(prepareSpy).toHaveBeenCalledWith({
        amount: "1",
        to: setup.provider.neoXRecipientAddress,
        network: "testnet",
      });

      const confirmResponse = await fetch(
        `${setup.baseUrl}/api/sessions/${preparedPayload.sessionId}/confirm`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
          },
        },
      );
      const confirmedPayload = (await confirmResponse.json()) as {
        message: string;
        requiresConfirmation: boolean;
      };

      expect(confirmResponse.status).toBe(200);
      expect(confirmedPayload.requiresConfirmation).toBe(false);
      expect(confirmedPayload.message).toContain("Submitted a Neo X");
      expect(confirmedPayload.message).toContain(
        setup.provider.latestNeoXTxHash,
      );
      expect(signSpy).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(setup.server);
    }
  });

  it("handles natural-language portfolio requests", async () => {
    const setup = await createTestServer();

    try {
      const response = await fetch(`${setup.baseUrl}/api/messages`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "show my portfolio",
        }),
      });
      const payload = (await response.json()) as {
        tool: string | null;
        requiresConfirmation: boolean;
      };

      expect(response.status).toBe(200);
      expect(payload.tool).toBe("getNeoN3PortfolioOverview");
      expect(payload.requiresConfirmation).toBe(false);
    } finally {
      await closeServer(setup.server);
    }
  });

  it("broadcasts a force Flamingo swap through HTTP without a confirmation step", async () => {
    const setup = await createTestServer();
    const prepareSpy = jest.spyOn(setup.provider, "prepareNeoN3TokenSwap");
    const signSpy = jest.spyOn(setup.provider, "signAndBroadcast");

    try {
      const response = await fetch(`${setup.baseUrl}/api/messages`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "swap 1 GAS for FUSD with force and 1% slippage",
        }),
      });
      const payload = (await response.json()) as {
        tool: string | null;
        requiresConfirmation: boolean;
        message: string;
        result: {
          postTransactionBalances: {
            address: string;
            tokens: Array<{
              requestedToken: string;
            }>;
          };
          transactionExplorerUrl: string;
        };
      };

      expect(response.status).toBe(200);
      expect(payload.tool).toBe("swapNeoN3Token");
      expect(payload.requiresConfirmation).toBe(false);
      expect(payload.message).toContain("Force swap requested");
      expect(payload.message).toContain("Submitted a Flamingo swap");
      expect(payload.result).toMatchObject({
        postTransactionBalances: {
          address: setup.provider.neoN3Address,
          tokens: [
            {
              requestedToken: "GAS",
            },
            {
              requestedToken: "FUSD",
            },
          ],
        },
        transactionExplorerUrl: `https://dora.coz.io/transaction/neo3/mainnet/${setup.provider.latestTxHash}`,
      });
      expect(prepareSpy).toHaveBeenCalledWith({
        amount: "1",
        fromToken: "GAS",
        toToken: "FUSD",
        slippagePercent: "1",
        deadlineMinutes: undefined,
        force: true,
      });
      expect(signSpy).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(setup.server);
    }
  });

  it("rejects direct HTTP calls to an unknown tool", async () => {
    const setup = await createTestServer();

    try {
      const response = await fetch(
        `${setup.baseUrl}/api/tools/unsupportedTool`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
        },
      );
      const payload = (await response.json()) as {
        error: {
          code: string;
        };
      };

      expect(response.status).toBe(404);
      expect(payload.error.code).toBe("NOT_FOUND");
    } finally {
      await closeServer(setup.server);
    }
  });

  it("rejects unauthorized requests", async () => {
    const setup = await createTestServer();

    try {
      const response = await fetch(`${setup.baseUrl}/api/tools`);
      const payload = (await response.json()) as {
        error: {
          code: string;
        };
      };

      expect(response.status).toBe(401);
      expect(payload.error.code).toBe("UNAUTHORIZED");
    } finally {
      await closeServer(setup.server);
    }
  });

  it("sanitizes exposed RPC-like secrets in REST error responses", async () => {
    const setup = await createTestServer();

    jest
      .spyOn(setup.provider, "getNeoN3PortfolioOverview")
      .mockRejectedValueOnce(
        new AppError(
          "Upstream RPC failed for https://user:pass@example.com/path?api_key=secret",
          {
            code: "UPSTREAM_RPC_FAILURE",
            statusCode: 502,
            expose: true,
            details: {
              error:
                "https://user:pass@example.com/path?api_key=secret&token=another-secret",
            },
          },
        ),
      );

    try {
      const response = await fetch(`${setup.baseUrl}/api/messages`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "show my portfolio",
        }),
      });
      const payload = (await response.json()) as {
        error: {
          code: string;
          message: string;
          details: {
            error: string;
          };
        };
      };

      expect(response.status).toBe(502);
      expect(payload.error.code).toBe("UPSTREAM_RPC_FAILURE");
      expect(payload.error.message).toBe(
        "Upstream RPC failed for https://********:********@example.com/path?api_key=********",
      );
      expect(payload.error.details.error).toBe(
        "https://********:********@example.com/path?api_key=********&token=********",
      );
    } finally {
      await closeServer(setup.server);
    }
  });

  it("serves public health, readiness, and metrics endpoints", async () => {
    const setup = await createTestServer();

    try {
      const healthResponse = await fetch(`${setup.baseUrl}/health`);
      const healthPayload = (await healthResponse.json()) as {
        status: string;
      };
      const readyResponse = await fetch(`${setup.baseUrl}/ready`);
      const readyPayload = (await readyResponse.json()) as {
        status: string;
        neoN3: {
          rpcHost?: string;
          rpcReachable: boolean;
          networkMatchesConfiguration: boolean;
        };
        neoX: {
          rpcReachable: boolean;
          networkMatchesConfiguration: boolean;
        };
      };
      const metricsResponse = await fetch(`${setup.baseUrl}/metrics`);
      const metricsPayload = (await metricsResponse.json()) as {
        api: {
          total: number;
        };
        agent: {
          transactionsPreparedTotal: number;
          transactionsSubmittedTotal: number;
        };
      };

      expect(healthResponse.status).toBe(200);
      expect(healthResponse.headers.get("x-request-id")).toBeTruthy();
      expect(healthPayload.status).toBe("ok");
      expect(readyResponse.status).toBe(200);
      expect(readyPayload.status).toBe("ready");
      expect(readyPayload.neoN3.rpcReachable).toBe(true);
      expect(readyPayload.neoN3.networkMatchesConfiguration).toBe(true);
      expect(readyPayload.neoN3.rpcHost).toBe("n3.example.com");
      expect(JSON.stringify(readyPayload)).not.toContain("https://");
      expect(readyPayload.neoX.rpcReachable).toBe(true);
      expect(readyPayload.neoX.networkMatchesConfiguration).toBe(true);
      expect(metricsResponse.status).toBe(200);
      expect(metricsPayload.api.total).toBeGreaterThanOrEqual(2);
      expect(
        metricsPayload.agent.transactionsPreparedTotal,
      ).toBeGreaterThanOrEqual(0);
      expect(
        metricsPayload.agent.transactionsSubmittedTotal,
      ).toBeGreaterThanOrEqual(0);
    } finally {
      await closeServer(setup.server);
    }
  });

  it("keeps readiness healthy when Neo X is not configured", async () => {
    const setup = await createTestServer();
    const readinessSpy = jest.spyOn(setup.provider, "checkReadiness");

    readinessSpy.mockResolvedValueOnce({
      neoN3: {
        network: "neoN3",
        enabled: true,
        configuredNetwork: "mainnet",
        rpcUrlAlias: "NEO_N3_RPC_URL",
        rpcHost: "n3.example.com",
        rpcReachable: true,
        networkMagic: 860_833_102,
        networkMatchesConfiguration: true,
        walletEnabled: true,
        walletAddress: setup.provider.neoN3Address,
      },
      neoX: {
        network: "neoX",
        enabled: false,
        configuredNetwork: "mainnet",
        rpcUrlAlias: "NEOX_MAINNET_RPC_URL",
        rpcReachable: false,
        configuredChainId: 47_763,
        networkMatchesConfiguration: false,
        walletEnabled: false,
        reason: "Neo X mainnet RPC is not configured.",
      },
    });

    try {
      const response = await fetch(`${setup.baseUrl}/ready`);
      const payload = (await response.json()) as {
        status: string;
        neoX: {
          enabled: boolean;
          rpcReachable: boolean;
        };
      };

      expect(response.status).toBe(200);
      expect(payload.status).toBe("ready");
      expect(payload.neoX.enabled).toBe(false);
      expect(payload.neoX.rpcReachable).toBe(false);
    } finally {
      await closeServer(setup.server);
    }
  });

  it("reports readiness failures when the Neo RPC network does not match configuration", async () => {
    const setup = await createTestServer();
    const readinessSpy = jest.spyOn(setup.provider, "checkReadiness");

    readinessSpy.mockResolvedValueOnce({
      neoN3: {
        network: "neoN3",
        enabled: true,
        configuredNetwork: "mainnet",
        rpcUrlAlias: "NEO_N3_RPC_URL",
        rpcHost: "n3.example.com",
        rpcReachable: true,
        networkMagic: 894_710_606,
        networkMatchesConfiguration: false,
        walletEnabled: true,
        walletAddress: setup.provider.neoN3Address,
        reason:
          "Configured Neo N3 mainnet network does not match the connected RPC network magic.",
      },
      neoX: {
        network: "neoX",
        enabled: true,
        configuredNetwork: "testnet",
        rpcUrlAlias: "NEOX_TESTNET_RPC_URL",
        rpcHost: "x.example.com",
        rpcReachable: true,
        chainId: 12_227_332,
        configuredChainId: 12_227_332,
        networkMatchesConfiguration: true,
        walletEnabled: true,
        walletAddress: setup.provider.neoXAddress,
      },
    });

    try {
      const response = await fetch(`${setup.baseUrl}/ready`);
      const payload = (await response.json()) as {
        error: {
          code: string;
          details: {
            reason: string;
            readiness: {
              neoN3: {
                rpcHost?: string;
              };
            };
          };
        };
      };

      expect(response.status).toBe(503);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      expect(payload.error.code).toBe("NOT_READY");
      expect(payload.error.details.reason).toContain(
        "Configured Neo N3 mainnet network does not match",
      );
      expect(payload.error.details.readiness.neoN3.rpcHost).toBe(
        "n3.example.com",
      );
    } finally {
      await closeServer(setup.server);
    }
  });

  it("tracks transaction lifecycle telemetry for prepared and submitted actions", async () => {
    const setup = await createTestServer();

    try {
      const prepareResponse = await fetch(
        `${setup.baseUrl}/api/tools/sendNeoN3Gas`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            arguments: {
              amount: "0.1",
              to: setup.provider.neoNsName,
            },
          }),
        },
      );
      const preparedPayload = (await prepareResponse.json()) as {
        sessionId: string;
      };

      await fetch(
        `${setup.baseUrl}/api/sessions/${preparedPayload.sessionId}/confirm`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
          },
        },
      );

      const metricsResponse = await fetch(`${setup.baseUrl}/metrics`);
      const metricsPayload = (await metricsResponse.json()) as {
        agent: {
          transactionsPreparedTotal: number;
          transactionsSubmittedTotal: number;
          transactionsByTool: Record<string, number>;
        };
      };

      expect(
        metricsPayload.agent.transactionsPreparedTotal,
      ).toBeGreaterThanOrEqual(1);
      expect(
        metricsPayload.agent.transactionsSubmittedTotal,
      ).toBeGreaterThanOrEqual(1);
      expect(
        metricsPayload.agent.transactionsByTool.sendNeoN3Gas,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      await closeServer(setup.server);
    }
  });
});

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { PlannerService } from "../src/agent/planner";
import { AgentRuntime } from "../src/agent/runtime";
import { SessionStore } from "../src/agent/sessionStore";
import { ToolRegistry } from "../src/agent/toolRegistry";
import { createApiServer } from "../src/api/server";
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
          address: string;
          tokens: Array<{
            requestedToken: string;
          }>;
        };
      };

      expect(response.status).toBe(200);
      expect(payload.tool).toBe("swapNeoN3Token");
      expect(payload.requiresConfirmation).toBe(false);
      expect(payload.message).toContain("Force swap requested");
      expect(payload.message).toContain("Submitted a Flamingo swap");
      expect(payload.result).toMatchObject({
        address: setup.provider.neoN3Address,
        tokens: [
          {
            requestedToken: "GAS",
          },
          {
            requestedToken: "FUSD",
          },
        ],
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
        neo: {
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
      expect(readyPayload.neo.rpcReachable).toBe(true);
      expect(readyPayload.neo.networkMatchesConfiguration).toBe(true);
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

  it("reports readiness failures when the Neo RPC network does not match configuration", async () => {
    const setup = await createTestServer();
    const readinessSpy = jest.spyOn(setup.provider, "checkReadiness");

    readinessSpy.mockResolvedValueOnce({
      network: "neoN3",
      configuredNetwork: "mainnet",
      rpcUrl: "https://n3.example.com",
      rpcReachable: true,
      networkMagic: 894_710_606,
      networkMatchesConfiguration: false,
      walletEnabled: true,
      walletAddress: setup.provider.neoN3Address,
    });

    try {
      const response = await fetch(`${setup.baseUrl}/ready`);
      const payload = (await response.json()) as {
        error: {
          code: string;
        };
      };

      expect(response.status).toBe(503);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      expect(payload.error.code).toBe("NOT_READY");
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

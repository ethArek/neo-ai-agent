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
      const response = await fetch(`${setup.baseUrl}/health`);
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
});

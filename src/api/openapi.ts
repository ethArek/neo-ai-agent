import type { ToolRegistry } from "../agent/toolRegistry";

function createAgentResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: [
      "sessionId",
      "message",
      "tool",
      "arguments",
      "result",
      "requiresConfirmation",
    ],
    properties: {
      sessionId: {
        type: "string",
        description:
          "Session identifier used for follow-up confirmation or cancellation.",
      },
      message: {
        type: "string",
      },
      tool: {
        type: ["string", "null"],
      },
      arguments: {
        type: "object",
        additionalProperties: true,
      },
      result: {
        description:
          "Tool-specific payload. This field is intentionally flexible.",
        nullable: true,
      },
      requiresConfirmation: {
        type: "boolean",
      },
    },
  };
}

function createToolDescriptorSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: [
      "name",
      "description",
      "argumentsDescription",
      "readOnly",
      "dangerous",
      "networks",
    ],
    properties: {
      name: {
        type: "string",
      },
      description: {
        type: "string",
      },
      argumentsDescription: {
        type: "string",
      },
      readOnly: {
        type: "boolean",
      },
      dangerous: {
        type: "boolean",
      },
      networks: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
  };
}

function createErrorSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["message", "code", "statusCode"],
        properties: {
          message: {
            type: "string",
          },
          code: {
            type: "string",
          },
          statusCode: {
            type: "integer",
          },
          details: {
            description: "Optional validation or provider-specific details.",
            nullable: true,
          },
        },
      },
    },
  };
}

function createServerList(baseUrl?: string): Array<Record<string, unknown>> {
  if (!baseUrl) {
    return [];
  }

  return [
    {
      url: baseUrl,
      description: "Current server",
    },
  ];
}

export function buildOpenApiDocument(
  registry: ToolRegistry,
  baseUrl?: string,
): Record<string, unknown> {
  const toolNames = registry.listToolNames();

  return {
    openapi: "3.1.0",
    info: {
      title: "Neo AI Agent REST API",
      version: "1.0.0",
      description:
        "Experimental REST API for Neo AI Agent. Route shapes, payloads, and in-memory session behavior may change.",
      "x-experimental": true,
    },
    servers: createServerList(baseUrl),
    tags: [
      {
        name: "Experimental",
        description:
          "This API surface is experimental. Confirm contracts and payloads before building long-term integrations.",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque token",
          description:
            "Send this header when API_BEARER_TOKEN is configured on the server.",
        },
      },
      schemas: {
        AgentResponse: createAgentResponseSchema(),
        ToolDescriptor: createToolDescriptorSchema(),
        ErrorResponse: createErrorSchema(),
        MessageRequest: {
          type: "object",
          required: ["message"],
          properties: {
            message: {
              type: "string",
              minLength: 1,
            },
            sessionId: {
              type: "string",
            },
          },
        },
        ToolExecutionRequest: {
          type: "object",
          properties: {
            arguments: {
              type: "object",
              additionalProperties: true,
              default: {},
            },
            sessionId: {
              type: "string",
            },
            confirm: {
              type: "boolean",
            },
          },
        },
        HealthResponse: {
          type: "object",
          required: ["status", "toolCount"],
          properties: {
            status: {
              type: "string",
              enum: ["ok"],
            },
            toolCount: {
              type: "integer",
            },
          },
        },
        ReadinessResponse: {
          type: "object",
          required: ["status", "neo", "sessions", "toolCount"],
          properties: {
            status: {
              type: "string",
              enum: ["ready"],
            },
            neo: {
              type: "object",
              required: [
                "network",
                "configuredNetwork",
                "rpcUrl",
                "rpcReachable",
                "networkMatchesConfiguration",
                "walletEnabled",
              ],
              properties: {
                network: {
                  type: "string",
                },
                configuredNetwork: {
                  type: "string",
                },
                rpcUrl: {
                  type: "string",
                },
                rpcReachable: {
                  type: "boolean",
                },
                networkMagic: {
                  type: "integer",
                  nullable: true,
                },
                networkMatchesConfiguration: {
                  type: "boolean",
                },
                walletEnabled: {
                  type: "boolean",
                },
                walletAddress: {
                  type: "string",
                  nullable: true,
                },
              },
            },
            sessions: {
              type: "object",
              required: [
                "activeSessions",
                "pendingActions",
                "draftActions",
                "recentBroadcasts",
                "maxAgeMs",
              ],
              properties: {
                activeSessions: {
                  type: "integer",
                },
                pendingActions: {
                  type: "integer",
                },
                draftActions: {
                  type: "integer",
                },
                recentBroadcasts: {
                  type: "integer",
                },
                maxAgeMs: {
                  type: "integer",
                },
              },
            },
            toolCount: {
              type: "integer",
            },
          },
        },
        MetricsResponse: {
          type: "object",
          required: ["generatedAt", "api", "agent", "runtime"],
          properties: {
            generatedAt: {
              type: "string",
            },
            api: {
              type: "object",
              additionalProperties: true,
            },
            agent: {
              type: "object",
              additionalProperties: true,
            },
            runtime: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
        ToolsResponse: {
          type: "object",
          required: ["tools"],
          properties: {
            tools: {
              type: "array",
              items: {
                $ref: "#/components/schemas/ToolDescriptor",
              },
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    paths: {
      "/health": {
        get: {
          tags: ["Experimental"],
          summary: "Health check",
          description:
            "Returns a public liveness payload for the REST API process.",
          security: [],
          responses: {
            "200": {
              description: "API is healthy.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/HealthResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/ready": {
        get: {
          tags: ["Experimental"],
          summary: "Readiness check",
          description:
            "Returns a public readiness payload that validates Neo RPC connectivity and basic runtime state.",
          security: [],
          responses: {
            "200": {
              description: "API is ready to serve requests.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ReadinessResponse",
                  },
                },
              },
            },
            "503": {
              description: "API is not ready.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/metrics": {
        get: {
          tags: ["Experimental"],
          summary: "Operational metrics",
          description:
            "Returns an in-memory operational snapshot for request handling, tool execution, and transaction lifecycle telemetry.",
          security: [],
          responses: {
            "200": {
              description: "Operational metrics snapshot.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/MetricsResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          tags: ["Experimental"],
          summary: "OpenAPI document",
          description:
            "Returns the experimental OpenAPI document for this REST API.",
          responses: {
            "200": {
              description: "OpenAPI document.",
            },
          },
        },
      },
      "/swagger.json": {
        get: {
          tags: ["Experimental"],
          summary: "Swagger document alias",
          description:
            "Returns the same experimental OpenAPI document as /openapi.json.",
          responses: {
            "200": {
              description: "OpenAPI document.",
            },
          },
        },
      },
      "/api/tools": {
        get: {
          tags: ["Experimental"],
          summary: "List tools",
          description:
            "Returns the currently implemented Neo tools available through the agent, including the networks each tool supports.",
          responses: {
            "200": {
              description: "Tool registry.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ToolsResponse",
                  },
                },
              },
            },
            "401": {
              description: "Bearer token is missing or invalid.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/messages": {
        post: {
          tags: ["Experimental"],
          summary: "Send a natural-language request",
          description:
            "Plans and executes a natural-language Neo request using the current in-memory session context and the currently implemented networks.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/MessageRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Agent response.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AgentResponse",
                  },
                },
              },
            },
            "400": {
              description: "Validation error.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            "401": {
              description: "Bearer token is missing or invalid.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/tools/{toolName}": {
        post: {
          tags: ["Experimental"],
          summary: "Execute a tool directly",
          description:
            "Executes a specific tool directly. Dangerous tools prepare first and may require a later confirmation call.",
          parameters: [
            {
              name: "toolName",
              in: "path",
              required: true,
              schema: {
                type: "string",
                enum: toolNames,
              },
            },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ToolExecutionRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Tool response.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AgentResponse",
                  },
                },
              },
            },
            "400": {
              description: "Validation error.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            "401": {
              description: "Bearer token is missing or invalid.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            "404": {
              description: "Tool name is not registered.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/sessions/{sessionId}/confirm": {
        post: {
          tags: ["Experimental"],
          summary: "Confirm a pending action",
          description:
            "Confirms the current pending action for a session and broadcasts it when applicable.",
          parameters: [
            {
              name: "sessionId",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          responses: {
            "200": {
              description: "Confirmed response.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AgentResponse",
                  },
                },
              },
            },
            "401": {
              description: "Bearer token is missing or invalid.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/sessions/{sessionId}/cancel": {
        post: {
          tags: ["Experimental"],
          summary: "Cancel a pending or draft action",
          description:
            "Cancels the current pending transaction or incomplete draft request for a session.",
          parameters: [
            {
              name: "sessionId",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          responses: {
            "200": {
              description: "Canceled response.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AgentResponse",
                  },
                },
              },
            },
            "401": {
              description: "Bearer token is missing or invalid.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

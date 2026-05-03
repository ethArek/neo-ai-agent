import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { z } from "zod";

import type { AgentRuntime } from "../agent/runtime";
import type { ToolRegistry } from "../agent/toolRegistry";
import { type ToolName, toolNames } from "../agent/types";
import { AppError, NotFoundError, serializeError } from "../core/errors";
import { logger } from "../core/logger";
import { telemetry } from "../core/telemetry";
import { buildOpenApiDocument } from "./openapi";

const jsonContentType = "application/json; charset=utf-8";
const maxBodySizeBytes = 1024 * 1024;

const messageRequestSchema = z.object({
  message: z.string().trim().min(1, "message is required."),
  sessionId: z.string().trim().min(1).optional(),
});

const toolExecutionRequestSchema = z.object({
  arguments: z.record(z.string(), z.unknown()).default({}),
  sessionId: z.string().trim().min(1).optional(),
  confirm: z.boolean().optional(),
});

interface ApiServerOptions {
  runtime: AgentRuntime;
  registry: ToolRegistry;
  host: string;
  port: number;
  bearerToken?: string;
}

interface RequestContext {
  request: IncomingMessage;
  path: string;
  method: string;
  requestId: string;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": jsonContentType,
    "Content-Length": Buffer.byteLength(body).toString(),
  });
  response.end(body);
}

function getAuthorizationToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;

  if (!header) {
    return undefined;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return undefined;
  }

  return match[1].trim();
}

function getBaseUrl(request: IncomingMessage): string {
  const protocolHeader = request.headers["x-forwarded-proto"];
  const protocol =
    typeof protocolHeader === "string" && protocolHeader.trim() !== ""
      ? protocolHeader.split(",")[0].trim()
      : "http";

  return `${protocol}://${request.headers.host ?? "localhost"}`;
}

function getOrCreateRequestId(request: IncomingMessage): string {
  const header = request.headers["x-request-id"];

  if (typeof header === "string" && header.trim() !== "") {
    return header.trim();
  }

  return randomUUID();
}

function isPublicRoute(method: string, path: string): boolean {
  return (
    method === "GET" &&
    (path === "/health" || path === "/ready" || path === "/metrics")
  );
}

function assertAuthorized(
  request: IncomingMessage,
  bearerToken?: string,
): void {
  if (!bearerToken) {
    return;
  }

  const providedToken = getAuthorizationToken(request);

  if (providedToken === bearerToken) {
    return;
  }

  throw new AppError("Unauthorized.", {
    code: "UNAUTHORIZED",
    statusCode: 401,
    expose: true,
  });
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalSize = 0;

  for await (const chunk of request) {
    const bufferChunk = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk));

    totalSize += bufferChunk.length;

    if (totalSize > maxBodySizeBytes) {
      throw new AppError("Request body exceeds 1 MB.", {
        code: "PAYLOAD_TOO_LARGE",
        statusCode: 413,
        expose: true,
      });
    }

    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();

  if (rawBody === "") {
    return {};
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new AppError("Request body must be a JSON object.", {
        code: "INVALID_JSON_BODY",
        statusCode: 400,
        expose: true,
      });
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("Request body must contain valid JSON.", {
      code: "INVALID_JSON_BODY",
      statusCode: 400,
      expose: true,
    });
  }
}

function getToolName(segment: string): ToolName {
  if (toolNames.includes(segment as ToolName)) {
    return segment as ToolName;
  }

  throw new NotFoundError(`Tool '${segment}' is not registered.`);
}

async function handleHealth(
  response: ServerResponse,
  registry: ToolRegistry,
): Promise<void> {
  sendJson(response, 200, {
    status: "ok",
    toolCount: registry.listToolNames().length,
  });
}

async function handleReady(
  response: ServerResponse,
  runtime: AgentRuntime,
): Promise<void> {
  try {
    const readiness = await runtime.getReadinessStatus();
    const failedNetworks = [readiness.neoN3, readiness.neoX].filter(
      (entry) =>
        entry.enabled !== false &&
        (!entry.rpcReachable || !entry.networkMatchesConfiguration),
    );

    if (failedNetworks.length > 0) {
      throw new AppError("Service is not ready.", {
        code: "NOT_READY",
        statusCode: 503,
        expose: true,
        details: {
          reason:
            failedNetworks[0]?.reason ??
            "One or more configured networks are not ready.",
          readiness,
        },
      });
    }

    sendJson(response, 200, {
      status: "ready",
      ...readiness,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_READY") {
      throw error;
    }

    throw new AppError("Service is not ready.", {
      code: "NOT_READY",
      statusCode: 503,
      expose: true,
      details: {
        error: error instanceof Error ? error.message : error,
      },
    });
  }
}

async function handleMetrics(
  response: ServerResponse,
  runtime: AgentRuntime,
): Promise<void> {
  sendJson(response, 200, {
    ...telemetry.snapshot(),
    runtime: runtime.getOperationalSnapshot(),
  });
}

async function handleTools(
  response: ServerResponse,
  registry: ToolRegistry,
): Promise<void> {
  sendJson(response, 200, {
    tools: registry.listPlannerTools(),
  });
}

async function handleOpenApiDocument(
  request: IncomingMessage,
  response: ServerResponse,
  registry: ToolRegistry,
): Promise<void> {
  sendJson(response, 200, buildOpenApiDocument(registry, getBaseUrl(request)));
}

async function handleMessage(
  context: RequestContext,
  response: ServerResponse,
  runtime: AgentRuntime,
): Promise<void> {
  const payload = messageRequestSchema.parse(
    await readJsonBody(context.request),
  );
  const result = await runtime.handleMessage(
    payload.message,
    payload.sessionId,
  );
  sendJson(response, 200, result);
}

async function handleToolExecution(
  context: RequestContext,
  response: ServerResponse,
  runtime: AgentRuntime,
): Promise<void> {
  const toolName = getToolName(context.path.slice("/api/tools/".length));
  const payload = toolExecutionRequestSchema.parse(
    await readJsonBody(context.request),
  );
  const result = await runtime.executeTool({
    tool: toolName,
    arguments: payload.arguments,
    sessionId: payload.sessionId,
    confirm: payload.confirm,
  });
  sendJson(response, 200, result);
}

async function handleSessionAction(
  context: RequestContext,
  response: ServerResponse,
  runtime: AgentRuntime,
): Promise<void> {
  const match = context.path.match(
    /^\/api\/sessions\/([^/]+)\/(confirm|cancel)$/,
  );

  if (!match) {
    throw new NotFoundError("Route not found.");
  }

  const sessionId = decodeURIComponent(match[1]);
  const action = match[2] === "confirm" ? "Confirm" : "Cancel";
  const result = await runtime.handleMessage(action, sessionId);
  sendJson(response, 200, result);
}

async function routeRequest(
  context: RequestContext,
  response: ServerResponse,
  runtime: AgentRuntime,
  registry: ToolRegistry,
): Promise<void> {
  if (context.method === "GET" && context.path === "/health") {
    await handleHealth(response, registry);

    return;
  }

  if (context.method === "GET" && context.path === "/ready") {
    await handleReady(response, runtime);

    return;
  }

  if (context.method === "GET" && context.path === "/metrics") {
    await handleMetrics(response, runtime);

    return;
  }

  if (
    context.method === "GET" &&
    (context.path === "/openapi.json" || context.path === "/swagger.json")
  ) {
    await handleOpenApiDocument(context.request, response, registry);

    return;
  }

  if (context.method === "GET" && context.path === "/api/tools") {
    await handleTools(response, registry);

    return;
  }

  if (context.method === "POST" && context.path === "/api/messages") {
    await handleMessage(context, response, runtime);

    return;
  }

  if (context.method === "POST" && context.path.startsWith("/api/tools/")) {
    await handleToolExecution(context, response, runtime);

    return;
  }

  if (
    context.method === "POST" &&
    /^\/api\/sessions\/[^/]+\/(confirm|cancel)$/.test(context.path)
  ) {
    await handleSessionAction(context, response, runtime);

    return;
  }

  throw new NotFoundError("Route not found.");
}

export function createApiServer(options: ApiServerOptions): Server {
  return createServer(async (request, response) => {
    const method = request.method?.toUpperCase() ?? "GET";
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    const path = url.pathname;
    const requestId = getOrCreateRequestId(request);
    const requestStartedAt = process.hrtime.bigint();
    let statusCode = 500;

    response.setHeader("X-Request-Id", requestId);

    try {
      if (!isPublicRoute(method, path)) {
        assertAuthorized(request, options.bearerToken);
      }

      await routeRequest(
        {
          request,
          path,
          method,
          requestId,
        },
        response,
        options.runtime,
        options.registry,
      );
      statusCode = response.statusCode || 200;
    } catch (error) {
      const serialized = serializeError(error);

      statusCode = serialized.statusCode;
      logger.error("REST API request failed.", {
        requestId,
        method,
        path,
        statusCode: serialized.statusCode,
        code: serialized.code,
        error: error instanceof Error ? error.message : error,
      });

      sendJson(response, serialized.statusCode, {
        error: serialized,
      });
    } finally {
      const durationMs =
        Number(process.hrtime.bigint() - requestStartedAt) / 1_000_000;

      telemetry.recordApiRequest({
        name: `${method} ${path}`,
        statusCode,
        durationMs,
      });

      if (statusCode >= 500) {
        logger.error("REST API request completed with server error.", {
          requestId,
          method,
          path,
          statusCode,
          durationMs,
        });
      } else if (statusCode >= 400) {
        logger.warn("REST API request completed with client error.", {
          requestId,
          method,
          path,
          statusCode,
          durationMs,
        });
      } else {
        logger.info("REST API request completed.", {
          requestId,
          method,
          path,
          statusCode,
          durationMs,
        });
      }
    }
  });
}

export async function startApiServer(
  options: ApiServerOptions,
): Promise<Server> {
  const server = createApiServer(options);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

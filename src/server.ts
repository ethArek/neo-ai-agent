#!/usr/bin/env node

import { loadConfig } from "./core/config";
import { logger } from "./core/logger";
import { createAgentApp } from "./app/createAgentApp";
import { startApiServer } from "./api/server";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = createAgentApp(config);

  logger.warn("Neo AI Agent REST API is experimental and may change.");

  if (config.walletEnabled && !config.api.bearerToken) {
    logger.warn(
      "REST API is starting without API_BEARER_TOKEN while wallet mode is enabled.",
    );
  }

  const server = await startApiServer({
    runtime: app.runtime,
    registry: app.registry,
    host: config.api.host,
    port: config.port,
    bearerToken: config.api.bearerToken,
  });

  logger.info("Neo AI Agent REST API is listening.", {
    host: config.api.host,
    port: config.port,
    walletEnabled: config.walletEnabled,
    bearerTokenEnabled: Boolean(config.api.bearerToken),
  });

  const shutdown = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  process.on("SIGINT", () => {
    shutdown()
      .catch((error: unknown) => {
        logger.error("Failed to stop REST API cleanly.", {
          error: error instanceof Error ? error.message : error,
        });
      })
      .finally(() => {
        process.exit(0);
      });
  });

  process.on("SIGTERM", () => {
    shutdown()
      .catch((error: unknown) => {
        logger.error("Failed to stop REST API cleanly.", {
          error: error instanceof Error ? error.message : error,
        });
      })
      .finally(() => {
        process.exit(0);
      });
  });
}

main().catch((error: unknown) => {
  logger.error("Neo AI Agent REST API failed.", {
    error: error instanceof Error ? error.message : error,
  });

  process.exitCode = 1;
});

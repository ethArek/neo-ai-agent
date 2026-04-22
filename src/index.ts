#!/usr/bin/env node

import { createAgentApp } from "./app/createAgentApp";
import { runCli } from "./cli/runner";
import { createCliTheme } from "./cli/theme";
import { loadConfig } from "./core/config";
import { logger } from "./core/logger";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = createAgentApp(config);

  await runCli(app.runtime, process.argv.slice(2));
}

main().catch((error: unknown) => {
  const theme = createCliTheme();
  logger.error("Neo AI Agent CLI failed.", {
    error: error instanceof Error ? error.message : error,
  });

  if (error instanceof Error) {
    process.stderr.write(`${theme.renderError(error.message)}\n`);
  } else {
    process.stderr.write(`${theme.renderError("Unknown error.")}\n`);
  }

  process.exitCode = 1;
});

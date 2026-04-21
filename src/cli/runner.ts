import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command, InvalidArgumentError } from "commander";

import type { AgentRuntime } from "../agent/runtime";
import { toolNames } from "../agent/types";
import type { ToolName } from "../agent/types";
import {
  buildConfirmationGuidance,
  type ConfirmationMode,
} from "./confirmation";
import { createCliTheme } from "./theme";

function renderConfirmationLine(
  line: string,
  theme: ReturnType<typeof createCliTheme>,
): string {
  if (line.startsWith("Next step:")) {
    return theme.renderSuccess(line);
  }

  return theme.renderMuted(line);
}

function printResponse(
  response: unknown,
  json: boolean,
  colorEnabled: boolean,
  confirmationMode: ConfirmationMode,
): void {
  const theme = createCliTheme(colorEnabled);

  if (json) {
    output.write(`${JSON.stringify(response, null, 2)}\n`);

    return;
  }

  if (
    typeof response === "object" &&
    response !== null &&
    "message" in response
  ) {
    const typedResponse = response as {
      message: string;
      tool?: string | null;
      requiresConfirmation?: boolean;
      result?: unknown;
    };

    output.write(`${theme.renderPrimaryMessage(typedResponse.message)}\n`);

    if (typedResponse.tool) {
      output.write(`${theme.renderLabel("Tool", typedResponse.tool)}\n`);
    }

    if (typedResponse.result !== undefined && typedResponse.result !== null) {
      output.write(`${theme.renderSectionTitle("Result")}\n`);
      output.write(`${theme.renderJson(typedResponse.result)}\n`);
    }

    if (typedResponse.requiresConfirmation) {
      const guidance = buildConfirmationGuidance(confirmationMode);

      output.write(`${theme.renderWarning("Requires confirmation: yes")}\n`);
      output.write(`${theme.renderSectionTitle(guidance.title)}\n`);
      output.write(`${theme.renderWarning(guidance.lines[0])}\n`);

      for (const line of guidance.lines.slice(1)) {
        output.write(`${renderConfirmationLine(line, theme)}\n`);
      }
    }

    return;
  }

  output.write(`${theme.renderJson(response)}\n`);
}

async function runInteractive(
  runtime: AgentRuntime,
  json: boolean,
  colorEnabled: boolean,
): Promise<void> {
  const theme = createCliTheme(colorEnabled);
  const readline = createInterface({
    input,
    output,
  });
  let done = false;
  let sessionId: string | undefined;

  output.write(`${theme.renderBanner()}\n`);
  output.write(
    `${theme.renderMuted("Type 'exit' to quit. Type 'Confirm' or 'Cancel' for pending actions.")}\n`,
  );

  while (!done) {
    const line = (await readline.question(theme.renderPrompt())).trim();

    if (line === "") {
      continue;
    }

    if (/^(exit|quit)$/i.test(line)) {
      done = true;
      continue;
    }

    const response = await runtime.handleMessage(line, sessionId);
    sessionId = response.sessionId;
    printResponse(response, json, colorEnabled, "interactive");
  }

  readline.close();
}

function isToolName(value: string): value is ToolName {
  return toolNames.includes(value as ToolName);
}

function parseToolName(value: string): ToolName {
  if (!isToolName(value)) {
    throw new InvalidArgumentError(
      `Unsupported tool '${value}'. Supported tools: ${toolNames.join(", ")}`,
    );
  }

  return value;
}

function parseJsonArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("Arguments must be a JSON object.");
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new InvalidArgumentError(
      error instanceof Error
        ? error.message
        : "Failed to parse JSON arguments.",
    );
  }
}

async function handleNaturalLanguageRequest(
  runtime: AgentRuntime,
  messageParts: string[],
  json: boolean,
  colorEnabled: boolean,
): Promise<void> {
  if (messageParts.length === 0) {
    return;
  }

  const response = await runtime.handleMessage(messageParts.join(" "));
  printResponse(response, json, colorEnabled, "one-shot");
}

export async function runCli(
  runtime: AgentRuntime,
  argv: string[],
): Promise<void> {
  const theme = createCliTheme();
  const program = new Command();

  program
    .name("neo-ai-agent")
    .description("CLI-first Neo AI agent with confirmation-safe write actions.")
    .showHelpAfterError()
    .configureOutput({
      outputError: (message, write) => {
        write(theme.renderError(message));
      },
    })
    .argument("[message...]", "Natural-language request to the agent")
    .option("--json", "Print the full response as JSON")
    .action(async (messageParts: string[], options: { json?: boolean }) => {
      if (messageParts.length === 0) {
        program.help();
      }

      await handleNaturalLanguageRequest(
        runtime,
        messageParts,
        Boolean(options.json),
        theme.colorEnabled,
      );
    });

  program
    .command("interactive")
    .description("Start an interactive CLI session with confirmation support")
    .option("--json", "Print the full response as JSON")
    .action(async (options: { json?: boolean }) => {
      await runInteractive(runtime, Boolean(options.json), theme.colorEnabled);
    });

  program
    .command("tool")
    .description("Execute a tool directly")
    .argument("<name>", "Tool name", parseToolName)
    .option("--args <json>", "JSON object with tool arguments", "{}")
    .option("--confirm", "Confirm a previously prepared write action")
    .option("--json", "Print the full response as JSON")
    .action(
      async (
        tool: ToolName,
        options: { args: string; confirm?: boolean; json?: boolean },
      ) => {
        const response = await runtime.executeTool({
          tool,
          arguments: parseJsonArguments(options.args),
          confirm: Boolean(options.confirm),
        });

        printResponse(
          response,
          Boolean(options.json),
          theme.colorEnabled,
          "one-shot",
        );
      },
    );

  await program.parseAsync(argv, {
    from: "user",
  });
}

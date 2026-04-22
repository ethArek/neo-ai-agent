jest.mock("node:readline/promises", () => ({
  createInterface: jest.fn(),
}));

import { createInterface } from "node:readline/promises";

import { PlannerService } from "../src/agent/planner";
import { AgentRuntime } from "../src/agent/runtime";
import { SessionStore } from "../src/agent/sessionStore";
import { ToolRegistry } from "../src/agent/toolRegistry";
import { runCli } from "../src/cli/runner";
import { ValidationError } from "../src/core/errors";
import { FakeNeoProvider } from "./helpers/fakeNeoProvider";

function createRuntime(): AgentRuntime {
  const registry = new ToolRegistry();

  return new AgentRuntime({
    planner: new PlannerService({
      tools: registry.listPlannerTools(),
    }),
    registry,
    neo: new FakeNeoProvider(),
    sessions: new SessionStore(),
  });
}

describe("runCli", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("keeps interactive mode alive after a failed request and shows the error", async () => {
    const readline = {
      question: jest
        .fn<Promise<string>, [string]>()
        .mockResolvedValueOnce("show unclaimed gas for arkadiusz.neo")
        .mockResolvedValueOnce("exit"),
      close: jest.fn(),
    } satisfies {
      question: (prompt: string) => Promise<string>;
      close: () => void;
    };
    const stderrWriteSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdoutWriteSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const runtime = createRuntime();

    jest
      .mocked(createInterface)
      .mockReturnValue(
        readline as unknown as ReturnType<typeof createInterface>,
      );
    jest
      .spyOn(runtime, "handleMessage")
      .mockRejectedValueOnce(
        new ValidationError("NeoNS name 'arkadiusz.neo' has expired."),
      );

    await expect(runCli(runtime, ["interactive"])).resolves.toBeUndefined();

    expect(stderrWriteSpy).toHaveBeenCalledWith(
      expect.stringContaining("NeoNS name 'arkadiusz.neo' has expired."),
    );
    expect(readline.question).toHaveBeenCalledTimes(2);
    expect(readline.close).toHaveBeenCalledTimes(1);
    expect(stdoutWriteSpy).toHaveBeenCalled();
  });

  it("shows a spinner while waiting for a long-running CLI request", async () => {
    jest.useFakeTimers();

    const stdoutWriteSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const runtime = createRuntime();
    const ttyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY",
    );

    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    jest.spyOn(runtime, "handleMessage").mockImplementation(
      async () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              sessionId: "session-1",
              message: "Loaded your portfolio.",
              tool: "getNeoN3PortfolioOverview",
              arguments: {},
              result: null,
              requiresConfirmation: false,
            });
          }, 300);
        }),
    );

    try {
      const runPromise = runCli(runtime, ["show", "my", "portfolio"]);

      await jest.advanceTimersByTimeAsync(150);

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        expect.stringContaining("Working on your Neo request"),
      );

      await jest.advanceTimersByTimeAsync(250);
      await expect(runPromise).resolves.toBeUndefined();
    } finally {
      if (ttyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", ttyDescriptor);
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      }
    }
  });
});

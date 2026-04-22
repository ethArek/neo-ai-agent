interface DurationSummary {
  count: number;
  totalMs: number;
  maxMs: number;
}

interface CounterSnapshot {
  total: number;
  failures: number;
  byName: Record<string, number>;
  durationsMs: DurationSummary & {
    averageMs: number;
  };
}

function createCounterSnapshot(): CounterSnapshot {
  return {
    total: 0,
    failures: 0,
    byName: {},
    durationsMs: {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      averageMs: 0,
    },
  };
}

function incrementCounter(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function recordDuration(summary: DurationSummary, durationMs: number): void {
  summary.count += 1;
  summary.totalMs += durationMs;
  summary.maxMs = Math.max(summary.maxMs, durationMs);
}

function toDurationSnapshot(summary: DurationSummary): DurationSummary & {
  averageMs: number;
} {
  return {
    ...summary,
    averageMs:
      summary.count === 0
        ? 0
        : Number((summary.totalMs / summary.count).toFixed(2)),
  };
}

export interface TelemetrySnapshot {
  generatedAt: string;
  api: CounterSnapshot & {
    byStatusCode: Record<string, number>;
  };
  agent: {
    toolExecutions: CounterSnapshot;
    transactionsPreparedTotal: number;
    transactionsSubmittedTotal: number;
    transactionsByTool: Record<string, number>;
  };
}

class TelemetryStore {
  private readonly apiRequests = createCounterSnapshot();
  private readonly apiStatusCodes: Record<string, number> = {};
  private readonly toolExecutions = createCounterSnapshot();
  private readonly transactionByTool: Record<string, number> = {};
  private transactionsPreparedTotal = 0;
  private transactionsSubmittedTotal = 0;

  public recordApiRequest(input: {
    name: string;
    statusCode: number;
    durationMs: number;
  }): void {
    this.apiRequests.total += 1;

    if (input.statusCode >= 400) {
      this.apiRequests.failures += 1;
    }

    incrementCounter(this.apiRequests.byName, input.name);
    incrementCounter(this.apiStatusCodes, String(input.statusCode));
    recordDuration(this.apiRequests.durationsMs, input.durationMs);
  }

  public recordToolExecution(input: {
    tool: string;
    durationMs: number;
    failed: boolean;
  }): void {
    this.toolExecutions.total += 1;

    if (input.failed) {
      this.toolExecutions.failures += 1;
    }

    incrementCounter(this.toolExecutions.byName, input.tool);
    recordDuration(this.toolExecutions.durationsMs, input.durationMs);
  }

  public recordPreparedTransaction(tool: string): void {
    this.transactionsPreparedTotal += 1;
    incrementCounter(this.transactionByTool, tool);
  }

  public recordSubmittedTransaction(tool: string): void {
    this.transactionsSubmittedTotal += 1;
    incrementCounter(this.transactionByTool, tool);
  }

  public snapshot(): TelemetrySnapshot {
    return {
      generatedAt: new Date().toISOString(),
      api: {
        ...this.apiRequests,
        durationsMs: toDurationSnapshot(this.apiRequests.durationsMs),
        byStatusCode: {
          ...this.apiStatusCodes,
        },
      },
      agent: {
        toolExecutions: {
          ...this.toolExecutions,
          durationsMs: toDurationSnapshot(this.toolExecutions.durationsMs),
        },
        transactionsPreparedTotal: this.transactionsPreparedTotal,
        transactionsSubmittedTotal: this.transactionsSubmittedTotal,
        transactionsByTool: {
          ...this.transactionByTool,
        },
      },
    };
  }
}

export const telemetry = new TelemetryStore();

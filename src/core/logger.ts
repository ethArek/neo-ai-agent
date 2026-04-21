import pino from "pino";

const sensitiveKeyPattern =
  /(private|secret|seed|wif|token|authorization|api[_-]?key)/i;

function maskString(value: string): string {
  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export function sanitizeForLogs(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLogs(entry));
  }

  if (typeof value === "object") {
    return Object.entries(value).reduce<Record<string, unknown>>(
      (accumulator, [key, entry]) => {
        if (sensitiveKeyPattern.test(key)) {
          accumulator[key] =
            typeof entry === "string" ? maskString(entry) : "[REDACTED]";
        } else {
          accumulator[key] = sanitizeForLogs(entry);
        }

        return accumulator;
      },
      {},
    );
  }

  return value;
}

const baseLogger = pino({
  level: process.env.NODE_ENV === "development" ? "debug" : "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const logger = {
  debug(message: string, context?: unknown): void {
    baseLogger.debug(sanitizeForLogs(context), message);
  },
  info(message: string, context?: unknown): void {
    baseLogger.info(sanitizeForLogs(context), message);
  },
  warn(message: string, context?: unknown): void {
    baseLogger.warn(sanitizeForLogs(context), message);
  },
  error(message: string, context?: unknown): void {
    baseLogger.error(sanitizeForLogs(context), message);
  },
};

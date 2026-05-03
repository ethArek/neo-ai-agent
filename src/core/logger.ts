import pino from "pino";

const sensitiveKeyPattern =
  /(private|secret|seed|wif|authorization|api[_-]?key)/i;
const sensitiveTokenKeys = new Set([
  "accesstoken",
  "authtoken",
  "bearertoken",
  "idtoken",
  "refreshtoken",
  "sessiontoken",
]);
const sensitiveQueryParameterPattern =
  /^(?:access[_-]?token|api[_-]?key|apikey|auth|authorization|bearer|key|password|secret|signature|token)$/i;
const sensitivePathSegmentPattern =
  /(?:access[_-]?token|api[_-]?key|apikey|auth(?:orization)?|bearer|password|private(?:[_-]?key)?|secret|seed|signature|token|wif|mnemonic)/i;
const opaquePathSegmentPattern = /^(?:0x[a-fA-F0-9]{32,}|[A-Za-z0-9._-]{24,})$/;

function maskString(value: string): string {
  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function normalizeLogKey(key: string): string {
  return key.replaceAll(/[_-]/g, "").toLowerCase();
}

function isSensitiveLogKey(key: string): boolean {
  const normalizedKey = normalizeLogKey(key);

  return sensitiveKeyPattern.test(key) || sensitiveTokenKeys.has(normalizedKey);
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitizeUrlPathSegment(segment: string): string {
  if (segment === "") {
    return segment;
  }

  const decodedSegment = decodeURIComponentSafely(segment);

  if (
    sensitivePathSegmentPattern.test(decodedSegment) ||
    opaquePathSegmentPattern.test(decodedSegment)
  ) {
    return "********";
  }

  return segment;
}

function sanitizeUrlMatch(value: string): string {
  try {
    const url = new URL(value);

    if (url.username) {
      url.username = "********";
    }

    if (url.password) {
      url.password = "********";
    }

    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveQueryParameterPattern.test(key)) {
        url.searchParams.set(key, "********");
      }
    }

    url.pathname = url.pathname
      .split("/")
      .map((segment) => sanitizeUrlPathSegment(segment))
      .join("/");

    return url.toString();
  } catch {
    return value;
  }
}

export function sanitizeStringValue(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"')]+/gi, (match) => sanitizeUrlMatch(match))
    .replace(
      /\b(Bearer\s+)([^\s,;]+)/gi,
      (_, prefix: string, token: string) => `${prefix}${maskString(token)}`,
    )
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|password|secret|signature|token))\s*[:=]\s*([^\s,;&]+)/gi,
      (_, key: string, token: string) => `${key}=${maskString(token)}`,
    )
    .replace(
      /\b((?:private(?:[_-]?key)?|seed|wif|mnemonic))\s*[:=]\s*(0x[a-fA-F0-9]{64}|[^\s,;&]+)/gi,
      (_, key: string, token: string) => `${key}=${maskString(token)}`,
    );
}

export function sanitizeForLogs(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLogs(entry));
  }

  if (typeof value === "string") {
    return sanitizeStringValue(value);
  }

  if (typeof value === "object") {
    return Object.entries(value).reduce<Record<string, unknown>>(
      (accumulator, [key, entry]) => {
        if (isSensitiveLogKey(key)) {
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

import { ZodError } from "zod";

export interface AppErrorOptions {
  code: string;
  statusCode: number;
  details?: unknown;
  expose?: boolean;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly expose: boolean;

  public constructor(message: string, options: AppErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.expose = options.expose ?? true;
  }
}

export class ValidationError extends AppError {
  public constructor(message: string, details?: unknown) {
    super(message, {
      code: "VALIDATION_ERROR",
      statusCode: 400,
      details,
    });
  }
}

export class NotFoundError extends AppError {
  public constructor(message: string, details?: unknown) {
    super(message, {
      code: "NOT_FOUND",
      statusCode: 404,
      details,
    });
  }
}

export class WalletUnavailableError extends AppError {
  public constructor(message = "Wallet mode is not enabled.") {
    super(message, {
      code: "WALLET_UNAVAILABLE",
      statusCode: 403,
    });
  }
}

export class ConfirmationRequiredError extends AppError {
  public constructor(message: string, details?: unknown) {
    super(message, {
      code: "CONFIRMATION_REQUIRED",
      statusCode: 409,
      details,
    });
  }
}

export class NeoRpcError extends AppError {
  public constructor(message: string, details?: unknown) {
    super(message, {
      code: "NEO_RPC_ERROR",
      statusCode: 502,
      details,
    });
  }
}

export class ProviderCapabilityError extends AppError {
  public constructor(message: string, details?: unknown) {
    super(message, {
      code: "PROVIDER_CAPABILITY_ERROR",
      statusCode: 501,
      details,
    });
  }
}

export class LlmPlanningError extends AppError {
  public constructor(message: string, details?: unknown) {
    super(message, {
      code: "LLM_PLANNING_ERROR",
      statusCode: 502,
      details,
    });
  }
}

export interface SerializedError {
  message: string;
  code: string;
  statusCode: number;
  details?: unknown;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof AppError) {
    return {
      message: error.expose ? error.message : "Internal server error.",
      code: error.code,
      statusCode: error.statusCode,
      details: error.expose ? error.details : undefined,
    };
  }

  if (error instanceof ZodError) {
    return {
      message: error.issues[0]?.message ?? "Request validation failed.",
      code: "VALIDATION_ERROR",
      statusCode: 400,
      details: error.issues,
    };
  }

  if (error instanceof Error) {
    return {
      message: "Internal server error.",
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
    };
  }

  return {
    message: "Internal server error.",
    code: "INTERNAL_SERVER_ERROR",
    statusCode: 500,
  };
}

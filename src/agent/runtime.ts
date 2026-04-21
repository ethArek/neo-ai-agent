import { randomUUID } from "node:crypto";

import { ValidationError } from "../core/errors";
import { isNeoN3Address } from "../core/validation";
import type { BroadcastResult } from "../neo/types";
import type { NeoProvider } from "../neo/types";
import type { PlannerService } from "./planner";
import type { SessionStore } from "./sessionStore";
import type { ToolRegistry } from "./toolRegistry";
import type {
  AgentResponse,
  BroadcastActivity,
  DraftToolAction,
  ExecuteToolRequest,
  PlannerAction,
  ToolName,
} from "./types";

const neoNsPattern =
  /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.neo)\b/i;

interface AgentRuntimeOptions {
  planner: PlannerService;
  registry: ToolRegistry;
  neo: NeoProvider;
  sessions: SessionStore;
}

export class AgentRuntime {
  private readonly planner: PlannerService;
  private readonly registry: ToolRegistry;
  private readonly neo: NeoProvider;
  private readonly sessions: SessionStore;

  public constructor(options: AgentRuntimeOptions) {
    this.planner = options.planner;
    this.registry = options.registry;
    this.neo = options.neo;
    this.sessions = options.sessions;
  }

  public async handleMessage(
    message: string,
    sessionId?: string,
  ): Promise<AgentResponse> {
    const session = this.sessions.getOrCreate(sessionId);
    this.syncSessionWalletAddress(session.id);
    const trimmedMessage = message.trim();
    const normalizedMessage = trimmedMessage.toLowerCase();

    if (session.pendingAction && this.isConfirmMessage(normalizedMessage)) {
      return this.confirmPendingAction(session.id);
    }

    if (session.pendingAction && this.isCancelMessage(normalizedMessage)) {
      const canceledTool = session.pendingAction.tool;

      this.sessions.clearPendingAction(session.id);

      return {
        sessionId: session.id,
        message: `Canceled the pending ${canceledTool} action.`,
        tool: null,
        arguments: {},
        result: {
          canceledTool,
        },
        requiresConfirmation: false,
      };
    }

    if (session.draftAction && this.isConfirmMessage(normalizedMessage)) {
      return {
        sessionId: session.id,
        message: this.buildMissingInputsMessage(session.draftAction),
        tool: session.draftAction.tool,
        arguments: session.draftAction.arguments,
        result: null,
        requiresConfirmation: false,
      };
    }

    if (session.draftAction && this.isCancelMessage(normalizedMessage)) {
      const canceledTool = session.draftAction.tool;

      this.sessions.clearDraftAction(session.id);

      return {
        sessionId: session.id,
        message: `Canceled the incomplete ${canceledTool} request.`,
        tool: null,
        arguments: {},
        result: {
          canceledTool,
        },
        requiresConfirmation: false,
      };
    }

    const completedDraftPlan = this.tryCompleteDraftAction(
      trimmedMessage,
      session.draftAction,
      session,
    );

    if (completedDraftPlan) {
      return this.executePlannedAction(session.id, completedDraftPlan);
    }

    const plan = await this.planner.plan(trimmedMessage, {
      walletEnabled: this.neo.walletEnabled(),
      pendingAction: session.pendingAction,
      draftAction: session.draftAction,
      walletAddress: session.walletAddress,
      neoN3WalletAddress: session.neoN3WalletAddress,
      lastReferencedAddress: session.lastReferencedAddress,
    });
    const hydratedPlan = this.hydratePlanWithSessionContext(
      plan,
      trimmedMessage,
      session,
    );

    if (hydratedPlan.intent === "confirm_action") {
      if (!session.pendingAction) {
        return {
          sessionId: session.id,
          message: "There is no pending action to confirm.",
          tool: null,
          arguments: {},
          result: null,
          requiresConfirmation: false,
        };
      }

      return this.confirmPendingAction(session.id);
    }

    if (hydratedPlan.intent === "cancel_action") {
      if (!session.pendingAction) {
        if (session.draftAction) {
          const canceledTool = session.draftAction.tool;

          this.sessions.clearDraftAction(session.id);

          return {
            sessionId: session.id,
            message: `Canceled the incomplete ${canceledTool} request.`,
            tool: null,
            arguments: {},
            result: {
              canceledTool,
            },
            requiresConfirmation: false,
          };
        }

        return {
          sessionId: session.id,
          message: "There is no pending action to cancel.",
          tool: null,
          arguments: {},
          result: null,
          requiresConfirmation: false,
        };
      }

      const canceledTool = session.pendingAction.tool;
      this.sessions.clearPendingAction(session.id);

      return {
        sessionId: session.id,
        message: `Canceled the pending ${canceledTool} action.`,
        tool: null,
        arguments: {},
        result: {
          canceledTool,
        },
        requiresConfirmation: false,
      };
    }

    return this.executePlannedAction(session.id, hydratedPlan);
  }

  public async executeTool(
    request: ExecuteToolRequest,
  ): Promise<AgentResponse> {
    const session = this.sessions.getOrCreate(request.sessionId);

    this.syncSessionWalletAddress(session.id);
    const tool = this.registry.get(request.tool);
    const parsedInput = tool.schema.parse(request.arguments);
    const pendingActionBeforeExecution = session.pendingAction;
    const execution = await tool.execute(
      parsedInput,
      {
        neo: this.neo,
        session: this.sessions.getToolSessionContext(session.id),
      },
      {
        confirm: request.confirm,
        pendingAction: session.pendingAction,
      },
    );

    if (execution.requiresConfirmation && execution.pendingAction) {
      this.sessions.setPendingAction(session.id, execution.pendingAction);
      this.sessions.clearDraftAction(session.id);
    } else if (request.confirm) {
      this.sessions.clearPendingAction(session.id);
      this.sessions.clearDraftAction(session.id);
    } else {
      this.sessions.clearDraftAction(session.id);
    }

    const broadcastActivity = this.createBroadcastActivity(
      request.tool,
      request.arguments,
      execution.data,
      pendingActionBeforeExecution?.prepared,
    );

    if (broadcastActivity) {
      this.sessions.addBroadcastActivity(session.id, broadcastActivity);
    }

    this.rememberSessionAddress(
      session.id,
      request.tool,
      request.arguments,
      execution.data,
    );

    return {
      sessionId: session.id,
      message: execution.message,
      tool: request.tool,
      arguments: request.arguments,
      result: execution.data,
      requiresConfirmation: execution.requiresConfirmation ?? false,
    };
  }

  private async executePlannedAction(
    sessionId: string,
    plan: PlannerAction,
  ): Promise<AgentResponse> {
    if (!plan.tool) {
      return {
        sessionId,
        message:
          plan.explanation ??
          "I could not map that request to a supported Neo N3 action. Try a balance lookup, block or transaction lookup, contract call, transfer, or Flamingo swap request.",
        tool: null,
        arguments: plan.arguments,
        result: null,
        requiresConfirmation: false,
      };
    }

    if (plan.missingInputs.length > 0) {
      this.sessions.setDraftAction(sessionId, this.createDraftAction(plan));

      return {
        sessionId,
        message: this.buildMissingInputsMessage(plan),
        tool: plan.tool,
        arguments: plan.arguments,
        result: null,
        requiresConfirmation: false,
      };
    }

    this.sessions.clearDraftAction(sessionId);

    return this.executeTool({
      tool: plan.tool,
      arguments: plan.arguments,
      sessionId,
    });
  }

  private async confirmPendingAction(
    sessionId: string,
  ): Promise<AgentResponse> {
    const session = this.sessions.getOrCreate(sessionId);
    const pendingAction = session.pendingAction;

    if (!pendingAction) {
      throw new ValidationError("There is no pending action to confirm.");
    }

    const response = await this.executeTool({
      tool: pendingAction.tool,
      arguments: pendingAction.arguments,
      sessionId,
      confirm: true,
    });

    this.sessions.clearPendingAction(sessionId);

    return response;
  }

  private isConfirmMessage(message: string): boolean {
    return /^(confirm|yes|approve|go ahead|send it|do it|ok[,]?\s*do it|okay[,]?\s*do it|proceed)$/i.test(
      message.trim(),
    );
  }

  private isCancelMessage(message: string): boolean {
    return /^(cancel|stop|abort|never mind)$/i.test(message.trim());
  }

  private syncSessionWalletAddress(sessionId: string): void {
    const walletAddress = this.neo.walletEnabled()
      ? this.neo.getNeoN3WalletAddress()
      : undefined;

    if (!walletAddress) {
      return;
    }

    this.sessions.setWalletAddress(sessionId, walletAddress);
  }

  private createDraftAction(plan: PlannerAction): DraftToolAction {
    if (!plan.tool) {
      throw new ValidationError(
        "Cannot create a draft action without a target tool.",
      );
    }

    return {
      tool: plan.tool,
      arguments: plan.arguments,
      missingInputs: [...plan.missingInputs],
      createdAt: new Date().toISOString(),
    };
  }

  private buildMissingInputsMessage(plan: {
    tool: ToolName | null;
    arguments: Record<string, unknown>;
    missingInputs: string[];
  }): string {
    const missingInputs = plan.missingInputs.join(", ");

    if (
      plan.tool === "sendNeoN3Gas" &&
      plan.missingInputs.length === 1 &&
      plan.missingInputs[0] === "to"
    ) {
      return 'I need the Neo N3 recipient to run sendNeoN3Gas. Reply with a Neo N3 address or a NeoNS name like "arkadiusz.neo".';
    }

    if (
      plan.tool === "sendNeoN3Token" &&
      plan.missingInputs.length === 1 &&
      plan.missingInputs[0] === "to"
    ) {
      return 'I need the Neo N3 recipient to run sendNeoN3Token. Reply with a Neo N3 address or a NeoNS name like "arkadiusz.neo".';
    }

    if (
      (plan.tool === "swapNeoN3Token" || plan.tool === "getNeoN3SwapQuote") &&
      plan.missingInputs.length > 0
    ) {
      return 'I need amount, fromToken, and toToken to run the Neo N3 Flamingo swap flow. Reply with something like "swap 1 GAS for FUSD".';
    }

    return `I need ${missingInputs} to run ${plan.tool}.`;
  }

  private tryCompleteDraftAction(
    message: string,
    draftAction: DraftToolAction | undefined,
    session: {
      walletAddress?: string;
      lastReferencedAddress?: string;
    },
  ): PlannerAction | undefined {
    if (!draftAction) {
      return undefined;
    }

    const mergedArguments = {
      ...draftAction.arguments,
    };
    const remainingInputs = new Set(draftAction.missingInputs);
    const amountMatch = message.match(/\b([0-9]+(?:\.[0-9]+)?)\b/);
    const amountWithTokenMatch = message.match(
      /\b([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z][A-Za-z0-9._:-]*)\b/,
    );
    const fromTokenMatch = message.match(
      /\b(?:from|using)\s+([A-Za-z][A-Za-z0-9._:-]*)\b/i,
    );
    const toTokenMatch = message.match(
      /\b(?:for|to)\s+([A-Za-z][A-Za-z0-9._:-]*)\b/i,
    );
    const resolvedAddress = this.resolveAddressReference(message, session);
    const neoN3Recipient = this.extractNeoN3AddressOrName(message);

    for (const inputName of draftAction.missingInputs) {
      if (inputName === "amount" && amountMatch) {
        mergedArguments.amount = amountMatch[1];
        remainingInputs.delete(inputName);
        continue;
      }

      if (
        inputName === "to" &&
        this.acceptsNeoN3Recipient(draftAction.tool) &&
        neoN3Recipient
      ) {
        mergedArguments.to = neoN3Recipient;
        remainingInputs.delete(inputName);
        continue;
      }

      if (inputName === "address" && resolvedAddress) {
        mergedArguments.address = resolvedAddress;
        remainingInputs.delete(inputName);
        continue;
      }

      if (inputName === "token") {
        const tokenCandidate =
          toTokenMatch?.[1] ??
          fromTokenMatch?.[1] ??
          amountWithTokenMatch?.[2] ??
          this.extractSingleToken(message);

        if (tokenCandidate) {
          mergedArguments.token = tokenCandidate;
          remainingInputs.delete(inputName);
        }

        continue;
      }

      if (inputName === "fromToken") {
        const fromTokenCandidate =
          fromTokenMatch?.[1] ??
          amountWithTokenMatch?.[2] ??
          this.extractSingleToken(message);

        if (fromTokenCandidate) {
          mergedArguments.fromToken = fromTokenCandidate;
          remainingInputs.delete(inputName);
        }

        continue;
      }

      if (inputName === "toToken") {
        const toTokenCandidate =
          toTokenMatch?.[1] ?? this.extractSingleToken(message);

        if (toTokenCandidate) {
          mergedArguments.toToken = toTokenCandidate;
          remainingInputs.delete(inputName);
        }
      }
    }

    if (remainingInputs.size > 0) {
      return undefined;
    }

    return {
      intent: `continue_${draftAction.tool}`,
      tool: draftAction.tool,
      arguments: mergedArguments,
      needsConfirmation: this.registry.get(draftAction.tool).dangerous,
      missingInputs: [],
      explanation: `Completed the missing inputs for ${draftAction.tool}.`,
    };
  }

  private resolveAddressReference(
    message: string,
    session: {
      walletAddress?: string;
      lastReferencedAddress?: string;
    },
  ): string | undefined {
    const explicitAddress = this.extractNeoN3AddressOrName(message);

    if (explicitAddress) {
      return explicitAddress;
    }

    const normalizedMessage = message.trim().toLowerCase();

    if (
      /\bmy (?:address|wallet|account|wallet address)\b/.test(normalizedMessage)
    ) {
      return session.walletAddress ?? session.lastReferencedAddress;
    }

    if (
      /\b(?:this|that|same) (?:address|wallet|account)\b/.test(
        normalizedMessage,
      )
    ) {
      return session.lastReferencedAddress ?? session.walletAddress;
    }

    return undefined;
  }

  private extractSingleToken(message: string): string | undefined {
    const tokenMatches = message.match(/[A-Za-z][A-Za-z0-9._:-]*/g);

    if (!tokenMatches || tokenMatches.length !== 1) {
      return undefined;
    }

    return tokenMatches[0];
  }

  private extractNeoN3AddressOrName(message: string): string | undefined {
    const parts = message.match(/[A-Za-z0-9]+/g) ?? [];

    for (const part of parts) {
      if (isNeoN3Address(part)) {
        return part;
      }
    }

    const neoNsMatch = message.match(neoNsPattern);

    if (neoNsMatch) {
      return neoNsMatch[1].toLowerCase();
    }

    return undefined;
  }

  private acceptsNeoN3Recipient(tool: ToolName): boolean {
    return tool === "sendNeoN3Gas" || tool === "sendNeoN3Token";
  }

  private hydratePlanWithSessionContext(
    plan: PlannerAction,
    message: string,
    session: {
      walletAddress?: string;
      lastReferencedAddress?: string;
    },
  ): PlannerAction {
    if (!plan.tool) {
      return plan;
    }

    const addressArgument = plan.arguments.address;
    const hasAddress =
      typeof addressArgument === "string" && addressArgument.trim() !== "";

    if (hasAddress || !this.toolSupportsImplicitAddress(plan.tool)) {
      return plan;
    }

    const resolvedAddress = this.resolveSessionAddressReference(
      message,
      session,
    );

    if (!resolvedAddress) {
      return plan;
    }

    return {
      ...plan,
      arguments: {
        ...plan.arguments,
        address: resolvedAddress,
      },
      missingInputs: plan.missingInputs.filter((input) => input !== "address"),
    };
  }

  private resolveSessionAddressReference(
    message: string,
    session: {
      walletAddress?: string;
      lastReferencedAddress?: string;
    },
  ): string | undefined {
    const normalizedMessage = message.trim().toLowerCase();

    if (
      /\bmy (?:address|wallet|account|wallet address)\b/.test(normalizedMessage)
    ) {
      return session.walletAddress ?? session.lastReferencedAddress;
    }

    if (
      /\b(?:this|that|same) (?:address|wallet|account)\b/.test(
        normalizedMessage,
      )
    ) {
      return session.lastReferencedAddress ?? session.walletAddress;
    }

    return undefined;
  }

  private toolSupportsImplicitAddress(tool: ToolName): boolean {
    return (
      tool === "getNeoN3PortfolioOverview" ||
      tool === "getNeoN3TokenBalances" ||
      tool === "getNeoN3TransferHistory" ||
      tool === "getRecentActions"
    );
  }

  private rememberSessionAddress(
    sessionId: string,
    tool: ToolName,
    argumentsPayload: Record<string, unknown>,
    result: unknown,
  ): void {
    const addressFromArguments =
      typeof argumentsPayload.address === "string"
        ? argumentsPayload.address
        : undefined;

    if (addressFromArguments && this.shouldRememberAddressFromTool(tool)) {
      this.sessions.rememberAddress(sessionId, addressFromArguments);

      return;
    }

    const addressFromResult = this.extractAddressFromResult(tool, result);

    if (addressFromResult) {
      this.sessions.rememberAddress(sessionId, addressFromResult);
    }
  }

  private shouldRememberAddressFromTool(tool: ToolName): boolean {
    return (
      tool === "getNeoN3PortfolioOverview" ||
      tool === "getNeoN3TokenBalances" ||
      tool === "getNeoN3TransferHistory"
    );
  }

  private extractAddressFromResult(
    tool: ToolName,
    result: unknown,
  ): string | undefined {
    if (typeof result !== "object" || result === null) {
      return undefined;
    }

    if (
      tool === "getWalletAddress" &&
      "address" in result &&
      typeof result.address === "string"
    ) {
      return result.address;
    }

    return undefined;
  }

  private createBroadcastActivity(
    tool: ToolName,
    argumentsPayload: Record<string, unknown>,
    result: unknown,
    prepared?: {
      to?: string;
      amount?: string;
      tokenSymbol?: string;
      toTokenSymbol?: string;
      amountOut?: string;
      minimumAmountOut?: string;
      slippagePercent?: string;
      routeSymbols?: string[];
      deadlineMinutes?: number;
      deadlineTimestamp?: number;
    },
  ): BroadcastActivity | undefined {
    if (!this.isBroadcastResult(result)) {
      return undefined;
    }

    const fallbackTo =
      typeof argumentsPayload.to === "string" ? argumentsPayload.to : undefined;
    const fallbackAmount =
      typeof argumentsPayload.amount === "string"
        ? argumentsPayload.amount
        : undefined;
    const fallbackTokenSymbol =
      typeof argumentsPayload.token === "string"
        ? argumentsPayload.token
        : undefined;

    return {
      id: randomUUID(),
      tool,
      arguments: argumentsPayload,
      txHash: result.txHash,
      network: result.network,
      sender: result.sender,
      summary: result.summary,
      createdAt: new Date().toISOString(),
      status: "submitted",
      to: fallbackTo ?? prepared?.to,
      amount: fallbackAmount ?? prepared?.amount,
      tokenSymbol: fallbackTokenSymbol ?? prepared?.tokenSymbol,
      toTokenSymbol: prepared?.toTokenSymbol,
      amountOut: prepared?.amountOut,
      minimumAmountOut: prepared?.minimumAmountOut,
      slippagePercent: prepared?.slippagePercent,
      routeSymbols: prepared?.routeSymbols,
      deadlineMinutes: prepared?.deadlineMinutes,
      deadlineTimestamp: prepared?.deadlineTimestamp,
    };
  }

  private isBroadcastResult(value: unknown): value is BroadcastResult {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    return (
      "network" in value &&
      "sender" in value &&
      "summary" in value &&
      "txHash" in value &&
      typeof value.network === "string" &&
      typeof value.sender === "string" &&
      typeof value.summary === "string" &&
      typeof value.txHash === "string"
    );
  }
}

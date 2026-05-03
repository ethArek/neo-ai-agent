import { randomUUID } from "node:crypto";

import {
  extractNeoN3AddressOrName,
  resolveAddressReference,
  resolveSessionAddressReference,
} from "../core/addressResolver";
import { ValidationError } from "../core/errors";
import { logger } from "../core/logger";
import { telemetry } from "../core/telemetry";
import type {
  BroadcastReceipt,
  BroadcastResult,
  NeoNetwork,
  NeoProvider,
  PostTransactionBalances,
  PreparedTransaction,
  TransactionStatus,
  TransactionStatusState,
} from "../neo/types";
import { applyPlannerExecutionPolicy } from "./executionPolicy";
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

interface AgentRuntimeOptions {
  planner: PlannerService;
  registry: ToolRegistry;
  neo: NeoProvider;
  sessions: SessionStore;
  transactionPollingIntervalMs?: number;
  transactionPollingTimeoutMs?: number;
}

export interface AgentProgressUpdate {
  phase: "waiting_for_confirmation";
  label: string;
}

interface AgentRuntimeExecutionOptions {
  onProgress?: (update: AgentProgressUpdate) => void;
}

export class AgentRuntime {
  private static readonly neoN3MainnetNetworkMagic = 860_833_102;
  private static readonly neoN3TestnetNetworkMagic = 894_710_606;

  private readonly planner: PlannerService;
  private readonly registry: ToolRegistry;
  private readonly neo: NeoProvider;
  private readonly sessions: SessionStore;
  private readonly transactionPollingIntervalMs: number;
  private readonly transactionPollingTimeoutMs: number;

  public constructor(options: AgentRuntimeOptions) {
    this.planner = options.planner;
    this.registry = options.registry;
    this.neo = options.neo;
    this.sessions = options.sessions;
    this.transactionPollingIntervalMs =
      options.transactionPollingIntervalMs ?? 1500;
    this.transactionPollingTimeoutMs =
      options.transactionPollingTimeoutMs ?? 45_000;
  }

  public async handleMessage(
    message: string,
    sessionId?: string,
    options: AgentRuntimeExecutionOptions = {},
  ): Promise<AgentResponse> {
    const session = this.sessions.getOrCreate(sessionId);
    this.syncSessionNetworkContext(session.id);
    const trimmedMessage = message.trim();
    const normalizedMessage = trimmedMessage.toLowerCase();

    if (session.pendingAction && this.isConfirmMessage(normalizedMessage)) {
      return this.confirmPendingAction(session.id, options);
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
      return this.executePlannedAction(session.id, completedDraftPlan, options);
    }

    const plan = await this.planner.plan(trimmedMessage, {
      defaultNetwork: session.defaultNetwork,
      implementedNetworks: session.implementedNetworks,
      walletEnabled: this.neo.walletEnabled(),
      pendingAction: session.pendingAction,
      draftAction: session.draftAction,
      walletAddress: session.walletAddress,
      walletAddresses: session.walletAddresses,
      lastReferencedAddress: session.lastReferencedAddress,
      lastReferencedAddresses: session.lastReferencedAddresses,
    });
    const hydratedPlan = this.hydratePlanWithSessionContext(
      plan,
      trimmedMessage,
      session,
    );

    if (hydratedPlan.intent === "confirm_action") {
      if (!this.isConfirmMessage(normalizedMessage)) {
        return {
          sessionId: session.id,
          message:
            'Pending actions can only be confirmed with an explicit message such as "Confirm" or "Proceed".',
          tool: null,
          arguments: {},
          result: null,
          requiresConfirmation: false,
        };
      }

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

      return this.confirmPendingAction(session.id, options);
    }

    if (hydratedPlan.intent === "cancel_action") {
      if (!this.isCancelMessage(normalizedMessage)) {
        return {
          sessionId: session.id,
          message:
            'Pending actions can only be canceled with an explicit message such as "Cancel" or "Abort".',
          tool: null,
          arguments: {},
          result: null,
          requiresConfirmation: false,
        };
      }

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

    return this.executePlannedAction(session.id, hydratedPlan, options);
  }

  public async executeTool(
    request: ExecuteToolRequest,
    options: AgentRuntimeExecutionOptions = {},
  ): Promise<AgentResponse> {
    const session = this.sessions.getOrCreate(request.sessionId);

    this.syncSessionNetworkContext(session.id);
    const tool = this.registry.get(request.tool);
    const parsedInput = tool.schema.parse(request.arguments);
    const pendingActionBeforeExecution = session.pendingAction;
    const executionStartedAt = process.hrtime.bigint();

    try {
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
        telemetry.recordPreparedTransaction(request.tool);
        logger.info("Prepared a pending blockchain action.", {
          sessionId: session.id,
          tool: request.tool,
          actionId: execution.pendingAction.id,
          network: execution.pendingAction.prepared.network,
          sender: execution.pendingAction.prepared.sender,
          to: execution.pendingAction.prepared.to,
          amount: execution.pendingAction.prepared.amount,
          tokenSymbol: execution.pendingAction.prepared.tokenSymbol,
        });
      } else if (request.confirm) {
        this.sessions.clearPendingAction(session.id);
        this.sessions.clearDraftAction(session.id);
      } else {
        this.sessions.clearDraftAction(session.id);
      }

      const preparedTransaction =
        execution.preparedTransaction ?? pendingActionBeforeExecution?.prepared;
      const broadcastResult = this.isBroadcastResult(execution.data)
        ? execution.data
        : undefined;
      const broadcastActivity = this.createBroadcastActivity(
        request.tool,
        request.arguments,
        broadcastResult,
        preparedTransaction,
      );
      let responseMessage = execution.message;
      let responseResult = execution.data;

      if (broadcastActivity) {
        this.sessions.addBroadcastActivity(session.id, broadcastActivity);
        telemetry.recordSubmittedTransaction(request.tool);
        logger.info("Submitted a blockchain transaction.", {
          sessionId: session.id,
          tool: request.tool,
          txHash: broadcastActivity.txHash,
          network: broadcastActivity.network,
          sender: broadcastActivity.sender,
          to: broadcastActivity.to,
          amount: broadcastActivity.amount,
          tokenSymbol: broadcastActivity.tokenSymbol,
          toTokenSymbol: broadcastActivity.toTokenSymbol,
        });

        const receipt = await this.observeBroadcastResult(
          request.tool,
          session.id,
          broadcastActivity,
          broadcastResult,
          preparedTransaction,
          options.onProgress,
        );

        if (receipt) {
          broadcastActivity.status = receipt.status.status;
          responseMessage = this.buildBroadcastCompletionMessage(
            execution.message,
            receipt,
            preparedTransaction,
          );
          responseResult = this.buildBroadcastResponseResult(
            request.tool,
            receipt,
            preparedTransaction,
          );
        }
      }

      this.rememberSessionAddress(
        session.id,
        request.tool,
        request.arguments,
        execution.data,
      );
      telemetry.recordToolExecution({
        tool: request.tool,
        durationMs: this.durationMs(executionStartedAt),
        failed: false,
      });

      return {
        sessionId: session.id,
        message: responseMessage,
        tool: request.tool,
        arguments: request.arguments,
        result: responseResult,
        requiresConfirmation: execution.requiresConfirmation ?? false,
      };
    } catch (error) {
      const durationMs = this.durationMs(executionStartedAt);

      telemetry.recordToolExecution({
        tool: request.tool,
        durationMs,
        failed: true,
      });
      logger.error("Tool execution failed.", {
        sessionId: session.id,
        tool: request.tool,
        confirm: Boolean(request.confirm),
        durationMs,
        error: error instanceof Error ? error.message : error,
      });

      throw error;
    }
  }

  private async executePlannedAction(
    sessionId: string,
    plan: PlannerAction,
    options: AgentRuntimeExecutionOptions,
  ): Promise<AgentResponse> {
    if (!plan.tool) {
      return {
        sessionId,
        message:
          plan.explanation ??
          "I could not map that request to a supported Neo action. Try a Neo N3 request, a Neo X EVM request, or clarify which chain you want to use.",
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
    const plannedArguments = applyPlannerExecutionPolicy({
      tool: plan.tool,
      argumentsPayload: plan.arguments,
      executionPolicy: plan.executionPolicy,
    });

    return this.executeTool(
      {
        tool: plan.tool,
        arguments: plannedArguments,
        sessionId,
      },
      options,
    );
  }

  private async confirmPendingAction(
    sessionId: string,
    options: AgentRuntimeExecutionOptions,
  ): Promise<AgentResponse> {
    const session = this.sessions.getOrCreate(sessionId);
    const pendingAction = session.pendingAction;

    if (!pendingAction) {
      throw new ValidationError("There is no pending action to confirm.");
    }

    const response = await this.executeTool(
      {
        tool: pendingAction.tool,
        arguments: pendingAction.arguments,
        sessionId,
        confirm: true,
      },
      options,
    );

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

  private syncSessionNetworkContext(sessionId: string): void {
    this.sessions.setNetworkContext(sessionId, {
      defaultNetwork: this.neo.getDefaultNetwork(),
      implementedNetworks: this.neo.getImplementedNetworks(),
      walletAddresses: this.neo.getWalletAddresses(),
    });
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
      executionPolicy: plan.executionPolicy,
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

    if (
      plan.tool === "neox_get_native_balance" &&
      plan.missingInputs.length === 1 &&
      plan.missingInputs[0] === "address"
    ) {
      return "I need a Neo X 0x address to check the native GAS balance.";
    }

    if (
      plan.tool === "neox_get_erc20_balance" &&
      plan.missingInputs.length > 0
    ) {
      return "I need a Neo X token contract and owner 0x address to check an ERC-20 balance.";
    }

    if (plan.tool === "neox_call_contract" && plan.missingInputs.length > 0) {
      return "I need a Neo X contract address, ABI or function signature, and functionName to call a Solidity contract.";
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
    const resolvedAddress = resolveAddressReference(message, session);
    const neoN3Recipient = extractNeoN3AddressOrName(message);

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

      if (
        inputName === "to" &&
        this.acceptsNeoXRecipient(draftAction.tool) &&
        resolvedAddress &&
        /^0x[a-fA-F0-9]{40}$/.test(resolvedAddress)
      ) {
        mergedArguments.to = resolvedAddress;
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
      executionPolicy: draftAction.executionPolicy,
      explanation: `Completed the missing inputs for ${draftAction.tool}.`,
    };
  }

  private extractSingleToken(message: string): string | undefined {
    const tokenMatches = message.match(/[A-Za-z][A-Za-z0-9._:-]*/g);

    if (!tokenMatches || tokenMatches.length !== 1) {
      return undefined;
    }

    return tokenMatches[0];
  }

  private acceptsNeoN3Recipient(tool: ToolName): boolean {
    return tool === "sendNeoN3Gas" || tool === "sendNeoN3Token";
  }

  private acceptsNeoXRecipient(tool: ToolName): boolean {
    return (
      tool === "neox_prepare_native_transfer" ||
      tool === "neox_prepare_erc20_transfer"
    );
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

    const resolvedAddress = resolveSessionAddressReference(message, session);

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

  private toolSupportsImplicitAddress(tool: ToolName): boolean {
    return (
      tool === "getNeoN3PortfolioOverview" ||
      tool === "getNeoN3TokenBalances" ||
      tool === "getNeoN3UnclaimedGas" ||
      tool === "getNeoN3TransferHistory" ||
      tool === "getRecentActions" ||
      tool === "neox_get_native_balance"
    );
  }

  private rememberSessionAddress(
    sessionId: string,
    tool: ToolName,
    argumentsPayload: Record<string, unknown>,
    result: unknown,
  ): void {
    const addressNetwork = this.inferAddressNetwork(
      tool,
      argumentsPayload,
      result,
    );
    const addressFromArguments =
      typeof argumentsPayload.address === "string"
        ? argumentsPayload.address
        : typeof argumentsPayload.owner === "string"
          ? argumentsPayload.owner
          : undefined;

    if (addressFromArguments && this.shouldRememberAddressFromTool(tool)) {
      this.sessions.rememberAddress(
        sessionId,
        addressFromArguments,
        addressNetwork,
      );

      return;
    }

    const addressFromResult = this.extractAddressFromResult(tool, result);

    if (addressFromResult) {
      this.sessions.rememberAddress(
        sessionId,
        addressFromResult.address,
        addressFromResult.network,
      );
    }
  }

  private shouldRememberAddressFromTool(tool: ToolName): boolean {
    return (
      tool === "getNeoN3PortfolioOverview" ||
      tool === "getNeoN3TokenBalances" ||
      tool === "getNeoN3UnclaimedGas" ||
      tool === "getNeoN3TransferHistory" ||
      tool === "neox_get_native_balance" ||
      tool === "neox_get_erc20_balance"
    );
  }

  private extractAddressFromResult(
    tool: ToolName,
    result: unknown,
  ): { address: string; network: NeoNetwork } | undefined {
    if (typeof result !== "object" || result === null) {
      return undefined;
    }

    if (
      tool === "getWalletAddress" &&
      "address" in result &&
      "network" in result &&
      typeof result.address === "string" &&
      typeof result.network === "string" &&
      this.isNeoNetwork(result.network)
    ) {
      return {
        address: result.address,
        network: result.network,
      };
    }

    return undefined;
  }

  private inferAddressNetwork(
    tool: ToolName,
    argumentsPayload: Record<string, unknown>,
    result: unknown,
  ): NeoNetwork | undefined {
    if (
      typeof argumentsPayload.network === "string" &&
      this.isNeoNetwork(argumentsPayload.network)
    ) {
      return argumentsPayload.network;
    }

    if (
      typeof result === "object" &&
      result !== null &&
      "network" in result &&
      typeof result.network === "string" &&
      this.isNeoNetwork(result.network)
    ) {
      return result.network;
    }

    const toolNetworks = this.registry.get(tool).networks;

    return toolNetworks.length === 1 ? toolNetworks[0] : undefined;
  }

  private createBroadcastActivity(
    tool: ToolName,
    argumentsPayload: Record<string, unknown>,
    result: BroadcastResult | undefined,
    prepared?: PreparedTransaction,
  ): BroadcastActivity | undefined {
    if (!result) {
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
        : typeof argumentsPayload.fromToken === "string"
          ? argumentsPayload.fromToken
          : undefined;
    const fallbackToTokenSymbol =
      typeof argumentsPayload.toToken === "string"
        ? argumentsPayload.toToken
        : undefined;

    return {
      id: randomUUID(),
      tool,
      arguments: argumentsPayload,
      txHash: result.txHash,
      network: result.network,
      rpcNetwork: result.rpcNetwork,
      sender: result.sender,
      summary: result.summary,
      createdAt: new Date().toISOString(),
      status: "submitted",
      to: fallbackTo ?? prepared?.to,
      amount: fallbackAmount ?? prepared?.amount,
      tokenSymbol: fallbackTokenSymbol ?? prepared?.tokenSymbol,
      toTokenSymbol: fallbackToTokenSymbol ?? prepared?.toTokenSymbol,
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

  private isNeoNetwork(value: string): value is NeoNetwork {
    return value === "neoN3" || value === "neoX";
  }

  private async observeBroadcastResult(
    tool: ToolName,
    sessionId: string,
    activity: BroadcastActivity,
    broadcast: BroadcastResult | undefined,
    prepared?: PreparedTransaction,
    onProgress?: (update: AgentProgressUpdate) => void,
  ): Promise<BroadcastReceipt | undefined> {
    if (!broadcast) {
      return undefined;
    }

    try {
      const status = await this.pollTransactionStatus(
        tool,
        broadcast,
        onProgress,
      );
      const postTransactionBalances = await this.loadPostTransactionBalances(
        broadcast,
        status,
        prepared,
      );

      return {
        broadcast,
        status,
        postTransactionBalances,
      };
    } catch (error) {
      logger.warn(
        "Transaction broadcast succeeded, but post-broadcast polling failed.",
        {
          sessionId,
          tool,
          txHash: activity.txHash,
          network: activity.network,
          error: error instanceof Error ? error.message : error,
        },
      );

      return undefined;
    }
  }

  private async pollTransactionStatus(
    tool: ToolName,
    broadcast: BroadcastResult,
    onProgress?: (update: AgentProgressUpdate) => void,
  ): Promise<TransactionStatus> {
    const startedAt = Date.now();
    let latestStatus = await this.neo.getTransactionStatus({
      hash: broadcast.txHash,
      network: broadcast.network,
      rpcNetwork: broadcast.rpcNetwork,
    });
    let waitingLabelEmitted = false;

    while (
      this.shouldKeepPollingTransactionStatus(latestStatus.status) &&
      Date.now() - startedAt < this.transactionPollingTimeoutMs
    ) {
      if (!waitingLabelEmitted && onProgress) {
        onProgress({
          phase: "waiting_for_confirmation",
          label: this.buildConfirmationProgressLabel(tool),
        });
        waitingLabelEmitted = true;
      }

      await this.sleep(this.transactionPollingIntervalMs);
      latestStatus = await this.neo.getTransactionStatus({
        hash: broadcast.txHash,
        network: broadcast.network,
        rpcNetwork: broadcast.rpcNetwork,
      });
    }

    return latestStatus;
  }

  private shouldKeepPollingTransactionStatus(
    status: TransactionStatusState,
  ): boolean {
    return (
      status === "submitted" || status === "pending" || status === "not_found"
    );
  }

  private async loadPostTransactionBalances(
    broadcast: BroadcastResult,
    status: TransactionStatus,
    prepared?: PreparedTransaction,
  ): Promise<PostTransactionBalances | undefined> {
    if (status.status !== "confirmed") {
      return undefined;
    }

    if (broadcast.network !== "neoN3") {
      return undefined;
    }

    const address = prepared?.sender ?? broadcast.sender;
    const requestedTokens = this.collectObservedTokenSymbols(prepared);

    if (!address || requestedTokens.length === 0) {
      return undefined;
    }

    const tokens = await Promise.all(
      requestedTokens.map(async (requestedToken) => {
        const balances = await this.neo.getNeoN3TokenBalances(
          address,
          requestedToken,
        );

        return {
          requestedToken,
          balance: balances[0] ?? null,
        };
      }),
    );

    return {
      address,
      tokens,
    };
  }

  private collectObservedTokenSymbols(
    prepared?: PreparedTransaction,
  ): string[] {
    if (!prepared) {
      return [];
    }

    const uniqueTokens = new Set<string>();

    for (const token of [prepared.tokenSymbol, prepared.toTokenSymbol]) {
      if (typeof token === "string" && token.trim() !== "") {
        uniqueTokens.add(token.trim());
      }
    }

    return [...uniqueTokens];
  }

  private buildBroadcastCompletionMessage(
    baseMessage: string,
    receipt: BroadcastReceipt,
    prepared?: PreparedTransaction,
  ): string {
    const lines = [
      baseMessage,
      this.buildTransactionStatusLine(receipt.status),
    ];
    const balancesLine = this.buildPostTransactionBalancesLine(
      receipt.postTransactionBalances,
      prepared,
    );

    if (balancesLine) {
      lines.push(balancesLine);
    }

    return lines.join("\n");
  }

  private buildTransactionStatusLine(status: TransactionStatus): string {
    switch (status.status) {
      case "confirmed": {
        if (status.blockNumber !== undefined) {
          return `On-chain status: confirmed in block ${status.blockNumber}.`;
        }

        return "On-chain status: confirmed.";
      }
      case "failed":
        return `On-chain status: failed. ${status.summary}`;
      case "pending":
      case "submitted":
      case "not_found":
        return "Waiting for transaction to confirm.";
      default:
        return `On-chain status: ${status.status}.`;
    }
  }

  private buildBroadcastResponseResult(
    tool: ToolName,
    receipt: BroadcastReceipt,
    prepared?: PreparedTransaction,
  ): unknown {
    if (tool === "swapNeoN3Token") {
      return {
        postTransactionBalances: receipt.postTransactionBalances ?? null,
        transactionExplorerUrl: this.buildDoraTransactionExplorerUrl(
          receipt.broadcast,
          prepared,
        ),
      };
    }

    return receipt;
  }

  private buildDoraTransactionExplorerUrl(
    broadcast: BroadcastResult,
    prepared?: PreparedTransaction,
  ): string | null {
    if (broadcast.network !== "neoN3") {
      return null;
    }

    const explorerNetwork = this.resolveDoraExplorerNetwork(prepared);

    if (!explorerNetwork) {
      return null;
    }

    return `https://dora.coz.io/transaction/neo3/${explorerNetwork}/${broadcast.txHash}`;
  }

  private resolveDoraExplorerNetwork(
    prepared?: PreparedTransaction,
  ): "mainnet" | "testnet" | undefined {
    if (prepared?.networkMagic === AgentRuntime.neoN3MainnetNetworkMagic) {
      return "mainnet";
    }

    if (prepared?.networkMagic === AgentRuntime.neoN3TestnetNetworkMagic) {
      return "testnet";
    }

    return undefined;
  }

  private buildConfirmationProgressLabel(tool: ToolName): string {
    switch (tool) {
      case "swapNeoN3Token":
        return "Swap submitted. Tracking on-chain confirmation...";
      case "sendNeoN3Gas":
      case "sendNeoN3Token":
        return "Transfer submitted. Tracking on-chain confirmation...";
      case "neox_prepare_native_transfer":
      case "neox_prepare_erc20_transfer":
      case "neox_prepare_contract_write":
        return "Neo X transaction submitted. Tracking EVM receipt...";
      default:
        return "Transaction submitted. Tracking on-chain confirmation...";
    }
  }

  private buildPostTransactionBalancesLine(
    balances: PostTransactionBalances | undefined,
    prepared?: PreparedTransaction,
  ): string | undefined {
    if (!balances || balances.tokens.length === 0) {
      return undefined;
    }

    const balanceSummary = balances.tokens
      .map((entry) => {
        if (entry.balance) {
          return `${entry.balance.symbol} ${entry.balance.balance}`;
        }

        return `${entry.requestedToken} unavailable`;
      })
      .join(", ");
    const label =
      prepared?.action === "swapNeoN3Token"
        ? "Post-swap wallet balances"
        : "Current wallet balances";

    return `${label}: ${balanceSummary}.`;
  }

  private sleep(durationMs: number): Promise<void> {
    if (durationMs <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    });
  }

  public async getReadinessStatus(): Promise<{
    neoN3: Awaited<ReturnType<NeoProvider["checkReadiness"]>>["neoN3"];
    neoX: Awaited<ReturnType<NeoProvider["checkReadiness"]>>["neoX"];
    sessions: ReturnType<SessionStore["getStats"]>;
    toolCount: number;
  }> {
    const readiness = await this.neo.checkReadiness();

    return {
      neoN3: readiness.neoN3,
      neoX: readiness.neoX,
      sessions: this.sessions.getStats(),
      toolCount: this.registry.listToolNames().length,
    };
  }

  public getOperationalSnapshot(): {
    sessions: ReturnType<SessionStore["getStats"]>;
    toolCount: number;
  } {
    return {
      sessions: this.sessions.getStats(),
      toolCount: this.registry.listToolNames().length,
    };
  }

  private durationMs(startedAt: bigint): number {
    return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  }
}

import { z } from "zod";

import {
  extractNeoN3AddressOrName,
  isNeoN3AddressReference,
  resolveAddressReference,
} from "../core/addressResolver";
import { formatNetworkLabel } from "../core/formatting";
import { LlmPlanningError } from "../core/errors";
import { logger } from "../core/logger";
import { hash256Schema } from "../core/validation";
import type { LlmProvider } from "../llm/provider";
import type { NeoNetwork } from "../neo/types";
import type {
  PlannerAction,
  PlannerContext,
  PlannerToolDescriptor,
  ToolName,
} from "./types";

const plannerResponseSchema = z.object({
  intent: z.string(),
  tool: z.string().nullable(),
  arguments: z.record(z.string(), z.unknown()).default({}),
  needsConfirmation: z.boolean().default(false),
  missingInputs: z.array(z.string()).default([]),
  explanation: z.string().optional(),
});

const contractHashPattern = /\b(0x[a-fA-F0-9]{40})\b/;

interface PlannerServiceOptions {
  tools: PlannerToolDescriptor[];
  provider?: LlmProvider;
}

export class PlannerService {
  private readonly tools: PlannerToolDescriptor[];
  private readonly provider?: LlmProvider;

  public constructor(options: PlannerServiceOptions) {
    this.tools = options.tools;
    this.provider = options.provider;
  }

  public async plan(
    message: string,
    context: PlannerContext,
  ): Promise<PlannerAction> {
    if (this.provider) {
      try {
        const rawOutput = await this.provider.plan({
          message,
          context,
          tools: this.tools,
        });

        return this.normalizePlan(this.parseProviderOutput(rawOutput));
      } catch (error) {
        logger.warn("Falling back to heuristic planner.", {
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    return this.heuristicPlan(message, context);
  }

  private parseProviderOutput(rawOutput: string): PlannerAction {
    const jsonCandidate = this.extractJsonObject(rawOutput);
    const parsed = plannerResponseSchema.safeParse(JSON.parse(jsonCandidate));

    if (!parsed.success) {
      throw new LlmPlanningError(
        "Planner response could not be validated.",
        parsed.error.flatten(),
      );
    }

    return this.normalizePlan(parsed.data);
  }

  private normalizePlan(
    plan: z.infer<typeof plannerResponseSchema>,
  ): PlannerAction {
    const selectedTool =
      plan.tool && this.isSupportedTool(plan.tool) ? plan.tool : null;
    const descriptor = selectedTool
      ? this.tools.find((tool) => tool.name === selectedTool)
      : undefined;

    return {
      intent: plan.intent,
      tool: selectedTool,
      arguments: plan.arguments,
      needsConfirmation: descriptor ? descriptor.dangerous : false,
      missingInputs: plan.missingInputs,
      explanation: plan.explanation,
    };
  }

  private heuristicPlan(
    message: string,
    context: PlannerContext,
  ): PlannerAction {
    const trimmedMessage = message.trim();
    const lowerMessage = trimmedMessage.toLowerCase();
    const requestedNetwork = this.detectRequestedNetwork(lowerMessage);
    const neoN3WalletAddress = this.getWalletAddress(context, "neoN3");
    const resolvedAddress = resolveAddressReference(trimmedMessage, context);
    const neoN3Recipient =
      extractNeoN3AddressOrName(trimmedMessage) ??
      (resolvedAddress && isNeoN3AddressReference(resolvedAddress)
        ? resolvedAddress
        : undefined);
    const isSwapMessage =
      /\bswap\b/.test(lowerMessage) ||
      /\bflamingo\b/.test(lowerMessage) ||
      /\bbest route\b/.test(lowerMessage) ||
      /\bmin(?:imum)? received\b/.test(lowerMessage);
    const swapParameters = this.extractSwapParameters(trimmedMessage);
    const isImperativeSwap = /^\s*swap\b/i.test(trimmedMessage);

    if (this.isConfirmMessage(lowerMessage)) {
      return {
        intent: "confirm_action",
        tool: null,
        arguments: {},
        needsConfirmation: false,
        missingInputs: [],
        explanation: context.pendingAction
          ? "The user confirmed the pending action."
          : "The user asked to confirm.",
      };
    }

    if (this.isCancelMessage(lowerMessage)) {
      return {
        intent: "cancel_action",
        tool: null,
        arguments: {},
        needsConfirmation: false,
        missingInputs: [],
        explanation: "The user wants to cancel the pending action.",
      };
    }

    if (
      requestedNetwork &&
      !this.isImplementedNetwork(requestedNetwork, context)
    ) {
      return this.createUnavailableNetworkPlan(requestedNetwork);
    }

    if (isSwapMessage) {
      const missingInputs = [];

      if (!swapParameters.amount) {
        missingInputs.push("amount");
      }

      if (!swapParameters.fromToken) {
        missingInputs.push("fromToken");
      }

      if (!swapParameters.toToken) {
        missingInputs.push("toToken");
      }

      const swapArguments = {
        amount: swapParameters.amount,
        fromToken: swapParameters.fromToken,
        toToken: swapParameters.toToken,
        slippagePercent: swapParameters.slippagePercent,
        deadlineMinutes: swapParameters.deadlineMinutes,
        force: swapParameters.force,
      };

      if (
        !swapParameters.force &&
        this.isSwapQuoteRequest(lowerMessage) &&
        !isImperativeSwap
      ) {
        return {
          intent: "get_neo_n3_swap_quote",
          tool: "getNeoN3SwapQuote",
          arguments: swapArguments,
          needsConfirmation: false,
          missingInputs,
          explanation: "Detected a Neo N3 Flamingo swap quote request.",
        };
      }

      return {
        intent: "swap_neo_n3_token",
        tool: "swapNeoN3Token",
        arguments: swapArguments,
        needsConfirmation: true,
        missingInputs,
        explanation: swapParameters.force
          ? "Detected a forced Neo N3 Flamingo swap request."
          : "Detected a Neo N3 Flamingo swap request.",
      };
    }

    const requestedOwnPortfolio = /\bmy (?:portfolio|balances|holdings)\b/.test(
      lowerMessage,
    );
    const wantsPortfolioOverview =
      requestedOwnPortfolio ||
      /\bportfolio\b/.test(lowerMessage) ||
      /\b(?:holdings|balance) overview\b/.test(lowerMessage) ||
      /\boverview of (?:my |this |that |same )?(?:portfolio|balances|holdings)\b/.test(
        lowerMessage,
      ) ||
      /\bsummary of (?:my |this |that |same )?(?:portfolio|balances|holdings)\b/.test(
        lowerMessage,
      ) ||
      lowerMessage.includes("all balances");
    const portfolioAddress = neoN3Recipient ?? neoN3WalletAddress;

    if (wantsPortfolioOverview) {
      return {
        intent: "get_neo_n3_portfolio_overview",
        tool: "getNeoN3PortfolioOverview",
        arguments: {
          address: portfolioAddress,
        },
        needsConfirmation: false,
        missingInputs: portfolioAddress ? [] : ["address"],
        explanation: "Detected a Neo N3 portfolio overview request.",
      };
    }

    const neoN3TransferHistoryLimitMatch = trimmedMessage.match(
      /\b(?:last|recent)\s+(\d+)\s+(?:transfers|token transfers|nep-17 transfers)\b/i,
    );
    const wantsNeoN3TransferHistory =
      /\b(?:transfer|token|nep-17)\s+history\b/.test(lowerMessage) ||
      /\brecent\b.*\b(?:transfers|token transfers|nep-17 transfers)\b/.test(
        lowerMessage,
      ) ||
      /\bshow\b.*\b(?:transfers|token transfers|nep-17 transfers)\b/.test(
        lowerMessage,
      );

    if (wantsNeoN3TransferHistory) {
      const address = neoN3Recipient ?? neoN3WalletAddress;

      return {
        intent: "get_neo_n3_transfer_history",
        tool: "getNeoN3TransferHistory",
        arguments: {
          address,
          limit: neoN3TransferHistoryLimitMatch
            ? Number(neoN3TransferHistoryLimitMatch[1])
            : undefined,
        },
        needsConfirmation: false,
        missingInputs: address ? [] : ["address"],
        explanation: "Detected a Neo N3 transfer history request.",
      };
    }

    const lastTransactionStatusRequest =
      /\bstatus\b.*\b(?:last|latest|most recent)\s+(?:transaction|tx)\b/.test(
        lowerMessage,
      ) ||
      /\b(?:last|latest|most recent)\s+(?:transaction|tx)\b.*\b(?:status|state|check|watch|track)\b/.test(
        lowerMessage,
      ) ||
      /\bwhat happened to (?:my )?(?:last|latest|most recent)\s+(?:transaction|tx)\b/.test(
        lowerMessage,
      );

    if (lastTransactionStatusRequest) {
      return {
        intent: "get_last_transaction_status",
        tool: "getLastTransactionStatus",
        arguments: {},
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a request for the latest transaction status.",
      };
    }

    const recentActionsLimitMatch = trimmedMessage.match(
      /\b(?:last|recent)\s+(\d+)\s+(?:actions|transactions|txs)\b/i,
    );
    const wantsRecentActions =
      /\b(?:recent|latest|last)\s+(?:actions|activity|transactions|txs)\b/.test(
        lowerMessage,
      ) ||
      /\bshow\b.*\b(?:recent|last)\b.*\b(?:actions|activity|transactions|txs)\b/.test(
        lowerMessage,
      ) ||
      /\b(?:activity|history)\b.*\b(?:transactions|txs|actions)\b/.test(
        lowerMessage,
      );

    if (wantsRecentActions) {
      return {
        intent: "get_recent_actions",
        tool: "getRecentActions",
        arguments: {
          address: neoN3Recipient,
          limit: recentActionsLimitMatch
            ? Number(recentActionsLimitMatch[1])
            : undefined,
        },
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a recent action history request.",
      };
    }

    const sendAmountMatch = trimmedMessage.match(
      /\bsend\s+([0-9]+(?:\.[0-9]+)?)\s+gas\b/i,
    );

    if (sendAmountMatch) {
      return {
        intent: "send_neo_n3_gas",
        tool: "sendNeoN3Gas",
        arguments: {
          amount: sendAmountMatch[1],
          to: neoN3Recipient,
        },
        needsConfirmation: true,
        missingInputs: neoN3Recipient ? [] : ["to"],
        explanation: "Detected a Neo N3 GAS transfer request.",
      };
    }

    const sendNeoN3TokenMatch =
      trimmedMessage.match(
        /\bsend\s+([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z0-9._:-]+)\b/i,
      ) ?? undefined;

    if (sendNeoN3TokenMatch && sendNeoN3TokenMatch[2].toLowerCase() !== "gas") {
      return {
        intent: "send_neo_n3_token",
        tool: "sendNeoN3Token",
        arguments: {
          amount: sendNeoN3TokenMatch[1],
          token: sendNeoN3TokenMatch[2],
          to: neoN3Recipient,
        },
        needsConfirmation: true,
        missingInputs: neoN3Recipient ? [] : ["to"],
        explanation: "Detected a Neo N3 token transfer request.",
      };
    }

    const asksGasBalance =
      lowerMessage.includes("gas balance") ||
      /\bhow much\b.*\bgas\b/.test(lowerMessage) ||
      /\bbalance\b.*\bgas\b/.test(lowerMessage);

    if (asksGasBalance) {
      const address = neoN3Recipient ?? neoN3WalletAddress;

      return {
        intent: "get_neo_n3_token_balance",
        tool: "getNeoN3TokenBalances",
        arguments: {
          address,
          token: "GAS",
        },
        needsConfirmation: false,
        missingInputs: address ? [] : ["address"],
        explanation: "Detected a Neo N3 GAS balance request.",
      };
    }

    const specificTokenBalanceMatch =
      trimmedMessage.match(
        /\b(?:balance of|how much)\s+([A-Za-z0-9._:-]+)\b.*\b(?:my address|my wallet|my account|this address|that address|same address)\b/i,
      ) ??
      trimmedMessage.match(
        /\bhow much\s+([A-Za-z0-9._:-]+)\s+(?:do i have|i have)\b/i,
      );

    if (
      specificTokenBalanceMatch &&
      specificTokenBalanceMatch[1].toLowerCase() !== "gas"
    ) {
      const address = neoN3Recipient ?? neoN3WalletAddress;

      return {
        intent: "get_neo_n3_token_balance",
        tool: "getNeoN3TokenBalances",
        arguments: {
          address,
          token: specificTokenBalanceMatch[1],
        },
        needsConfirmation: false,
        missingInputs: address ? [] : ["address"],
        explanation: "Detected a Neo N3 token balance request.",
      };
    }

    if (
      lowerMessage.includes("token balances") ||
      lowerMessage.includes("nep-17 balances") ||
      lowerMessage.includes("all balances")
    ) {
      const address = neoN3Recipient ?? neoN3WalletAddress;

      return {
        intent: "get_neo_n3_token_balances",
        tool: "getNeoN3TokenBalances",
        arguments: {
          address,
        },
        needsConfirmation: false,
        missingInputs: address ? [] : ["address"],
        explanation: "Detected a Neo N3 token balance request.",
      };
    }

    const hashMatch = trimmedMessage.match(/(0x)?[0-9a-fA-F]{64}/);

    if (
      (lowerMessage.includes("transaction") || lowerMessage.includes("tx")) &&
      hashMatch
    ) {
      return {
        intent: "get_transaction",
        tool: "getTransaction",
        arguments: {
          hash: hash256Schema.parse(hashMatch[0]),
          network: requestedNetwork,
        },
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a transaction lookup request.",
      };
    }

    const blockHashMatch = trimmedMessage.match(
      /\bblock\b.*((0x)?[0-9a-fA-F]{64})/i,
    );
    const blockHeightMatch = trimmedMessage.match(/\bblock\b.*?(\d+)/i);

    if (
      lowerMessage.includes("block") &&
      (blockHashMatch || blockHeightMatch)
    ) {
      return {
        intent: "get_block",
        tool: "getBlock",
        arguments: blockHashMatch
          ? {
              hash: hash256Schema.parse(blockHashMatch[1]),
              network: requestedNetwork,
            }
          : {
              height: Number(blockHeightMatch?.[1]),
              network: requestedNetwork,
            },
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a block lookup request.",
      };
    }

    const contractHashMatch = trimmedMessage.match(contractHashPattern);
    const neoN3ReadOperationMatch = trimmedMessage.match(
      /\b(?:call|read|invoke)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i,
    );
    const neoN3WriteOperationMatch = trimmedMessage.match(
      /\b(?:prepare|write)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i,
    );

    if (contractHashMatch && neoN3ReadOperationMatch) {
      return {
        intent: "invoke_neo_n3_read",
        tool: "invokeNeoN3Read",
        arguments: {
          contractHash: contractHashMatch[1],
          operation: neoN3ReadOperationMatch[1],
          args: [],
        },
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a Neo N3 read-only contract invocation request.",
      };
    }

    if (contractHashMatch && neoN3WriteOperationMatch) {
      return {
        intent: "prepare_neo_n3_contract_write",
        tool: "prepareNeoN3ContractWrite",
        arguments: {
          contractHash: contractHashMatch[1],
          operation: neoN3WriteOperationMatch[1],
          args: [],
        },
        needsConfirmation: true,
        missingInputs: [],
        explanation: "Detected a Neo N3 contract write preparation request.",
      };
    }

    if (
      /\bwallet address\b/.test(lowerMessage) ||
      /\bmy\s+address\b/.test(lowerMessage)
    ) {
      return {
        intent: "get_wallet_address",
        tool: "getWalletAddress",
        arguments: requestedNetwork
          ? {
              network: requestedNetwork,
            }
          : {},
        needsConfirmation: false,
        missingInputs: [],
        explanation: requestedNetwork
          ? `Detected a ${formatNetworkLabel(requestedNetwork)} wallet address request.`
          : "Detected a wallet address request.",
      };
    }

    return {
      intent: "unknown",
      tool: null,
      arguments: {},
      needsConfirmation: false,
      missingInputs: [],
      explanation:
        "I could not map that request to a supported Neo action. Try a balance lookup, block or transaction lookup, contract call, transfer, or Flamingo swap request on an implemented network.",
    };
  }

  private extractJsonObject(rawOutput: string): string {
    const firstBrace = rawOutput.indexOf("{");
    const lastBrace = rawOutput.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new LlmPlanningError(
        "Planner response did not contain a JSON object.",
      );
    }

    return rawOutput.slice(firstBrace, lastBrace + 1);
  }

  private isSupportedTool(tool: string): tool is ToolName {
    return this.tools.some((entry) => entry.name === tool);
  }

  private createUnavailableNetworkPlan(network: NeoNetwork): PlannerAction {
    return {
      intent: "unsupported_network",
      tool: null,
      arguments: {
        network,
      },
      needsConfirmation: false,
      missingInputs: [],
      explanation: `${formatNetworkLabel(network)} support is planned but not implemented yet in this agent.`,
    };
  }

  private getWalletAddress(
    context: PlannerContext,
    network: NeoNetwork,
  ): string | undefined {
    return (
      context.walletAddresses[network] ??
      (context.defaultNetwork === network ? context.walletAddress : undefined)
    );
  }

  private detectRequestedNetwork(message: string): NeoNetwork | undefined {
    if (/\bneo\s*x\b|\bevm\b/.test(message)) {
      return "neoX";
    }

    if (/\bneo\s*n3\b|\bon\s+n3\b|\bn3\b/.test(message)) {
      return "neoN3";
    }

    return undefined;
  }

  private isImplementedNetwork(
    network: NeoNetwork,
    context: PlannerContext,
  ): boolean {
    return context.implementedNetworks.includes(network);
  }

  private extractSwapParameters(message: string): {
    amount?: string;
    fromToken?: string;
    toToken?: string;
    slippagePercent?: string;
    deadlineMinutes?: number;
    force: boolean;
  } {
    const swapMatch = message.match(
      /\bswap(?:\s+([0-9]+(?:\.[0-9]+)?))?(?:\s+([A-Za-z][A-Za-z0-9._:-]*))?(?:\s+(?:for|to)\s+([A-Za-z][A-Za-z0-9._:-]*))?/i,
    );
    const routeMatch = message.match(
      /\b([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z][A-Za-z0-9._:-]*)\s+(?:for|to)\s+([A-Za-z][A-Za-z0-9._:-]*)/i,
    );
    const fromTokenMatch = message.match(
      /\b(?:from|using)\s+([A-Za-z][A-Za-z0-9._:-]*)\b/i,
    );
    const toTokenMatch = message.match(
      /\b(?:for|to)\s+([A-Za-z][A-Za-z0-9._:-]*)\b/i,
    );
    const slippageLeadingMatch = message.match(
      /\b(?:slippage|max slippage)\s+(?:of\s+)?([0-9]+(?:\.[0-9]+)?)%?\b/i,
    );
    const slippageTrailingMatch = message.match(
      /\b([0-9]+(?:\.[0-9]+)?)%\s+slippage\b/i,
    );
    const deadlineLeadingMatch = message.match(
      /\bdeadline\s+(?:of\s+)?([0-9]+)\s*(?:m|min|minute|minutes)\b/i,
    );
    const deadlineTrailingMatch = message.match(
      /\b([0-9]+)\s*(?:m|min|minute|minutes)\s+deadline\b/i,
    );
    const deadlineCandidate =
      deadlineLeadingMatch?.[1] ?? deadlineTrailingMatch?.[1];

    return {
      amount: swapMatch?.[1] ?? routeMatch?.[1],
      fromToken: swapMatch?.[2] ?? routeMatch?.[2] ?? fromTokenMatch?.[1],
      toToken: swapMatch?.[3] ?? routeMatch?.[3] ?? toTokenMatch?.[1],
      slippagePercent: slippageLeadingMatch?.[1] ?? slippageTrailingMatch?.[1],
      deadlineMinutes: deadlineCandidate
        ? Number(deadlineCandidate)
        : undefined,
      force: /\bforce\b/i.test(message),
    };
  }

  private isSwapQuoteRequest(message: string): boolean {
    return (
      /\bquote\b/.test(message) ||
      /\bhow much\b/.test(message) ||
      /\b(?:would|will)\s+i\s+get\b/.test(message) ||
      /\bexpected\b/.test(message) ||
      /\breceive\b/.test(message) ||
      /\broute\b/.test(message) ||
      /\bslippage\b/.test(message) ||
      /\bdeadline\b/.test(message) ||
      /\bmin(?:imum)? received\b/.test(message)
    );
  }

  private isConfirmMessage(message: string): boolean {
    return /^(confirm|yes|approve|go ahead|send it|do it|ok[,]?\s*do it|okay[,]?\s*do it|proceed)$/i.test(
      message.trim(),
    );
  }

  private isCancelMessage(message: string): boolean {
    return /^(cancel|stop|never mind|abort)$/i.test(message.trim());
  }
}

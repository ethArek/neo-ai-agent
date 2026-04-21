import { z } from "zod";

import { LlmPlanningError } from "../core/errors";
import { logger } from "../core/logger";
import { hash256Schema, isNeoN3Address } from "../core/validation";
import type { LlmProvider } from "../llm/provider";
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

const addressPattern = /(0x[a-fA-F0-9]{40})/;
const neoNsPattern =
  /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.neo)\b/i;

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
    const resolvedAddress = this.resolveAddressReference(
      trimmedMessage,
      context,
    );
    const neoN3Recipient = this.extractNeoN3AddressOrName(trimmedMessage);
    const implicitNeoN3Address =
      neoN3Recipient ??
      (resolvedAddress && this.isNeoN3AddressReference(resolvedAddress)
        ? resolvedAddress
        : undefined);
    const implicitNeoXAddress =
      resolvedAddress && this.isEvmAddressReference(resolvedAddress)
        ? resolvedAddress
        : undefined;
    const isNeoN3Message =
      /\bneo\s*n3\b/.test(lowerMessage) ||
      /\bon\s+n3\b/.test(lowerMessage) ||
      /\bn3\b/.test(lowerMessage) ||
      Boolean(implicitNeoN3Address);
    const swapParameters = this.extractSwapParameters(trimmedMessage);
    const isFlamingoSwapMessage =
      (/\bswap\b/.test(lowerMessage) ||
        /\bflamingo\b/.test(lowerMessage) ||
        /\bbest route\b/.test(lowerMessage) ||
        /\bmin(?:imum)? received\b/.test(lowerMessage)) &&
      (isNeoN3Message || /\bflamingo\b/.test(lowerMessage));
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

    if (isFlamingoSwapMessage) {
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
          explanation: "Detected a Flamingo swap quote request on Neo N3.",
        };
      }

      return {
        intent: "swap_neo_n3_token",
        tool: "swapNeoN3Token",
        arguments: swapArguments,
        needsConfirmation: true,
        missingInputs,
        explanation: swapParameters.force
          ? "Detected a force Flamingo swap request on Neo N3."
          : "Detected a Flamingo swap request on Neo N3.",
      };
    }

    const bridgeDirection = this.resolveBridgeDirection(lowerMessage);
    const bridgeAmountMatch = trimmedMessage.match(
      /\b(?:bridge|deposit|withdraw)\s+([0-9]+(?:\.[0-9]+)?)\s+gas\b/i,
    );
    const bridgeRequest =
      bridgeDirection &&
      /\bgas\b/.test(lowerMessage) &&
      /\b(?:bridge|deposit|withdraw)\b/.test(lowerMessage);
    const wantsBridgeQuote =
      Boolean(bridgeDirection) &&
      (/\bbridge\b.*\b(?:fee|quote|cost|eta|limit|limits|min|max)\b/.test(
        lowerMessage,
      ) ||
        /\b(?:fee|quote|cost|eta|limit|limits|min|max)\b.*\bbridge\b/.test(
          lowerMessage,
        ) ||
        /\bexpected received\b/.test(lowerMessage));
    const wantsBridgeStatus =
      /\bbridge\b.*\b(?:status|track|arrived|arrival|complete|completed)\b/.test(
        lowerMessage,
      ) ||
      /\bdid\b.*\bbridge\b.*\barrive\b/.test(lowerMessage) ||
      /\bstatus of (?:my |the )?last bridge\b/.test(lowerMessage);

    if (wantsBridgeQuote && bridgeDirection) {
      const destination = this.resolveBridgeDestination(
        trimmedMessage,
        bridgeDirection,
        context,
      );

      return {
        intent: "get_gas_bridge_quote",
        tool: "getGasBridgeQuote",
        arguments: {
          direction: bridgeDirection,
          amount: bridgeAmountMatch?.[1],
          to: destination,
        },
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a bridge quote request.",
      };
    }

    if (wantsBridgeStatus) {
      return {
        intent: "get_bridge_status",
        tool: "getBridgeStatus",
        arguments: {},
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a bridge status request.",
      };
    }

    if (bridgeDirection && bridgeAmountMatch) {
      const destination = this.resolveBridgeDestination(
        trimmedMessage,
        bridgeDirection,
        context,
      );

      return {
        intent: "bridge_gas",
        tool: "bridgeGas",
        arguments: {
          direction: bridgeDirection,
          amount: bridgeAmountMatch[1],
          to: destination,
        },
        needsConfirmation: true,
        missingInputs: [],
        explanation: "Detected a GAS bridge request.",
      };
    }

    if (bridgeDirection && bridgeRequest) {
      const destination = this.resolveBridgeDestination(
        trimmedMessage,
        bridgeDirection,
        context,
      );

      return {
        intent: "bridge_gas",
        tool: "bridgeGas",
        arguments: {
          direction: bridgeDirection,
          to: destination,
        },
        needsConfirmation: true,
        missingInputs: ["amount"],
        explanation:
          "Detected a GAS bridge request that still needs an amount.",
      };
    }

    const approveMatch = trimmedMessage.match(
      /\bapprove\s+([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z0-9._:-]+)(?:\s+(?:for|to)\s+(0x[a-fA-F0-9]{40}))?/i,
    );

    if (approveMatch) {
      return {
        intent: "approve_erc20",
        tool: "approveErc20",
        arguments: {
          amount: approveMatch[1],
          token: approveMatch[2],
          spender: approveMatch[3],
        },
        needsConfirmation: true,
        missingInputs: approveMatch[3] ? [] : ["spender"],
        explanation: "Detected an ERC-20 approval request.",
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
    const wantsCombinedPortfolioOverview =
      lowerMessage.includes("all balances") ||
      /\bcombined\b/.test(lowerMessage) ||
      /\bboth\b.*\b(?:portfolio|balances|holdings)\b/.test(lowerMessage) ||
      /\b(?:portfolio|balances|holdings)\b.*\bboth\b/.test(lowerMessage) ||
      (/\bneo\s*x\b/.test(lowerMessage) &&
        (/\bneo\s*n3\b/.test(lowerMessage) ||
          /\bon\s+n3\b/.test(lowerMessage)));
    const wantsNeoXPortfolioOverview =
      wantsPortfolioOverview &&
      /\bneo\s*x\b/.test(lowerMessage) &&
      !wantsCombinedPortfolioOverview;
    const wantsNeoN3PortfolioOverview =
      wantsPortfolioOverview &&
      (/\bneo\s*n3\b/.test(lowerMessage) ||
        /\bon\s+n3\b/.test(lowerMessage) ||
        /\bn3\s+(?:portfolio|balances|holdings)\b/.test(lowerMessage) ||
        /\b(?:portfolio|balances|holdings)\s+(?:on\s+)?n3\b/.test(
          lowerMessage,
        ));
    const portfolioAddress =
      implicitNeoXAddress ??
      (requestedOwnPortfolio ||
      wantsCombinedPortfolioOverview ||
      wantsNeoXPortfolioOverview
        ? context.neoXWalletAddress
        : undefined);
    const portfolioNeoN3Address =
      implicitNeoN3Address ??
      (wantsCombinedPortfolioOverview || wantsNeoN3PortfolioOverview
        ? context.neoN3WalletAddress
        : undefined);
    const shouldPreferNeoN3PortfolioOverview =
      wantsPortfolioOverview &&
      !wantsCombinedPortfolioOverview &&
      !wantsNeoXPortfolioOverview &&
      Boolean(
        isNeoN3Message || implicitNeoN3Address || context.neoN3WalletAddress,
      );

    if (wantsNeoN3PortfolioOverview || shouldPreferNeoN3PortfolioOverview) {
      return {
        intent: "get_neo_n3_portfolio_overview",
        tool: "getNeoN3PortfolioOverview",
        arguments: {
          address: implicitNeoN3Address ?? context.neoN3WalletAddress,
        },
        needsConfirmation: false,
        missingInputs: [],
        explanation:
          wantsNeoN3PortfolioOverview || isNeoN3Message
            ? "Detected a Neo N3 portfolio overview request."
            : "Detected a Neo N3-first portfolio overview request.",
      };
    }

    if (wantsPortfolioOverview) {
      return {
        intent: "get_portfolio_overview",
        tool: "getPortfolioOverview",
        arguments: {
          address: portfolioAddress,
          neoN3Address: portfolioNeoN3Address,
        },
        needsConfirmation: false,
        missingInputs:
          portfolioAddress ||
          portfolioNeoN3Address ||
          context.neoXWalletAddress ||
          context.neoN3WalletAddress
            ? []
            : ["address"],
        explanation: "Detected a portfolio overview request.",
      };
    }

    const neoN3TransferHistoryLimitMatch = trimmedMessage.match(
      /\b(?:last|recent)\s+(\d+)\s+(?:transfers|token transfers|nep-17 transfers)\b/i,
    );
    const wantsNeoN3TransferHistory =
      isNeoN3Message &&
      (/\b(?:transfer|token|nep-17)\s+history\b/.test(lowerMessage) ||
        /\brecent\b.*\b(?:transfers|token transfers|nep-17 transfers)\b/.test(
          lowerMessage,
        ) ||
        /\bshow\b.*\b(?:transfers|token transfers|nep-17 transfers)\b/.test(
          lowerMessage,
        ));

    if (wantsNeoN3TransferHistory) {
      return {
        intent: "get_neo_n3_transfer_history",
        tool: "getNeoN3TransferHistory",
        arguments: {
          address: neoN3Recipient,
          limit: neoN3TransferHistoryLimitMatch
            ? Number(neoN3TransferHistoryLimitMatch[1])
            : undefined,
        },
        needsConfirmation: false,
        missingInputs: [],
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
    const recentActionsAddress = resolvedAddress ?? neoN3Recipient;

    if (wantsRecentActions) {
      return {
        intent: "get_recent_actions",
        tool: "getRecentActions",
        arguments: {
          address: recentActionsAddress,
          limit: recentActionsLimitMatch
            ? Number(recentActionsLimitMatch[1])
            : undefined,
        },
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a recent action history request.",
      };
    }

    const sendGasMatch = trimmedMessage.match(
      /\bsend\s+([0-9]+(?:\.[0-9]+)?)\s+gas\s+(?:to\s+)?(0x[a-fA-F0-9]{40})/i,
    );
    const sendAmountMatch = trimmedMessage.match(
      /\bsend\s+([0-9]+(?:\.[0-9]+)?)\s+gas\b/i,
    );
    const isBridgeRequest = /\b(?:bridge|deposit|withdraw)\b/.test(
      lowerMessage,
    );

    if (
      sendAmountMatch &&
      !isBridgeRequest &&
      this.prefersNeoN3Transfer(lowerMessage, neoN3Recipient)
    ) {
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

    if (sendGasMatch) {
      return {
        intent: "send_gas",
        tool: "sendGas",
        arguments: {
          amount: sendGasMatch[1],
          to: sendGasMatch[2],
        },
        needsConfirmation: true,
        missingInputs: [],
        explanation: "Detected a native GAS transfer request.",
      };
    }

    const sendTokenMatch = trimmedMessage.match(
      /\bsend\s+([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z0-9._:-]+)\s+(?:to\s+)?(0x[a-fA-F0-9]{40})/i,
    );
    const sendNeoN3TokenMatch =
      trimmedMessage.match(
        /\bsend\s+([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z0-9._:-]+)\b/i,
      ) ?? undefined;

    if (
      sendNeoN3TokenMatch &&
      sendNeoN3TokenMatch[2].toLowerCase() !== "gas" &&
      !isBridgeRequest &&
      this.prefersNeoN3Transfer(lowerMessage, neoN3Recipient)
    ) {
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

    if (sendTokenMatch && sendTokenMatch[2].toLowerCase() !== "gas") {
      return {
        intent: "send_erc20",
        tool: "sendErc20",
        arguments: {
          amount: sendTokenMatch[1],
          token: sendTokenMatch[2],
          to: sendTokenMatch[3],
        },
        needsConfirmation: true,
        missingInputs: [],
        explanation: "Detected an ERC-20 transfer request.",
      };
    }

    const asksGasBalance =
      lowerMessage.includes("gas balance") ||
      /\bhow much\b.*\bgas\b/.test(lowerMessage) ||
      /\bbalance\b.*\bgas\b/.test(lowerMessage);

    if (asksGasBalance && isNeoN3Message) {
      return {
        intent: "get_neo_n3_token_balance",
        tool: "getNeoN3TokenBalances",
        arguments: {
          address: implicitNeoN3Address,
          token: "GAS",
        },
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a Neo N3 GAS balance request.",
      };
    }

    if (asksGasBalance) {
      return {
        intent: "get_balance",
        tool: "getBalance",
        arguments: {
          address: implicitNeoXAddress,
        },
        needsConfirmation: false,
        missingInputs: implicitNeoXAddress ? [] : ["address"],
        explanation: "Detected a native GAS balance request.",
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
      if (isNeoN3Message || implicitNeoN3Address) {
        return {
          intent: "get_neo_n3_token_balance",
          tool: "getNeoN3TokenBalances",
          arguments: {
            address: implicitNeoN3Address,
            token: specificTokenBalanceMatch[1],
          },
          needsConfirmation: false,
          missingInputs: [],
          explanation: "Detected a Neo N3 token balance request.",
        };
      }

      return {
        intent: "get_token_balance",
        tool: "getTokenBalances",
        arguments: {
          address: implicitNeoXAddress,
          token: specificTokenBalanceMatch[1],
        },
        needsConfirmation: false,
        missingInputs: implicitNeoXAddress ? [] : ["address"],
        explanation: "Detected a token balance request.",
      };
    }

    if (
      lowerMessage.includes("token balances") ||
      lowerMessage.includes("erc20 balances") ||
      lowerMessage.includes("all balances")
    ) {
      if (
        (isNeoN3Message || implicitNeoN3Address) &&
        !lowerMessage.includes("erc20")
      ) {
        return {
          intent: "get_neo_n3_token_balances",
          tool: "getNeoN3TokenBalances",
          arguments: {
            address: implicitNeoN3Address,
          },
          needsConfirmation: false,
          missingInputs: [],
          explanation: "Detected a Neo N3 token balance request.",
        };
      }

      return {
        intent: "get_token_balances",
        tool: "getTokenBalances",
        arguments: {
          address: implicitNeoXAddress,
        },
        needsConfirmation: false,
        missingInputs: implicitNeoXAddress ? [] : ["address"],
        explanation: "Detected a tracked ERC-20 balance request.",
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
            }
          : {
              height: Number(blockHeightMatch?.[1]),
            },
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a block lookup request.",
      };
    }

    const contractAddressMatch = trimmedMessage.match(addressPattern);
    const readSignatureMatch = trimmedMessage.match(
      /\b(?:call|read|invoke)\s+([A-Za-z_][A-Za-z0-9_]*\([^)]*\))/i,
    );
    const writeSignatureMatch = trimmedMessage.match(
      /\b(?:prepare|write|send)\s+([A-Za-z_][A-Za-z0-9_]*\([^)]*\))/i,
    );
    const neoN3ReadOperationMatch = trimmedMessage.match(
      /\b(?:call|read|invoke)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i,
    );
    const neoN3WriteOperationMatch = trimmedMessage.match(
      /\b(?:prepare|write)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i,
    );

    if (isNeoN3Message && contractAddressMatch && neoN3ReadOperationMatch) {
      return {
        intent: "invoke_neo_n3_read",
        tool: "invokeNeoN3Read",
        arguments: {
          contractHash: contractAddressMatch[1],
          operation: neoN3ReadOperationMatch[1],
          args: [],
        },
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a Neo N3 read-only contract invocation request.",
      };
    }

    if (isNeoN3Message && contractAddressMatch && neoN3WriteOperationMatch) {
      return {
        intent: "prepare_neo_n3_contract_write",
        tool: "prepareNeoN3ContractWrite",
        arguments: {
          contractHash: contractAddressMatch[1],
          operation: neoN3WriteOperationMatch[1],
          args: [],
        },
        needsConfirmation: true,
        missingInputs: [],
        explanation: "Detected a Neo N3 contract write preparation request.",
      };
    }

    if (contractAddressMatch && readSignatureMatch) {
      return {
        intent: "invoke_read",
        tool: "invokeRead",
        arguments: {
          contractAddress: contractAddressMatch[1],
          functionSignature: readSignatureMatch[1],
          args: [],
        },
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a read-only contract invocation request.",
      };
    }

    if (contractAddressMatch && writeSignatureMatch) {
      return {
        intent: "prepare_contract_write",
        tool: "prepareContractWrite",
        arguments: {
          contractAddress: contractAddressMatch[1],
          functionSignature: writeSignatureMatch[1],
          args: [],
        },
        needsConfirmation: true,
        missingInputs: [],
        explanation: "Detected a contract write preparation request.",
      };
    }

    if (
      /\bwallet address\b/.test(lowerMessage) ||
      /\bmy(?:\s+neo(?:\s*x|\s*n3))?\s+address\b/.test(lowerMessage)
    ) {
      const network =
        /\bneo\s*x\b/.test(lowerMessage) || /\bevm\b/.test(lowerMessage)
          ? "neoX"
          : /\bneo\s*n3\b/.test(lowerMessage) ||
              /\bon\s+n3\b/.test(lowerMessage)
            ? "neoN3"
            : undefined;

      return {
        intent: "get_wallet_address",
        tool: "getWalletAddress",
        arguments: {
          network,
        },
        needsConfirmation: false,
        missingInputs: [],
        explanation: "Detected a wallet address request.",
      };
    }

    return {
      intent: "unknown",
      tool: null,
      arguments: {},
      needsConfirmation: false,
      missingInputs: [],
      explanation:
        "I could not map that request to a supported Neo N3 or Neo X action. Try a balance lookup, block or transaction lookup, bridge, approval, contract call, or transfer request.",
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

  private resolveBridgeDirection(
    message: string,
  ): "neoN3ToNeoX" | "neoXToNeoN3" | undefined {
    if (/from\s+neo\s*n3\b.*\bto\s+neo\s*x\b/.test(message)) {
      return "neoN3ToNeoX";
    }

    if (/from\s+neo\s*x\b.*\bto\s+neo\s*n3\b/.test(message)) {
      return "neoXToNeoN3";
    }

    if (/\bdeposit\b/.test(message) && /\bneo\s*x\b/.test(message)) {
      return "neoN3ToNeoX";
    }

    if (/\bwithdraw\b/.test(message) && /\bneo\s*n3\b/.test(message)) {
      return "neoXToNeoN3";
    }

    if (/\bto\s+neo\s*x\b/.test(message)) {
      return "neoN3ToNeoX";
    }

    if (/\bto\s+neo\s*n3\b/.test(message)) {
      return "neoXToNeoN3";
    }

    return undefined;
  }

  private resolveBridgeDestination(
    message: string,
    direction: "neoN3ToNeoX" | "neoXToNeoN3",
    context: PlannerContext,
  ): string | undefined {
    if (direction === "neoN3ToNeoX") {
      const resolvedAddress = this.resolveAddressReference(message, context);

      if (resolvedAddress && this.isEvmAddressReference(resolvedAddress)) {
        return resolvedAddress;
      }

      return context.neoXWalletAddress;
    }

    return (
      this.extractNeoN3AddressOrName(message) ?? context.neoN3WalletAddress
    );
  }

  private resolveAddressReference(
    message: string,
    context: PlannerContext,
  ): string | undefined {
    const explicitAddressMatch = message.match(addressPattern);

    if (explicitAddressMatch) {
      return explicitAddressMatch[1];
    }

    const normalizedMessage = message.toLowerCase();

    if (this.referencesWalletAddress(normalizedMessage)) {
      return context.walletAddress ?? context.lastReferencedAddress;
    }

    if (this.referencesLastKnownAddress(normalizedMessage)) {
      return context.lastReferencedAddress ?? context.walletAddress;
    }

    return undefined;
  }

  private referencesWalletAddress(message: string): boolean {
    return /\bmy (?:address|wallet|account|wallet address)\b/.test(message);
  }

  private referencesLastKnownAddress(message: string): boolean {
    return /\b(?:this|that|same) (?:address|wallet|account)\b/.test(message);
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

  private isEvmAddressReference(address: string): boolean {
    return addressPattern.test(address);
  }

  private isNeoN3AddressReference(address: string): boolean {
    return isNeoN3Address(address) || neoNsPattern.test(address);
  }

  private prefersNeoN3Transfer(
    message: string,
    recipient: string | undefined,
  ): boolean {
    if (/\bneo\s*x\b/.test(message)) {
      return false;
    }

    if (/\bneo\s*n3\b|\bon\s+n3\b/.test(message)) {
      return true;
    }

    if (recipient) {
      return true;
    }

    return false;
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

import { approveErc20Tool } from "../tools/approveErc20";
import { bridgeGasTool } from "../tools/bridgeGas";
import { NotFoundError } from "../core/errors";
import { getBalanceTool } from "../tools/getBalance";
import { getBlockTool } from "../tools/getBlock";
import { getBridgeStatusTool } from "../tools/getBridgeStatus";
import { getGasBridgeQuoteTool } from "../tools/getGasBridgeQuote";
import { getLastTransactionStatusTool } from "../tools/getLastTransactionStatus";
import { getNeoN3PortfolioOverviewTool } from "../tools/getNeoN3PortfolioOverview";
import { getNeoN3SwapQuoteTool } from "../tools/getNeoN3SwapQuote";
import { getNeoN3TokenBalancesTool } from "../tools/getNeoN3TokenBalances";
import { getNeoN3TransferHistoryTool } from "../tools/getNeoN3TransferHistory";
import { getPortfolioOverviewTool } from "../tools/getPortfolioOverview";
import { getRecentActionsTool } from "../tools/getRecentActions";
import { getTokenBalancesTool } from "../tools/getTokenBalances";
import { getTransactionTool } from "../tools/getTransaction";
import { getWalletAddressTool } from "../tools/getWalletAddress";
import { invokeNeoN3ReadTool } from "../tools/invokeNeoN3Read";
import { invokeReadTool } from "../tools/invokeRead";
import { prepareNeoN3ContractWriteTool } from "../tools/prepareNeoN3ContractWrite";
import { prepareContractWriteTool } from "../tools/prepareContractWrite";
import { sendErc20Tool } from "../tools/sendErc20";
import { sendGasTool } from "../tools/sendGas";
import { sendNeoN3GasTool } from "../tools/sendNeoN3Gas";
import { sendNeoN3TokenTool } from "../tools/sendNeoN3Token";
import { swapNeoN3TokenTool } from "../tools/swapNeoN3Token";
import type { PlannerToolDescriptor, ToolDefinition, ToolName } from "./types";

const allTools = [
  getBalanceTool,
  getNeoN3PortfolioOverviewTool,
  getNeoN3TokenBalancesTool,
  getNeoN3TransferHistoryTool,
  getNeoN3SwapQuoteTool,
  getGasBridgeQuoteTool,
  getBridgeStatusTool,
  getPortfolioOverviewTool,
  getTokenBalancesTool,
  getTransactionTool,
  getLastTransactionStatusTool,
  getRecentActionsTool,
  getBlockTool,
  invokeReadTool,
  invokeNeoN3ReadTool,
  prepareContractWriteTool,
  prepareNeoN3ContractWriteTool,
  getWalletAddressTool,
  bridgeGasTool,
  sendGasTool,
  sendNeoN3GasTool,
  sendNeoN3TokenTool,
  swapNeoN3TokenTool,
  sendErc20Tool,
  approveErc20Tool,
] satisfies ToolDefinition[];

export class ToolRegistry {
  private readonly tools = new Map<ToolName, ToolDefinition>(
    allTools.map((tool) => [tool.name, tool] as const),
  );

  public get(name: ToolName): ToolDefinition {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new NotFoundError(`Tool '${name}' is not registered.`);
    }

    return tool;
  }

  public listPlannerTools(): PlannerToolDescriptor[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      argumentsDescription: tool.argumentsDescription,
      readOnly: tool.readOnly,
      dangerous: tool.dangerous,
    }));
  }

  public listToolNames(): ToolName[] {
    return [...this.tools.keys()];
  }
}

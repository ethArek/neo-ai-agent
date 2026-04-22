import { NotFoundError } from "../core/errors";
import { getBlockTool } from "../tools/getBlock";
import { getLastTransactionStatusTool } from "../tools/getLastTransactionStatus";
import { getNeoN3PortfolioOverviewTool } from "../tools/getNeoN3PortfolioOverview";
import { getNeoN3SwapQuoteTool } from "../tools/getNeoN3SwapQuote";
import { getNeoN3TokenBalancesTool } from "../tools/getNeoN3TokenBalances";
import { getNeoN3TransferHistoryTool } from "../tools/getNeoN3TransferHistory";
import { getNeoN3UnclaimedGasTool } from "../tools/getNeoN3UnclaimedGas";
import { getRecentActionsTool } from "../tools/getRecentActions";
import { getTransactionTool } from "../tools/getTransaction";
import { getWalletAddressTool } from "../tools/getWalletAddress";
import { invokeNeoN3ReadTool } from "../tools/invokeNeoN3Read";
import { prepareNeoN3ContractWriteTool } from "../tools/prepareNeoN3ContractWrite";
import { sendNeoN3GasTool } from "../tools/sendNeoN3Gas";
import { sendNeoN3TokenTool } from "../tools/sendNeoN3Token";
import { swapNeoN3TokenTool } from "../tools/swapNeoN3Token";
import type { PlannerToolDescriptor, ToolDefinition, ToolName } from "./types";

const allTools = [
  getNeoN3PortfolioOverviewTool,
  getNeoN3TokenBalancesTool,
  getNeoN3UnclaimedGasTool,
  getNeoN3TransferHistoryTool,
  getNeoN3SwapQuoteTool,
  getTransactionTool,
  getLastTransactionStatusTool,
  getRecentActionsTool,
  getBlockTool,
  invokeNeoN3ReadTool,
  prepareNeoN3ContractWriteTool,
  getWalletAddressTool,
  sendNeoN3GasTool,
  sendNeoN3TokenTool,
  swapNeoN3TokenTool,
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
      networks: tool.networks,
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

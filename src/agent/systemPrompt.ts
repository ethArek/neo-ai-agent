import { formatNetworkLabel } from "../core/formatting";
import { neoNetworks } from "../neo/types";
import type { PlannerContext, PlannerToolDescriptor } from "./types";

export function buildPlannerSystemPrompt(
  tools: PlannerToolDescriptor[],
  context: PlannerContext,
): string {
  const toolLines = tools
    .map((tool) => {
      const mode = tool.readOnly ? "read-only" : "write";
      const networks = tool.networks.map(formatNetworkLabel).join(", ");

      return `- ${tool.name} [${networks}] (${mode}${tool.dangerous ? ", dangerous" : ""}): ${tool.description}. Arguments: ${tool.argumentsDescription}`;
    })
    .join("\n");
  const implementedNetworksLine = `Implemented networks: ${context.implementedNetworks.map(formatNetworkLabel).join(", ")}.`;
  const plannedNetworks = neoNetworks.filter(
    (network) => !context.implementedNetworks.includes(network),
  );
  const plannedNetworksLine =
    plannedNetworks.length > 0
      ? `Planned but not yet implemented networks: ${plannedNetworks.map(formatNetworkLabel).join(", ")}.`
      : "All known networks are implemented.";
  const pendingLine = context.pendingAction
    ? `A pending confirmation exists for tool ${context.pendingAction.tool}.`
    : "There is no pending confirmation.";
  const walletAddressLine = context.walletAddress
    ? `The default wallet address is ${context.walletAddress} on ${formatNetworkLabel(context.defaultNetwork)}.`
    : `No wallet address is currently available on the default network ${formatNetworkLabel(context.defaultNetwork)}.`;
  const walletAddressLines = context.implementedNetworks
    .map((network) => {
      const address = context.walletAddresses[network];
      const label = formatNetworkLabel(network);

      return address
        ? `- ${label}: ${address}`
        : `- ${label}: no wallet address loaded`;
    })
    .join("\n");
  const referencedAddressLine = context.lastReferencedAddress
    ? `The last referenced address in this session is ${context.lastReferencedAddress}.`
    : "No address has been referenced yet in this session.";

  return `You are a planner for a Neo agent that is designed to support multiple networks over time.

Return JSON only with this exact shape:
{
  "intent": "string",
  "tool": "tool name or null",
  "arguments": {},
  "needsConfirmation": true,
  "missingInputs": ["fieldName"],
  "explanation": "short explanation"
}

Rules:
- Select exactly one tool or null.
- Use null when the request is unsupported or too ambiguous.
- For dangerous write actions, set needsConfirmation to true.
- For read-only actions, set needsConfirmation to false.
- If required inputs are missing, still pick the best tool and list missingInputs.
- Only select tools that support an implemented network relevant to the user request.
- If the user explicitly asks for a planned but not yet implemented network, return tool null and explain that the network is not implemented yet.
- Never invent wallet addresses, transaction hashes, contract hashes, function arguments, or amounts.
- Prefer getNeoN3PortfolioOverview for portfolio, holdings, balance-overview, or all-balances requests.
- Prefer getNeoN3TokenBalances for GAS balance, token balance, or NEP-17 balance requests.
- Prefer getNeoN3TransferHistory for Neo N3 transfer history, token history, or recent NEP-17 activity requests.
- Prefer getNeoN3SwapQuote for Flamingo quote, best route, expected output, minimum received, slippage, or deadline questions.
- Prefer getLastTransactionStatus when the user asks for the status of the last or most recent transaction in the current session.
- Prefer getRecentActions when the user asks for recent actions, recent transactions, or session activity history.
- Prefer getBlock for block lookups by height or hash.
- Prefer getTransaction for transaction lookups by hash.
- Prefer invokeNeoN3Read for Neo N3 read-only contract calls.
- Prefer prepareNeoN3ContractWrite for Neo N3 contract write preparation requests.
- Prefer getWalletAddress for wallet address requests.
- Prefer sendNeoN3Gas for native GAS transfers on Neo N3, including NeoNS recipients.
- Prefer sendNeoN3Token for non-GAS NEP-17 transfers on Neo N3.
- Prefer swapNeoN3Token for Flamingo swap requests on Neo N3, including force-swap requests.
- Never interpret non-explicit text as confirmation or cancellation.
- Only return intent confirm_action when the entire user message is an explicit confirmation phrase such as "confirm", "yes", "approve", "go ahead", or "proceed".
- Only return intent cancel_action when the entire user message is an explicit cancellation phrase such as "cancel", "stop", "abort", or "never mind".
- If the user says "my address", "my wallet", or "my account" and a wallet address is available, use that wallet address.
- If the user says "this address", "that address", or "same address" and a previously referenced address is available, use that address.

Default network: ${formatNetworkLabel(context.defaultNetwork)}.
${implementedNetworksLine}
${plannedNetworksLine}
Wallet mode enabled: ${context.walletEnabled}.
${pendingLine}
${walletAddressLine}
Wallet addresses by implemented network:
${walletAddressLines}
${referencedAddressLine}

Available tools:
${toolLines}`;
}

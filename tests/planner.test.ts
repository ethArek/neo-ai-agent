import { PlannerService } from "../src/agent/planner";
import { ToolRegistry } from "../src/agent/toolRegistry";
import type { PlannerContext } from "../src/agent/types";
import type { LlmProvider } from "../src/llm/provider";

const neoN3Address = "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM";
const neoNsName = "arkadiusz.neo";

function createPlanner(): PlannerService {
  return new PlannerService({
    tools: new ToolRegistry().listPlannerTools(),
  });
}

function createPlannerWithProvider(provider: LlmProvider): PlannerService {
  return new PlannerService({
    tools: new ToolRegistry().listPlannerTools(),
    provider,
  });
}

function createContext(
  overrides: Partial<PlannerContext> = {},
): PlannerContext {
  return {
    defaultNetwork: "neoN3",
    implementedNetworks: ["neoN3"],
    walletEnabled: false,
    walletAddresses: {},
    lastReferencedAddresses: {},
    ...overrides,
  };
}

describe("PlannerService", () => {
  it("maps a GAS transfer request to sendNeoN3Gas", async () => {
    const plan = await createPlanner().plan(
      `Send 0.1 GAS to ${neoNsName}`,
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.tool).toBe("sendNeoN3Gas");
    expect(plan.arguments).toMatchObject({
      amount: "0.1",
      to: neoNsName,
    });
    expect(plan.needsConfirmation).toBe(true);
  });

  it("maps a Neo N3 token transfer request to sendNeoN3Token", async () => {
    const plan = await createPlanner().plan(
      `Send 12.5 FUSD to ${neoNsName}`,
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.tool).toBe("sendNeoN3Token");
    expect(plan.arguments).toMatchObject({
      amount: "12.5",
      token: "FUSD",
      to: neoNsName,
    });
    expect(plan.needsConfirmation).toBe(true);
  });

  it("keeps a GAS transfer without a recipient as a draft", async () => {
    const plan = await createPlanner().plan(
      "send 0.1 gas",
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.tool).toBe("sendNeoN3Gas");
    expect(plan.arguments).toMatchObject({
      amount: "0.1",
    });
    expect(plan.missingInputs).toEqual(["to"]);
  });

  it("uses the Neo N3 wallet address for balance questions about my address", async () => {
    const plan = await createPlanner().plan(
      "how much gas i have on my address",
      createContext({
        walletEnabled: true,
        walletAddress: neoN3Address,
        walletAddresses: {
          neoN3: neoN3Address,
        },
      }),
    );

    expect(plan.tool).toBe("getNeoN3TokenBalances");
    expect(plan.arguments).toMatchObject({
      address: neoN3Address,
      token: "GAS",
    });
    expect(plan.missingInputs).toHaveLength(0);
  });

  it("uses the Neo N3 wallet address for unclaimed GAS questions about my address", async () => {
    const plan = await createPlanner().plan(
      "how much unclaimed gas do i have on my address",
      createContext({
        walletEnabled: true,
        walletAddress: neoN3Address,
        walletAddresses: {
          neoN3: neoN3Address,
        },
      }),
    );

    expect(plan.tool).toBe("getNeoN3UnclaimedGas");
    expect(plan.arguments).toMatchObject({
      address: neoN3Address,
    });
    expect(plan.missingInputs).toHaveLength(0);
  });

  it("maps a Polish unclaimed GAS question to the dedicated tool", async () => {
    const plan = await createPlanner().plan(
      "ile unclaimed gas mam na moim adresie",
      createContext({
        walletEnabled: true,
        walletAddress: neoN3Address,
        walletAddresses: {
          neoN3: neoN3Address,
        },
      }),
    );

    expect(plan.tool).toBe("getNeoN3UnclaimedGas");
    expect(plan.arguments).toMatchObject({
      address: neoN3Address,
    });
    expect(plan.missingInputs).toHaveLength(0);
  });

  it("maps all balances to Neo N3 portfolio overview", async () => {
    const plan = await createPlanner().plan(
      "show all balances",
      createContext({
        walletEnabled: true,
        walletAddress: neoN3Address,
        walletAddresses: {
          neoN3: neoN3Address,
        },
      }),
    );

    expect(plan.tool).toBe("getNeoN3PortfolioOverview");
    expect(plan.arguments).toMatchObject({
      address: neoN3Address,
    });
    expect(plan.missingInputs).toHaveLength(0);
  });

  it("maps a Neo N3 transfer history request", async () => {
    const plan = await createPlanner().plan(
      "show my last 2 transfers on Neo N3",
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.tool).toBe("getNeoN3TransferHistory");
    expect(plan.arguments).toMatchObject({
      address: undefined,
      limit: 2,
    });
  });

  it("maps a recent action request", async () => {
    const plan = await createPlanner().plan(
      "show my last 3 actions",
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.tool).toBe("getRecentActions");
    expect(plan.arguments).toMatchObject({
      limit: 3,
    });
    expect(plan.needsConfirmation).toBe(false);
  });

  it("maps a Flamingo quote request", async () => {
    const plan = await createPlanner().plan(
      "what is the best Flamingo route to swap 1 GAS for FUSD",
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.tool).toBe("getNeoN3SwapQuote");
    expect(plan.arguments).toMatchObject({
      amount: "1",
      fromToken: "GAS",
      toToken: "FUSD",
      force: false,
    });
    expect(plan.needsConfirmation).toBe(false);
  });

  it("maps a force Flamingo swap request", async () => {
    const plan = await createPlanner().plan(
      "swap 1 GAS for FUSD with force and 1% slippage",
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.tool).toBe("swapNeoN3Token");
    expect(plan.arguments).toMatchObject({
      amount: "1",
      fromToken: "GAS",
      toToken: "FUSD",
      slippagePercent: "1",
      force: true,
    });
    expect(plan.needsConfirmation).toBe(false);
  });

  it("maps wallet address requests to getWalletAddress", async () => {
    const plan = await createPlanner().plan(
      "show my address",
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.tool).toBe("getWalletAddress");
    expect(plan.arguments).toEqual({});
  });

  it("recognizes confirmation text", async () => {
    const plan = await createPlanner().plan(
      "Confirm",
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.intent).toBe("confirm_action");
    expect(plan.tool).toBeNull();
  });

  it("keeps unsupported approval requests unmapped", async () => {
    const plan = await createPlanner().plan(
      "approve 1 usdt",
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.tool).toBeNull();
    expect(plan.intent).toBe("unknown");
  });

  it("routes a Neo X GAS balance request to the native balance tool", async () => {
    const plan = await createPlanner().plan(
      "check GAS balance on Neo X",
      createContext({
        walletEnabled: true,
        walletAddresses: {
          neoX: "0xAA00000000000000000000000000000000000001",
        },
        implementedNetworks: ["neoN3", "neoX"],
      }),
    );

    expect(plan.tool).toBe("neox_get_native_balance");
    expect(plan.arguments).toMatchObject({
      address: "0xAA00000000000000000000000000000000000001",
    });
  });

  it("routes a Neo X ERC-20 balance request to the ERC-20 balance tool", async () => {
    const plan = await createPlanner().plan(
      "check ERC20 balance on Neo X",
      createContext({
        implementedNetworks: ["neoN3", "neoX"],
      }),
    );

    expect(plan.tool).toBe("neox_get_erc20_balance");
    expect(plan.missingInputs).toEqual(["tokenContract", "owner"]);
  });

  it("routes a Neo X Solidity contract call to the contract call tool", async () => {
    const plan = await createPlanner().plan(
      "call this Solidity contract on Neo X",
      createContext({
        implementedNetworks: ["neoN3", "neoX"],
      }),
    );

    expect(plan.tool).toBe("neox_call_contract");
    expect(plan.missingInputs).toEqual([
      "contractAddress",
      "functionName",
      "abi",
    ]);
  });

  it("keeps NEP-17 balance requests on Neo N3", async () => {
    const plan = await createPlanner().plan(
      "check NEP-17 balance on Neo N3",
      createContext({
        walletAddress: neoN3Address,
        walletAddresses: {
          neoN3: neoN3Address,
        },
        implementedNetworks: ["neoN3", "neoX"],
      }),
    );

    expect(plan.tool).toBe("getNeoN3TokenBalances");
    expect(plan.arguments).toMatchObject({
      address: neoN3Address,
    });
  });

  it("asks for clarification when a Neo balance request is ambiguous", async () => {
    const plan = await createPlanner().plan(
      "check my Neo balance",
      createContext({
        walletAddress: neoN3Address,
        walletAddresses: {
          neoN3: neoN3Address,
          neoX: "0xAA00000000000000000000000000000000000001",
        },
        implementedNetworks: ["neoN3", "neoX"],
      }),
    );

    expect(plan.tool).toBeNull();
    expect(plan.intent).toBe("clarify_neo_network");
    expect(plan.explanation).toContain("Neo N3 or Neo X");
  });

  it("ignores provider confirmation intents unless the raw user message is an explicit confirm phrase", async () => {
    const provider: LlmProvider = {
      async plan() {
        return JSON.stringify({
          intent: "confirm_action",
          tool: null,
          arguments: {},
          needsConfirmation: false,
          missingInputs: [],
        });
      },
    };
    const plan = await createPlannerWithProvider(provider).plan(
      "show my portfolio",
      createContext({
        walletEnabled: true,
        walletAddress: neoN3Address,
        walletAddresses: {
          neoN3: neoN3Address,
        },
      }),
    );

    expect(plan.tool).toBe("getNeoN3PortfolioOverview");
    expect(plan.intent).toBe("get_neo_n3_portfolio_overview");
  });

  it("accepts provider confirmation intents for explicit confirm phrases", async () => {
    const provider: LlmProvider = {
      async plan() {
        return JSON.stringify({
          intent: "confirm_action",
          tool: null,
          arguments: {},
          needsConfirmation: false,
          missingInputs: [],
        });
      },
    };
    const plan = await createPlannerWithProvider(provider).plan(
      "Confirm",
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.intent).toBe("confirm_action");
    expect(plan.tool).toBeNull();
  });

  it("falls back to heuristics when the provider returns malformed JSON", async () => {
    const provider: LlmProvider = {
      async plan() {
        return "not-json";
      },
    };
    const plan = await createPlannerWithProvider(provider).plan(
      "show my address",
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.tool).toBe("getWalletAddress");
    expect(plan.intent).toBe("get_wallet_address");
  });
});

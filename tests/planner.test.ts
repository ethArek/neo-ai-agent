import { PlannerService } from "../src/agent/planner";
import type { PlannerContext } from "../src/agent/types";
import { ToolRegistry } from "../src/agent/toolRegistry";

const neoN3Address = "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM";
const neoNsName = "arkadiusz.neo";

function createPlanner(): PlannerService {
  return new PlannerService({
    tools: new ToolRegistry().listPlannerTools(),
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
    expect(plan.needsConfirmation).toBe(true);
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

  it("keeps explicit Neo X requests unsupported until that network is implemented", async () => {
    const plan = await createPlanner().plan(
      "show my Neo X address",
      createContext({
        walletEnabled: true,
      }),
    );

    expect(plan.tool).toBeNull();
    expect(plan.intent).toBe("unsupported_network");
    expect(plan.explanation).toContain("Neo X support is planned");
  });
});

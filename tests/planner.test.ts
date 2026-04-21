import { PlannerService } from "../src/agent/planner";
import { ToolRegistry } from "../src/agent/toolRegistry";

const neoN3Address = "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM";
const neoNsName = "arkadiusz.neo";

function createPlanner(): PlannerService {
  return new PlannerService({
    tools: new ToolRegistry().listPlannerTools(),
  });
}

describe("PlannerService", () => {
  it("maps a GAS transfer request to sendNeoN3Gas", async () => {
    const plan = await createPlanner().plan(`Send 0.1 GAS to ${neoNsName}`, {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("sendNeoN3Gas");
    expect(plan.arguments).toMatchObject({
      amount: "0.1",
      to: neoNsName,
    });
    expect(plan.needsConfirmation).toBe(true);
  });

  it("maps a Neo N3 token transfer request to sendNeoN3Token", async () => {
    const plan = await createPlanner().plan(`Send 12.5 FUSD to ${neoNsName}`, {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("sendNeoN3Token");
    expect(plan.arguments).toMatchObject({
      amount: "12.5",
      token: "FUSD",
      to: neoNsName,
    });
    expect(plan.needsConfirmation).toBe(true);
  });

  it("keeps a GAS transfer without a recipient as a draft", async () => {
    const plan = await createPlanner().plan("send 0.1 gas", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("sendNeoN3Gas");
    expect(plan.arguments).toMatchObject({
      amount: "0.1",
    });
    expect(plan.missingInputs).toEqual(["to"]);
  });

  it("uses the Neo N3 wallet address for balance questions about my address", async () => {
    const plan = await createPlanner().plan(
      "how much gas i have on my address",
      {
        walletEnabled: true,
        walletAddress: neoN3Address,
        neoN3WalletAddress: neoN3Address,
      },
    );

    expect(plan.tool).toBe("getNeoN3TokenBalances");
    expect(plan.arguments).toMatchObject({
      address: neoN3Address,
      token: "GAS",
    });
    expect(plan.missingInputs).toHaveLength(0);
  });

  it("maps all balances to Neo N3 portfolio overview", async () => {
    const plan = await createPlanner().plan("show all balances", {
      walletEnabled: true,
      walletAddress: neoN3Address,
      neoN3WalletAddress: neoN3Address,
    });

    expect(plan.tool).toBe("getNeoN3PortfolioOverview");
    expect(plan.arguments).toMatchObject({
      address: neoN3Address,
    });
    expect(plan.missingInputs).toHaveLength(0);
  });

  it("maps a Neo N3 transfer history request", async () => {
    const plan = await createPlanner().plan(
      "show my last 2 transfers on Neo N3",
      {
        walletEnabled: true,
      },
    );

    expect(plan.tool).toBe("getNeoN3TransferHistory");
    expect(plan.arguments).toMatchObject({
      address: undefined,
      limit: 2,
    });
  });

  it("maps a recent action request", async () => {
    const plan = await createPlanner().plan("show my last 3 actions", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("getRecentActions");
    expect(plan.arguments).toMatchObject({
      limit: 3,
    });
    expect(plan.needsConfirmation).toBe(false);
  });

  it("maps a Flamingo quote request", async () => {
    const plan = await createPlanner().plan(
      "what is the best Flamingo route to swap 1 GAS for FUSD",
      {
        walletEnabled: true,
      },
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
      {
        walletEnabled: true,
      },
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
    const plan = await createPlanner().plan("show my address", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("getWalletAddress");
    expect(plan.arguments).toEqual({});
  });

  it("recognizes confirmation text", async () => {
    const plan = await createPlanner().plan("Confirm", {
      walletEnabled: true,
    });

    expect(plan.intent).toBe("confirm_action");
    expect(plan.tool).toBeNull();
  });

  it("keeps unsupported approval requests unmapped", async () => {
    const plan = await createPlanner().plan("approve 1 usdt", {
      walletEnabled: true,
    });

    expect(plan.tool).toBeNull();
    expect(plan.intent).toBe("unknown");
  });
});

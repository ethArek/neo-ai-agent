import { PlannerService } from "../src/agent/planner";
import { ToolRegistry } from "../src/agent/toolRegistry";

describe("PlannerService", () => {
  it("maps a GAS transfer request to sendGas", async () => {
    const recipient = "0x1111111111111111111111111111111111111111";
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan(`Send 0.1 GAS to ${recipient}`, {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("sendGas");
    expect(plan.arguments).toMatchObject({
      amount: "0.1",
      to: recipient,
    });
    expect(plan.needsConfirmation).toBe(true);
  });

  it("maps a NeoNS transfer request to sendNeoN3Gas", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("Send 0.1 GAS on N3 to arkadiusz.neo", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("sendNeoN3Gas");
    expect(plan.arguments).toMatchObject({
      amount: "0.1",
      to: "arkadiusz.neo",
    });
    expect(plan.needsConfirmation).toBe(true);
  });

  it("maps a Neo N3 token transfer request to sendNeoN3Token", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("Send 12.5 FUSD on N3 to arkadiusz.neo", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("sendNeoN3Token");
    expect(plan.arguments).toMatchObject({
      amount: "12.5",
      token: "FUSD",
      to: "arkadiusz.neo",
    });
    expect(plan.needsConfirmation).toBe(true);
  });

  it("maps a Neo N3 -> Neo X bridge request to bridgeGas", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("Bridge 1 GAS from Neo N3 to Neo X", {
      walletEnabled: true,
      walletAddress: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
      neoXWalletAddress: "0x1111111111111111111111111111111111111111",
      neoN3WalletAddress: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
    });

    expect(plan.tool).toBe("bridgeGas");
    expect(plan.arguments).toMatchObject({
      direction: "neoN3ToNeoX",
      amount: "1",
      to: "0x1111111111111111111111111111111111111111",
    });
    expect(plan.needsConfirmation).toBe(true);
  });

  it("maps a bridge fee request to getGasBridgeQuote", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan(
      "what is the fee to bridge 1 GAS from Neo X to Neo N3",
      {
        walletEnabled: true,
        walletAddress: "0x1111111111111111111111111111111111111111",
      },
    );

    expect(plan.tool).toBe("getGasBridgeQuote");
    expect(plan.arguments).toMatchObject({
      direction: "neoXToNeoN3",
      amount: "1",
    });
    expect(plan.needsConfirmation).toBe(false);
  });

  it("maps a bridge status request to getBridgeStatus", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("did my last bridge arrive", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("getBridgeStatus");
    expect(plan.needsConfirmation).toBe(false);
  });

  it("keeps a Neo X -> Neo N3 bridge request without amount as a draft", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan(
      "Bridge GAS from Neo X to Neo N3 NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
      {
        walletEnabled: true,
      },
    );

    expect(plan.tool).toBe("bridgeGas");
    expect(plan.arguments).toMatchObject({
      direction: "neoXToNeoN3",
      to: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
    });
    expect(plan.missingInputs).toEqual(["amount"]);
  });

  it("uses the wallet address for balance questions about my address", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("how much gas i have on my address", {
      walletEnabled: true,
      walletAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(plan.tool).toBe("getBalance");
    expect(plan.arguments).toMatchObject({
      address: "0x1111111111111111111111111111111111111111",
    });
    expect(plan.missingInputs).toHaveLength(0);
  });

  it("uses the Neo N3 wallet address for balance questions about my address", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("how much gas i have on my address", {
      walletEnabled: true,
      walletAddress: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
      neoXWalletAddress: "0x1111111111111111111111111111111111111111",
      neoN3WalletAddress: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
    });

    expect(plan.tool).toBe("getNeoN3TokenBalances");
    expect(plan.arguments).toMatchObject({
      address: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
      token: "GAS",
    });
    expect(plan.missingInputs).toHaveLength(0);
  });

  it("maps a default portfolio request to Neo N3 first", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("show my portfolio", {
      walletEnabled: true,
      walletAddress: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
      neoXWalletAddress: "0x1111111111111111111111111111111111111111",
      neoN3WalletAddress: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
    });

    expect(plan.tool).toBe("getNeoN3PortfolioOverview");
    expect(plan.arguments).toMatchObject({
      address: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
    });
    expect(plan.missingInputs).toHaveLength(0);
  });

  it("maps an all-balances request to the combined overview", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("show all balances", {
      walletEnabled: true,
      walletAddress: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
      neoXWalletAddress: "0x1111111111111111111111111111111111111111",
      neoN3WalletAddress: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
    });

    expect(plan.tool).toBe("getPortfolioOverview");
    expect(plan.arguments).toMatchObject({
      address: "0x1111111111111111111111111111111111111111",
      neoN3Address: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
    });
    expect(plan.missingInputs).toHaveLength(0);
  });

  it("maps a Neo N3 portfolio request to getNeoN3PortfolioOverview", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("show my neo n3 portfolio", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("getNeoN3PortfolioOverview");
    expect(plan.arguments).toEqual({
      address: undefined,
    });
    expect(plan.missingInputs).toHaveLength(0);
  });

  it("maps a Neo N3 token balance request to getNeoN3TokenBalances", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("show my N3 token balances", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("getNeoN3TokenBalances");
    expect(plan.arguments).toEqual({
      address: undefined,
    });
  });

  it("maps a Neo N3 transfer history request to getNeoN3TransferHistory", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("show my last 2 transfers on Neo N3", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("getNeoN3TransferHistory");
    expect(plan.arguments).toMatchObject({
      address: undefined,
      limit: 2,
    });
  });

  it("recognizes confirmation text", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("Confirm", {
      walletEnabled: true,
    });

    expect(plan.intent).toBe("confirm_action");
    expect(plan.tool).toBeNull();
  });

  it("does not map swap requests to a tool", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("Swap 1 GAS for USDT", {
      walletEnabled: true,
    });

    expect(plan.tool).toBeNull();
    expect(plan.intent).toBe("unknown");
  });

  it("maps a Flamingo quote request on Neo N3", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan(
      "what is the best Flamingo route to swap 1 GAS for FUSD on N3",
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

  it("maps a force Flamingo swap request on Neo N3", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan(
      'Swap 1 GAS for FUSD on N3 with "force" and 1% slippage',
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

  it("keeps an incomplete Flamingo swap on Neo N3 as a draft", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("swap GAS for FUSD on N3", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("swapNeoN3Token");
    expect(plan.arguments).toMatchObject({
      fromToken: "GAS",
      toToken: "FUSD",
    });
    expect(plan.missingInputs).toEqual(["amount"]);
  });

  it("keeps an approval request without spender as a draft", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("Approve 25 USDT", {
      walletEnabled: true,
    });

    expect(plan.arguments).toMatchObject({
      amount: "25",
      token: "USDT",
    });
    expect(plan.missingInputs).toEqual(["spender"]);
  });

  it("maps an approval request to approveErc20", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const spender = "0x1111111111111111111111111111111111111111";
    const plan = await planner.plan(`Approve 25 USDT for ${spender}`, {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("approveErc20");
    expect(plan.arguments).toMatchObject({
      amount: "25",
      token: "USDT",
      spender,
    });
  });

  it("maps a last transaction status request to getLastTransactionStatus", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("check the status of my last transaction", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("getLastTransactionStatus");
    expect(plan.arguments).toEqual({});
  });

  it("maps a recent actions request to getRecentActions", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("show my last 3 actions", {
      walletEnabled: true,
      walletAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(plan.tool).toBe("getRecentActions");
    expect(plan.arguments).toEqual({
      address: undefined,
      limit: 3,
    });
  });

  it("defaults wallet address requests to Neo N3", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("show my address", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("getWalletAddress");
    expect(plan.arguments).toEqual({
      network: undefined,
    });
  });

  it("maps explicit Neo X wallet address requests to Neo X", async () => {
    const planner = new PlannerService({
      tools: new ToolRegistry().listPlannerTools(),
    });

    const plan = await planner.plan("show my Neo X address", {
      walletEnabled: true,
    });

    expect(plan.tool).toBe("getWalletAddress");
    expect(plan.arguments).toEqual({
      network: "neoX",
    });
  });
});

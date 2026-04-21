import { AgentRuntime } from "../src/agent/runtime";
import { PlannerService } from "../src/agent/planner";
import { SessionStore } from "../src/agent/sessionStore";
import { ToolRegistry } from "../src/agent/toolRegistry";
import { FakeNeoProvider } from "./helpers/fakeNeoProvider";

function createRuntime(provider: FakeNeoProvider): AgentRuntime {
  const registry = new ToolRegistry();

  return new AgentRuntime({
    planner: new PlannerService({
      tools: registry.listPlannerTools(),
    }),
    registry,
    neo: provider,
    sessions: new SessionStore(),
  });
}

describe("AgentRuntime", () => {
  it("prepares and then confirms a Neo N3 GAS transfer by NeoNS name", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareNeoN3GasTransfer");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const runtime = createRuntime(provider);

    const prepared = await runtime.handleMessage(
      `Send 0.1 GAS to ${provider.neoNsName}`,
    );

    expect(prepared.tool).toBe("sendNeoN3Gas");
    expect(prepared.requiresConfirmation).toBe(true);
    expect(prepareSpy).toHaveBeenCalledWith({
      amount: "0.1",
      to: provider.neoNsName,
    });
    expect(prepared.message).toContain(provider.neoN3Address);

    const confirmed = await runtime.handleMessage(
      "Confirm",
      prepared.sessionId,
    );

    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(confirmed.requiresConfirmation).toBe(false);
    expect(confirmed.message).toContain("Submitted a Neo N3 GAS transfer");
    expect(confirmed.message).toContain(provider.latestTxHash);
  });

  it("completes a draft GAS transfer after collecting the recipient", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareNeoN3GasTransfer");
    const runtime = createRuntime(provider);

    const draft = await runtime.handleMessage("send 0.1 gas");

    expect(draft.tool).toBe("sendNeoN3Gas");
    expect(draft.requiresConfirmation).toBe(false);
    expect(draft.message).toContain("recipient");

    const prepared = await runtime.handleMessage(
      provider.recipientAddress,
      draft.sessionId,
    );

    expect(prepareSpy).toHaveBeenCalledWith({
      amount: "0.1",
      to: provider.recipientAddress,
    });
    expect(prepared.requiresConfirmation).toBe(true);
  });

  it("prepares and then confirms a Neo N3 token transfer", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareNeoN3TokenTransfer");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const runtime = createRuntime(provider);

    const prepared = await runtime.handleMessage(
      `Send 12.5 FUSD to ${provider.neoNsName}`,
    );

    expect(prepared.tool).toBe("sendNeoN3Token");
    expect(prepared.requiresConfirmation).toBe(true);
    expect(prepareSpy).toHaveBeenCalledWith({
      amount: "12.5",
      token: "FUSD",
      to: provider.neoNsName,
    });

    const confirmed = await runtime.handleMessage(
      "Confirm",
      prepared.sessionId,
    );

    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(confirmed.message).toContain("Submitted a Neo N3 transfer");
    expect(confirmed.message).toContain(provider.latestTxHash);
  });

  it("loads a Flamingo quote on Neo N3 without preparing a transaction", async () => {
    const provider = new FakeNeoProvider();
    const quoteSpy = jest.spyOn(provider, "getNeoN3SwapQuote");
    const runtime = createRuntime(provider);

    const response = await runtime.handleMessage(
      "what is the best Flamingo route to swap 1 GAS for FUSD",
    );

    expect(response.tool).toBe("getNeoN3SwapQuote");
    expect(response.requiresConfirmation).toBe(false);
    expect(quoteSpy).toHaveBeenCalledWith({
      amount: "1",
      fromToken: "GAS",
      toToken: "FUSD",
      slippagePercent: undefined,
      deadlineMinutes: undefined,
      force: false,
    });
    expect(response.message).toContain("Flamingo quote");
    expect(response.result).toMatchObject({
      dex: "Flamingo",
      routeSymbols: ["GAS", "FLM", "FUSD"],
      amountOut: "2.4",
    });
  });

  it("prepares and then confirms a Flamingo swap on Neo N3", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareNeoN3TokenSwap");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const runtime = createRuntime(provider);

    const prepared = await runtime.handleMessage(
      "Swap 1 GAS for FUSD with force and 1% slippage",
    );

    expect(prepared.tool).toBe("swapNeoN3Token");
    expect(prepared.requiresConfirmation).toBe(true);
    expect(prepareSpy).toHaveBeenCalledWith({
      amount: "1",
      fromToken: "GAS",
      toToken: "FUSD",
      slippagePercent: "1",
      deadlineMinutes: undefined,
      force: true,
    });
    expect(prepared.message).toContain("Force swap requested");
    expect(prepared.message).toContain("minimum received");

    const confirmed = await runtime.handleMessage(
      "Confirm",
      prepared.sessionId,
    );

    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(confirmed.message).toContain("Submitted a Flamingo swap");
    expect(confirmed.message).toContain(provider.latestTxHash);
  });

  it("reuses the remembered wallet address across turns", async () => {
    const provider = new FakeNeoProvider();
    const balanceSpy = jest.spyOn(provider, "getNeoN3TokenBalances");
    const runtime = createRuntime(provider);

    const addressResponse = await runtime.handleMessage("show my address");
    const balanceResponse = await runtime.handleMessage(
      "how much gas i have on my address",
      addressResponse.sessionId,
    );

    expect(balanceResponse.tool).toBe("getNeoN3TokenBalances");
    expect(balanceSpy).toHaveBeenCalledWith(provider.neoN3Address, "GAS");
    expect(balanceResponse.message).toContain(provider.neoN3Address);
    expect(addressResponse.result).toMatchObject({
      address: provider.neoN3Address,
      network: "neoN3",
    });
  });

  it("loads a Neo N3 portfolio overview for the session wallet", async () => {
    const provider = new FakeNeoProvider();
    const portfolioSpy = jest.spyOn(provider, "getNeoN3PortfolioOverview");
    const runtime = createRuntime(provider);

    const response = await runtime.handleMessage("show my portfolio");

    expect(response.tool).toBe("getNeoN3PortfolioOverview");
    expect(portfolioSpy).toHaveBeenCalledWith(provider.neoN3Address);
    expect(response.result).toMatchObject({
      address: provider.neoN3Address,
      neoBalance: {
        balance: "12",
      },
    });
  });

  it("loads recent Neo N3 transfer history from the session wallet", async () => {
    const provider = new FakeNeoProvider();
    const historySpy = jest.spyOn(provider, "getNeoN3TransferHistory");
    const runtime = createRuntime(provider);

    const response = await runtime.handleMessage(
      "show my last 2 transfers on Neo N3",
    );

    expect(response.tool).toBe("getNeoN3TransferHistory");
    expect(historySpy).toHaveBeenCalledWith({
      address: provider.neoN3Address,
      limit: 2,
      token: undefined,
    });
    expect(response.result).toMatchObject({
      count: 2,
    });
  });

  it("invokes a Neo N3 contract read", async () => {
    const provider = new FakeNeoProvider();
    const invokeSpy = jest.spyOn(provider, "invokeNeoN3Read");
    const runtime = createRuntime(provider);

    const response = await runtime.executeTool({
      tool: "invokeNeoN3Read",
      arguments: {
        contractHash: "0x1111111111111111111111111111111111111111",
        operation: "balanceOf",
        args: [],
      },
    });

    expect(invokeSpy).toHaveBeenCalledWith(
      "0x1111111111111111111111111111111111111111",
      "balanceOf",
      [],
    );
    expect(response.message).toContain("Invoked Neo N3 operation balanceOf");
    expect(response.result).toMatchObject({
      result: "42",
    });
  });

  it("prepares and then confirms a Neo N3 contract write", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "buildNeoN3ContractWrite");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const runtime = createRuntime(provider);

    const prepared = await runtime.executeTool({
      tool: "prepareNeoN3ContractWrite",
      arguments: {
        contractHash: "0x1111111111111111111111111111111111111111",
        operation: "vote",
        args: [],
      },
    });

    expect(prepareSpy).toHaveBeenCalledWith({
      contractHash: "0x1111111111111111111111111111111111111111",
      operation: "vote",
      args: [],
    });
    expect(prepared.requiresConfirmation).toBe(true);

    const confirmed = await runtime.handleMessage(
      "confirm",
      prepared.sessionId,
    );

    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(confirmed.message).toContain(provider.latestTxHash);
  });

  it("checks the status of the last broadcast transaction from the session", async () => {
    const provider = new FakeNeoProvider();
    const statusSpy = jest.spyOn(provider, "getTransactionStatus");
    const runtime = createRuntime(provider);

    const prepared = await runtime.handleMessage(
      `Send 0.1 GAS to ${provider.recipientAddress}`,
    );

    await runtime.handleMessage("Confirm", prepared.sessionId);

    const response = await runtime.handleMessage(
      "check the status of my last transaction",
      prepared.sessionId,
    );

    expect(response.tool).toBe("getLastTransactionStatus");
    expect(statusSpy).toHaveBeenLastCalledWith({
      hash: provider.latestTxHash,
      network: "neoN3",
    });
    expect(response.message).toContain("confirmed");
    expect(response.result).toMatchObject({
      status: {
        hash: provider.latestTxHash,
        status: "confirmed",
      },
    });
  });

  it("shows recent broadcast actions for the session", async () => {
    const provider = new FakeNeoProvider();
    const statusSpy = jest.spyOn(provider, "getTransactionStatus");
    const runtime = createRuntime(provider);

    const prepared = await runtime.handleMessage(
      `Send 0.1 GAS to ${provider.recipientAddress}`,
    );

    await runtime.handleMessage("Confirm", prepared.sessionId);

    const response = await runtime.handleMessage(
      "show my last 3 actions",
      prepared.sessionId,
    );

    expect(response.tool).toBe("getRecentActions");
    expect(statusSpy).toHaveBeenLastCalledWith({
      hash: provider.latestTxHash,
      network: "neoN3",
    });
    expect(response.result).toMatchObject({
      count: 1,
      actions: [
        {
          activity: {
            sender: provider.neoN3Address,
          },
          status: {
            status: "confirmed",
          },
        },
      ],
    });
  });

  it("reports Neo X as planned but not yet implemented", async () => {
    const provider = new FakeNeoProvider();
    const runtime = createRuntime(provider);

    const response = await runtime.handleMessage("show my Neo X address");

    expect(response.tool).toBeNull();
    expect(response.requiresConfirmation).toBe(false);
    expect(response.message).toContain("Neo X support is planned");
  });
});

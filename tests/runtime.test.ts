import { AgentRuntime } from "../src/agent/runtime";
import { PlannerService } from "../src/agent/planner";
import { SessionStore } from "../src/agent/sessionStore";
import { ToolRegistry } from "../src/agent/toolRegistry";
import { FakeNeoProvider } from "./helpers/fakeNeoProvider";

describe("AgentRuntime confirmation flow", () => {
  it("prepares and then confirms a GAS transfer in the same session", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareGasTransfer");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const prepared = await runtime.handleMessage(
      `Send 0.1 GAS to ${provider.recipientAddress}`,
    );

    expect(prepared.requiresConfirmation).toBe(true);
    expect(prepareSpy).toHaveBeenCalledTimes(1);

    const confirmed = await runtime.handleMessage(
      "Confirm",
      prepared.sessionId,
    );

    expect(confirmed.requiresConfirmation).toBe(false);
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(confirmed.message).toContain("Submitted a transfer of 0.1 GAS");
    expect(confirmed.message).toContain("Transaction hash:");
  });

  it("prepares and then confirms a Neo N3 GAS transfer by NeoNS name", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareNeoN3GasTransfer");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const prepared = await runtime.handleMessage(
      `Send 0.1 GAS on N3 to ${provider.neoNsName}`,
    );

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

    expect(confirmed.requiresConfirmation).toBe(false);
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(confirmed.message).toContain("Submitted a Neo N3 GAS transfer");
    expect(confirmed.message).toContain("Transaction hash:");
  });

  it("prepares and then confirms a Neo N3 token transfer by NeoNS name", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareNeoN3TokenTransfer");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const prepared = await runtime.handleMessage(
      `Send 12.5 FUSD on N3 to ${provider.neoNsName}`,
    );

    expect(prepared.requiresConfirmation).toBe(true);
    expect(prepareSpy).toHaveBeenCalledWith({
      amount: "12.5",
      token: "FUSD",
      to: provider.neoNsName,
    });
    expect(prepared.message).toContain(provider.neoN3Address);

    const confirmed = await runtime.handleMessage(
      "Confirm",
      prepared.sessionId,
    );

    expect(confirmed.requiresConfirmation).toBe(false);
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(confirmed.message).toContain("Submitted a Neo N3 transfer");
    expect(confirmed.message).toContain("Transaction hash:");
  });

  it("prepares and then confirms a bridge transaction in the same session", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareGasBridge");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const prepared = await runtime.handleMessage(
      `Bridge 1 GAS from Neo X to Neo N3 ${provider.neoN3Address}`,
    );

    expect(prepared.requiresConfirmation).toBe(true);
    expect(prepareSpy).toHaveBeenCalledWith({
      amount: "1",
      direction: "neoXToNeoN3",
      to: provider.neoN3Address,
    });

    const confirmed = await runtime.handleMessage(
      "Confirm",
      prepared.sessionId,
    );

    expect(confirmed.requiresConfirmation).toBe(false);
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(confirmed.message).toContain("Submitted a Neo X -> Neo N3 bridge");
    expect(confirmed.message).toContain("Transaction hash:");
  });

  it("loads a bridge quote without preparing a transaction", async () => {
    const provider = new FakeNeoProvider();
    const quoteSpy = jest.spyOn(provider, "getGasBridgeQuote");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const response = await runtime.handleMessage(
      "what is the fee to bridge 1 GAS from Neo X to Neo N3",
    );

    expect(response.tool).toBe("getGasBridgeQuote");
    expect(response.requiresConfirmation).toBe(false);
    expect(quoteSpy).toHaveBeenCalledWith({
      direction: "neoXToNeoN3",
      amount: "1",
      to: provider.neoN3Address,
    });
    expect(response.result).toMatchObject({
      currentFee: "0.1",
      estimatedReceived: "0.9",
    });
  });

  it("loads a Flamingo quote on Neo N3 without preparing a transaction", async () => {
    const provider = new FakeNeoProvider();
    const quoteSpy = jest.spyOn(provider, "getNeoN3SwapQuote");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const response = await runtime.handleMessage(
      "what is the best Flamingo route to swap 1 GAS for FUSD on N3",
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
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const prepared = await runtime.handleMessage(
      'Swap 1 GAS for FUSD on N3 with "force" and 1% slippage',
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

    expect(confirmed.requiresConfirmation).toBe(false);
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(confirmed.message).toContain("Submitted a Flamingo swap");
    expect(confirmed.message).toContain("Transaction hash:");
  });

  it("tracks the last bridge end-to-end from session metadata", async () => {
    const provider = new FakeNeoProvider();
    const bridgeStatusSpy = jest.spyOn(provider, "getBridgeStatus");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const prepared = await runtime.handleMessage(
      `Bridge 1 GAS from Neo X to Neo N3 ${provider.neoN3Address}`,
    );

    await runtime.handleMessage("Confirm", prepared.sessionId);

    const response = await runtime.handleMessage(
      "did my last bridge arrive",
      prepared.sessionId,
    );

    expect(response.tool).toBe("getBridgeStatus");
    expect(bridgeStatusSpy).toHaveBeenCalledWith({
      txHash: `0x${"c".repeat(64)}`,
      direction: "neoXToNeoN3",
      destinationAddress: provider.neoN3Address,
      amount: "1",
      maxFee: "0.1",
      createdAt: expect.any(String),
    });
    expect(response.message).toContain("bridge is complete");
    expect(response.result).toMatchObject({
      arrival: {
        status: "arrived",
      },
      estimatedReceived: "0.9",
    });
  });

  it("reuses the remembered wallet address across turns", async () => {
    const provider = new FakeNeoProvider();
    const balanceSpy = jest.spyOn(provider, "getNeoN3TokenBalances");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const addressResponse = await runtime.handleMessage("show my address");
    const balanceResponse = await runtime.handleMessage(
      "how much gas i have on my address",
      addressResponse.sessionId,
    );

    expect(balanceResponse.tool).toBe("getNeoN3TokenBalances");
    expect(balanceSpy).toHaveBeenCalledWith(provider.neoN3Address, "GAS");
    expect(balanceResponse.message).toContain(provider.neoN3Address);
  });

  it("shows Neo N3 as the default wallet address", async () => {
    const provider = new FakeNeoProvider();
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const response = await runtime.handleMessage("show my address");

    expect(response.tool).toBe("getWalletAddress");
    expect(response.message).toContain(provider.neoN3Address);
    expect(response.result).toMatchObject({
      address: provider.neoN3Address,
      neoXAddress: provider.senderAddress,
      neoN3Address: provider.neoN3Address,
      primaryNetwork: "neoN3",
    });
  });

  it("shows Neo X when the user explicitly asks for the Neo X address", async () => {
    const provider = new FakeNeoProvider();
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const response = await runtime.handleMessage("show my Neo X address");

    expect(response.tool).toBe("getWalletAddress");
    expect(response.message).toContain(provider.senderAddress);
    expect(response.result).toMatchObject({
      address: provider.senderAddress,
      primaryNetwork: "neoX",
    });
  });

  it("loads a Neo N3-first portfolio overview for the session wallet", async () => {
    const provider = new FakeNeoProvider();
    const neoN3PortfolioSpy = jest.spyOn(provider, "getNeoN3PortfolioOverview");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const response = await runtime.handleMessage("show my portfolio");

    expect(response.tool).toBe("getNeoN3PortfolioOverview");
    expect(neoN3PortfolioSpy).toHaveBeenCalledWith(provider.neoN3Address);
    expect(response.message).toContain(provider.neoN3Address);
    expect(response.result).toMatchObject({
      address: provider.neoN3Address,
      neoBalance: {
        balance: "12",
      },
    });
    expect(response.result).toEqual(
      expect.objectContaining({
        tokenBalances: expect.arrayContaining([
          expect.objectContaining({
            symbol: "FUSD",
          }),
        ]),
      }),
    );
  });

  it("loads a combined overview when the user asks for all balances", async () => {
    const provider = new FakeNeoProvider();
    const nativeBalanceSpy = jest.spyOn(provider, "getNativeBalance");
    const tokenBalancesSpy = jest.spyOn(provider, "getTokenBalances");
    const neoN3PortfolioSpy = jest.spyOn(provider, "getNeoN3PortfolioOverview");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const response = await runtime.handleMessage("show all balances");

    expect(response.tool).toBe("getPortfolioOverview");
    expect(nativeBalanceSpy).toHaveBeenCalledWith(provider.senderAddress);
    expect(tokenBalancesSpy).toHaveBeenCalledWith(provider.senderAddress);
    expect(neoN3PortfolioSpy).toHaveBeenCalledWith(provider.neoN3Address);
    expect(response.message).toContain("Neo X");
    expect(response.message).toContain("Neo N3");
    expect(response.result).toMatchObject({
      neoX: {
        address: provider.senderAddress,
      },
      neoN3: {
        address: provider.neoN3Address,
        neoBalance: {
          balance: "12",
        },
      },
    });
  });

  it("loads a dedicated Neo N3 portfolio overview from the session wallet", async () => {
    const provider = new FakeNeoProvider();
    const neoN3PortfolioSpy = jest.spyOn(provider, "getNeoN3PortfolioOverview");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const response = await runtime.handleMessage("show my neo n3 portfolio");

    expect(response.tool).toBe("getNeoN3PortfolioOverview");
    expect(neoN3PortfolioSpy).toHaveBeenCalledWith(provider.neoN3Address);
    expect(response.message).toContain(provider.neoN3Address);
    expect(response.result).toMatchObject({
      address: provider.neoN3Address,
      neoBalance: {
        symbol: "NEO",
      },
    });
    expect(response.result).toEqual(
      expect.objectContaining({
        tokenBalances: expect.arrayContaining([
          expect.objectContaining({
            symbol: "FUSD",
          }),
        ]),
      }),
    );
  });

  it("loads Neo N3 token balances from the session wallet", async () => {
    const provider = new FakeNeoProvider();
    const tokenBalancesSpy = jest.spyOn(provider, "getNeoN3TokenBalances");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const response = await runtime.handleMessage("show my N3 token balances");

    expect(response.tool).toBe("getNeoN3TokenBalances");
    expect(tokenBalancesSpy).toHaveBeenCalledWith(
      provider.neoN3Address,
      undefined,
    );
    expect(response.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: "GAS",
        }),
        expect.objectContaining({
          symbol: "NEO",
        }),
      ]),
    );
  });

  it("loads recent Neo N3 transfer history from the session wallet", async () => {
    const provider = new FakeNeoProvider();
    const historySpy = jest.spyOn(provider, "getNeoN3TransferHistory");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

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
      transfers: expect.arrayContaining([
        expect.objectContaining({
          token: expect.objectContaining({
            symbol: "FUSD",
          }),
        }),
      ]),
    });
  });

  it("invokes a Neo N3 contract read", async () => {
    const provider = new FakeNeoProvider();
    const invokeSpy = jest.spyOn(provider, "invokeNeoN3Read");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

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
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

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
    expect(confirmed.message).toContain("Transaction hash:");
  });

  it("keeps swap requests unsupported", async () => {
    const provider = new FakeNeoProvider();
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const draftResponse = await runtime.handleMessage("convert GAS to USDT");

    expect(draftResponse.tool).toBeNull();
    expect(draftResponse.requiresConfirmation).toBe(false);
    expect(draftResponse.message).toContain("supported Neo N3 or Neo X action");
  });

  it("completes an ERC-20 approval after collecting a spender address", async () => {
    const provider = new FakeNeoProvider();
    const spender = "0x1111111111111111111111111111111111111111";
    const prepareSpy = jest.spyOn(provider, "prepareErc20Approval");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const draftResponse = await runtime.handleMessage("approve 1 USDT");

    expect(draftResponse.tool).toBe("approveErc20");
    expect(draftResponse.requiresConfirmation).toBe(false);
    expect(draftResponse.message).toContain("spender address");

    const preparedResponse = await runtime.handleMessage(
      spender,
      draftResponse.sessionId,
    );

    expect(prepareSpy).toHaveBeenCalledWith({
      amount: "1",
      token: "USDT",
      spender,
    });
    expect(preparedResponse.requiresConfirmation).toBe(true);

    const confirmedResponse = await runtime.handleMessage(
      "confirm",
      preparedResponse.sessionId,
    );

    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(confirmedResponse.message).toContain(
      "Submitted an approval of 1 USDT",
    );
    expect(confirmedResponse.message).toContain("Transaction hash:");
  });

  it("keeps forced swap requests unsupported", async () => {
    const provider = new FakeNeoProvider();
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const response = await runtime.handleMessage(
      'swap 1 GAS for USDT with "force"',
    );

    expect(response.tool).toBeNull();
    expect(response.requiresConfirmation).toBe(false);
    expect(response.message).toContain("supported Neo N3 or Neo X action");
  });

  it("checks the status of the last broadcast transaction from the session", async () => {
    const provider = new FakeNeoProvider();
    const statusSpy = jest.spyOn(provider, "getTransactionStatus");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const prepared = await runtime.handleMessage(
      `Send 0.1 GAS to ${provider.recipientAddress}`,
    );

    await runtime.handleMessage("Confirm", prepared.sessionId);

    const response = await runtime.handleMessage(
      "check the status of my last transaction",
      prepared.sessionId,
    );

    expect(response.tool).toBe("getLastTransactionStatus");
    expect(statusSpy).toHaveBeenCalledWith({
      hash: `0x${"c".repeat(64)}`,
      network: "neoX",
    });
    expect(response.message).toContain("confirmed");
    expect(response.result).toMatchObject({
      status: "confirmed",
    });
  });

  it("shows recent broadcast actions for the session wallet address", async () => {
    const provider = new FakeNeoProvider();
    const statusSpy = jest.spyOn(provider, "getTransactionStatus");
    const runtime = new AgentRuntime({
      planner: new PlannerService({
        tools: new ToolRegistry().listPlannerTools(),
      }),
      registry: new ToolRegistry(),
      neo: provider,
      sessions: new SessionStore(),
    });

    const prepared = await runtime.handleMessage(
      `Send 0.1 GAS to ${provider.recipientAddress}`,
    );

    await runtime.handleMessage("Confirm", prepared.sessionId);

    const response = await runtime.handleMessage(
      "show my last 3 actions",
      prepared.sessionId,
    );

    expect(response.tool).toBe("getRecentActions");
    expect(statusSpy).toHaveBeenCalledWith({
      hash: `0x${"c".repeat(64)}`,
      network: "neoX",
    });
    expect(response.result).toMatchObject({
      count: 1,
      actions: [
        {
          sender: provider.senderAddress,
          currentStatus: "confirmed",
        },
      ],
    });
  });
});

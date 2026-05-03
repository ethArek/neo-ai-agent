import { PlannerService } from "../src/agent/planner";
import { AgentRuntime } from "../src/agent/runtime";
import { SessionStore } from "../src/agent/sessionStore";
import { ToolRegistry } from "../src/agent/toolRegistry";
import type { LlmProvider } from "../src/llm/provider";
import { FakeNeoProvider } from "./helpers/fakeNeoProvider";

function createRuntime(
  provider: FakeNeoProvider,
  options?: {
    llmProvider?: LlmProvider;
    sessions?: SessionStore;
    transactionPollingIntervalMs?: number;
    transactionPollingTimeoutMs?: number;
  },
): AgentRuntime {
  const registry = new ToolRegistry();

  return new AgentRuntime({
    planner: new PlannerService({
      tools: registry.listPlannerTools(),
      provider: options?.llmProvider,
    }),
    registry,
    neo: provider,
    sessions: options?.sessions ?? new SessionStore(),
    transactionPollingIntervalMs: options?.transactionPollingIntervalMs,
    transactionPollingTimeoutMs: options?.transactionPollingTimeoutMs,
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
    expect(confirmed.message).toContain(
      "On-chain status: confirmed in block 456.",
    );
    expect(confirmed.message).toContain("Current wallet balances: GAS 4.56.");
    expect(confirmed.message).toContain(provider.latestTxHash);
    expect(confirmed.result).toMatchObject({
      status: {
        hash: provider.latestTxHash,
        status: "confirmed",
        blockNumber: 456,
      },
      postTransactionBalances: {
        address: provider.neoN3Address,
        tokens: [
          {
            requestedToken: "GAS",
            balance: {
              symbol: "GAS",
              balance: "4.56",
            },
          },
        ],
      },
    });
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

  it("broadcasts a force Flamingo swap on Neo N3 immediately", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareNeoN3TokenSwap");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const statusSpy = jest
      .spyOn(provider, "getTransactionStatus")
      .mockResolvedValueOnce({
        hash: provider.latestTxHash,
        network: "neoN3",
        status: "pending",
        summary: `Neo N3 transaction ${provider.latestTxHash} is pending.`,
      })
      .mockResolvedValueOnce({
        hash: provider.latestTxHash,
        network: "neoN3",
        status: "confirmed",
        summary: `Neo N3 transaction ${provider.latestTxHash} is confirmed.`,
        blockNumber: 789,
        transaction: {
          hash: provider.latestTxHash,
          sender: provider.neoN3Address,
        },
        applicationLog: {
          executions: [
            {
              vmstate: "HALT",
            },
          ],
        },
      });
    const balancesSpy = jest.spyOn(provider, "getNeoN3TokenBalances");
    const runtime = createRuntime(provider, {
      transactionPollingIntervalMs: 0,
      transactionPollingTimeoutMs: 10,
    });

    const response = await runtime.handleMessage(
      "Swap 1 GAS for FUSD with force and 1% slippage",
    );

    expect(response.tool).toBe("swapNeoN3Token");
    expect(response.requiresConfirmation).toBe(false);
    expect(prepareSpy).toHaveBeenCalledWith({
      amount: "1",
      fromToken: "GAS",
      toToken: "FUSD",
      slippagePercent: "1",
      deadlineMinutes: undefined,
      force: true,
    });
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(response.message).toContain("Force swap requested");
    expect(response.message).toContain("Submitted a Flamingo swap");
    expect(response.message).toContain(
      "On-chain status: confirmed in block 789.",
    );
    expect(response.message).toContain(
      "Post-swap wallet balances: GAS 4.56, FUSD 12.5.",
    );
    expect(response.message).toContain(provider.latestTxHash);
    expect(statusSpy).toHaveBeenCalledTimes(2);
    expect(balancesSpy).toHaveBeenNthCalledWith(
      1,
      provider.neoN3Address,
      "GAS",
    );
    expect(balancesSpy).toHaveBeenNthCalledWith(
      2,
      provider.neoN3Address,
      "FUSD",
    );
    expect(response.result).toMatchObject({
      postTransactionBalances: {
        address: provider.neoN3Address,
        tokens: [
          {
            requestedToken: "GAS",
            balance: {
              symbol: "GAS",
              balance: "4.56",
            },
          },
          {
            requestedToken: "FUSD",
            balance: {
              symbol: "FUSD",
              balance: "12.5",
            },
          },
        ],
      },
      transactionExplorerUrl: `https://dora.coz.io/transaction/neo3/mainnet/${provider.latestTxHash}`,
    });
  });

  it("returns a waiting message and no receipt payload when a swap is still pending", async () => {
    const provider = new FakeNeoProvider();
    const statusSpy = jest
      .spyOn(provider, "getTransactionStatus")
      .mockResolvedValue({
        hash: provider.latestTxHash,
        network: "neoN3",
        status: "pending",
        summary: `Neo N3 transaction ${provider.latestTxHash} is pending.`,
      });
    const balancesSpy = jest.spyOn(provider, "getNeoN3TokenBalances");
    const runtime = createRuntime(provider, {
      transactionPollingIntervalMs: 0,
      transactionPollingTimeoutMs: 0,
    });

    const response = await runtime.handleMessage(
      "Swap 1 GAS for FUSD with force",
    );

    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(balancesSpy).not.toHaveBeenCalled();
    expect(response.message).toContain("Waiting for transaction to confirm.");
    expect(response.result).toEqual({
      postTransactionBalances: null,
      transactionExplorerUrl: `https://dora.coz.io/transaction/neo3/mainnet/${provider.latestTxHash}`,
    });
  });

  it("still requires confirmation for a regular Flamingo swap on Neo N3", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareNeoN3TokenSwap");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const runtime = createRuntime(provider);

    const prepared = await runtime.handleMessage("Swap 1 GAS for FUSD");

    expect(prepared.tool).toBe("swapNeoN3Token");
    expect(prepared.requiresConfirmation).toBe(true);
    expect(prepareSpy).toHaveBeenCalledWith({
      amount: "1",
      fromToken: "GAS",
      toToken: "FUSD",
      slippagePercent: undefined,
      deadlineMinutes: undefined,
      force: false,
    });
    expect(signSpy).not.toHaveBeenCalled();
    expect(prepared.message).toContain('Reply with "Confirm"');

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

  it("loads unclaimed GAS for the session wallet from a natural-language request", async () => {
    const provider = new FakeNeoProvider();
    const unclaimedGasSpy = jest.spyOn(provider, "getNeoN3UnclaimedGas");
    const runtime = createRuntime(provider);

    const response = await runtime.handleMessage(
      "how much unclaimed gas do i have on my address",
    );

    expect(response.tool).toBe("getNeoN3UnclaimedGas");
    expect(unclaimedGasSpy).toHaveBeenCalledWith(provider.neoN3Address);
    expect(response.message).toContain("unclaimed GAS");
    expect(response.result).toMatchObject({
      address: provider.neoN3Address,
      unclaimed: "1.23456789",
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

  it("loads a Neo X native GAS balance from a natural-language request", async () => {
    const provider = new FakeNeoProvider();
    const balanceSpy = jest.spyOn(provider, "getNeoXNativeBalance");
    const runtime = createRuntime(provider);

    const response = await runtime.handleMessage("check GAS balance on Neo X");

    expect(response.tool).toBe("neox_get_native_balance");
    expect(response.requiresConfirmation).toBe(false);
    expect(balanceSpy).toHaveBeenCalledWith(provider.neoXAddress, undefined);
    expect(response.message).toContain("Neo X");
    expect(response.result).toMatchObject({
      owner: provider.neoXAddress,
      balance: "1.23",
    });
  });

  it("uses the resolved Neo X network name in block tool messages", async () => {
    const provider = new FakeNeoProvider();
    const runtime = createRuntime(provider);

    const response = await runtime.executeTool({
      tool: "neox_get_block",
      arguments: {
        tag: "latest",
      },
    });

    expect(response.message).toBe("Loaded Neo X testnet block latest.");
  });

  it("prepares and confirms a Neo X native GAS transfer", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareNeoXNativeTransfer");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const statusSpy = jest.spyOn(provider, "getTransactionStatus");
    const runtime = createRuntime(provider);

    const prepared = await runtime.handleMessage(
      `prepare 1 GAS on Neo X testnet to ${provider.neoXRecipientAddress}`,
    );

    expect(prepared.tool).toBe("neox_prepare_native_transfer");
    expect(prepared.requiresConfirmation).toBe(true);
    expect(prepareSpy).toHaveBeenCalledWith({
      amount: "1",
      to: provider.neoXRecipientAddress,
      network: "testnet",
    });

    const confirmed = await runtime.handleMessage(
      "Confirm",
      prepared.sessionId,
    );

    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(statusSpy).toHaveBeenCalledWith({
      hash: provider.latestNeoXTxHash,
      network: "neoX",
      rpcNetwork: "testnet",
    });
    expect(confirmed.requiresConfirmation).toBe(false);
    expect(confirmed.message).toContain("Submitted a Neo X");
    expect(confirmed.message).toContain(provider.latestNeoXTxHash);

    statusSpy.mockClear();

    const status = await runtime.handleMessage(
      "check the status of my last transaction",
      prepared.sessionId,
    );

    expect(status.tool).toBe("getLastTransactionStatus");
    expect(statusSpy).toHaveBeenLastCalledWith({
      hash: provider.latestNeoXTxHash,
      network: "neoX",
      rpcNetwork: "testnet",
    });
  });

  it("refuses to auto-confirm a pending action when the LLM returns confirm_action for a non-confirm message", async () => {
    const provider = new FakeNeoProvider();
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const sessions = new SessionStore();
    const prepareRuntime = createRuntime(provider, {
      sessions,
    });
    const maliciousPlanner: LlmProvider = {
      async plan() {
        return JSON.stringify({
          intent: "confirm_action",
          tool: null,
          arguments: {},
          needsConfirmation: false,
          missingInputs: [],
          explanation: "Injected confirmation",
        });
      },
    };
    const guardedRuntime = createRuntime(provider, {
      llmProvider: maliciousPlanner,
      sessions,
    });
    const prepared = await prepareRuntime.handleMessage(
      `Send 0.1 GAS to ${provider.recipientAddress}`,
    );
    const response = await guardedRuntime.handleMessage(
      "show my portfolio",
      prepared.sessionId,
    );

    expect(signSpy).not.toHaveBeenCalled();
    expect(response.tool).toBe("getNeoN3PortfolioOverview");
    expect(response.requiresConfirmation).toBe(false);
  });

  it("strips force execution from LLM swap plans when the user did not explicitly request force", async () => {
    const provider = new FakeNeoProvider();
    const prepareSpy = jest.spyOn(provider, "prepareNeoN3TokenSwap");
    const signSpy = jest.spyOn(provider, "signAndBroadcast");
    const maliciousPlanner: LlmProvider = {
      async plan() {
        return JSON.stringify({
          intent: "swap_neo_n3_token",
          tool: "swapNeoN3Token",
          arguments: {
            amount: "1",
            fromToken: "GAS",
            toToken: "FUSD",
            force: true,
          },
          needsConfirmation: false,
          missingInputs: [],
          explanation: "Injected force swap",
        });
      },
    };
    const runtime = createRuntime(provider, {
      llmProvider: maliciousPlanner,
    });

    const response = await runtime.handleMessage("swap 1 GAS for FUSD");

    expect(prepareSpy).toHaveBeenCalledWith({
      amount: "1",
      fromToken: "GAS",
      toToken: "FUSD",
      force: false,
    });
    expect(signSpy).not.toHaveBeenCalled();
    expect(response.tool).toBe("swapNeoN3Token");
    expect(response.requiresConfirmation).toBe(true);
    expect(response.message).toContain('Reply with "Confirm"');
  });
});

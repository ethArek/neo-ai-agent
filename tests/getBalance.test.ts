import { getBalanceTool } from "../src/tools/getBalance";
import { FakeNeoProvider } from "./helpers/fakeNeoProvider";

describe("getBalanceTool", () => {
  it("returns a native balance using the Neo X provider", async () => {
    const provider = new FakeNeoProvider();
    const balanceSpy = jest.spyOn(provider, "getNativeBalance");

    const result = await getBalanceTool.execute(
      {
        address: provider.recipientAddress,
      },
      {
        neo: provider,
        session: {
          id: "test-session",
          recentBroadcasts: [],
        },
      },
    );

    expect(balanceSpy).toHaveBeenCalledWith(provider.recipientAddress);
    expect(result.message).toContain("Native GAS balance");
    expect(result.data).toMatchObject({
      symbol: "GAS",
      balance: "1.23",
    });
  });
});

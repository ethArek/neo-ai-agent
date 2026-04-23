import { createCliTheme } from "../src/cli/theme";

describe("createCliTheme", () => {
  it("returns plain text when colors are disabled", () => {
    const theme = createCliTheme(false);

    expect(theme.renderLabel("Tool", "sendNeoN3Gas")).toBe(
      "Tool: sendNeoN3Gas",
    );
    expect(theme.renderNetworkStatus("mainnet")).toBe(
      "Network: Neo N3  MAINNET ",
    );
    expect(theme.renderPrompt()).toBe("neo> ");
    expect(theme.renderJson({ amount: 1, confirmed: true })).toBe(
      JSON.stringify(
        {
          amount: 1,
          confirmed: true,
        },
        null,
        2,
      ),
    );
  });

  it("renders styled banner and prompt when colors are enabled", () => {
    const theme = createCliTheme(true);

    expect(theme.renderBanner()).toContain("\u001b[");
    expect(theme.renderBanner()).toContain("Neo AI Agent");
    expect(theme.renderNetworkStatus("testnet")).toContain("\u001b[");
    expect(theme.renderNetworkStatus("testnet")).toContain("TESTNET");
    expect(theme.renderPrompt()).toContain("\u001b[");
    expect(theme.renderWarning("Requires confirmation")).toContain("\u001b[");
  });

  it("highlights json keys and scalar values", () => {
    const theme = createCliTheme(true);
    const rendered = theme.renderJson({
      symbol: "GAS",
      decimals: 8,
      tradable: true,
      note: null,
    });

    expect(rendered).toContain('\u001b[1;36m"symbol"\u001b[0m:');
    expect(rendered).toContain('\u001b[32m"GAS"\u001b[0m');
    expect(rendered).toContain("\u001b[33m8\u001b[0m");
    expect(rendered).toContain("\u001b[35mtrue\u001b[0m");
    expect(rendered).toContain("\u001b[31mnull\u001b[0m");
  });
});

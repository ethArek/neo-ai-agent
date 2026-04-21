import { buildConfirmationGuidance } from "../src/cli/confirmation";

describe("buildConfirmationGuidance", () => {
  it("explains the confirm flow in interactive mode", () => {
    const guidance = buildConfirmationGuidance("interactive");

    expect(guidance.title).toBe("Confirmation");
    expect(guidance.lines[0]).toContain("Nothing has been sent yet");
    expect(guidance.lines[1]).toContain('type "Confirm"');
    expect(guidance.lines[2]).toContain('type "Cancel"');
  });

  it("explains the restart requirement for one-shot mode", () => {
    const guidance = buildConfirmationGuidance("one-shot");

    expect(guidance.lines[0]).toContain("Nothing has been sent yet");
    expect(guidance.lines[1]).toContain("session ends after the response");
    expect(guidance.lines[2]).toContain("interactive");
    expect(guidance.lines[2]).toContain('type "Confirm"');
  });
});

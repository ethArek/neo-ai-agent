import { SessionStore } from "../src/agent/sessionStore";

describe("SessionStore", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("evicts the oldest session when the configured session cap is reached", () => {
    let now = 1;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const sessions = new SessionStore({
      maxSessions: 2,
    });

    sessions.rememberAddress("session-1", "addr-1", "neoN3");
    now = 2;
    sessions.rememberAddress("session-2", "addr-2", "neoN3");
    now = 3;
    sessions.rememberAddress("session-3", "addr-3", "neoN3");

    expect(sessions.getStats().activeSessions).toBe(2);
    expect(
      sessions.getToolSessionContext("session-2").lastReferencedAddress,
    ).toBe("addr-2");
    expect(
      sessions.getToolSessionContext("session-3").lastReferencedAddress,
    ).toBe("addr-3");
  });
});

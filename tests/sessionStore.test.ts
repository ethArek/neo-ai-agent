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

  it("preserves a user-selected default network across context syncs", () => {
    const sessions = new SessionStore();

    sessions.setNetworkContext("session-1", {
      defaultNetwork: "neoN3",
      implementedNetworks: ["neoN3", "neoX"],
      walletAddresses: {
        neoN3: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
        neoX: "0xAA00000000000000000000000000000000000001",
      },
    });
    sessions.setDefaultNetwork("session-1", "neoX");
    sessions.setNetworkContext("session-1", {
      defaultNetwork: "neoN3",
      implementedNetworks: ["neoN3", "neoX"],
      walletAddresses: {
        neoN3: "NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM",
        neoX: "0xAA00000000000000000000000000000000000001",
      },
    });

    expect(sessions.getToolSessionContext("session-1")).toMatchObject({
      defaultNetwork: "neoX",
      activeNetworkSelected: true,
      walletAddress: "0xAA00000000000000000000000000000000000001",
    });
  });
});

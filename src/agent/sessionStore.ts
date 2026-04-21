import { randomUUID } from "node:crypto";

import type { NeoNetwork, NetworkAddressMap } from "../neo/types";
import type {
  BroadcastActivity,
  DraftToolAction,
  PendingToolAction,
  ToolSessionContext,
} from "./types";

interface AgentSession {
  id: string;
  defaultNetwork: NeoNetwork;
  implementedNetworks: NeoNetwork[];
  pendingAction?: PendingToolAction;
  draftAction?: DraftToolAction;
  walletAddress?: string;
  walletAddresses: NetworkAddressMap;
  lastReferencedAddress?: string;
  lastReferencedAddresses: NetworkAddressMap;
  recentBroadcasts: BroadcastActivity[];
  updatedAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly maxAgeMs: number;
  private readonly maxRecentBroadcasts = 20;

  public constructor(maxAgeMs = 1000 * 60 * 60) {
    this.maxAgeMs = maxAgeMs;
  }

  public getOrCreate(sessionId?: string): AgentSession {
    this.cleanupExpiredSessions();

    if (sessionId) {
      const existing = this.sessions.get(sessionId);

      if (existing) {
        existing.updatedAt = Date.now();

        return existing;
      }
    }

    const session: AgentSession = {
      id: sessionId ?? randomUUID(),
      defaultNetwork: "neoN3",
      implementedNetworks: ["neoN3"],
      walletAddresses: {},
      lastReferencedAddresses: {},
      recentBroadcasts: [],
      updatedAt: Date.now(),
    };

    this.sessions.set(session.id, session);

    return session;
  }

  public setPendingAction(
    sessionId: string,
    pendingAction: PendingToolAction,
  ): void {
    const session = this.getOrCreate(sessionId);
    session.pendingAction = pendingAction;
    session.updatedAt = Date.now();
  }

  public clearPendingAction(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (session) {
      session.pendingAction = undefined;
      session.updatedAt = Date.now();
    }
  }

  public setDraftAction(sessionId: string, draftAction: DraftToolAction): void {
    const session = this.getOrCreate(sessionId);

    session.draftAction = draftAction;
    session.updatedAt = Date.now();
  }

  public clearDraftAction(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (session) {
      session.draftAction = undefined;
      session.updatedAt = Date.now();
    }
  }

  public setNetworkContext(
    sessionId: string,
    context: {
      defaultNetwork: NeoNetwork;
      implementedNetworks: NeoNetwork[];
      walletAddresses: NetworkAddressMap;
    },
  ): void {
    const session = this.getOrCreate(sessionId);

    session.defaultNetwork = context.defaultNetwork;
    session.implementedNetworks = [...context.implementedNetworks];
    session.walletAddresses = {
      ...context.walletAddresses,
    };
    session.walletAddress = this.selectPrimaryAddress(
      session.defaultNetwork,
      session.walletAddresses,
    );

    for (const network of Object.keys(
      session.walletAddresses,
    ) as NeoNetwork[]) {
      const address = session.walletAddresses[network];

      if (address && !session.lastReferencedAddresses[network]) {
        session.lastReferencedAddresses[network] = address;
      }
    }

    if (!session.lastReferencedAddress && session.walletAddress) {
      session.lastReferencedAddress = session.walletAddress;
    }

    session.updatedAt = Date.now();
  }

  public rememberAddress(
    sessionId: string,
    address: string,
    network?: NeoNetwork,
  ): void {
    const session = this.getOrCreate(sessionId);
    const resolvedNetwork = network ?? session.defaultNetwork;

    session.lastReferencedAddress = address;
    session.lastReferencedAddresses[resolvedNetwork] = address;
    session.updatedAt = Date.now();
  }

  public addBroadcastActivity(
    sessionId: string,
    activity: BroadcastActivity,
  ): void {
    const session = this.getOrCreate(sessionId);

    session.recentBroadcasts.unshift(activity);
    session.recentBroadcasts = session.recentBroadcasts.slice(
      0,
      this.maxRecentBroadcasts,
    );
    session.updatedAt = Date.now();
  }

  public getToolSessionContext(sessionId: string): ToolSessionContext {
    const session = this.getOrCreate(sessionId);

    return {
      id: session.id,
      defaultNetwork: session.defaultNetwork,
      implementedNetworks: [...session.implementedNetworks],
      walletAddress: session.walletAddress,
      walletAddresses: {
        ...session.walletAddresses,
      },
      lastReferencedAddress: session.lastReferencedAddress,
      lastReferencedAddresses: {
        ...session.lastReferencedAddresses,
      },
      recentBroadcasts: [...session.recentBroadcasts],
    };
  }

  private selectPrimaryAddress(
    defaultNetwork: NeoNetwork,
    walletAddresses: NetworkAddressMap,
  ): string | undefined {
    return walletAddresses[defaultNetwork] ?? Object.values(walletAddresses)[0];
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.updatedAt > this.maxAgeMs) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

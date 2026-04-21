import { randomUUID } from "node:crypto";

import type {
  BroadcastActivity,
  DraftToolAction,
  PendingToolAction,
  ToolSessionContext,
} from "./types";

interface AgentSession {
  id: string;
  pendingAction?: PendingToolAction;
  draftAction?: DraftToolAction;
  walletAddress?: string;
  neoXWalletAddress?: string;
  neoN3WalletAddress?: string;
  lastReferencedAddress?: string;
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

  public setWalletAddress(sessionId: string, address: string): void {
    const session = this.getOrCreate(sessionId);

    session.walletAddress = address;

    if (!session.lastReferencedAddress) {
      session.lastReferencedAddress = address;
    }

    session.updatedAt = Date.now();
  }

  public setWalletAddresses(
    sessionId: string,
    addresses: {
      neoXWalletAddress?: string;
      neoN3WalletAddress?: string;
    },
  ): void {
    const session = this.getOrCreate(sessionId);
    const primaryWalletAddress =
      addresses.neoN3WalletAddress ?? addresses.neoXWalletAddress;

    session.neoXWalletAddress = addresses.neoXWalletAddress;
    session.neoN3WalletAddress = addresses.neoN3WalletAddress;
    session.walletAddress = primaryWalletAddress;

    if (!session.lastReferencedAddress && primaryWalletAddress) {
      session.lastReferencedAddress = primaryWalletAddress;
    }

    session.updatedAt = Date.now();
  }

  public rememberAddress(sessionId: string, address: string): void {
    const session = this.getOrCreate(sessionId);

    session.lastReferencedAddress = address;
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
      walletAddress: session.walletAddress,
      neoXWalletAddress: session.neoXWalletAddress,
      neoN3WalletAddress: session.neoN3WalletAddress,
      lastReferencedAddress: session.lastReferencedAddress,
      recentBroadcasts: [...session.recentBroadcasts],
    };
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

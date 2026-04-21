import type { BroadcastResult, PreparedTransaction } from "./types";

export function toBroadcastSummary(summary: string): string {
  if (/^Prepared\b/.test(summary)) {
    return summary.replace(/^Prepared\b/, "Submitted");
  }

  return summary;
}

export function createBroadcastResult(
  prepared: PreparedTransaction,
  txHash: string,
): BroadcastResult {
  return {
    txHash,
    sender: prepared.sender,
    summary: toBroadcastSummary(prepared.summary),
    network: prepared.network,
  };
}

export function createBroadcastMessage(broadcast: BroadcastResult): string {
  return `${broadcast.summary} Transaction hash: ${broadcast.txHash}.`;
}

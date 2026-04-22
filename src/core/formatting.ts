import type { NeoNetwork } from "../neo/types";

export function formatNetworkLabel(network: NeoNetwork): string {
  return network === "neoX" ? "Neo X" : "Neo N3";
}

import type { NeoNetwork } from "../neo/types";

export const chainTypes = ["neo-n3", "neo-x"] as const;
export const chainNetworks = ["mainnet", "testnet", "custom"] as const;

export type ChainType = (typeof chainTypes)[number];
export type Network = (typeof chainNetworks)[number];

export interface ChainAdapter {
  chainType: ChainType;
  getImplementedNetwork(): NeoNetwork;
  getDefaultNetwork(): Network;
  walletEnabled(): boolean;
  getWalletAddress(): string | undefined;
}

export interface ToolExecutionContextMetadata {
  chain: ChainType;
  network: Network;
}

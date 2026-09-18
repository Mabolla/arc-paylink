import { defineChain } from "viem";

export type ArcNetwork = "mainnet" | "testnet";

export const ARC_NETWORK: ArcNetwork =
  process.env.NEXT_PUBLIC_ARC_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const IS_ARC_MAINNET = ARC_NETWORK === "mainnet";
export const ARC_CHAIN_ID = IS_ARC_MAINNET ? 5_042 : 5_042_002;
export const ARC_NETWORK_NAME = IS_ARC_MAINNET ? "Arc" : "Arc Testnet";
export const ARC_RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC_URL
  ?? (IS_ARC_MAINNET ? "https://rpc.mainnet.arc.io" : "https://rpc.testnet.arc.io");
export const ARC_EXPLORER_URL = IS_ARC_MAINNET
  ? "https://explorer.arc.io"
  : "https://explorer.testnet.arc.io";
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const USDC_DECIMALS = 6;

export const arcChain = defineChain({
  id: ARC_CHAIN_ID,
  name: ARC_NETWORK_NAME,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: { default: { name: "ArcScan", url: ARC_EXPLORER_URL } },
  ...(IS_ARC_MAINNET ? {} : { testnet: true }),
});

export const arcChainParameter = {
  chainId: `0x${ARC_CHAIN_ID.toString(16)}`,
  chainName: ARC_NETWORK_NAME,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: [ARC_RPC_URL],
  blockExplorerUrls: [ARC_EXPLORER_URL],
};

import { IS_ARC_MAINNET, arcChain } from "../arc";

// A legacy NEXT_PUBLIC_ARC_RPC_URL override can point at the other network.
// Collections use the canonical endpoint for their explicitly selected chain.
// Receipt verification still checks the RPC's actual chain ID before accepting it.
export const COMMERCE_RPC_URL = IS_ARC_MAINNET
  ? "https://rpc.mainnet.arc.io"
  : "https://rpc.testnet.arc.io";
export const commerceChain = {
  ...arcChain,
  rpcUrls: { default: { http: [COMMERCE_RPC_URL] } },
};

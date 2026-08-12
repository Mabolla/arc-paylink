import type { EIP1193Provider } from "viem";
import { ARC_CHAIN_ID, arcChainParameter } from "./arc";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export function getBrowserProvider(): EIP1193Provider {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask or another EVM wallet.");
  return window.ethereum;
}

export async function connectWallet(provider: EIP1193Provider): Promise<`0x${string}`> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
  if (!accounts[0]) throw new Error("The wallet did not return an account.");
  return accounts[0];
}

export async function ensureArcTestnet(provider: EIP1193Provider): Promise<void> {
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  const target = `0x${ARC_CHAIN_ID.toString(16)}`;
  if (current.toLowerCase() === target.toLowerCase()) return;

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: target }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [arcChainParameter] });
  }
}

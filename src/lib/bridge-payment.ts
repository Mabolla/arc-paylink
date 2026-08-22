import { AppKit, type BridgeResult } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, http, type Address, type EIP1193Provider } from "viem";

const BASE_SEPOLIA_CHAIN_ID = 84_532;
const BASE_SEPOLIA_RPC_URL = "https://base-sepolia-rpc.publicnode.com";

async function ensureBaseSepolia(provider: EIP1193Provider): Promise<void> {
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  const target = `0x${BASE_SEPOLIA_CHAIN_ID.toString(16)}`;
  if (current.toLowerCase() === target) return;
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: target }] });
}

export async function executeBridgePayment({
  provider,
  recipient,
  amount,
}: {
  provider: EIP1193Provider;
  recipient: Address;
  amount: string;
}): Promise<BridgeResult> {
  await ensureBaseSepolia(provider);
  const adapter = await createViemAdapterFromProvider({
    provider,
    getPublicClient: ({ chain }) =>
      createPublicClient({
        chain,
        transport: http(chain.id === BASE_SEPOLIA_CHAIN_ID ? BASE_SEPOLIA_RPC_URL : undefined),
      }),
  });
  const result = await new AppKit().bridge({
    from: { adapter, chain: "Base_Sepolia" },
    to: { adapter, chain: "Arc_Testnet", recipientAddress: recipient, useForwarder: false },
    amount,
    token: "USDC",
  });
  if (result.destination.useForwarder === true) throw new Error("Forwarder bridge flows are unsupported.");
  return result;
}

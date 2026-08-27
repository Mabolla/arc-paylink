const { createPublicClient, formatUnits, http } = require("viem");
const { arcTestnet } = require("viem/chains");

const BASE_SEPOLIA_DOMAIN = 6;
const BURN_TRANSACTION = "0xee5cf435e0b17874ed0b9415763d976ae2e20d4caf11be1b4e0154cef8fe62bf";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ESCROW_ADDRESS = "0x5321E75Be8c1814C205eda13c26cDD067dc225BD";
const EXPECTED_BALANCE = 1_000_000n;

const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
];

async function main() {
  const destination = createPublicClient({
    chain: arcTestnet,
    transport: http(process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io"),
  });

  let forwardTxHash;
  for (let attempt = 0; attempt < 120 && !forwardTxHash; attempt += 1) {
    const response = await fetch(
      `https://iris-api-sandbox.circle.com/v2/messages/${BASE_SEPOLIA_DOMAIN}?transactionHash=${BURN_TRANSACTION}`,
    );
    if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }
    if (!response.ok) throw new Error(`Circle message lookup failed with HTTP ${response.status}`);
    const data = await response.json();
    forwardTxHash = data.messages?.[0]?.forwardTxHash;
    if (!forwardTxHash) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!forwardTxHash) throw new Error("Timed out waiting for the Arc forwarding transaction");

  const escrowBalance = await destination.readContract({
    address: ARC_USDC,
    abi: balanceOfAbi,
    functionName: "balanceOf",
    args: [ESCROW_ADDRESS],
  });
  if (escrowBalance < EXPECTED_BALANCE) {
    throw new Error(`Arc escrow balance is only ${formatUnits(escrowBalance, 6)} USDC`);
  }

  console.log(`Base burn transaction: ${BURN_TRANSACTION}`);
  console.log(`Arc mint transaction: ${forwardTxHash}`);
  console.log(`Arc escrow: ${ESCROW_ADDRESS}`);
  console.log(`Arc escrow balance: ${formatUnits(escrowBalance, 6)} USDC`);
  console.log("Cross-chain escrow funding verified.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

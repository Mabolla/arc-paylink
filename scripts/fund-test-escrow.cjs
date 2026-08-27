const {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  pad,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { arcTestnet, baseSepolia } = require("viem/chains");

const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TOKEN_MESSENGER_WITH_FEES = "0x8745D906D67C346E5eb1aEEED38Eb87F34DF0C0A";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ESCROW_ADDRESS = "0x5321E75Be8c1814C205eda13c26cDD067dc225BD";
const BASE_SEPOLIA_DOMAIN = 6;
const ARC_TESTNET_DOMAIN = 26;
const TRANSFER_AMOUNT = 1_000_000n;
const MAX_FEE_AMOUNT = 100_000n;
const EXECUTE = process.env.CCTP_EXECUTE_TRANSFER === "true";

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "allowance", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
];

const depositAbi = [
  {
    type: "function",
    name: "depositForBurnWithFees",
    stateMutability: "payable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      {
        name: "claim",
        type: "tuple",
        components: [
          { name: "signedQuote", type: "bytes" },
          { name: "refundAddress", type: "address" },
        ],
      },
    ],
    outputs: [],
  },
];

function getPrivateKey() {
  const input = process.env.ARC_TESTNET_PRIVATE_KEY?.trim();
  if (!input) throw new Error("ARC_TESTNET_PRIVATE_KEY is not set");
  const key = input.startsWith("0x") ? input : `0x${input}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Private key must contain exactly 32 bytes");
  return key;
}

async function main() {
  const account = privateKeyToAccount(getPrivateKey());
  const source = createPublicClient({ chain: baseSepolia, transport: http() });
  const wallet = createWalletClient({ chain: baseSepolia, transport: http(), account });
  const destination = createPublicClient({
    chain: arcTestnet,
    transport: http(process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io"),
  });

  const [ethBalance, usdcBalance, currentAllowance, escrowBalanceBefore] = await Promise.all([
    source.getBalance({ address: account.address }),
    source.readContract({ address: BASE_SEPOLIA_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    source.readContract({
      address: BASE_SEPOLIA_USDC,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, TOKEN_MESSENGER_WITH_FEES],
    }),
    destination.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [ESCROW_ADDRESS] }),
  ]);

  const quoteResponse = await fetch(
    `https://iris-api-sandbox.circle.com/v2/quote/burn/usdc/${BASE_SEPOLIA_DOMAIN}/${ARC_TESTNET_DOMAIN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: TRANSFER_AMOUNT.toString(),
        feeToken: BASE_SEPOLIA_USDC,
        requests: [{ type: "FORWARD" }, { type: "PRE_FINALITY" }],
      }),
    },
  );
  if (!quoteResponse.ok) throw new Error(`Circle quote failed with HTTP ${quoteResponse.status}`);
  const quote = await quoteResponse.json();
  if (!quote.signedQuote || !quote.feeTotalAmount) throw new Error("Circle returned an incomplete quote");

  const feeAmount = BigInt(quote.feeTotalAmount);
  if (feeAmount > MAX_FEE_AMOUNT) {
    throw new Error(`Quoted fee exceeds the 0.1 USDC safety cap: ${formatUnits(feeAmount, 6)} USDC`);
  }
  const approvalAmount = TRANSFER_AMOUNT + feeAmount;
  console.log(`Source wallet: ${account.address}`);
  console.log(`Base Sepolia ETH: ${formatEther(ethBalance)}`);
  console.log(`Base Sepolia USDC: ${formatUnits(usdcBalance, 6)}`);
  console.log(`Current CCTP allowance: ${formatUnits(currentAllowance, 6)} USDC`);
  console.log(`Arc escrow balance before: ${formatUnits(escrowBalanceBefore, 6)} USDC`);
  console.log(`Destination escrow: ${ESCROW_ADDRESS}`);
  console.log(`Transfer: ${formatUnits(TRANSFER_AMOUNT, 6)} USDC`);
  console.log(`Quoted fee: ${formatUnits(feeAmount, 6)} USDC`);
  console.log(`Total source USDC: ${formatUnits(approvalAmount, 6)} USDC`);
  console.log(`Quote expires at Base block: ${quote.expiry?.expiresAtBlock ?? "unknown"}`);

  if (usdcBalance < approvalAmount) throw new Error("Insufficient Base Sepolia USDC for transfer plus fees");
  if (ethBalance === 0n) throw new Error("Base Sepolia ETH is required for gas");
  if (!EXECUTE) {
    console.log("Dry run complete; no approval or burn transaction was sent.");
    return;
  }

  const approvalTx = await wallet.writeContract({
    address: BASE_SEPOLIA_USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [TOKEN_MESSENGER_WITH_FEES, approvalAmount],
  });
  const approvalReceipt = await source.waitForTransactionReceipt({ hash: approvalTx });
  if (approvalReceipt.status !== "success") throw new Error("USDC approval transaction reverted");
  const allowanceAfterApproval = await source.readContract({
    address: BASE_SEPOLIA_USDC,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, TOKEN_MESSENGER_WITH_FEES],
  });
  if (allowanceAfterApproval < approvalAmount) {
    throw new Error(
      `USDC allowance is ${formatUnits(allowanceAfterApproval, 6)} after approval; expected ${formatUnits(approvalAmount, 6)}`,
    );
  }
  console.log(`Approval transaction: ${approvalTx}`);
  console.log(`Allowance after approval: ${formatUnits(allowanceAfterApproval, 6)} USDC`);

  const burnTx = await wallet.sendTransaction({
    to: TOKEN_MESSENGER_WITH_FEES,
    data: encodeFunctionData({
      abi: depositAbi,
      functionName: "depositForBurnWithFees",
      args: [
        TRANSFER_AMOUNT,
        ARC_TESTNET_DOMAIN,
        pad(ESCROW_ADDRESS, { size: 32 }),
        BASE_SEPOLIA_USDC,
        pad("0x", { size: 32 }),
        { signedQuote: quote.signedQuote, refundAddress: account.address },
      ],
    }),
  });
  await source.waitForTransactionReceipt({ hash: burnTx });
  console.log(`Burn transaction: ${burnTx}`);

  let forwardTxHash;
  for (let attempt = 0; attempt < 120 && !forwardTxHash; attempt += 1) {
    const response = await fetch(
      `https://iris-api-sandbox.circle.com/v2/messages/${BASE_SEPOLIA_DOMAIN}?transactionHash=${burnTx}`,
    );
    if (!response.ok) throw new Error(`Circle message lookup failed with HTTP ${response.status}`);
    const data = await response.json();
    forwardTxHash = data.messages?.[0]?.forwardTxHash;
    if (!forwardTxHash) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!forwardTxHash) throw new Error("Timed out waiting for the Arc forwarding transaction");

  const escrowBalanceAfter = await destination.readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [ESCROW_ADDRESS],
  });
  if (escrowBalanceAfter < TRANSFER_AMOUNT) throw new Error("Arc escrow did not receive the expected 1 USDC");

  console.log(`Arc mint transaction: ${forwardTxHash}`);
  console.log(`Arc escrow balance after: ${formatUnits(escrowBalanceAfter, 6)} USDC`);
  console.log("Cross-chain escrow funding verified.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

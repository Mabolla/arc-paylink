const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const ARC_MAINNET_CHAIN_ID = 5042n;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const EXPECTED_DEPLOYER = "0xE7be265f2301E08a6EaE5Cfd0C1113a7Cd35b3dd";
const RECIPIENT = "0x94705A9d675daa924F9190Eca4c05ED6B12d5345";
const AMOUNT = 10_000n;
const OBLIGATION_ID = "MICROGRANT-PILOT-SETTLE-001";
const REQUEST_ID = "fea1571a-17ef-42f4-aae2-875916552165";

async function main() {
  if (process.env.CONFIRM_ARC_MAINNET_SETTLEMENT !== "ARC_PAYLINK_EXACT_0_01_USDC") {
    throw new Error("Refusing settlement without the exact mainnet confirmation value");
  }

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error(`Refusing chain ${network.chainId}; expected Arc Mainnet (${ARC_MAINNET_CHAIN_ID})`);
  }

  const [payer] = await hre.ethers.getSigners();
  if (!payer || payer.address.toLowerCase() !== EXPECTED_DEPLOYER.toLowerCase()) {
    throw new Error(`Refusing unexpected payer ${payer?.address ?? "missing"}`);
  }

  const usdc = await hre.ethers.getContractAt([
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
  ], ARC_USDC);
  if (await usdc.decimals() !== 6n) throw new Error("Unexpected Arc USDC decimals");
  const before = await usdc.balanceOf(payer.address);
  if (before < AMOUNT) throw new Error("Insufficient ERC-20 USDC balance for the exact pilot payment");

  const transaction = await usdc.transfer(RECIPIENT, AMOUNT);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Settlement transaction failed");

  const evidence = {
    schemaVersion: 1,
    network: "Arc Mainnet",
    chainId: Number(ARC_MAINNET_CHAIN_ID),
    requestId: REQUEST_ID,
    obligationId: OBLIGATION_ID,
    token: ARC_USDC,
    payer: payer.address,
    recipient: RECIPIENT,
    amount: "0.01",
    amountBaseUnits: AMOUNT.toString(),
    transactionHash: transaction.hash,
    blockNumber: receipt.blockNumber,
    confirmedAt: new Date().toISOString(),
    explorer: `https://explorer.arc.io/tx/${transaction.hash}`,
  };
  const output = path.join(__dirname, "..", "deployments", "arc-mainnet-settlement.json");
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

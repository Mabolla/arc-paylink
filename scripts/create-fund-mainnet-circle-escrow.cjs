const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const hre = require("hardhat");

const ARC_MAINNET_CHAIN_ID = 5042n;
const FACTORY_ADDRESS = "0x19fbf0B85e66d68D312cD18D04A1a789107387FF";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const EXPECTED_SENDER = "0xE7be265f2301E08a6EaE5Cfd0C1113a7Cd35b3dd";
const AMOUNT_USDC = "0.01";
const AMOUNT = 10_000n;
const LIFETIME_SECONDS = 7 * 24 * 60 * 60;

async function main() {
  if (process.env.CONFIRM_ARC_MAINNET_WALLETLESS_ESCROW !== "ARC_PAYLINK_WALLETLESS_0_01_USDC") {
    throw new Error("Refusing mainnet escrow funding without the exact confirmation value");
  }

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error(`Refusing chain ${network.chainId}; expected Arc Mainnet (${ARC_MAINNET_CHAIN_ID})`);
  }

  const [sender] = await hre.ethers.getSigners();
  if (!sender || sender.address.toLowerCase() !== EXPECTED_SENDER.toLowerCase()) {
    throw new Error(`Refusing unexpected sender ${sender?.address ?? "missing"}`);
  }

  const factory = await hre.ethers.getContractAt("ArcPayLinkFactory", FACTORY_ADDRESS);
  const usdc = await hre.ethers.getContractAt("IERC20", ARC_USDC);
  if ((await factory.paymentToken()).toLowerCase() !== ARC_USDC.toLowerCase()) {
    throw new Error("Factory payment token mismatch");
  }
  if (await usdc.balanceOf(sender.address) < AMOUNT) {
    throw new Error("Insufficient ERC-20 USDC for the 0.01 USDC walletless pilot");
  }

  const secret = `0x${randomBytes(32).toString("hex")}`;
  const secretHash = hre.ethers.keccak256(secret);
  const latest = await hre.ethers.provider.getBlock("latest");
  const expiry = latest.timestamp + LIFETIME_SECONDS;

  const createTx = await factory.createPayLink(AMOUNT, expiry, secretHash);
  const createReceipt = await createTx.wait();
  const created = createReceipt.logs
    .map((log) => {
      try { return factory.interface.parseLog(log); } catch { return null; }
    })
    .find((event) => event?.name === "PayLinkCreated");
  if (!created) throw new Error("PayLinkCreated event was not found");

  const escrow = created.args.escrow;
  const fundTx = await usdc.transfer(escrow, AMOUNT);
  const fundReceipt = await fundTx.wait();
  if (await usdc.balanceOf(escrow) !== AMOUNT) throw new Error("Escrow funding mismatch");

  const escrowContract = await hre.ethers.getContractAt("ArcPayLinkEscrow", escrow);
  if (await escrowContract.state() !== 1n) throw new Error("Escrow is not funded");

  const publicEvidence = {
    schemaVersion: 1,
    network: "Arc Mainnet",
    chainId: Number(ARC_MAINNET_CHAIN_ID),
    circleBlockchain: "ARC",
    circleWalletType: "User-Controlled SCA",
    factory: FACTORY_ADDRESS,
    sender: sender.address,
    paymentId: created.args.paymentId,
    escrow,
    amountUsdc: AMOUNT_USDC,
    amountBaseUnits: AMOUNT.toString(),
    expiry: new Date(expiry * 1000).toISOString(),
    secretHash,
    creationTransaction: createReceipt.hash,
    fundingTransaction: fundReceipt.hash,
    status: "funded",
  };
  fs.writeFileSync("arc-mainnet-walletless-escrow.json", `${JSON.stringify(publicEvidence, null, 2)}\n`, { flag: "wx" });
  fs.writeFileSync(
    "arc-mainnet-walletless.private-claim.json",
    `${JSON.stringify({ ...publicEvidence, secret }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify(publicEvidence, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

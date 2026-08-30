const fs = require("node:fs");
const { constants, createPublicKey, publicEncrypt, randomBytes } = require("node:crypto");
const hre = require("hardhat");

const ARC_TESTNET_CHAIN_ID = 5042002n;
const FACTORY_ADDRESS = "0x8C377F5Bb508ece6De8090209619122edd4bC453";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const TEST_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

function testAmount() {
  const value = process.env.ARC_PAYLINK_TEST_AMOUNT_USDC?.trim() || "0.01";
  if (!/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new Error("ARC_PAYLINK_TEST_AMOUNT_USDC must be a positive USDC amount with at most 6 decimals");
  }
  const units = hre.ethers.parseUnits(value, 6);
  if (units <= 0n) throw new Error("ARC_PAYLINK_TEST_AMOUNT_USDC must be positive");
  return { value, units };
}

function claimPublicKey() {
  const encoded = process.env.ARC_PAYLINK_CLAIM_PUBLIC_KEY?.trim();
  if (!encoded) throw new Error("ARC_PAYLINK_CLAIM_PUBLIC_KEY is not set");
  return createPublicKey({ key: Buffer.from(encoded, "base64"), format: "der", type: "spki" });
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(`Refusing to create an escrow on chain ${network.chainId}`);
  }

  const [sender] = await hre.ethers.getSigners();
  if (!sender) throw new Error("No Arc Testnet signer is configured");
  const amount = testAmount();

  const factoryCode = await hre.ethers.provider.getCode(FACTORY_ADDRESS);
  if (factoryCode === "0x") throw new Error(`No factory found at ${FACTORY_ADDRESS}`);

  const factory = await hre.ethers.getContractAt("ArcPayLinkFactory", FACTORY_ADDRESS);
  const usdc = await hre.ethers.getContractAt("IERC20", ARC_USDC);
  const configuredToken = await factory.paymentToken();
  if (configuredToken.toLowerCase() !== ARC_USDC.toLowerCase()) {
    throw new Error(`Factory token mismatch: ${configuredToken}`);
  }

  const senderBalance = await usdc.balanceOf(sender.address);
  if (senderBalance < amount.units) {
    throw new Error(`Insufficient Arc Testnet USDC: ${hre.ethers.formatUnits(senderBalance, 6)}`);
  }

  const secretBytes = randomBytes(32);
  const secret = `0x${secretBytes.toString("hex")}`;
  const secretHash = hre.ethers.keccak256(secret);
  const encryptedSecret = publicEncrypt(
    { key: claimPublicKey(), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    secretBytes,
  ).toString("base64");

  const latest = await hre.ethers.provider.getBlock("latest");
  const expiry = latest.timestamp + TEST_LIFETIME_SECONDS;
  const createTx = await factory.createPayLink(amount.units, expiry, secretHash);
  const createReceipt = await createTx.wait();
  const created = createReceipt.logs
    .map((log) => {
      try { return factory.interface.parseLog(log); } catch { return null; }
    })
    .find((event) => event?.name === "PayLinkCreated");
  if (!created) throw new Error("PayLinkCreated event was not found");

  const escrow = created.args.escrow;
  const fundTx = await usdc.transfer(escrow, amount.units);
  const fundReceipt = await fundTx.wait();
  const fundedBalance = await usdc.balanceOf(escrow);
  if (fundedBalance !== amount.units) {
    throw new Error(`Escrow funding mismatch: ${fundedBalance}`);
  }

  const escrowContract = await hre.ethers.getContractAt("ArcPayLinkEscrow", escrow);
  if ((await escrowContract.state()) !== 1n) throw new Error("New escrow is not Funded");

  const claimPackage = {
    network: "Arc Testnet",
    chainId: Number(ARC_TESTNET_CHAIN_ID),
    factory: FACTORY_ADDRESS,
    sender: sender.address,
    paymentId: created.args.paymentId,
    escrow,
    amountUsdc: amount.value,
    amountBaseUnits: amount.units.toString(),
    expiry: new Date(expiry * 1000).toISOString(),
    secretHash,
    encryptedSecret,
    encryption: "RSA-OAEP-SHA256",
    creationTransaction: createReceipt.hash,
    fundingTransaction: fundReceipt.hash,
    status: "funded",
  };
  fs.writeFileSync("circle-escrow-package.json", JSON.stringify(claimPackage, null, 2));

  const privateClaimPackage = { ...claimPackage, secret };
  delete privateClaimPackage.encryptedSecret;
  delete privateClaimPackage.encryption;
  const privatePackageName = `arc-paylink-${created.args.paymentId.slice(2, 10)}.private-claim.json`;
  fs.writeFileSync(privatePackageName, JSON.stringify(privateClaimPackage, null, 2), { mode: 0o600 });

  console.log(`Escrow: ${escrow}`);
  console.log(`Amount: ${amount.value} USDC`);
  console.log(`Secret hash: ${secretHash}`);
  console.log(`Create transaction: ${createReceipt.hash}`);
  console.log(`Funding transaction: ${fundReceipt.hash}`);
  console.log(`Encrypted claim secret: ${encryptedSecret}`);
  console.log(`Private recipient package: ${privatePackageName}`);
  console.log("Escrow state: Funded");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const hre = require("hardhat");

const ARC_TESTNET_CHAIN_ID = 5042002n;
const FACTORY_ADDRESS = "0x8C377F5Bb508ece6De8090209619122edd4bC453";
const EXPECTED_USDC = "0x3600000000000000000000000000000000000000";
const TEST_AMOUNT = 1_000_000n;
const TEST_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

async function main() {
  const privateKeyInput = process.env.ARC_TESTNET_PRIVATE_KEY?.trim();
  if (!privateKeyInput) throw new Error("ARC_TESTNET_PRIVATE_KEY is not set");
  const privateKey = privateKeyInput.startsWith("0x") ? privateKeyInput : `0x${privateKeyInput}`;
  if (!hre.ethers.isHexString(privateKey, 32)) {
    throw new Error("ARC_TESTNET_PRIVATE_KEY must contain exactly 32 bytes");
  }

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(`Refusing to create an escrow on chain ${network.chainId}`);
  }

  const [sender] = await hre.ethers.getSigners();
  if (!sender) throw new Error("No Arc Testnet signer is configured");

  const factoryCode = await hre.ethers.provider.getCode(FACTORY_ADDRESS);
  if (factoryCode === "0x") throw new Error(`No factory found at ${FACTORY_ADDRESS}`);

  const factory = await hre.ethers.getContractAt("ArcPayLinkFactory", FACTORY_ADDRESS);
  const configuredToken = await factory.paymentToken();
  if (configuredToken.toLowerCase() !== EXPECTED_USDC.toLowerCase()) {
    throw new Error(`Factory token mismatch: ${configuredToken}`);
  }

  const latest = await hre.ethers.provider.getBlock("latest");
  const expiry = latest.timestamp + TEST_LIFETIME_SECONDS;
  const nonce = await factory.nonces(sender.address);
  const secret = hre.ethers.keccak256(
    hre.ethers.solidityPacked(
      ["bytes32", "string", "address", "uint256"],
      [privateKey, "arc-paylink-crosschain-test-v1", FACTORY_ADDRESS, nonce],
    ),
  );
  const secretHash = hre.ethers.keccak256(secret);

  const tx = await factory.createPayLink(TEST_AMOUNT, expiry, secretHash);
  const receipt = await tx.wait();
  const created = receipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "PayLinkCreated");

  if (!created) throw new Error("PayLinkCreated event was not found");

  console.log(`Sender: ${sender.address}`);
  console.log(`Payment ID: ${created.args.paymentId}`);
  console.log(`Escrow: ${created.args.escrow}`);
  console.log(`Amount: ${hre.ethers.formatUnits(TEST_AMOUNT, 6)} USDC`);
  console.log(`Expiry: ${new Date(expiry * 1000).toISOString()}`);
  console.log(`Secret hash: ${secretHash}`);
  console.log(`Transaction: ${receipt.hash}`);
  console.log(`Explorer: https://testnet.arcscan.app/tx/${receipt.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const hre = require("hardhat");

const ARC_TESTNET_CHAIN_ID = 5042002n;
const FACTORY_ADDRESS = "0x8C377F5Bb508ece6De8090209619122edd4bC453";
const ESCROW_ADDRESS = "0x5321E75Be8c1814C205eda13c26cDD067dc225BD";
const EXPECTED_USDC = "0x3600000000000000000000000000000000000000";
const EXPECTED_AMOUNT = 1_000_000n;
const EXPECTED_SECRET_HASH = "0x870b2c9673739e5231aa243f98c5d51bec3cdd0f0ab4a2022ba6b580e6ad2b41";
const CREATION_TRANSACTION = "0x83a2a27212622e6aee519458de2c623ddab6dee399fc115122687355bc2a5580";
const CREATION_NONCE = 0n;

async function verifyClaim(escrow, recipientAddress) {
  const usdc = await hre.ethers.getContractAt("IERC20", EXPECTED_USDC);
  const creationReceipt = await hre.ethers.provider.getTransactionReceipt(CREATION_TRANSACTION);
  if (!creationReceipt) throw new Error("Escrow creation receipt was not found");
  const events = await escrow.queryFilter(escrow.filters.Claimed(), creationReceipt.blockNumber, "latest");
  if (events.length !== 1) throw new Error(`Expected one Claimed event; found ${events.length}`);

  const event = events[0];
  if (event.args.recipient.toLowerCase() !== recipientAddress.toLowerCase()) {
    throw new Error(`Claim recipient mismatch: ${event.args.recipient}`);
  }
  if (event.args.amount !== EXPECTED_AMOUNT) throw new Error(`Claim amount mismatch: ${event.args.amount}`);
  if ((await escrow.state()) !== 2n) throw new Error("Escrow state is not Claimed");
  if ((await usdc.balanceOf(ESCROW_ADDRESS)) !== 0n) throw new Error("Claimed escrow balance is not zero");

  console.log(`Recipient: ${event.args.recipient}`);
  console.log(`Escrow: ${ESCROW_ADDRESS}`);
  console.log(`Claim transaction: ${event.transactionHash}`);
  console.log(`Amount claimed: ${hre.ethers.formatUnits(event.args.amount, 6)} USDC`);
  console.log("Escrow state: Claimed");
  console.log(`Explorer: https://testnet.arcscan.app/tx/${event.transactionHash}`);
}

async function main() {
  const privateKeyInput = process.env.ARC_TESTNET_PRIVATE_KEY?.trim();
  if (!privateKeyInput) throw new Error("ARC_TESTNET_PRIVATE_KEY is not set");
  const privateKey = privateKeyInput.startsWith("0x") ? privateKeyInput : `0x${privateKeyInput}`;
  if (!hre.ethers.isHexString(privateKey, 32)) {
    throw new Error("ARC_TESTNET_PRIVATE_KEY must contain exactly 32 bytes");
  }

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(`Refusing to claim on chain ${network.chainId}`);
  }

  const [recipient] = await hre.ethers.getSigners();
  if (!recipient) throw new Error("No Arc Testnet signer is configured");

  const secret = hre.ethers.keccak256(
    hre.ethers.solidityPacked(
      ["bytes32", "string", "address", "uint256"],
      [privateKey, "arc-paylink-crosschain-test-v1", FACTORY_ADDRESS, CREATION_NONCE],
    ),
  );
  const secretHash = hre.ethers.keccak256(secret);
  if (secretHash.toLowerCase() !== EXPECTED_SECRET_HASH.toLowerCase()) {
    throw new Error("Derived secret does not match the funded escrow");
  }

  const escrow = await hre.ethers.getContractAt("ArcPayLinkEscrow", ESCROW_ADDRESS);
  const tokenAddress = await escrow.token();
  const amount = await escrow.amount();
  const expiry = await escrow.expiry();
  const onchainSecretHash = await escrow.secretHash();
  const stateBefore = await escrow.state();

  if (tokenAddress.toLowerCase() !== EXPECTED_USDC.toLowerCase()) throw new Error("Escrow token mismatch");
  if (amount !== EXPECTED_AMOUNT) throw new Error(`Escrow amount mismatch: ${amount}`);
  if (onchainSecretHash.toLowerCase() !== EXPECTED_SECRET_HASH.toLowerCase()) throw new Error("Escrow secret hash mismatch");
  if (stateBefore === 2n) {
    await verifyClaim(escrow, recipient.address);
    return;
  }
  if (stateBefore !== 1n) throw new Error(`Escrow is not funded; state=${stateBefore}`);

  const latest = await hre.ethers.provider.getBlock("latest");
  if (BigInt(latest.timestamp) >= expiry) throw new Error("Escrow has expired");
  const deadline = BigInt(Math.min(latest.timestamp + 3600, Number(expiry) - 1));

  const domain = {
    name: "Arc PayLink",
    version: "1",
    chainId: Number(ARC_TESTNET_CHAIN_ID),
    verifyingContract: ESCROW_ADDRESS,
  };
  const types = {
    Claim: [
      { name: "escrow", type: "address" },
      { name: "recipient", type: "address" },
      { name: "secretHash", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const value = {
    escrow: ESCROW_ADDRESS,
    recipient: recipient.address,
    secretHash: EXPECTED_SECRET_HASH,
    deadline,
  };
  const signature = await recipient.signTypedData(domain, types, value);

  const tx = await escrow.claim(secret, recipient.address, deadline, signature);
  await tx.wait();
  await verifyClaim(escrow, recipient.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

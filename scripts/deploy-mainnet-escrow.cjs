const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const ARC_MAINNET_CHAIN_ID = 5042n;
const ARC_USDC = "0x3600000000000000000000000000000000000000";

async function main() {
  if (process.env.CONFIRM_ARC_MAINNET_DEPLOY !== "ARC_PAYLINK_MAINNET") {
    throw new Error("Refusing mainnet deployment without CONFIRM_ARC_MAINNET_DEPLOY=ARC_PAYLINK_MAINNET");
  }

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error(`Refusing to deploy on chain ${network.chainId}; expected Arc Mainnet (${ARC_MAINNET_CHAIN_ID})`);
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("ARC_MAINNET_PRIVATE_KEY is not set");
  const expectedDeployer = process.env.EXPECTED_ARC_MAINNET_DEPLOYER;
  if (!expectedDeployer || deployer.address.toLowerCase() !== expectedDeployer.toLowerCase()) {
    throw new Error(`Refusing unexpected mainnet deployer ${deployer.address}`);
  }

  const tokenCode = await hre.ethers.provider.getCode(ARC_USDC);
  if (tokenCode === "0x") throw new Error(`No USDC interface found at ${ARC_USDC}`);

  const usdc = await hre.ethers.getContractAt(["function decimals() view returns (uint8)"], ARC_USDC);
  const decimals = await usdc.decimals();
  if (decimals !== 6n) throw new Error(`Unexpected Arc USDC decimals: ${decimals}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  if (balance === 0n) throw new Error("The deployer has no Arc USDC for gas");

  console.log(`Deployer: ${deployer.address}`);
  console.log(`Native gas balance: ${hre.ethers.formatEther(balance)} USDC`);

  const factory = await hre.ethers.deployContract("ArcPayLinkFactory", [ARC_USDC]);
  await factory.waitForDeployment();
  const deploymentTx = factory.deploymentTransaction();
  const receipt = await deploymentTx.wait();
  const factoryAddress = await factory.getAddress();
  const implementationAddress = await factory.implementation();

  const evidence = {
    schemaVersion: 2,
    release: "surplus-safe-v2",
    network: "Arc Mainnet",
    chainId: Number(ARC_MAINNET_CHAIN_ID),
    usdc: ARC_USDC,
    deployer: deployer.address,
    factory: factoryAddress,
    implementation: implementationAddress,
    transactionHash: deploymentTx.hash,
    blockNumber: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
    sourceCommit: process.env.SOURCE_COMMIT || null,
    supersedesFactory: "0x19fbf0B85e66d68D312cD18D04A1a789107387FF",
    explorer: `https://explorer.arc.io/tx/${deploymentTx.hash}`,
  };

  const output = path.join(__dirname, "..", "deployments", "arc-mainnet-escrow-v2.json");
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

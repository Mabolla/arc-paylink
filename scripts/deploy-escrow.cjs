const hre = require("hardhat");

const ARC_TESTNET_CHAIN_ID = 5042002n;
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(`Refusing to deploy on chain ${network.chainId}; expected Arc Testnet (${ARC_TESTNET_CHAIN_ID})`);
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("ARC_TESTNET_PRIVATE_KEY is not set");
  }

  const tokenCode = await hre.ethers.provider.getCode(ARC_TESTNET_USDC);
  if (tokenCode === "0x") {
    throw new Error(`No USDC interface found at ${ARC_TESTNET_USDC}`);
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Native gas balance: ${hre.ethers.formatEther(balance)} USDC`);

  const factory = await hre.ethers.deployContract("ArcPayLinkFactory", [ARC_TESTNET_USDC]);
  await factory.waitForDeployment();

  const deploymentTx = factory.deploymentTransaction();
  const factoryAddress = await factory.getAddress();
  const implementationAddress = await factory.implementation();

  console.log(`Factory: ${factoryAddress}`);
  console.log(`Implementation: ${implementationAddress}`);
  console.log(`Transaction: ${deploymentTx.hash}`);
  console.log(`Explorer: https://testnet.arcscan.app/tx/${deploymentTx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

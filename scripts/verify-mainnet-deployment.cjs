const fs = require("node:fs");
const path = require("node:path");
const { createPublicClient, getAddress, http, parseAbi } = require("viem");
const { arc } = require("viem/chains");

const root = path.join(__dirname, "..");
const deployment = JSON.parse(
  fs.readFileSync(path.join(root, "deployments", "arc-mainnet-escrow.json"), "utf8"),
);
const factoryArtifact = require(path.join(
  root,
  "artifacts/contracts/ArcPayLinkFactory.sol/ArcPayLinkFactory.json",
));
const escrowArtifact = require(path.join(
  root,
  "artifacts/contracts/ArcPayLinkEscrow.sol/ArcPayLinkEscrow.json",
));
const factoryDebug = require(path.join(
  root,
  "artifacts/contracts/ArcPayLinkFactory.sol/ArcPayLinkFactory.dbg.json",
));

function fail(message) {
  throw new Error(`Arc mainnet verification failed: ${message}`);
}

function normalizedAddressWord(value) {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function immutableReferences() {
  const buildInfoPath = path.resolve(
    root,
    "artifacts/contracts/ArcPayLinkFactory.sol",
    factoryDebug.buildInfo,
  );
  const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
  return buildInfo.output.contracts["contracts/ArcPayLinkFactory.sol"]
    .ArcPayLinkFactory.evm.deployedBytecode.immutableReferences;
}

function verifyFactoryBytecode(onchainCode) {
  const compiled = factoryArtifact.deployedBytecode.toLowerCase().replace(/^0x/, "");
  const deployed = onchainCode.toLowerCase().replace(/^0x/, "");
  if (compiled.length !== deployed.length) fail("factory bytecode length mismatch");

  const ignored = new Set();
  const observedGroups = [];
  for (const references of Object.values(immutableReferences())) {
    const values = new Set();
    for (const { start, length } of references) {
      for (let index = start * 2; index < (start + length) * 2; index += 1) ignored.add(index);
      values.add(deployed.slice(start * 2, (start + length) * 2));
    }
    if (values.size !== 1) fail("factory immutable references are inconsistent");
    observedGroups.push([...values][0]);
  }

  for (let index = 0; index < compiled.length; index += 1) {
    if (!ignored.has(index) && compiled[index] !== deployed[index]) {
      fail(`factory bytecode differs outside immutable data at nibble ${index}`);
    }
  }

  const expected = new Set([
    normalizedAddressWord(deployment.implementation),
    normalizedAddressWord(deployment.usdc),
  ]);
  if (observedGroups.length !== expected.size || observedGroups.some((value) => !expected.has(value))) {
    fail("factory immutable addresses do not match the deployment record");
  }
}

async function main() {
  if (deployment.chainId !== 5042) fail(`unexpected chain ID ${deployment.chainId}`);
  const client = createPublicClient({ chain: arc, transport: http("https://rpc.mainnet.arc.io") });
  const chainId = await client.getChainId();
  if (chainId !== deployment.chainId) fail(`RPC returned chain ID ${chainId}`);

  const factory = getAddress(deployment.factory);
  const implementation = getAddress(deployment.implementation);
  const [factoryCode, implementationCode, receipt, configuredImplementation, configuredToken] =
    await Promise.all([
      client.getCode({ address: factory }),
      client.getCode({ address: implementation }),
      client.getTransactionReceipt({ hash: deployment.transactionHash }),
      client.readContract({
        address: factory,
        abi: parseAbi(["function implementation() view returns (address)"]),
        functionName: "implementation",
      }),
      client.readContract({
        address: factory,
        abi: parseAbi(["function paymentToken() view returns (address)"]),
        functionName: "paymentToken",
      }),
    ]);

  if (!factoryCode || factoryCode === "0x") fail("factory bytecode is missing");
  if (!implementationCode || implementationCode === "0x") fail("implementation bytecode is missing");
  verifyFactoryBytecode(factoryCode);
  if (implementationCode.toLowerCase() !== escrowArtifact.deployedBytecode.toLowerCase()) {
    fail("implementation bytecode does not match the compiled ArcPayLinkEscrow artifact");
  }
  if (receipt.status !== "success") fail("deployment transaction did not succeed");
  if (receipt.blockNumber !== BigInt(deployment.blockNumber)) fail("deployment block mismatch");
  if (receipt.contractAddress?.toLowerCase() !== factory.toLowerCase()) fail("receipt factory mismatch");
  if (configuredImplementation.toLowerCase() !== implementation.toLowerCase()) {
    fail("factory implementation getter mismatch");
  }
  if (configuredToken.toLowerCase() !== deployment.usdc.toLowerCase()) fail("factory token getter mismatch");

  console.log(JSON.stringify({
    chainId,
    factory,
    implementation,
    transactionHash: deployment.transactionHash,
    blockNumber: deployment.blockNumber,
    factoryBytecodeBytes: (factoryCode.length - 2) / 2,
    implementationBytecodeBytes: (implementationCode.length - 2) / 2,
    sourceCommit: deployment.sourceCommit,
    verified: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

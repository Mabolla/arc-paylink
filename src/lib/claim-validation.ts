import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHex,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { isTrustedArcPayLinkFactory } from "@/lib/claim-package";
import { ARC_NETWORK_NAME, ARC_RPC_URL, ARC_USDC_ADDRESS, arcChain } from "@/lib/arc";

const factoryAbi = parseAbi(["function escrows(bytes32 paymentId) view returns (address)"]);
const escrowAbi = parseAbi([
  "function token() view returns (address)",
  "function sender() view returns (address)",
  "function amount() view returns (uint256)",
  "function expiry() view returns (uint256)",
  "function secretHash() view returns (bytes32)",
  "function state() view returns (uint8)",
]);

type ContractReader = {
  readContract(args: {
    address: Address;
    abi: typeof factoryAbi | typeof escrowAbi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
};

const defaultReader = createPublicClient({
  chain: arcChain,
  transport: http(ARC_RPC_URL),
}) as unknown as ContractReader;

export type VerifiedClaimContext = {
  factory: Address;
  paymentId: Hex;
  escrow: Address;
  amountBaseUnits: bigint;
  expiry: number;
  secretHash: Hex;
  sender: Address;
};

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name}.`);
  return value.trim();
}

function address(value: unknown, name: string) {
  const candidate = requiredString(value, name);
  if (!isAddress(candidate)) throw new Error(`${name} is not a valid address.`);
  return getAddress(candidate);
}

function bytes32(value: unknown, name: string) {
  const candidate = requiredString(value, name);
  if (!isHex(candidate) || candidate.length !== 66) throw new Error(`${name} must be 32 bytes.`);
  return candidate as Hex;
}

export async function verifyClaimContext(
  input: Record<string, unknown>,
  reader: ContractReader = defaultReader,
  now = Math.floor(Date.now() / 1000),
): Promise<VerifiedClaimContext> {
  const factory = address(input.factory, "factory");
  if (!isTrustedArcPayLinkFactory(factory)) {
    throw new Error("Claim package factory is not trusted.");
  }
  const paymentId = bytes32(input.paymentId, "paymentId");
  const escrow = address(input.escrow, "escrow");
  const secretHash = bytes32(input.secretHash, "secretHash");
  const amountText = requiredString(input.amountBaseUnits, "amountBaseUnits");
  if (!/^\d+$/.test(amountText) || BigInt(amountText) <= 0n) throw new Error("Claim amount is invalid.");
  const amountBaseUnits = BigInt(amountText);
  const packageExpiry = Math.floor(Date.parse(requiredString(input.expiry, "expiry")) / 1000);
  if (!Number.isSafeInteger(packageExpiry)) throw new Error("Claim expiry is invalid.");

  const registeredEscrow = await reader.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "escrows",
    args: [paymentId],
  });
  if (typeof registeredEscrow !== "string" || !isAddress(registeredEscrow) || registeredEscrow.toLowerCase() !== escrow.toLowerCase()) {
    throw new Error("Escrow is not registered for this Arc PayLink payment ID.");
  }

  const [token, sender, amount, expiry, onchainSecretHash, state] = await Promise.all([
    reader.readContract({ address: escrow, abi: escrowAbi, functionName: "token" }),
    reader.readContract({ address: escrow, abi: escrowAbi, functionName: "sender" }),
    reader.readContract({ address: escrow, abi: escrowAbi, functionName: "amount" }),
    reader.readContract({ address: escrow, abi: escrowAbi, functionName: "expiry" }),
    reader.readContract({ address: escrow, abi: escrowAbi, functionName: "secretHash" }),
    reader.readContract({ address: escrow, abi: escrowAbi, functionName: "state" }),
  ]);

  if (typeof token !== "string" || token.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()) {
    throw new Error(`Escrow payment token is not ${ARC_NETWORK_NAME} USDC.`);
  }
  if (typeof sender !== "string" || !isAddress(sender)) throw new Error("Escrow sender is invalid.");
  if (amount !== amountBaseUnits) throw new Error("Claim amount does not match the escrow.");
  if (typeof expiry !== "bigint" || expiry !== BigInt(packageExpiry)) throw new Error("Claim expiry does not match the escrow.");
  if (typeof onchainSecretHash !== "string" || onchainSecretHash.toLowerCase() !== secretHash.toLowerCase()) {
    throw new Error("Claim secret hash does not match the escrow.");
  }
  if (state !== 1) throw new Error("Arc PayLink escrow is not funded and claimable.");
  if (packageExpiry <= now) throw new Error("This PayLink has expired.");

  return { factory, paymentId, escrow, amountBaseUnits, expiry: packageExpiry, secretHash, sender: getAddress(sender) };
}

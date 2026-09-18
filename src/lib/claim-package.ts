import { getAddress, isAddress, isHex, keccak256, zeroAddress, type Address, type Hex } from "viem";
import { ARC_CHAIN_ID, ARC_NETWORK_NAME, IS_ARC_MAINNET } from "@/lib/arc";

const configuredFactory = process.env.NEXT_PUBLIC_ARC_PAYLINK_FACTORY_ADDRESS;
export const ARC_PAYLINK_FACTORY = getAddress(
  configuredFactory && isAddress(configuredFactory)
    ? configuredFactory
    : IS_ARC_MAINNET
      ? zeroAddress
      : "0x8C377F5Bb508ece6De8090209619122edd4bC453",
);

export type PrivateClaimPackage = {
  network: string;
  chainId: typeof ARC_CHAIN_ID;
  factory: Address;
  paymentId: Hex;
  escrow: Address;
  amountBaseUnits: string;
  amountUsdc: string;
  expiry: string;
  secretHash: Hex;
  secret: Hex;
};

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name}.`);
  return value.trim();
}

function bytes32(value: unknown, name: string) {
  const candidate = requiredString(value, name);
  if (!isHex(candidate) || candidate.length !== 66) throw new Error(`${name} must be 32 bytes.`);
  return candidate as Hex;
}

function address(value: unknown, name: string) {
  const candidate = requiredString(value, name);
  if (!isAddress(candidate)) throw new Error(`${name} is not a valid address.`);
  return getAddress(candidate);
}

export function parsePrivateClaimPackage(value: unknown): PrivateClaimPackage {
  if (!value || typeof value !== "object") throw new Error("This is not a valid Arc PayLink claim package.");
  const input = value as Record<string, unknown>;
  const chainId = Number(input.chainId);
  if (chainId !== ARC_CHAIN_ID) throw new Error(`This package is not for ${ARC_NETWORK_NAME}.`);

  if (ARC_PAYLINK_FACTORY === zeroAddress) throw new Error("Arc PayLink mainnet factory is not configured.");

  const factory = address(input.factory, "factory");
  if (factory.toLowerCase() !== ARC_PAYLINK_FACTORY.toLowerCase()) {
    throw new Error("This package was not created by the Arc PayLink factory.");
  }

  const secret = bytes32(input.secret, "secret");
  const secretHash = bytes32(input.secretHash, "secretHash");
  if (keccak256(secret) !== secretHash) throw new Error("Claim package secret does not match its hash.");

  const amountBaseUnits = requiredString(input.amountBaseUnits, "amountBaseUnits");
  if (!/^\d+$/.test(amountBaseUnits) || BigInt(amountBaseUnits) <= 0n) {
    throw new Error("Claim amount must be positive base units.");
  }
  const amountUsdc = requiredString(input.amountUsdc, "amountUsdc");
  const expiry = requiredString(input.expiry, "expiry");
  if (!Number.isFinite(Date.parse(expiry))) throw new Error("Claim package expiry is invalid.");

  return {
    network: ARC_NETWORK_NAME,
    chainId: ARC_CHAIN_ID,
    factory,
    paymentId: bytes32(input.paymentId, "paymentId"),
    escrow: address(input.escrow, "escrow"),
    amountBaseUnits,
    amountUsdc,
    expiry,
    secretHash,
    secret,
  };
}

export function publicClaimContext(claimPackage: PrivateClaimPackage) {
  return {
    factory: claimPackage.factory,
    paymentId: claimPackage.paymentId,
    escrow: claimPackage.escrow,
    amountBaseUnits: claimPackage.amountBaseUnits,
    expiry: claimPackage.expiry,
    secretHash: claimPackage.secretHash,
  };
}

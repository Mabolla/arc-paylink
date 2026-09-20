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

const configuredLegacyFactories = (process.env.NEXT_PUBLIC_ARC_PAYLINK_LEGACY_FACTORY_ADDRESSES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function configuredAddresses(values: string[], name: string) {
  return values.map((value) => {
    if (!isAddress(value)) throw new Error(`${name} contains an invalid address.`);
    return getAddress(value);
  });
}

export const ARC_PAYLINK_LEGACY_FACTORIES = configuredAddresses(configuredLegacyFactories, "NEXT_PUBLIC_ARC_PAYLINK_LEGACY_FACTORY_ADDRESSES");

export const ARC_PAYLINK_TRUSTED_FACTORIES = [
  ARC_PAYLINK_FACTORY,
  ...ARC_PAYLINK_LEGACY_FACTORIES,
].filter((factory, index, factories) => factories.findIndex((candidate) => candidate.toLowerCase() === factory.toLowerCase()) === index);

export function isTrustedArcPayLinkFactory(factory: Address) {
  return ARC_PAYLINK_TRUSTED_FACTORIES.some((candidate) => candidate.toLowerCase() === factory.toLowerCase());
}

const configuredSurplusSafeFactories = (process.env.NEXT_PUBLIC_ARC_PAYLINK_SURPLUS_SAFE_FACTORY_ADDRESSES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const ARC_PAYLINK_SURPLUS_SAFE_FACTORIES = configuredAddresses(
  configuredSurplusSafeFactories,
  "NEXT_PUBLIC_ARC_PAYLINK_SURPLUS_SAFE_FACTORY_ADDRESSES",
);

export function isSurplusSafeArcPayLinkFactory(factory: Address) {
  return ARC_PAYLINK_SURPLUS_SAFE_FACTORIES.some((candidate) => candidate.toLowerCase() === factory.toLowerCase());
}

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
  title?: string;
  reference?: string;
  recipientEmail?: string;
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
  if (!isTrustedArcPayLinkFactory(factory)) {
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
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length > 80) throw new Error("Payment title is too long.");
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  if (reference.length > 64) throw new Error("Payment reference is too long.");
  const recipientEmail = typeof input.recipientEmail === "string" ? input.recipientEmail.trim().toLowerCase() : "";
  if (recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) throw new Error("Recipient email is invalid.");

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
    ...(title ? { title } : {}),
    ...(reference ? { reference } : {}),
    ...(recipientEmail ? { recipientEmail } : {}),
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

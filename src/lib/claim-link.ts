import { parsePrivateClaimPackage, type PrivateClaimPackage } from "./claim-package";

export const CLAIM_FRAGMENT_KEY = "claim";

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("This Arc PayLink is invalid.");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeClaimFragment(claimPackage: PrivateClaimPackage) {
  const verified = parsePrivateClaimPackage(claimPackage);
  return `${CLAIM_FRAGMENT_KEY}=${toBase64Url(JSON.stringify(verified))}`;
}

export function claimLink(origin: string, claimPackage: PrivateClaimPackage) {
  return `${origin}/claim#${encodeClaimFragment(claimPackage)}`;
}

export function parseClaimFragment(fragment: string): PrivateClaimPackage | null {
  const parameters = new URLSearchParams(fragment.replace(/^#/, ""));
  const encoded = parameters.get(CLAIM_FRAGMENT_KEY);
  if (!encoded) return null;
  try {
    return parsePrivateClaimPackage(JSON.parse(fromBase64Url(encoded)));
  } catch (error) {
    if (error instanceof Error && error.message !== "This Arc PayLink is invalid.") throw error;
    throw new Error("This Arc PayLink is invalid.");
  }
}

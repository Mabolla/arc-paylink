import { ARC_USDC_ADDRESS } from "@/lib/arc";
import type { VerifiedClaimContext } from "@/lib/claim-validation";
import { decodeEventLog, getAddress, isHex, parseAbi, type Address, type Hex } from "viem";

const factoryEventAbi = parseAbi([
  "event PayLinkCreated(bytes32 indexed paymentId,address indexed escrow,address indexed sender,address token,uint256 amount,uint256 expiry,bytes32 secretHash)",
]);
const transferEventAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

type ReceiptLog = { address: Address; data: Hex; topics: readonly (Hex | readonly Hex[] | null)[] };
type Receipt = { status: "success" | "reverted"; logs: readonly ReceiptLog[] };
type ReceiptReader = { getTransactionReceipt(args: { hash: Hex }): Promise<Receipt> };

function transactionHash(value: unknown, name: string) {
  if (typeof value !== "string" || !isHex(value) || value.length !== 66) throw new Error(`${name} must be a transaction hash.`);
  return value as Hex;
}

function eventTopics(log: ReceiptLog) {
  const topics = log.topics.filter((topic): topic is Hex => typeof topic === "string");
  return topics.length ? topics as [Hex, ...Hex[]] : undefined;
}

export async function verifyWalletlessTransactionEvidence(
  input: Record<string, unknown>,
  claim: VerifiedClaimContext,
  reader: ReceiptReader,
) {
  const creationHash = transactionHash(input.creationHash, "creationHash");
  const fundingHash = transactionHash(input.fundingHash, "fundingHash");
  const [creation, funding] = await Promise.all([
    reader.getTransactionReceipt({ hash: creationHash }),
    reader.getTransactionReceipt({ hash: fundingHash }),
  ]);
  if (creation.status !== "success") throw new Error("Escrow creation transaction was not successful.");
  if (funding.status !== "success") throw new Error("Escrow funding transaction was not successful.");

  const creationMatches = creation.logs.some((log) => {
    if (log.address.toLowerCase() !== claim.factory.toLowerCase()) return false;
    try {
      const topics = eventTopics(log);
      if (!topics) return false;
      const decoded = decodeEventLog({ abi: factoryEventAbi, data: log.data, topics });
      return decoded.eventName === "PayLinkCreated"
        && decoded.args.paymentId.toLowerCase() === claim.paymentId.toLowerCase()
        && decoded.args.escrow.toLowerCase() === claim.escrow.toLowerCase()
        && decoded.args.sender.toLowerCase() === claim.sender.toLowerCase()
        && decoded.args.token.toLowerCase() === ARC_USDC_ADDRESS.toLowerCase()
        && decoded.args.amount === claim.amountBaseUnits
        && decoded.args.expiry === BigInt(claim.expiry)
        && decoded.args.secretHash.toLowerCase() === claim.secretHash.toLowerCase();
    } catch {
      return false;
    }
  });
  if (!creationMatches) throw new Error("Creation transaction does not contain this PayLink escrow.");

  const fundingMatches = funding.logs.some((log) => {
    if (log.address.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()) return false;
    try {
      const topics = eventTopics(log);
      if (!topics) return false;
      const decoded = decodeEventLog({ abi: transferEventAbi, data: log.data, topics });
      return decoded.eventName === "Transfer"
        && getAddress(decoded.args.from) === claim.sender
        && getAddress(decoded.args.to) === claim.escrow
        && decoded.args.value === claim.amountBaseUnits;
    } catch {
      return false;
    }
  });
  if (!fundingMatches) throw new Error("Funding transaction does not fund this PayLink escrow.");
  return { creationHash, fundingHash };
}

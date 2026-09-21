import { ARC_CHAIN_ID } from "./arc";
import type { RequestStore } from "./server-request-store";
import type { WalletlessRecord } from "./walletless-record";

const pathFor = (paymentId: string) => `walletless/v1/chain-${ARC_CHAIN_ID}/${paymentId.toLowerCase()}.json`;

export async function createWalletlessRecordEntry(record: WalletlessRecord, store: RequestStore) {
  const pathname = pathFor(record.paymentId);
  if ((await store.list(pathname)).includes(pathname)) throw new Error("This PayLink is already registered.");
  await store.put(pathname, JSON.stringify(record));
}

export async function loadWalletlessRecord(paymentId: string, store: RequestStore): Promise<WalletlessRecord | undefined> {
  const pathname = pathFor(paymentId);
  if (!(await store.list(pathname)).includes(pathname)) return undefined;
  return await store.read(pathname) as WalletlessRecord;
}

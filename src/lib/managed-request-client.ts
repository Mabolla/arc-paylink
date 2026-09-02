export type ManagedRequestReference = { requestId: string; managementToken: string };
const KEY = "arc-paylink.managed-requests.v1";
export function managedRequestReferences(storage: Pick<Storage, "getItem">): ManagedRequestReference[] { try { const value = JSON.parse(storage.getItem(KEY) ?? "[]"); return Array.isArray(value) ? value.filter((item) => item && typeof item.requestId === "string" && typeof item.managementToken === "string") : []; } catch { return []; } }
export function saveManagedRequestReference(storage: Pick<Storage, "getItem" | "setItem">, reference: ManagedRequestReference): void { const existing = managedRequestReferences(storage).filter((item) => item.requestId !== reference.requestId); storage.setItem(KEY, JSON.stringify([reference, ...existing])); }

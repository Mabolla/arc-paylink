import { afterEach, describe, expect, it, vi } from "vitest";
import { clearClientIdempotencyKey, clientIdempotencyKey } from "./client-idempotency";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("client idempotency keys", () => {
  afterEach(() => vi.restoreAllMocks());
  it("reuses one UUID for the same operation scope", () => {
    const storage = new MemoryStorage();
    const uuid = "11111111-1111-4111-8111-111111111111";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(uuid);
    expect(clientIdempotencyKey(storage, "claim.payment-1")).toBe(uuid);
    expect(clientIdempotencyKey(storage, "claim.payment-1")).toBe(uuid);
    expect(storage.length).toBe(1);
  });

  it("rotates only after explicit completion cleanup", () => {
    const storage = new MemoryStorage();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    const first = clientIdempotencyKey(storage, "deploy.payment-1");
    clearClientIdempotencyKey(storage, "deploy.payment-1");
    expect(clientIdempotencyKey(storage, "deploy.payment-1")).not.toBe(first);
  });
});

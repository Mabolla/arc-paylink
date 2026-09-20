const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function clientIdempotencyKey(storage: Storage, scope: string) {
  const key = `arc-paylink.idempotency.${scope}`;
  const existing = storage.getItem(key);
  if (existing && UUID.test(existing)) return existing;
  const created = crypto.randomUUID();
  storage.setItem(key, created);
  return created;
}

export function clearClientIdempotencyKey(storage: Storage, scope: string) {
  storage.removeItem(`arc-paylink.idempotency.${scope}`);
}

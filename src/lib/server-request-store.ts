import type { ManagedRequest, RequestEvent } from "./request-lifecycle";

export type RequestStore = {
  list(prefix: string): Promise<string[]>;
  read(pathname: string): Promise<unknown>;
  put(pathname: string, body: string): Promise<void>;
};

const root = (id: string) => `requests/v1/${id}/`;

export async function createRequestRecord(record: ManagedRequest, store: RequestStore): Promise<void> {
  const path = `${root(record.requestId)}request.json`;
  if ((await store.list(path)).length) throw new Error("Request already exists.");
  await store.put(path, JSON.stringify(record));
}

export async function loadRequestRecord(id: string, store: RequestStore): Promise<{ record: ManagedRequest; events: RequestEvent[] } | undefined> {
  const paths = await store.list(root(id));
  const requestPath = paths.find((path) => path.endsWith("/request.json"));
  if (!requestPath) return undefined;
  const record = await store.read(requestPath) as ManagedRequest;
  const eventPaths = paths.filter((path) => path.includes("/events/")).sort();
  const events = await Promise.all(eventPaths.map((path) => store.read(path))) as RequestEvent[];
  return { record, events };
}

export async function appendRequestEvent(id: string, event: RequestEvent, key: string, store: RequestStore): Promise<void> {
  const path = `${root(id)}events/${key}.json`;
  if ((await store.list(path)).length) return;
  await store.put(path, JSON.stringify(event));
}

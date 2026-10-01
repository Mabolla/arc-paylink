import { CommerceError, type CommerceStore, type Versioned } from "./store";
export class MemoryStore implements CommerceStore {
  data = new Map<string, Versioned<unknown>>();
  serial = 0;
  pageSize = 2;
  async read<T>(path: string) {
    return structuredClone(this.data.get(path)) as Versioned<T> | undefined;
  }
  async write(path: string, value: unknown, version?: string) {
    const existing = this.data.get(path);
    if ((!version && existing) || (version && existing?.version !== version))
      throw new CommerceError("Record conflict", 409);
    this.data.set(path, {
      value: structuredClone(value),
      version: String(++this.serial),
    });
  }
  async list(prefix: string, cursor?: string) {
    const all = [...this.data.keys()]
      .filter((p) => p.startsWith(prefix))
      .sort();
    const start = cursor ? Number(cursor) : 0;
    const paths = all.slice(start, start + this.pageSize);
    return {
      paths,
      cursor:
        start + this.pageSize < all.length
          ? String(start + this.pageSize)
          : undefined,
    };
  }
}

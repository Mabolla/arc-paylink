import { get, head, list, put } from "@vercel/blob";
import { ARC_CHAIN_ID } from "../arc";

export type Versioned<T> = { value: T; version: string };
export interface CommerceStore {
  read<T>(path: string): Promise<Versioned<T> | undefined>;
  write(path: string, value: unknown, version?: string): Promise<void>;
  list(
    prefix: string,
    cursor?: string,
  ): Promise<{ paths: string[]; cursor?: string }>;
}
export class CommerceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const root = `commerce/v1/chain-${ARC_CHAIN_ID}/`;
const strongVersion = (value: string | undefined) => !!value && !value.startsWith("W/");

export function blobCommerceStore(): CommerceStore {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token)
    throw new CommerceError(
      "Business storage is not configured on this deployment.",
      503,
    );
  return {
    async read<T>(path: string) {
      const result = await get(root + path, {
        access: "private",
        useCache: false,
        token,
        headers: { "Accept-Encoding": "identity" },
      });
      if (!result || result.statusCode !== 200) return undefined;
      const value = JSON.parse(await new Response(result.stream).text()) as T;
      if (strongVersion(result.blob.etag)) return { value, version: result.blob.etag };

      // HTTP content transformations can make a GET ETag weak. Obtain the
      // authoritative object ETag from the Blob API; never blindly strip W/.
      const before = await head(root + path, { token });
      if (!strongVersion(before.etag))
        throw new CommerceError("Storage cannot provide a conditional record version.", 503);
      if (result.blob.etag.startsWith("W/") && result.blob.etag.slice(2) === before.etag)
        return { value, version: before.etag };

      // Unrelated/missing HTTP tags require a consistent body read between two
      // matching metadata versions. A changed version is a conflict, not permission
      // to overwrite. All body reads bypass the private Blob CDN cache.
      const fresh = await get(root + path, {
        access: "private", useCache: false, token,
        headers: { "Accept-Encoding": "identity" },
      });
      if (!fresh || fresh.statusCode !== 200)
        throw new CommerceError("This record changed. Refresh and retry.", 409);
      const currentValue = JSON.parse(await new Response(fresh.stream).text()) as T;
      const after = await head(root + path, { token });
      if (!strongVersion(after.etag) || before.etag !== after.etag)
        throw new CommerceError("This record changed. Refresh and retry.", 409);
      return { value: currentValue, version: after.etag };
    },
    async write(path, value, version) {
      if (version !== undefined && !strongVersion(version))
        throw new CommerceError("Storage cannot provide a conditional record version.", 503);
      try {
        await put(root + path, JSON.stringify(value), {
          token,
          access: "private",
          addRandomSuffix: false,
          contentType: "application/json",
          cacheControlMaxAge: 0,
          ...(version
            ? { allowOverwrite: true, ifMatch: version }
            : { allowOverwrite: false }),
        });
      } catch (error) {
        // Conditional failures are conflicts, never an excuse to overwrite another writer.
        if (
          error instanceof Error &&
          /precondition|already exists|condition|412/i.test(error.message)
        )
          throw new CommerceError(
            "This record changed. Refresh and retry.",
            409,
          );
        throw error;
      }
    },
    async list(prefix, cursor) {
      const result = await list({
        token,
        prefix: root + prefix,
        cursor,
        limit: 100,
      });
      return {
        paths: result.blobs.map((b) => b.pathname.slice(root.length)),
        cursor: result.hasMore ? result.cursor : undefined,
      };
    },
  };
}

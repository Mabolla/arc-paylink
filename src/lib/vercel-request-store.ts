import { get, list, put } from "@vercel/blob";
import type { RequestStore } from "./server-request-store";

export function vercelRequestStore(token: string): RequestStore {
  return {
    async list(prefix) {
      const result = await list({ prefix, limit: 100, token });
      return result.blobs.map((blob) => blob.pathname);
    },
    async read(pathname) {
      const result = await get(pathname, { access: "private", useCache: false, token });
      if (!result || result.statusCode !== 200) return undefined;
      return JSON.parse(await new Response(result.stream).text());
    },
    async put(pathname, body) {
      await put(pathname, body, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json", token });
    },
  };
}

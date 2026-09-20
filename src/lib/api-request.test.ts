import { describe, expect, it } from "vitest";
import { assertSameOriginRequest, readJsonObject } from "./api-request";

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/write", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("bounded JSON request bodies", () => {
  it("accepts a JSON object", async () => {
    await expect(readJsonObject(jsonRequest('{"ok":true}')))
      .resolves.toEqual({ ok: true });
  });

  it("rejects arrays and oversized bodies", async () => {
    await expect(readJsonObject(jsonRequest("[]"))).rejects.toThrow("JSON object");
    await expect(readJsonObject(jsonRequest('{"value":"long"}'), 4)).rejects.toThrow("too large");
  });

  it("requires JSON and rejects browser cross-origin writes", async () => {
    await expect(readJsonObject(new Request("https://example.test/api/write", { method: "POST", body: "{}" }))).rejects.toThrow("Content-Type");
    expect(() => assertSameOriginRequest(jsonRequest("{}", { origin: "https://evil.test" }))).toThrow("Cross-origin");
    expect(() => assertSameOriginRequest(jsonRequest("{}", { origin: "https://example.test" }))).not.toThrow();
  });
});

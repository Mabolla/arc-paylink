import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Read-only provider endpoints, verified against their official API references.
const CIRCLE_LIST = "https://api.circle.com/v2/notifications/subscriptions";
const VERCEL_LIST = "https://api.vercel.com/v10/projects?search=arc-paylink&limit=100";
const OWNED_WEBHOOK = "https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app/api/checkout/webhooks/circle";
const TYPES = new Set(["*", "transactions.*", "transactions.inbound", "transactions.outbound", "challenges.*", "challenges.accelerateTransaction", "challenges.cancelTransaction", "challenges.changePin", "challenges.contractExecution", "challenges.createTransaction", "challenges.createWallet", "challenges.initialize", "challenges.restorePin", "challenges.setPin", "challenges.setSecurityQuestions", "contracts.*", "contracts.eventLog", "modularWallet.*", "modularWallet.userOperation"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getOnce(url, credential, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${credential}` },
    });
  } catch { return { status: "request_failed", httpStatus: null }; }
  const httpStatus = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
  if (!response.ok) {
    try { await response.body?.cancel(); } catch { /* Error bodies never enter evidence. */ }
    return { status: "http_error", httpStatus };
  }
  try { return { status: "checked", httpStatus, payload: await response.json() }; }
  catch { return { status: "invalid_response", httpStatus }; }
}

/** No provider mutations, retries, pagination, environment reads or credential exports. */
export async function collectAccountCheck({ env = {}, fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const circleKey = env.CIRCLE_API_KEY?.trim() ?? "";
  const vercelToken = env.VERCEL_TOKEN?.trim() ?? "";
  const privateValues = [circleKey, vercelToken].filter(Boolean);
  const safeId = (value, pattern) => typeof value === "string" && pattern.test(value) && !privateValues.some(secret => value.includes(secret));
  const evidence = {
    schemaVersion: 1, mode: "READ_ONLY_PROVIDER_ACCOUNT_DIAGNOSTIC", generatedAt: now(),
    ...(typeof env.GITHUB_SHA === "string" && /^[0-9a-f]{40}$/.test(env.GITHUB_SHA) ? { sourceCommit: env.GITHUB_SHA } : {}),
    circle: { keyConfigured: Boolean(circleKey), status: "not_configured", httpStatus: null, matchingSubscriptions: [] },
    vercel: { tokenConfigured: Boolean(vercelToken), status: "not_configured", httpStatus: null, projects: [] },
  };
  if (circleKey) {
    const result = await getOnce(CIRCLE_LIST, circleKey, fetchImpl);
    Object.assign(evidence.circle, { status: result.status, httpStatus: result.httpStatus });
    if (result.status === "checked") {
      if (!Array.isArray(result.payload?.data)) evidence.circle.status = "invalid_response";
      else evidence.circle.matchingSubscriptions = result.payload.data.filter(entry => entry?.endpoint === OWNED_WEBHOOK).slice(0, 100).map(entry => ({
        ...(safeId(entry.id, uuid) ? { id: entry.id } : {}),
        ...(typeof entry.enabled === "boolean" ? { enabled: entry.enabled } : {}),
        ...(Array.isArray(entry.notificationTypes) ? { notificationTypes: [...new Set(entry.notificationTypes.filter(type => TYPES.has(type)))].slice(0, TYPES.size) } : {}),
      }));
    }
  }
  if (vercelToken) {
    const result = await getOnce(VERCEL_LIST, vercelToken, fetchImpl);
    Object.assign(evidence.vercel, { status: result.status, httpStatus: result.httpStatus });
    if (result.status === "checked") {
      const projects = Array.isArray(result.payload) ? result.payload : result.payload?.projects;
      if (!Array.isArray(projects)) evidence.vercel.status = "invalid_response";
      else evidence.vercel.projects = projects.filter(entry => entry?.name === "arc-paylink" && safeId(entry.id, /^prj_[A-Za-z0-9]{1,120}$/)).slice(0, 100).map(entry => ({ id: entry.id, name: "arc-paylink" }));
    }
  }
  return evidence;
}

async function verifyMocks() {
  const calls = [];
  let absentCalls = 0;
  const absent = await collectAccountCheck({ env: {}, fetchImpl: async () => { absentCalls++; throw new Error("Unexpected provider request"); } });
  assert.equal(absent.circle.keyConfigured, false);
  assert.equal(absent.vercel.tokenConfigured, false);
  assert.equal(absentCalls, 0);
  const circleKey = "test-circle-secret-never-export";
  const vercelToken = "test-vercel-secret-never-export";
  const found = await collectAccountCheck({ env: { CIRCLE_API_KEY: circleKey, VERCEL_TOKEN: vercelToken }, fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method, redirect: options.redirect, signal: options.signal });
    const payload = url === CIRCLE_LIST ? { data: [
      { id: "11111111-1111-4111-8111-111111111111", endpoint: OWNED_WEBHOOK, enabled: true, notificationTypes: ["transactions.outbound", circleKey], name: circleKey },
      { id: "22222222-2222-4222-8222-222222222222", endpoint: OWNED_WEBHOOK + "?token=private", enabled: true },
      { id: "33333333-3333-4333-8333-333333333333", endpoint: "https://other.example/api/checkout/webhooks/circle", enabled: true },
    ] } : { projects: [
      { id: "prj_ownedProject", name: "arc-paylink", env: [{ value: vercelToken }] },
      { id: "prj_otherProject", name: "other-private-project", accountId: vercelToken },
    ] };
    return new Response(JSON.stringify(payload), { status: 200 });
  } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.url), [CIRCLE_LIST, VERCEL_LIST]);
  assert(calls.every(call => call.method === "GET" && call.redirect === "error" && call.signal instanceof AbortSignal));
  assert.deepEqual(found.circle.matchingSubscriptions, [{ id: "11111111-1111-4111-8111-111111111111", enabled: true, notificationTypes: ["transactions.outbound"] }]);
  assert.deepEqual(found.vercel.projects, [{ id: "prj_ownedProject", name: "arc-paylink" }]);
  const serialized = JSON.stringify(found);
  for (const secret of [circleKey, vercelToken, "other-private-project", "prj_otherProject", "?token=private"]) assert(!serialized.includes(secret));
  const failed = await collectAccountCheck({ env: { CIRCLE_API_KEY: circleKey }, fetchImpl: async () => new Response(circleKey, { status: 401 }) });
  assert.equal(failed.circle.httpStatus, 401);
  assert(!JSON.stringify(failed).includes(circleKey));
  const thrown = await collectAccountCheck({ env: { VERCEL_TOKEN: vercelToken }, fetchImpl: async () => { throw new Error(vercelToken); } });
  assert.equal(thrown.vercel.status, "request_failed");
  assert(!JSON.stringify(thrown).includes(vercelToken));
  console.log("Read-only provider account diagnostic mocks passed.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.includes("--self-test")) await verifyMocks();
  else {
    const evidence = await collectAccountCheck({ env: process.env });
    await mkdir("account-evidence", { recursive: true });
    await writeFile("account-evidence/collections-account-check.json", JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(evidence));
  }
}

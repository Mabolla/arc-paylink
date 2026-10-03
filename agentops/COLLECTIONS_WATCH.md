# Browser-independent collections reporting

`collections-watch.ts` is a reference read-only worker for a company's existing Arc PayLink workspace. It reads the scoped business API, stores verified receipt events in a private durable local ledger, and reports current paid/outstanding totals. It can run without an open browser. It never requests a payer private key, creates an order, signs a transfer or moves funds.

## Running it

Create a read-only agent key from the business dashboard. Keep the value in the host's secret environment configuration, rather than a command argument, a repository file or a log. Configure:

```text
ARCPAYLINK_COLLECTIONS_URL=https://YOUR_DEPLOYMENT
ARCPAYLINK_COLLECTIONS_KEY=<scoped read-only agent key>
ARCPAYLINK_COLLECTIONS_INTERVAL_SECONDS=60
```

For one scheduled pass:

```sh
node --import tsx agentops/collections-watch.ts --once --state /persistent/collections/receipts.json
```

For a continuously running host process, omit `--once`. The minimum interval is 30 seconds. The host must keep the process running or schedule repeated passes and must persist the checkpoint directory across restarts. Deploying the website or connecting its MCP endpoint alone does not schedule this worker. No production worker is silently provisioned by this reference implementation.

The watcher requires a reader key and rejects an owner key. Revocation takes effect on subsequent API requests. It sends only GET requests to the configured origin, refuses redirect following and does not use browser cookies. Errors fail closed with a sanitized status; a supervisor can restart the process using the saved state after an interruption.

## Checkpoint and delivery semantics

Each complete receipt page is written using a same-directory temporary file, file synchronization and atomic rename. The checkpoint has mode `0600`; it contains proof records but no access key. It is bound to the deployment origin, business ID and chain. Use a different path for each business and deployment. Do not commit it: customer order titles and references may contain business data.

Opaque page cursors are saved only to resume an interrupted scan. After reaching the end, the next pass starts from the beginning and deduplicates by `eventId`; a cursor is not a permanent new-event watermark. The ledger retains all observed events and verifies that a saved proof is not replaced with conflicting details. The reference caps its ledger at 100,000 receipts and each pass at 1,000 pages; archive or adapt it deliberately beyond those bounds.

Stdout contains the new receipts seen during that successful pass plus the current summary. The checkpoint's `events` array is the durable output. If the process stops after saving an event but before printing stdout, recover that event from the ledger. Downstream jobs must also deduplicate by `eventId`; stdout delivery is not claimed to be exactly once. A failed later page can leave earlier receipts safely saved, even though that pass exits without a complete summary.

A lock file prevents concurrent writers to one checkpoint. Normal shutdown removes it. After an abnormal termination, check that no previous watcher process is running before removing a stale `.lock` file. Never remove the ledger merely to clear a lock.

## What this does and does not complete

The worker proves that a company's agent can observe recorded payments without using the user interface. Circle payments arriving while the customer's browser is closed still need the owning Circle account's signed `transactions.outbound` webhook subscription. The watcher reads already-verified server records; it does not impersonate Circle, invent a transaction hash, bypass customer approval or repair an external transfer whose hash was never delivered. Existing-wallet customers can use the order's receipt recovery endpoint with their submitted hash. Google/Circle onboarding, actual signed webhook delivery and a production scheduler remain separate acceptance checks.

Run targeted tests with `npx vitest run agentops/collections-watch.test.ts`. Live acceptance should use a temporary scoped reader, run twice against an existing internal paid order, verify its exact hash and zero repeat events, and revoke the reader afterward. Such a check is read-only and is not evidence of a new payment or an external customer.

## Observed live acceptance

On 2026-10-01, two real `--once` runs against the deployed preview observed the existing internal mainnet order `604c797f-68d3-40bd-a483-bc7a36e7a33c`. The first pass captured one receipt; the second captured zero new receipts. The private checkpoint retained the exact pilot transaction hash. Both summaries reported paid `0.01 USDC` and outstanding `0`. No browser session or payer key was used, no new transfer occurred, and the temporary reader key was revoked afterward. Sanitized proof is in `evidence/collections-watch.json`. No continuous watcher or production scheduler was left running; Circle webhook delivery was not tested by these passes.

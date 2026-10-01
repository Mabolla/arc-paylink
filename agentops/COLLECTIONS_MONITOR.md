# Hosted collections monitor

The hosted monitor observes a company's existing orders and confirmed payment events without requiring an open browser. It records a durable private receipt ledger and a resumable receivables report. It does not approve or send payments, create orders, unlock payment attempts or mark an unconfirmed purchase as paid.

The hosted implementation passed real manual server acceptance on the isolated feature preview. Two complete scans retained one internal 0.01-USDC receipt; replay found zero new receipts. Owner and reader status, the remote MCP report, read-only restrictions and temporary key revocation passed. No new transfer was made. No provider schedule is active or verified. The local reader proof in `evidence/collections-watch.json` is separate from this hosted acceptance.

## Endpoints and access

| Request | Authentication | Purpose |
| --- | --- | --- |
| `GET /api/business/monitor` | The current workspace owner or scoped reader, using the business API's supported authentication. | Read a safe monitor status and latest completed report for that workspace. |
| `GET /api/business/monitor/storage` | Workspace owner only. | Read checkpoint presence and version kind for maintenance; no raw ETag, lease or credentials. |
| `POST /api/business/monitor/refresh` | Workspace owner Bearer key or owner session cookie, plus a supplied reader key for the same workspace and selected chain. | Run one bounded hosted observation pass. |
| `GET /api/cron/collections` | Exact `Authorization: Bearer <CRON_SECRET>` header. | Run one bounded pass for the fixed server-configured workspace and reader key. |

Manual refresh accepts only this JSON shape; extra properties are rejected:

```json
{
  "readerToken": "YOUR_SCOPED_READ_ONLY_AGENT_KEY"
}
```

The owner authenticates the manual request; the supplied reader is independently authorized and must belong to that owner's workspace on `ARC_CHAIN_ID`. This key is used for that request and is not saved in the monitor checkpoint. Manual refresh is independent of the cron-configured workspace, so one owner's request cannot select another company's monitoring target.

The cron endpoint accepts no caller-selected workspace or reader credential. Its server configuration fixes the target. The cron secret is distinct from the business reader key. Owner credentials cannot substitute for the monitor's reader credential, and revocation is checked throughout a scan. Responses do not expose either credential, raw pending receipt pages or the private lease/write-ahead log.

## Durable storage and execution

Monitor records are stored in the existing private commerce storage, under:

```text
commerce/v1/chain-<ARC_CHAIN_ID>/merchants/<workspaceId>/monitor/state.json
commerce/v1/chain-<ARC_CHAIN_ID>/merchants/<workspaceId>/monitor/events/<event-id-sha256>.json
```

The monitor writes only its own checkpoint and receipt ledger. Business order records and source payment events remain unchanged.

- A compare-and-swap checkpoint holds an expiring lease. Its lease ID and storage ETag prevent a stale runner from advancing or releasing a successor's checkpoint.
- Before immutable receipt records are appended, a pending page is saved as a write-ahead log. A later pass can finish that page after interruption without losing its receipt count or advancing the cursor too early.
- Each confirmed event has one immutable ledger entry. The event ID and verified receipt proof are checked on replay; a conflicting proof stops the run.
- A pass reads receipt pages, then order pages for exact integer USDC aggregation. Partial progress is persisted and resumed by a later authorized invocation. After a complete scan, the next scan starts again and deduplicates already observed receipts.

HTTP execution uses fixed limits: five combined event/order pages, a 45-second cooperative deadline and a 120-second lease. Pages contain at most 100 records; the summary scan is limited to 10,000 orders. The route's function duration limit is 60 seconds. The cooperative deadline is checked between operations; it cannot abort an in-flight storage request. The core module's standalone default remains 20 seconds.

A run may finish `complete`, return `partial` with resumable progress, or return `busy` while another live lease owns the checkpoint. Failed runs retain recoverable progress and expose a generic failure marker. Expired or replaced runners cannot release another run's lease. Larger workspaces can require multiple invocations; schedule frequency determines how quickly a partial scan can finish.

Reports are paginated scans, **not atomic snapshots** across every order and event. Orders can change while a scan is in progress. A following scan catches new or updated records; the report's completion and `asOf` timestamps explain its freshness. Receipt counts and the latest summary can therefore reflect different observation moments.

The monitor observes payment events already confirmed by checkout reconciliation or a verified provider notification. Its execution alone does not prove Google/Circle approval or Circle webhook delivery, and does not replace settlement verification for a still-processing order.

## Isolated production deployment

The inactive template is `agentops/deployment/collections-vercel.json`. It defines a daily invocation at `0 5 * * *` (05:00 UTC). It contains no credentials and there is deliberately no new root `vercel.json` in the shared repository.

Apply this configuration only to an isolated deployment checkout linked to a **new Vercel project**, using the reviewed new-version commit as its production deployment. Preserve the existing Arc PayLink project's production branch, domain and configuration. Do not promote the feature preview into the original production project to obtain scheduling.

Configure the new project's server environment before activation:

| Variable | Required value and scope |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Access to the intended private commerce store. A new isolated store requires a new workspace/key in that store; an existing workspace cannot be referenced across unrelated stores. |
| `NEXT_PUBLIC_ARC_NETWORK` | Explicit selected network; `mainnet` selects chain `5042`. Workspace and key must match the resulting `ARC_CHAIN_ID`. |
| `ARCPAYLINK_COLLECTIONS_WORKSPACE_ID` | One valid workspace UUID in that store and network. |
| `ARCPAYLINK_COLLECTIONS_READER_KEY` | A currently valid, revocable, read-only key scoped to that same workspace. Server-only; no `NEXT_PUBLIC_` prefix. |
| `CRON_SECRET` | A fresh random secret, 43–128 URL-safe characters. Generate 32 random bytes as 64 hexadecimal characters. It must differ from the reader credential and all other configured key/token/secret/password values. Server-only. |

Existing application configuration still applies to the rest of the new deployment; monitoring does not need a payer private key. Credentials must not be committed, embedded in the static tour or included in public acceptance evidence.

Vercel's cron scheduler invokes production deployments only; feature previews do not receive scheduled invocations. Vercel sends `CRON_SECRET` as a Bearer authorization header, which the endpoint checks exactly. An application status field named `schedulingConfigured` only means that matching valid server credentials are configured. It is not evidence that Vercel registered, enabled or invoked a schedule. [Vercel quickstart](https://vercel.com/docs/cron-jobs/quickstart), [cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).

The account's current plan and spend limits have not been verified. The template uses a daily schedule compatible with the published Hobby frequency limit. Hobby timing is within the scheduled hour; Pro and Enterprise permit more frequent invocations, down to once per minute. A frequent schedule requires verification of the new project's actual plan and intended operating budget before changing the template. Cron invokes a Vercel Function, so applicable function usage and storage work still count toward their limits and costs; no zero-cost claim is made. [Vercel cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Scheduled delivery is best effort and can be missed or duplicated. Vercel does not automatically retry a failed invocation. The checkpoint and ledger allow the next authorized pass to resume safely; operational review must check the last successful report and runtime logs. [Vercel delivery, idempotency and error handling](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Completed manual acceptance and remaining scheduler gate

The owner-authorized manual endpoint completed two scans against the already-paid internal 0.01-USDC order, without a browser session or new transfer. Both returned one tracked receipt, paid `0.01` and outstanding `0`; replay reported zero newly discovered events. Owner and reader status matched the persisted report, remote `get_collections_monitor` returned the same report, a reader could not start a refresh, and revocation denied subsequent access. The confirmed source event retained the exact original transaction hash. Sanitized proof: [collections-monitor.json](evidence/collections-monitor.json). Release checks and the explicitly simulated panel screenshot: [collections-monitor-release.json](evidence/collections-monitor-release.json).

The first live attempt exposed a weak HTTP ETag from private storage, which cannot be used for a conditional update. The adapter now obtains the authoritative object version from the Blob API. A matching transformed HTTP tag is bound to that version; unrelated or missing tags require a fresh uncached body read between matching metadata versions. Changed or unavailable versions stop the operation. Conditional writes, fencing and creation without overwrite remain enforced. Six storage adapter regression tests cover these cases. Initial failure and diagnosis are preserved in `evidence/collections-monitor-initial-failure.json`; the subsequent live check reported a strong conditional version.

Scheduler acceptance is a further gate: verify the new production project, active provider schedule, authentication configuration and a genuine provider-originated runtime invocation with a matching durable checkpoint. A manual endpoint run, unit tests or valid environment settings cannot close this gate. Circle webhook delivery and Google/Circle customer checkout require their own independent acceptance.

Official Vercel documentation reviewed 2026-10-01. The referenced pricing page was updated 2026-07-15; quickstart and management pages were updated 2026-08-11.

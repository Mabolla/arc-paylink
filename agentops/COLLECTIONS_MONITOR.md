# Hosted collections monitor

The hosted monitor observes a company's existing orders and confirmed payment events without requiring an open browser. It records a durable private receipt ledger and a resumable receivables report. It does not approve or send payments, create orders, unlock payment attempts or mark an unconfirmed purchase as paid.

The hosted implementation and deployment template are being integrated. A real manual server acceptance run is planned but has not yet passed. No provider schedule is active or verified. The existing two-pass local reader proof in `evidence/collections-watch.json` is separate evidence; it does not prove this hosted endpoint or a scheduled deployment.

## Endpoints and access

| Request | Authentication | Purpose |
| --- | --- | --- |
| `GET /api/business/monitor` | The current workspace owner or scoped reader, using the business API's supported authentication. | Read a safe monitor status and latest completed report for that workspace. |
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

## Acceptance still required

The next server proof must run the owner-authorized manual endpoint twice against the already-paid internal 0.01-USDC order, without a browser session or new transfer. It should verify one durable receipt, the exact known transaction hash, matching paid/outstanding totals, zero newly discovered events on replay, safe status access and reader revocation. Publish only sanitized results after those checks actually pass.

Scheduler acceptance is a further gate: verify the new production project, active provider schedule, authentication configuration and a genuine provider-originated runtime invocation with a matching durable checkpoint. A manual endpoint run, unit tests or valid environment settings cannot close this gate. Circle webhook delivery and Google/Circle customer checkout require their own independent acceptance.

Official Vercel documentation reviewed 2026-10-01. The referenced pricing page was updated 2026-07-15; quickstart and management pages were updated 2026-08-11.

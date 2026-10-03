# Collections release isolation checkpoint — 3 October 2026

Status: STEP 2 INCOMPLETE — shared Blob quota must be resolved before live release acceptance.

## Preserved baseline
- Original main: e82173d7580f1698f503d544202b986c143fd2a9; main was verified identical during step 1.
- Original Vercel production still shows September 21 release. No original project settings changed in this continuation.
- Feature source: 51e75524fd2eb4d5099b3eae50dd761f6fe0d3f6 (application source unchanged since 20e61cf).
- Created deploy/collections-pilot from the exact feature commit, without merging main or changing application code.
- Existing separate monitor production remains 82faa61 / deployment 7fY5KTNLPjbNwKXMDLLt93m6AWnX.

## Current dependency boundaries
| Resource | Actual state | Release requirement |
| --- | --- | --- |
| Full customer checkout | Original Vercel project's feature preview; Google/Circle callback bound to that host | Dedicated pilot project and verified exact callback; do not replace existing callback |
| Monitor | Separate project, same underlying private Blob store | Deliberate connection to pilot data only after migration/setup acceptance |
| Blob | arc-paylink-blob shared; commerce/v1 path segregation is logical, not credential isolation | Separate private pilot store; do not copy entire legacy store or give pilot the legacy store token |
| Circle / Google | Existing provider configuration shared by original and preview | Preserve old app/key/redirects; explicitly scope pilot configuration and document any remaining shared quotas |
| New release branch | deploy/collections-pilot | Stable deployment with a known-good rollback; branch alone is not a deployed product |
| Scheduled reader | Production-only reader and cron secret in monitor project | Re-enable only after quota and runtime acceptance |

## Newly observed operational blocker
Initial team overview showed 9.7K / 10K Blob Simple Operations (96.83%).
After the usage page loaded, arc-paylink-blob displayed 11,966 operations over its displayed last-30-days range.
Refreshed team overview explicitly showed **Exceeded free resources**, **12K / 10K** simple operations, and 497 / 2K advanced operations.
These UI observations supersede the earlier approximately-97%-used indication. They do not prove the exact historical source of consumption or that every legacy route is currently failing.
Official documentation: https://vercel.com/docs/vercel-blob/usage-and-pricing — Hobby simple operations allowance 10,000; Blob access is unavailable when limits are exceeded. No paid plan or trial was activated.
A new project/store must not be assumed to provide a fresh allowance or used to circumvent provider limits.

## Protective action completed
Only arc-paylink-collections-monitor cron was changed from Enabled to Disabled; UI confirmed Disabled and Run disabled.
Daily schedule definition 0 5 * * * retained. No data, keys or receipts were deleted.
Consequently the first natural daily invocation remains unverified and will not run until re-enabled.
No customer transfer, live collection scan, full test-suite rerun or credential export occurred in this continuation.
No new Vercel project/store has yet been created.

## Next concrete work
1. Reduce unnecessary pilot reads before any new live acceptance: business dashboard and report currently poll every 30 seconds; checkout every 10 seconds. These are code observations, not an attribution of all historical usage.
2. Resolve permitted Blob capacity (normal allowance recovery or explicitly approved plan change); do not enable a paid trial silently.
3. Provision an empty private pilot store with only pilot access, a dedicated full-product deployment, and the exact Google/Circle host configuration.
4. Run one bounded readiness acceptance, record rollback, then re-enable only the intended monitor.
5. Complete step 2 only when full checkout, persistence and callback readiness are verified on the stable pilot URL.

Step 1 payment evidence remains valid: collections-circle-payment-20261003.json.
Older activation evidence is historical; this checkpoint supersedes its providerEnabled=true field.

# Collections release review — 4 October 2026

Review target: pilot source `d8453be5f51674b628d8dcc711fa888fffbb2d62`. Its Vercel deployment check succeeded. Original main remains separate; this review is not an approval to merge or revise an application.

## Completed engineering checks

- Real internal Google/Circle USDC checkout and durable chain-verified receipt.
- Customer tab absent while Processing, followed by signed Circle webhook settlement; temporary notification delay subsequently removed.
- Owner recovery from a separate browser, scoped reader access, revocation and cross-company denial.
- Owner-only customer-reference clearing, preserved financial evidence and conflict/retry protection. No live records were cleared.
- Next.js, Firebase HTTP/gRPC and Anchor TOML dependency remediation. Latest production audit: 0 critical, 0 high, 20 moderate, 8 low package warnings. 294 application tests and production build including TypeScript passed after final dependency changes.

## Residual dependency findings

The 28 warnings propagate from three underlying advisory packages, rather than representing 28 independently demonstrated product defects:

| Root | Observed use | Disposition |
| --- | --- | --- |
| `uuid` | Circle SDK and Jayson use `v4()` without output-buffer arguments. The advisory concerns `v3/v5/v6` output-buffer bounds. | Reviewed calls do not match the described vulnerable pattern. Keep the audit warning; SDK internals and future changes are not fully proven safe. |
| `stream-json` | Jayson imports `StreamValues` and `Verifier`; the described advisory concerns `pick/ignore/filter/replace` filters. No application source imports these filters. | No affected filter use found in the inspected path. Do not claim all SDK internals were audited. |
| `elliptic` | Legacy ethers dependency tree includes it. No direct application import or matching path in the 17 inspected API deployment traces. | No patched version is published in the advisory. Do not introduce local private-key signing through this library; keep upstream replacement as a follow-up. Browser/page SDK paths remain outside the API trace proof. |

Primary advisories: GHSA-w5hq-g745-h8pq, GHSA-528h-pc64-c93x, GHSA-848j-6mx2-7j84. This is source inspection and dependency assessment, not exploit reproduction, an independent audit or a clean npm report.

## Release limits

- Internal acceptance only: zero verified external customers or customer revenue.
- Customer wallet must already have USDC; no bank-card/fiat checkout is claimed.
- Agents read scoped orders and receipts; connecting MCP does not itself create a schedule or bring customers.
- Stored financial orders remain. Clearing customerReference does not erase titles, invoice references, exports, agent copies, onchain/provider records or storage history. No automatic retention purge/full-workspace deletion exists.
- Parent-scoped dependency overrides must be reviewed on future SDK upgrades; TOML is a deliberate transitive major-version override with bounded compatibility evidence.
- Vercel's extra allowance is temporary. Avoid repeated live scans and dashboard refresh loops.

## Remaining acceptance gates

1. Observe the natural daily scheduler invocation after 5 October 09–10 UTC. The earlier manual Run does not close this gate.
2. Confirm returning Google/Circle wallet read-back on the final dependency release without sending another payment; if fresh authentication is required, report that boundary.
3. Freeze demo/application wording around this exact release and its limitations after those checks. Existing Microgrants submission stays unchanged; neither revision nor Tameion submission is authorized for immediate sending by this review.

There is no basis to label this broad production readiness. The completed engineering review can support a controlled pilot presentation with these limits, once the remaining acceptance evidence is collected.

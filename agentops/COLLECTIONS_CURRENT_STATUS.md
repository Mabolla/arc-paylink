# Collections pilot: current release gates

Updated 2026-10-04. This status supersedes older pending statements in the historical acceptance notes; historical observations remain unchanged.

## Verified scope

- The upgrade remains on `deploy/collections-pilot`. Original main remains `e82173d7580f1698f503d544202b986c143fd2a9`; no merge was performed.
- Pilot source `e772ffce8b81c7eea318ef5aa99055225ec96d3e` was published as Ready / Production / Current, deployment `HtgxdikgJY6XhGipz52ZFFGmBHGn`, on 4 October at 16:57:15 Europe/Istanbul.
- Owner recovery was observed from a separate private browser session. This is internal acceptance, not an independent customer's purchase.
- Real Google/Circle checkout and signed webhook settlement have been observed. The strict closed-tab scenario showed the customer tab absent and the business order still Processing before a later Circle webhook recorded Paid. Its 0.01-USDC mainnet receipt is `0x40c4b1029b175da4f63b380190b2d4172e83ac55cb95d4f4dc9c00efc76f07cd`, block 24203301. A temporary single-order notification delay was used for that timing proof and subsequently removed; it does not establish normal notification latency.
- Tenant isolation and reader write denial/revocation have local HTTP/MCP integration evidence: `evidence/company-boundary-check-20261004.json` and `evidence/reader-boundary-review-20261004.json`. These are not an independent security audit or live multi-company acceptance.

## Open gates

1. **Natural scheduler execution:** daily configuration exists, but the 4 October 09:04 UTC pass was manually started. Observe a natural pass after the 5 October 09–10 UTC window; confirm its timestamp, successful outcome and receipt summary. Do not use another manual run to close this gate.
2. **Security release decision:** review remaining privacy/retention, operational recovery and dependency findings before claiming general production readiness. Current local boundary tests do not close all security gates.
   The dashboard disclosure includes authorized reader agents. An owner-only action now clears the internal customer reference while preserving the financial order and receipt; it does not erase prior exports, onchain/provider records, invoice titles or storage history. Automatic retention purge and full-workspace deletion remain absent. See `evidence/customer-reference-clearing-20261004.json`. Dependency review completed a production audit after updating Next.js to 16.3.8 and compatible lockfile dependencies: After Firebase and TOML patches, the latest production audit reports 0 critical, 0 high, 20 moderate and 8 low package-level warnings (28 total). See `evidence/dependency-toml-patch-20261004.json`; 294 application tests and production build passed. The TOML transitive major override passed Anchor Buffer parsing compatibility checks; it still requires review on parent upgrades. Application and contract tests, lint and production build passed. Bounded applicability review is in `evidence/dependency-applicability-20261004.json`; it does not close the full security gate.
3. **Final presentation:** align the demo and application text with the frozen release. Distinguish internal mainnet acceptance, simulated sandbox screens and independent customer adoption. Neither Microgrants revision nor Tameion submission has been completed.

## Hosting limits

On 4 October, Vercel paused the Hobby team after Blob Simple Requests exceeded the included allowance. Official support restored access free as a one-time courtesy with a 3x allowance for 30 days. This is temporary capacity, not a permanent quota solution. No paid plan was purchased.

All three projects now use the Ignored Build Step setting `Only build production`. Future pre-production builds are skipped; production builds remain enabled. This reduces build consumption, not Blob reads. Avoid repeated dashboard polling and duplicate live validation. Changes to this setting were made in Vercel, not in repository configuration.

## Next check

Read existing evidence first. After the natural schedule window, inspect one recorded monitor result. No new payment, payer signature or manual monitor invocation is needed for this check. If access is blocked or the report has no new natural run, leave the gate open and report the exact limitation.

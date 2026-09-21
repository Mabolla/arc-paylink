# Arc PayLink product-readiness roadmap

Status labels are evidence-based: `PASS` means an automated or recorded mainnet test exists; `IN PROGRESS` means code exists but the product gate has not passed; `NOT STARTED` means the user flow is absent.

## Product promise

A sender enters a recipient email, amount, title, and expiry; funds one isolated Arc USDC escrow; and shares one private link. A recipient with no wallet opens that link, signs in with Google, receives a Circle user-controlled Arc wallet, and claims the exact amount. Neither user handles JSON, API keys, private keys, transaction hashes, or explorer reconciliation.

## Release gates

### Gate 0 — Baseline integrity (`PASS`)

- 125 application tests pass.
- 13 escrow contract tests pass.
- ESLint passes.
- Production build passes.
- Mainnet factory and implementation are deployed.
- A real 0.01 USDC mainnet Circle SCA claim is recorded.

### Gate 1 — One-link recipient handoff (`PASS`)

- Replace the downloaded/uploaded JSON package with one private claim URL.
- Keep the claim secret in the URL fragment so it is not sent in HTTP requests or server logs.
- Preserve the claim context through the Google redirect in session storage.
- Verify and consume the package exactly once.

### Gate 2 — Sender product flow (`PASS FOR MAINNET PILOT`)

- Ask for title, recipient email, exact USDC amount, and expiry.
- Connect the sender's Arc wallet.
- Create the isolated escrow and verify its factory event.
- Fund the escrow with the exact amount and verify the onchain transfer.
- Save a private creator-management capability.
- Produce a copyable recipient link; add transactional email delivery after provider configuration.
- Never expose the claim secret in creator dashboards, logs, analytics, or server persistence.

Current code evidence: creation/funding recovery persists locally before optional server work; later funding completes the signed creator backup; registration verifies the sender signature, funded escrow state, factory creation event, and exact USDC transfer receipt. Automated email delivery and deployed mainnet regression evidence remain open.

New records also contain a browser-encrypted claim backup. Its AES key and management capability are derived from a stable, payment-specific sender-wallet signature; the server stores neither the recovery signature nor plaintext claim secret. The mainnet pilot verified restoration in a clean browser with the payment ID and original sender wallet. Legacy pilot records created before this format are not retroactively recoverable.

### Gate 3 — Recipient product flow (`PASS FOR MAINNET PILOT`)

- Open one link without a pre-existing wallet.
- Authenticate with Google and create or recover the Circle wallet.
- Deploy the SCA only when required.
- Present human-readable approvals for deployment, authorization, and claim.
- Confirm the exact escrow, recipient, token, amount, and successful transaction on Arc.
- Persist a durable receipt and provide a safe resume path after refresh or timeout.

Current code evidence: Circle operation idempotency is stable across retries; claim receipts are stored per escrow, revalidated against Arc, and do not hide a different active claim. Deployed clean-account and interruption testing remains open.

### Gate 4 — Creator lifecycle and recovery (`PASS FOR MAINNET PILOT`)

- Show pending, funded, claimed, expired, refunded, revoked, and replaced states.
- Prevent duplicate settlement/claim assignment.
- Revoke only before funding; explain that funded onchain escrow cannot be cancelled early.
- Allow sender-only refund after expiry and verify the refund receipt.
- Revoke-and-replace creates a new immutable obligation and link.
- Replace manual transaction-hash entry with automatic onchain state reconciliation.

Current code evidence: walletless creator records reconcile escrow state automatically and support funding continuation, expiry refund, per-escrow claim receipts, and encrypted new-browser recovery. Automatic discovery of all sender PayLinks, legacy request-flow reconciliation, and deployed interruption/refund evidence remain open.

Contract review found and fixed two fund-lock cases in source: partial funding can now be refunded after expiry, and accidental overfunding is returned without changing the promised claim amount. Terminal escrows also allow sender-only surplus recovery. The creator UI funds only the outstanding balance and exposes expiry/surplus recovery. The verified `surplus-safe-v2` factory is deployed at `0x23c6DAed3617812249C3b9A3Db8525532D0787B9`; the original factory remains trusted only for existing escrow compatibility.

Factory migration compatibility is implemented: creation uses only the active factory, while explicitly configured legacy factories remain trusted for existing claims and creator recovery. New server recovery records persist their originating factory; pre-migration records fall back to the single configured legacy factory. The V2 deployment must set the old mainnet factory in `NEXT_PUBLIC_ARC_PAYLINK_LEGACY_FACTORY_ADDRESSES` before traffic is switched.

Refund/surplus controls are capability-gated through `NEXT_PUBLIC_ARC_PAYLINK_SURPLUS_SAFE_FACTORY_ADDRESSES`; an address belongs there only after its V2 bytecode verification succeeds. Legacy escrows no longer present controls that their immutable implementation cannot execute.

Vercel project inspection on 2026-09-20 initially found no custom Firewall rule. The Arc PayLink project now has an active rate-limit rule for `POST /api/*`: fixed 60-second window, 30 requests per source IP, HTTP 429 on excess. Vercel confirmed successful application and Audit Log records firewall version #1 with the rule created and enabled. Bot Protection remains off because broadly challenging non-browser traffic could interfere with legitimate API clients and is not required for this scoped control.

The V2 deployment workflow is isolated in `deploy-mainnet-escrow-v2.yml`: manual dispatch required the exact `DEPLOY_SURPLUS_SAFE_V2` phrase, serialized contract deployments, pinned the expected previously verified deployer, ran the full tests and production build before the transaction, verified deployed bytecode afterward, and preserved the V2 evidence artifact for 90 days. The successful deployment transaction is `0x430c4cfb2dd859efa2e9468d9023c8a53e591e146947a6c28378c2ab5c32e249`.

### Gate 5 — Security and privacy (`PARTIAL`)

- Validate trusted factory, official Arc USDC, payment ID, escrow bytecode/state, amount, expiry, secret hash, and Circle wallet ownership.
- Rate-limit mutable API routes and reject oversized or malformed bodies.
- Define email privacy/retention and keep recipient PII out of chain data.
- Add security headers and prevent sensitive URL fragments from entering analytics/error telemetry.
- Rotate any credential or 2FA seed that was exposed during setup.
- Review dependencies and the escrow contracts before public-value limits increase.

Current code evidence: mutable JSON routes reject bodies over 32 KiB; baseline browser security headers are configured; the private claim secret remains in the URL fragment and is never included in the creator server record. Durable rate limiting, formal privacy/retention policy, credential rotation evidence, dependency review, and contract review remain open.

Browser write requests now require JSON content type and reject cross-origin requests. Durable rate limiting still requires a deployment-layer atomic service such as Vercel Firewall or an Upstash-backed limiter; Blob storage is intentionally not treated as a correct atomic counter.

### Gate 6 — Product-quality testing (`PARTIAL — PILOT ACCEPTANCE PASSED`)

- Run clean-browser tests with at least 3–5 independent Google accounts.
- Cover first-time wallet creation and returning-wallet recovery separately.
- Cover refresh, back button, closed popup, rejected approval, slow confirmation, expired authorization, expired escrow, refund, duplicate click, wrong network, and insufficient balance.
- Test desktop Chrome plus a real mobile browser.
- Confirm every success in Circle logs and ArcScan, not only in the UI.
- Record defects and repeat the complete suite after each fix until no critical/high issue remains.

### Gate 7 — Release evidence (`PASS FOR MICROGRANTS PILOT`)

- Publish a concise architecture and threat-boundary description.
- Record redacted creation, funding, wallet deployment, authorization, claim, expiry, and refund evidence.
- Document limits, supported network/asset, fees, privacy, and recovery behavior.
- Keep the submitted Microgrants evidence aligned with the deployed mainnet release.

## Definition of done

Arc PayLink is ready for the scoped Microgrants mainnet pilot. Broader production use and higher value limits still require the remaining Gate 5 privacy/dependency work and the full Gate 6 multi-account, mobile, interruption, expiry, and refund matrix.

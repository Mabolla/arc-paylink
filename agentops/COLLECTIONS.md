# Arc PayLink business collections

This extension covers the merchant side of Arc PayLink: a company creates a customer order, the customer checks out using a Circle embedded account, and the company or its agent reads the resulting collection record. The earlier local AgentOps server remains a separate payer-side tool.

## Product routes

- `/business`: real business workspace, persistent private storage, order creation, status filters, overdue totals, CSV export, access key management.
- `/checkout/<orderId>`: customer purchase page, Google / Circle onboarding, balance display, exact approval, status recovery and verified receipt.
- `/business/demo`: interactive browser-only sandbox using the same dashboard component. Sample purchases are explicitly simulated.
- `/checkout/demo?order=<id>`: sandbox customer checkout. It never calls Circle or submits a transfer.
- `/api/business/mcp`: authenticated remote Streamable HTTP MCP server. Four read-only collection tools.
- `/api/checkout/webhooks/circle`: signed Circle transaction notifications, followed by independent onchain verification.

The main product homepage only receives a link to Business collections. The existing `/wallet` route gains a narrow checkout callback wrapper so Google can return to the already-used `/wallet` redirect path. Without a valid recent checkout return state it renders the original recipient wallet. Existing contracts, request settlement APIs, walletless claims and payment components are unchanged.

## Authentication and isolation

Create a workspace with a business name and fixed receiving Arc address. This does not verify the company's legal identity or ownership of the address; the creator must check the address before sharing purchase links.

The owner receives a 256-bit random recovery key once. Server storage contains its hash. The browser receives an HttpOnly, SameSite=Strict cookie scoped to `/api/business`, with Secure enabled on HTTPS. Save the owner key to restore access on another device; there is no email recovery in this version. API callers can send `Authorization: Bearer <key>`.

Only the owner creates or cancels orders and issues/revokes agent keys. Agent keys are read-only and scoped to one workspace. Revocation is checked on every HTTP request. The MCP route requires an explicit Bearer header and does not accept a browser cookie. Public checkout responses omit internal customer references, wallet IDs, challenge IDs and provider retry identities.

Orders, credentials, references, transaction ownership and receipt events are persisted in private Vercel Blob under a new `commerce/v1/chain-<chainId>/` prefix. Updates use ETag / If-Match compare-and-swap; creation forbids overwriting. This avoids a process-local concurrency lock and supports multiple serverless workers. All list operations page through storage. The dashboard exports its loaded pages and tells the user so; the agent can read subsequent pages. Summary aggregation scans all pages up to 10,000 orders, then requires paginated reporting.

## Customer payment

1. Customer opens the order link, sees the business, amount and receiving address.
2. Google authenticates the customer through Circle. Existing wallets are loaded; first-time users approve creation of a user-controlled Arc account.
3. Customer reviews the purchase and approves the exact USDC transfer in Circle's secure UI. A USDC balance is required. This version does not accept bank cards or convert fiat; no claim is made that a new empty wallet can purchase immediately.
4. The server verifies the session owns the source wallet on the configured Arc network. It atomically reserves one payment attempt before calling Circle. Amount and destination come from the stored order, never from the browser.
5. Provider retries reuse the saved UUID idempotency key. The returned challenge and transaction correlations are saved for recovery and background processing. A second payer cannot start another attempt, and processing orders cannot be cancelled.
6. Reconciliation follows the saved Circle challenge to the order's transaction; it cannot create a transfer. The RPC chain ID, successful receipt, exact USDC token/recipient/amount, source wallet and block time are checked. A transaction hash can settle one commerce order only.
7. The payment becomes `paid`; a durable `payment.confirmed` event and receipt become available to the company and its agent. Replaying a notification or reconciliation does not pay again.

Unknown, expired or unsuccessful attempts remain `processing` for reconciliation. They are not automatically unlocked. After 23 hours an attempt lacking a stored challenge cannot issue a new provider request, because provider retry retention must not be assumed forever. The operator must investigate it. This version does not provide a automatic refund or dispute workflow.

## Existing-wallet payments

The customer may also connect an existing EVM wallet, and programmatic clients may use `/api/checkout/<orderId>/external`. This is an additional payment method for the same business order, not a replacement for the Google/Circle experience.

1. `GET ?payer=<address>` returns a short-lived EIP-191 reservation message and nonce. Clients independently reconstruct the message with `externalPaymentMessage` before signing.
2. `POST {action: "reserve", ...intent, signature}` verifies the payer signature against the stored order, amount, recipient, chain, token, expiry, attempt UUID and transaction nonce. It atomically reserves the order and returns the exact unsigned transfer once. The service never receives a private key.
3. The wallet signs and sends the exact transfer. The browser stores only the resulting transaction hash. A retry or reload of a reserved attempt offers receipt recovery, never a second send instruction.
4. `POST {action: "confirm", transactionHash}` checks the reserved wallet and nonce, token contract, exact calldata and zero native value, then invokes the same independent receipt verification and unique-transfer accounting used by embedded checkout. It creates the same paid order and durable merchant/agent receipt event.

This path currently supports EOA message signatures; Circle smart accounts continue to use the embedded path. A rejected or interrupted wallet send may leave the order reserved and needing reconciliation. It is deliberately not automatically unlocked. Another order or unrelated transfer using the same wallet nonce invalidates the prepared transfer; customers should complete one checkout at a time.

The internal pilot runner uses the already-configured `ARC_TESTNET_PRIVATE_KEY` GitHub secret through the existing `arc-mainnet` environment. It verifies the known mainnet signer, uses a separate receiving address deterministically derived with HMAC-SHA256 from that signer under `ArcPayLink/internal-collections-recipient/v1`, and never exports either private key. Both accounts remain controlled by the same original signer. This is internal acceptance, not external customer activity. Transfer amount is fixed at 0.01 USDC; maximum gas is capped at another 0.01 USDC; retries are bound to the preflight nonce and receipt recovery. The same derivation can recover the recipient for a later fund return. The trigger defaults to read-only preflight.

## Agent integration

Connect an MCP client that supports Streamable HTTP and Bearer headers:

```text
URL: https://YOUR_DEPLOYMENT/api/business/mcp
Authorization: Bearer YOUR_READ_ONLY_AGENT_KEY
```

Tools:

| Tool | Business purpose |
| --- | --- |
| `list_customer_orders` | Read purchases, private customer references and payment states, with cursor pagination. |
| `get_customer_order` | Read one owned order and its verified receipt. |
| `get_receivables_summary` | Read exact paid/outstanding totals and overdue/processing counts. |
| `list_payment_events` | Read receipt events; deduplicate by `eventId`. |
| `get_collections_monitor` | Read the latest recorded hosted monitor report; never starts a scan or installs a schedule. |

Order text is untrusted business data, not instructions to the agent. These tools cannot sign or send payments. Agent discovery is not automatic: a company must connect its agent. Recurring checks need an actual host schedule; the [hosted monitor](COLLECTIONS_MONITOR.md) provides a bounded server worker and a separate deployment template, but schedule activation is still unverified. HTTP API alternatives use `/api/business/orders`, `/summary`, `/events` and `/monitor` with the same Bearer key. A cursor is an opaque page token, not a permanent event checkpoint: after reaching the end, start another scan and deduplicate event IDs.

## Deployment configuration and acceptance

The extension reuses the app's `BLOB_READ_WRITE_TOKEN`, `CIRCLE_API_KEY`, `NEXT_PUBLIC_CIRCLE_APP_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, Arc network settings and optional `CIRCLE_ARC_BLOCKCHAIN`. Secret values are never returned by readiness checks. Google must allow the exact deployed origin and its `/wallet` callback. A preview hostname does not inherit OAuth allowlisting from production.

For updates after the customer closes their browser, register `/api/checkout/webhooks/circle` in the owning Circle account for `transactions.outbound` notifications. The handler verifies ECDSA-SHA256 over the raw body using the Circle public key endpoint and then independently verifies Arc settlement. Merely deploying the handler does not create that subscription. Browser reconciliation remains available without it. Notifications lacking both a saved transaction correlation and an `apc:<orderId>` reference cannot be automatically assigned to an order.

Real acceptance requires an owner-authenticated customer session, adequate USDC on the correct network, Circle approval and a genuine onchain receipt. Unit tests, signed test fixtures and the interactive sandbox are not evidence of a real customer purchase. The existing-wallet path now has a real 0.01-USDC internal mainnet acceptance payment. This does not validate Google/Circle approval or represent an external customer purchase; see the evidence below.

The earlier Circle Agent Wallet CLI terms/telemetry approval blocker is separate from embedded customer checkout; this extension does not invoke that CLI or silently accept its terms.

## Verification

- `npm run test:app`: original application, payer AgentOps and business collections tests.
- `npm run lint` and `npm run build`.
- Tests cover tenant isolation, credential hashing/revocation, public/private fields, exact pagination totals, business-reference deduplication, concurrent payer reservation, provider timeout recovery, stale idempotency windows, wrong sender/hash/time, chain/token/amount verification, receipt reuse, storage failure recovery, ECDSA notification authenticity and real stateless MCP HTTP calls.
- The interactive browser scenario creates a purchase, opens checkout, simulates approval, returns to the updated order, inspects the agent report and checks mobile layout. This is explicitly a sandbox UI test.

## Primary integration references

- https://developers.circle.com/wallets/user-controlled/build-a-wallet-app
- https://developers.circle.com/wallets/user-controlled/transfer-tokens
- https://developers.circle.com/api-reference/wallets/user-controlled-wallets/get-user-challenge
- https://developers.circle.com/api-reference/wallets/user-controlled-wallets/get-transaction
- https://developers.circle.com/api-reference/verify-webhook-signatures
- https://vercel.com/docs/vercel-blob/using-blob-sdk

Reviewed 2026-10-01. The installed Circle Web SDK and Vercel Blob type declarations were also inspected.

## Deployed no-funds acceptance

Application commit `98f2880` passed the complete GitHub Actions run 53, including the existing mainnet verifier and read-only preflight. The Vercel preview succeeded. A real private-storage workspace and order were created on the preview; scoped agent reading, write denial, remote MCP reporting, public/private field separation, order cancellation and key revocation were verified. The test order was cancelled and the reader key revoked. No funds moved and no Google/Circle approval was performed. Sanitized evidence is in `evidence/collections-deployed.json`; owner credentials are not committed.

## Observed Google preview configuration blocker

On 2026-10-01, the real preview Google login returned `400 redirect_uri_mismatch` for the preview origin's `/wallet` callback. This is a confirmed OAuth allowlist gap, not a completed customer sign-in. Existing-wallet acceptance cannot prove Google/Circle onboarding or Circle webhook delivery. Production main and its deployment were left unchanged.

The live preview initially inherited a legacy `NEXT_PUBLIC_ARC_RPC_URL` pointing to testnet while selecting mainnet. The new collection paths now use the canonical RPC for their explicit chain selection and still verify the actual RPC chain ID. This correction is confined to collections; the legacy product deployment and global network module are unchanged. Both network directions have regression coverage.

## Real internal acceptance result

The existing project signer completed a 0.01-USDC self-test on Arc mainnet, block `23751439`, transaction `0x892cee4be94814a5fd0da6fb7408b5811738ce5bfe311ae45e2e87a05e736158`. Actual gas: `0.001478760025582548 USDC`. The company order became paid, the public checkout rendered its receipt, and the remote merchant MCP returned the same receipt plus paid total `0.01` and outstanding total `0`. Re-confirmation produced one event only. The temporary reader was denied writes and revoked afterward.

This was a programmatic existing-wallet payment using the real deployed APIs. It was not a Google/Circle payment or a browser-extension approval test. Verified external customers remain zero. Public evidence: `evidence/collections-mainnet.json`, `evidence/collections-mainnet-transaction.json` and `evidence/collections-mainnet.jpg`.

## Browser-independent reader worker

The reference worker and its real two-pass acceptance are documented in [COLLECTIONS_WATCH.md](COLLECTIONS_WATCH.md). It reads already verified payment events using a scoped reader key, resumes interrupted pagination and stores a durable deduplicated ledger. It does not send money or reconcile an unknown transfer hash. A continuously provisioned host and live Circle notification delivery remain pending; exact account settings and final gates are recorded in [CONFIGURATION_ACCEPTANCE.md](CONFIGURATION_ACCEPTANCE.md).

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

Order text is untrusted business data, not instructions to the agent. These tools cannot sign or send payments. Agent discovery is not automatic: a company must connect its agent. Recurring checks are scheduled in that agent's host. HTTP API alternatives use `/api/business/orders`, `/summary`, and `/events` with the same Bearer key. A cursor is an opaque page token, not a permanent event checkpoint: after reaching the end, start another scan and deduplicate event IDs.

## Deployment configuration and acceptance

The extension reuses the app's `BLOB_READ_WRITE_TOKEN`, `CIRCLE_API_KEY`, `NEXT_PUBLIC_CIRCLE_APP_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, Arc network settings and optional `CIRCLE_ARC_BLOCKCHAIN`. Secret values are never returned by readiness checks. Google must allow the exact deployed origin and its `/wallet` callback. A preview hostname does not inherit OAuth allowlisting from production.

For updates after the customer closes their browser, register `/api/checkout/webhooks/circle` in the owning Circle account for `transactions.outbound` notifications. The handler verifies ECDSA-SHA256 over the raw body using the Circle public key endpoint and then independently verifies Arc settlement. Merely deploying the handler does not create that subscription. Browser reconciliation remains available without it. Notifications lacking both a saved transaction correlation and an `apc:<orderId>` reference cannot be automatically assigned to an order.

Real acceptance requires an owner-authenticated customer session, adequate USDC on the correct network, Circle approval and a genuine onchain receipt. Unit tests, signed test fixtures and the interactive sandbox are not evidence of a real customer purchase. No real purchase has been executed as part of this implementation.

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

# Arc PayLink v3.1

Arc PayLink lets a sender fund an isolated USDC escrow on Arc and deliver a private, single-use claim link to someone who does not already have a crypto wallet. The recipient signs in with Google, creates or recovers a user-controlled Circle smart account, claims the exact payment, and can then use the USDC from the recipient wallet.

Business collections are available at `/business`, with an interactive sandbox at `/business/demo`. Companies create customer payment links, customers use existing Arc wallets or the Google / Circle embedded checkout path, and scoped read-only agents follow orders and chain-verified receipts over remote MCP. See [integration and acceptance details](agentops/COLLECTIONS.md). No real customer purchase is claimed by the sandbox.

The [collections watcher](agentops/COLLECTIONS_WATCH.md) also reads receipts without a browser, with a durable ledger and duplicate suppression. A daily pilot schedule is configured. A saved report completed on 5 October at 09:11 UTC within its window, without a manual Run in our workflow; provider trigger logs were outside retention, so exact provenance remains inferred. See the [current release gates](agentops/COLLECTIONS_CURRENT_STATUS.md) for the latest mainnet checkout, webhook and monitor status. The product/evidence tour is at `/collections-demo/index.html`; its sandbox screens remain simulated.

The [hosted collections monitor](agentops/COLLECTIONS_MONITOR.md) adds private server checkpoints, interrupted-run recovery and a recorded report in the business dashboard. The fifth read-only merchant tool, `get_collections_monitor`, exposes that report without starting work. A separate cron endpoint and isolated-deployment template are ready; automatic scheduling requires independent provider activation and acceptance.

An isolated invoice-agent prototype is available in [`agentops/`](agentops/README.md). Its five MCP tools inspect PayLinks, evaluate invoice policy, request exact approval, verify Circle Agent Wallet payments, and reconcile recorded transactions without resending funds. Run `npm run agentops:demo` for the explicitly simulated local rehearsal. Real AgentOps wallet/business acceptance is still pending; the existing escrow and walletless claim flow are unchanged.

**Live mainnet pilot:** [arc-paylink-two.vercel.app](https://arc-paylink-two.vercel.app)

## Full product and upgrade — reviewer route

The original product and the new collections workflow solve different sides of USDC payments:

| Original PayLink | Added collections pilot |
| --- | --- |
| Sender funds an isolated escrow; recipient receives USDC through a private claim link. | Company creates a customer purchase link and receives USDC after customer approval. |
| Recipient signs in with Google and creates/recovers a Circle wallet; no prior wallet setup is required. | Customer uses an existing wallet or Google/Circle access; purchase payment requires an available USDC balance. |
| Request tracking, settlement verification, encrypted creator recovery and address-bound claim authorization. | Company orders, due dates, verified receipts, recovery, revocable read-only MCP access and saved daily reports. |

1. Read the original [mainnet acceptance](docs/mainnet-microgrants-evidence.md) and the original flow below.
2. Inspect the [pilot source](https://github.com/Mabolla/arc-paylink/tree/deploy/collections-pilot) and [collections integration](agentops/COLLECTIONS.md).
3. Review the [current acceptance and limits](agentops/COLLECTIONS_RELEASE_REVIEW.md), including the [5 October daily report](agentops/evidence/daily-background-acceptance-20261005.json).
4. Read the [complete Microgrants revision](agentops/MICROGRANTS_UPGRADE_DRAFT.md). Neither a merged release nor an application submission is implied.

The public collections tour contains historical 1 October screenshots and labels. Its top update must be read separately from those recordings; final live-tour alignment is still pending. Original production/main are preserved.

## Reviewer quick check

- Open the live sender flow: [`/create`](https://arc-paylink-two.vercel.app/create)
- Verify the active surplus-safe V2 factory deployment on Arc mainnet: [`0x430c…e249`](https://explorer.arc.io/tx/0x430c4cfb2dd859efa2e9468d9023c8a53e591e146947a6c28378c2ab5c32e249)
- Inspect the machine-readable deployment record: [`deployments/arc-mainnet-escrow-v2.json`](./deployments/arc-mainnet-escrow-v2.json)
- Review the mainnet acceptance evidence: [`docs/mainnet-microgrants-evidence.md`](./docs/mainnet-microgrants-evidence.md)

## What is verified

The production build has completed a real Arc mainnet acceptance flow with `0.01 USDC`:

- sender wallet connection, isolated escrow creation, and exact funding;
- private claim-link handoff to a different Google account;
- Circle wallet creation and smart-account deployment;
- address-bound authorization and EIP-1271 claim;
- claimed balance displayed from Arc in `/wallet`;
- recipient USDC transfer preparation, review, approval, submission, and balance reconciliation;
- encrypted creator backup and recovery in a clean browser;
- recovered PayLink status revalidated from Arc as `CLAIMED`.

The application and contract test suites, lint, TypeScript checks, and production build are run before deployment. Detailed deployment and security records are in [`docs/`](./docs).

## Product flow

### Sender

1. Open `/create` and connect a funded Arc wallet.
2. Enter a title, recipient email, exact USDC amount, reference, and expiry.
3. Review and sign escrow creation and funding in the wallet.
4. Copy the private claim link and deliver it only to the intended recipient.
5. Track the PayLink from `/requests` and save its encrypted creator backup.

### Recipient

1. Open the private `/claim#claim=…` link.
2. Sign in with the intended Google account.
3. Create or recover the user-controlled Circle wallet.
4. Review and approve wallet deployment, claim authorization, and the final claim.
5. Open `/wallet` with the same Google account to view or send the received USDC.

### Creator recovery

In a new browser, the original sender can open `/requests`, enter the payment ID, reconnect the original wallet, and sign a payment-specific recovery message. The encrypted claim secret is decrypted only in that browser, and the recovered record is revalidated against Arc. Recovery itself moves no funds.

## Architecture

```mermaid
flowchart TD
  A[Sender wallet] --> B[Isolated Arc escrow]
  B --> C[Private single-use claim link]
  C --> D[Google-authenticated Circle wallet]
  D --> E[Address-bound EIP-1271 claim]
  E --> F[Recipient-controlled USDC]
  A --> G[Encrypted creator backup]
  G --> B
```

- `ArcPayLinkFactory` creates one deterministic minimal-proxy escrow per payment.
- Each escrow is locked to official Arc USDC, an exact amount, expiry, and hashed link secret.
- The claim signature binds the recipient wallet address, so possession of the link alone cannot redirect funds.
- Each PayLink can be claimed once. After expiry, refund behavior is sender-controlled according to the deployed escrow version.
- Creator records are stored without plaintext claim secrets; recovery uses wallet-signed, payment-specific key derivation.
- Claim secrets remain in the URL fragment and are not included in HTTP requests.

## Mainnet deployment

| Item | Value |
| --- | --- |
| Network | Arc mainnet (`5042`) |
| USDC | `0x3600000000000000000000000000000000000000` |
| Active factory | `0x23c6DAed3617812249C3b9A3Db8525532D0787B9` |
| Active implementation | `0xA51932CB63aF7B1Bb5d401eaA4052ED17194E760` |
| Deployment transaction | [`0x430c…e249`](https://explorer.arc.io/tx/0x430c4cfb2dd859efa2e9468d9023c8a53e591e146947a6c28378c2ab5c32e249) |
| Deployment block | `21876743` |
| Legacy factory | `0x19fbf0B85e66d68D312cD18D04A1a789107387FF` |

Machine-readable deployment evidence: [`deployments/arc-mainnet-escrow-v2.json`](./deployments/arc-mainnet-escrow-v2.json). The original pilot deployment remains in [`deployments/arc-mainnet-escrow.json`](./deployments/arc-mainnet-escrow.json) for legacy escrow verification.

## Security boundary

- Arc PayLink never asks for or receives a private key or seed phrase.
- The claim URL is a bearer secret and must be sent only to the intended recipient.
- The recipient email is an offchain delivery constraint; it is not written onchain.
- Circle secures the recipient wallet and presents explicit approvals.
- The server verifies trusted factory, escrow, token, payment ID, amount, expiry, secret hash, funded state, and wallet ownership before preparing a claim.
- Mutable JSON APIs enforce origin/content-type/body-size controls; production API writes are protected by a Vercel rate-limit rule.
- Recovery and status reconciliation do not automatically retry, refund, top up, or otherwise move funds.

See [`docs/security-privacy-threat-model.md`](./docs/security-privacy-threat-model.md) for the full threat boundary.

## Local development

Requirements: Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Quality checks:

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```

The default configuration is Arc testnet. Mainnet requires explicit environment configuration; contract deployment scripts also require their dedicated confirmation latch.

## Evidence and preserved history

- Mainnet pilot: [`docs/mainnet-microgrants-evidence.md`](./docs/mainnet-microgrants-evidence.md)
- Security and privacy: [`docs/security-privacy-threat-model.md`](./docs/security-privacy-threat-model.md)
- Product-readiness record: [`docs/product-readiness-roadmap.md`](./docs/product-readiness-roadmap.md)
- V3.1 lifecycle evidence: [`docs/v3.1-lifecycle-evidence.md`](./docs/v3.1-lifecycle-evidence.md)
- V3 testnet evidence: [`docs/v3-demo-evidence.md`](./docs/v3-demo-evidence.md)
- Preserved V3 baseline: branch `release/v3.0.0`, commit `215d3476afe26882b8575cfa26bf90ee56ba9452`

## License

MIT

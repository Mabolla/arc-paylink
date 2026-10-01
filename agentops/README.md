# Arc PayLink AgentOps 0.2

A local MCP add-on for a business agent to check invoice obligations, request approval, pay through a Circle Agent Wallet, verify Arc USDC settlement, and recover a failed status update without paying twice. The escrow contracts and existing payment APIs remain unchanged. For the added customer purchase flow, company dashboard and remote read-only agent tools, see [Business collections](COLLECTIONS.md).

**Status:** locally verified prototype, including an offline integration rehearsal. No real AgentOps payment or business pilot is claimed. This is a tool layer for an MCP host, not a continuously running autonomous finance operator.

## Review it without a wallet

Node.js 22+ is recommended. From the repository root:

```sh
npm ci
npm run agentops:test
npm run agentops:demo
```

The demo runs the real MCP server, decision engine, audit journal, CLI adapter, HTTP client and receipt decoder. The invoice, approval, wallet executable, HTTP service and Arc RPC responses are explicitly **simulated**. It forces a settlement-service outage, blocks a retry under another invoice name, and completes reconciliation with exactly one simulated transfer. It never calls the installed Circle CLI or a public RPC.

Saved output: [local-rehearsal.json](evidence/local-rehearsal.json). Delivery report: [RELEASE_REPORT.md](RELEASE_REPORT.md). Submission material: [SUBMISSION.md](SUBMISSION.md).

## Visual demo and recording

The feature branch includes an isolated static replay at `/agentops-demo/index.html`. It works on mobile, exposes all seven recorded tool results and provides a downloadable evidence file. It does not call a wallet, RPC or PayLink API. This replay is separate from the new `/business` and `/checkout` application routes.

An [84-second captioned video](../public/agentops-demo/rehearsal.mp4) shows seven actual screenshots of this working replay. Its persistent simulation label distinguishes the fixture transaction from a real payment. This is a silent recording with English captions. The public artifacts can be regenerated from the current rehearsal:

```sh
npm run agentops:demo -- --output agentops/evidence/local-rehearsal.json
npm run agentops:demo:build
```

Optional recording tooling is `node agentops/record-demo.mjs`; the rendering environment needs Playwright, Chromium and ffmpeg. `ARCPAYLINK_DEMO_CHROMIUM_PATH` can identify an installed renderer. Those tools are only used to capture the local demo page and are not payment-server dependencies.

## MCP tools

| Tool | Behavior |
| --- | --- |
| `inspect_paylink` | Read a known PayLink UUID and its status |
| `evaluate_invoice` | Compare invoice facts and policy; record a decision; no funds move |
| `pay_approved_invoice` | Ask for exact client approval, reserve durably, submit once, verify and sync |
| `reconcile_payment` | Reverify the saved transaction and retry status synchronization; cannot transfer |
| `read_agent_audit` | Verify the local hash chain and return recent records |

Policy is exposed as the `arcpaylink://policy` resource. Invoice evidence includes `invoiceId`, `obligationId`, `recipient`, `amount` and an ISO `dueDate`. `obligationId` must match the PayLink; an external invoice number can differ. Caller-supplied invoice evidence is not proof of invoice authenticity.

## Real testnet configuration

The repository includes **Circle CLI 1.1.4**, pinned in the lockfile. A separate global installation is not required. The runtime defaults to `node_modules/.bin/circle` and a local PayLink origin; it never silently targets the production site.

Every CLI subprocess receives Circle's supported `DO_NOT_TRACK=1` setting, disabling optional CLI telemetry. The adapter does not accept service terms or perform login on the operator's behalf; those are separate setup actions.

Use a dedicated account/runtime with no imported local wallet keys. Complete the Circle Agent Wallet login with the account owner present, following the [official quickstart](https://developers.circle.com/agent-stack/agent-wallets/quickstart). The owner accepts terms and enters the email OTP; do not grant an agent mailbox access. Select testnet for the test wallet:

```sh
DO_NOT_TRACK=1 ./node_modules/.bin/circle wallet login you@example.com --testnet
DO_NOT_TRACK=1 ./node_modules/.bin/circle wallet list --type agent --chain ARC-TESTNET --output json
```

Run a separate Arc Testnet PayLink instance with persistent storage. Provide these variables to the MCP host process (placeholders below are not usable addresses):

```dotenv
NEXT_PUBLIC_ARC_NETWORK=testnet
NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.io
ARCPAYLINK_BASE_URL=http://127.0.0.1:3000
ARCPAYLINK_CIRCLE_WALLET_ADDRESS=0xYourTestnetAgentWallet
ARCPAYLINK_ALLOWED_RECIPIENTS=0xApprovedTestPayee
ARCPAYLINK_MAX_PAYMENT_USDC=5
ARCPAYLINK_DAILY_LIMIT_USDC=10
```

Configure the host's working directory as the repository root, command `node`, and arguments `["--import", "tsx", "agentops/server.ts"]`. Run Node directly for stdio, since npm prints a banner. The MCP host must support form elicitation and present the exact payment approval to a trusted operator. A missing capability, decline, cancellation, or failed wallet preflight blocks submission. Host approval is trusted input, not independent proof of who approved.

The default journal is `~/.local/state/arc-paylink-agentops/<chainId>/audit.jsonl`. `ARCPAYLINK_AUDIT_PATH` can select a persistent private volume. All instances for one business/wallet must share the same journal on one local filesystem; do not run copies with separate journals. Do not store a live journal in this public repository. Journal and lock files are created with mode `0600`, new directories with `0700`.

## Payment and recovery guarantees

- Only pending, direct-Arc, matching invoice obligations are payable. The instance's network, recipient allowlist, exact six-decimal USDC amount, due date, per-payment cap and UTC daily budget must match.
- After approval, request facts and policy are checked again. A cross-process file lock covers approval, reservation, transfer and recording. Concurrent calls fail closed rather than waiting and potentially paying twice.
- A reservation containing request ID, invoice ID, obligation ID, source wallet, amount, network and UUID idempotency key is flushed to disk before invoking the wallet. Duplicate checks cover all three business identifiers. The key is passed to Circle's transfer command.
- The adapter explicitly selects `0x3600000000000000000000000000000000000000` as USDC. It accepts only `data.txHash`; a block hash or transaction ID is insufficient. The hash is flushed before RPC verification.
- Verification checks the RPC chain ID, successful official-USDC Transfer event, source wallet, exact recipient/amount/hash, and a block timestamp no earlier than the recorded attempt. A verified hash cannot settle two local obligations.
- `settled` means both chain verification and the PayLink API's matching settlement response succeeded. `sync-required` means payment was verified but status storage needs repair. `reconciliation-required` means outcome is unresolved. None is permission to send again.
- `reconcile_payment` uses only the already-saved hash. An unknown hash requires operator investigation with Circle using the journal's idempotency key; there is no automatic resubmission or arbitrary-hash attachment. Unresolved reservations continue to consume budget after midnight.
- If a process crashes and leaves `audit.jsonl.lock`, calls stop. First establish that the owning process is no longer running, preserve the journal, and investigate any attempt. Only then may the operator remove the stale lock and reconcile. Never delete the journal to unblock an invoice.

## Scope and remaining limits

This supports one business on one local filesystem, not multiple tenants or replicas. The journal detects ordinary edits but is not signed/WORM evidence: an operator who rewrites the entire file can recompute its hashes. Protect the filesystem and back up evidence under separate control; do not restore an older journal and resume payments. These are local application controls, not guarantees against another tool independently spending from the wallet.

This local payer process has no tenant invoice inbox, email/PDF ingestion, accounting connector, sanctions-screening service, webhook delivery, background schedule, or walletless-claim agent workflow. The separate [business collections module](COLLECTIONS.md) adds tenant authorization, customer purchases, embedded checkout, signed inbound Circle notifications and read-only remote MCP tools. The existing UUID-based PayLink API is not a tenant authorization system. The CLI's wallet resolver can fall back to a local wallet; hence the dedicated runtime without imported local keys requirement, plus agent-wallet preflight. CLI output/errors are not exposed verbatim to the MCP host.

Mainnet has not been validated for this prototype's pilot. Before enabling it, verify Circle-enforced wallet policies, account authorization, independent audit retention and genuine business evidence. See [Circle CLI docs](https://developers.circle.com/agent-stack/circle-cli) and the [published 1.1.4 package](https://www.npmjs.com/package/@circle-fin/cli/v/1.1.4). The adapter was checked against that package's `transfer`, `list`, `resolve` and output code, not just example commands.

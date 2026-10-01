# Tameion submission material — draft, not submitted

## Project

**Arc PayLink — customer payment links with verified collections for companies and their agents.**

Arc PayLink lets a company create a customer purchase link and track its collection through a business dashboard or a scoped MCP agent. Customers can use an existing Arc wallet; a Google / Circle embedded account path is also implemented, with preview OAuth configuration acceptance still pending. The service binds each payment to its order, verifies the exact transfer on Arc, and exposes a durable receipt event to the company and its agent. The read-only merchant agent cannot move funds.

The separate payer-side AgentOps extension compares invoice evidence with PayLink facts, vendor allowlists, due dates and spending limits. It requests per-payment approval before Circle Agent Wallet submission and reconciliation. This CLI path is distinct from customer collections and has no verified live CLI payment yet.

Its focus is the difficult case after submission: an API timeout must not become a second payment. Durable reservations, duplicate checks across invoice/obligation/PayLink identities, a persisted Circle idempotency key and a no-transfer reconciliation tool preserve the link between the decision and the transaction.

This is an isolated extension to the existing Arc PayLink product. The walletless escrow and recipient flow are retained. The current version requires per-payment approval and an MCP host; it is not an unattended agent or a complete AP/AR suite.

## Evidence available now

- Public source repository: https://github.com/Mabolla/arc-paylink (AgentOps branch: `feat/tameion-agentops`).
- Reproducible offline demo: `npm run agentops:demo`.
- Mobile-friendly evidence replay: `/agentops-demo/index.html` on this branch's preview deployment.
- [84-second captioned video](../public/agentops-demo/rehearsal.mp4): actual screenshots of the working evidence replay, with simulated external payment activity clearly labeled throughout. Silent, with English captions.
- 39 payer AgentOps tests; 32 business collections tests; 196 total application tests; 13 escrow contract tests.
- Verified external business pilots: **0**. Payer-side Circle Agent Wallet CLI transfers: **0 verified**. Customer collections: **one internal 0.01-USDC mainnet self-test**, detailed below. Simulation results are excluded.
- Existing product: https://arc-paylink-two.vercel.app — this is the existing PayLink mainnet pilot, not a deployed AgentOps demo.

## Recording outline, under three minutes

| Time | Demonstration |
| --- | --- |
| 0:00–0:20 | Business problem: invoice evidence, approval, payment and status can disagree |
| 0:20–0:55 | Agent reads a PayLink; shows policy and a rejected mismatch |
| 0:55–1:35 | Shows exact approval, submission and independent USDC receipt verification |
| 1:35–2:10 | Shows failed status sync; a renamed duplicate is blocked; reconciliation completes without another transfer |
| 2:10–2:40 | Displays audit trail, original obligation and settlement hash; states actual pilot/volume figures |
| 2:40–2:55 | Explains current approval requirement and next business integration |

The delivered video uses the seven-step replay in 84 seconds, with “SIMULATED · NO REAL FUNDS” visible throughout and the simulation stated in its opening caption. It is a visual replay of recorded local integration results, not a live financial transaction recording. Replace the synthetic transaction segment only after real testnet evidence exists. Registration/acceptance and final submission status have not been verified.

Before submission, include the actual recording URL and accurate business-use evidence. The [official event page](https://tameion.thecanteenapp.com/) supplies the submission form and current requirements.

## Customer collections extension (2026-10-01)

The feature branch now also includes a company dashboard, persistent tenant-scoped orders and access keys, Google / Circle embedded customer checkout, existing-wallet checkout with signed order reservations, exact onchain receipt verification, signed inbound Circle notifications and a remote read-only MCP server for company agents. See [COLLECTIONS.md](COLLECTIONS.md).

- Real workspace: https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app/business
- Interactive sandbox: https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app/business/demo
- Remote merchant MCP: `/api/business/mcp`, with a scoped Bearer key.

The sandbox is explicitly simulated and uses browser-local data. Embedded checkout code is implemented; a real Google-authenticated customer purchase and the deployed Circle webhook subscription still need acceptance. A new empty embedded wallet requires funding with USDC; this version does not offer card/fiat checkout. Do not describe sandbox purchases as users, traction, revenue or onchain volume.

## Real collections acceptance evidence

One internal 0.01-USDC mainnet payment has now completed through existing-wallet checkout, independently verified by the deployed server and read back through the company's remote MCP. Transaction: `0x892cee4be94814a5fd0da6fb7408b5811738ce5bfe311ae45e2e87a05e736158`; block `23751439`; actual gas `0.001478760025582548 USDC`.

[Public receipt page](https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app/checkout/604c797f-68d3-40bd-a483-bc7a36e7a33c) · [Agent acceptance evidence](evidence/collections-mainnet.json) · [Receipt screenshot](evidence/collections-mainnet.jpg).

This is a self-test between project-controlled accounts, not revenue or an external business pilot. Verified external customers: **0**. The separate Circle Agent Wallet CLI payment path remains unverified. Google preview login currently returns `redirect_uri_mismatch`; Circle approval and background webhook delivery remain acceptance gates.

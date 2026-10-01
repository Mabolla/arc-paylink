# Tameion submission material — draft, not submitted

## Project

**Arc PayLink AgentOps — invoice decisions with verifiable USDC settlement and safe reconciliation.**

Arc PayLink AgentOps gives a business's MCP agent a controlled path from a known invoice obligation to an auditable payment. The agent compares invoice evidence with PayLink facts, vendor allowlists, due dates and spending limits. It requests approval for the exact payment, uses Circle Agent Wallets to submit USDC on Arc, independently verifies the transfer, and records settlement against the original obligation.

Its focus is the difficult case after submission: an API timeout must not become a second payment. Durable reservations, duplicate checks across invoice/obligation/PayLink identities, a persisted Circle idempotency key and a no-transfer reconciliation tool preserve the link between the decision and the transaction.

This is an isolated extension to the existing Arc PayLink product. The walletless escrow and recipient flow are retained. The current version requires per-payment approval and an MCP host; it is not an unattended agent or a complete AP/AR suite.

## Evidence available now

- Public source repository: https://github.com/Mabolla/arc-paylink (AgentOps branch: `feat/tameion-agentops`).
- Reproducible offline demo: `npm run agentops:demo`.
- 39 AgentOps tests; 164 total application tests; 13 escrow contract tests.
- Current AgentOps business pilots: **0 verified**. Current AgentOps real transfer volume: **0 verified**. Simulation results are excluded.
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

If recorded before the real pilot, keep “SIMULATED — NO REAL PAYMENT” visible throughout and state it verbally. Replace the synthetic transaction segment only after real testnet evidence exists. No video has been recorded by this delivery. Registration/acceptance and final submission status have not been verified.

Before submission, include the actual recording URL and accurate business-use evidence. The [official event page](https://tameion.thecanteenapp.com/) supplies the submission form and current requirements.

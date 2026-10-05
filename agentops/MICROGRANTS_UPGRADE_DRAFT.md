# Arc Microgrants revision — 5 October 2026
Status: prepared for review, not submitted. Update existing BUIDL 49049; do not create a duplicate application.

## Project name
Arc PayLink

## Short description
Verified USDC payment links, business collections and read-only agent reporting on Arc.

## Full project description
Arc PayLink helps a business turn a USDC payment into a recorded order and a verifiable receipt. A business creates a fixed-amount checkout link, shares it with a customer, and tracks payment status, due dates and receipts in one dashboard.

The new collections pilot extends the original payment-link product with persistent company workspaces, Google/Circle customer-wallet access and scoped, revocable MCP access for business agents. Customers can use an existing Arc wallet or sign in with Google to access a user-controlled Circle wallet. The customer must already have USDC and explicitly approve the payment; bank-card or fiat checkout is not included.

Server-side verification ties settlement to the order. Signed Circle notifications allow settlement to finish after the customer leaves the checkout page. Read-only agents can inspect orders, collections totals, payment events and the latest saved report without authority to move funds. A hosted daily check records a collections report, so monitoring does not depend on keeping the business dashboard open.

## What changed since our original submission
We retained the original live PayLink product and built the upgrade on a separate branch and deployment. The pilot adds:
- Company order and collections dashboard.
- Google/Circle wallet access and approved USDC checkout.
- Verified receipts and browser-independent settlement.
- Revocable read-only MCP access and persisted background reports.
- Workspace recovery and owner-only customer-reference clearing that preserves payment evidence.

## Validation
Our internal acceptance workspace has five verified Arc mainnet payments of 0.01 USDC each, totaling 0.05 USDC. These are our own tests, not external customers or revenue.

On 4 October, a strict closed-tab scenario observed the customer tab closed while the order was still Processing, followed by a Paid receipt sourced from the signed Circle webhook. A temporary single-order notification delay made that sequence observable and was subsequently removed; this is recovery evidence, not a normal-latency claim.

Returning Google/Circle wallet access was verified on the final dependency release without another payment. On 5 October, the saved background report completed at 09:11 UTC, tracked all five receipts and recorded 0.05 USDC collected with zero outstanding. This falls within the configured daily schedule, with no manual Run in our workflow that day. The provider invocation log was outside the Hobby retention window, so exact trigger provenance is not independently proven.

The final dependency release passed 294 application tests and a production build including TypeScript. Thirteen contract tests passed earlier in the upgrade. Access-control and retry/conflict checks are documented in the repository. This is internal pilot validation, not an independent security audit.

## Why support this upgrade
The next milestone is a first external business pilot: measure checkout completion, verify that recurring reports help the business reconcile collections, and improve onboarding and recovery from that feedback. Support would also help complete privacy/retention controls and observe daily operation over time.

## Current limits
No verified external customers yet. Customer wallets require USDC. One observed daily background report does not establish long-term reliability. Financial records and onchain/provider history remain; clearing a customer reference is not full data erasure. The latest production dependency audit retains 20 moderate and 8 low warnings, with scope assessments documented. This remains a controlled pilot.

## Links
Original live product: https://arc-paylink-two.vercel.app
Collections pilot: https://arc-paylink-collections-pilot.vercel.app/business
Public demo and evidence tour: https://arc-paylink-collections-pilot.vercel.app/collections-demo/index.html
Pilot source: https://github.com/Mabolla/arc-paylink/tree/deploy/collections-pilot
Release review: https://github.com/Mabolla/arc-paylink/blob/review/collections-release-20261004/agentops/COLLECTIONS_RELEASE_REVIEW.md
Daily report evidence: https://github.com/Mabolla/arc-paylink/blob/review/collections-release-20261004/agentops/evidence/daily-background-acceptance-20261005.json
Final wallet evidence: https://github.com/Mabolla/arc-paylink/blob/review/collections-release-20261004/agentops/evidence/final-wallet-readback-20261004.json

## Editing guidance
Keep the project name, original live link and existing submission identity. Add the separate pilot/demo and evidence links. Replace outdated description/validation text with the relevant sections above. Preview before saving. Confirm whether project edits also update the existing grant submission; a project-description change alone does not prove that application-specific answers have changed.

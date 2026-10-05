# Arc Microgrants revision — 5 October 2026
Status: prepared for review, not submitted. Update existing BUIDL 49049; do not create a duplicate application.

## Project name
Arc PayLink

## Short description
Walletless USDC claiming, verified payment links and business collections with read-only agent reporting on Arc.

## Full project description
Arc PayLink lets a sender fund an isolated USDC escrow on Arc and share a private, single-use claim link. The recipient does not need to have a crypto wallet beforehand: they sign in with Google, create or recover a user-controlled Circle smart account, approve the claim and receive the exact USDC payment. They can return with the same Google account to view and send the received USDC.

The original product includes exact funding and settlement checks, amount/recipient/obligation verification, partial/duplicate/mismatched payment detection and a recovery plan that does not automatically move funds. The sender can track requests, revoke eligible pending requests, and recover encrypted creator records in another browser. Address-bound EIP-1271 authorization protects the claim; the private link must only be shared with its intended recipient. Expiry/refund behavior follows the deployed escrow version.

The business collections pilot adds a second workflow on this foundation: a company creates a fixed-amount checkout link, shares it with a customer, and tracks payment status, due dates and verified receipts in one dashboard. This purchase checkout is distinct from receiving a funded escrow claim.

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
No verified external customers yet. Purchase checkout requires a customer USDC balance; the original recipient claim receives USDC already funded by the sender and does not require the recipient to pre-fund the payment. One observed daily background report does not establish long-term reliability. Financial records and onchain/provider history remain; clearing a customer reference is not full data erasure. The latest production dependency audit retains 20 moderate and 8 low warnings, with scope assessments documented. This remains a controlled pilot.

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

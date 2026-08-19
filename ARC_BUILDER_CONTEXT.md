# Arc Builder Context

> Project-local builder context for Arc PayLink. This file is the first implementation of the shared Builder methodology we will reuse across Arc projects.

## Mission

Build useful, verifiable applications on Arc while turning every project into reusable Builder knowledge.

Core loop:

**Build → Learn → Document → Reuse → Build Better**

This project is both a product and a learning artifact. When a meaningful implementation decision, failure mode, test pattern, or Arc/Circle integration lesson is discovered, capture it here or in the shared Builder guide rather than losing it in chat history.

## Arc-First Rules

1. Treat Arc network configuration as fast-moving. Re-check official Arc documentation before implementation and deployment.
2. Arc uses **USDC as the native gas token**, not ETH.
3. Arc is **EVM compatible** and supports standard Solidity tooling such as Foundry, Hardhat, Viem, and Ethers.
4. Arc provides sub-second deterministic finality; do not invent unnecessary multi-confirmation waits.
5. Never guess chain IDs, RPC URLs, explorer URLs, token addresses, CCTP domains, SDK APIs, or supported-network matrices. Verify them from current official documentation.
6. Keep secrets out of source control: private keys, seed phrases, API keys, and production credentials must never be committed.
7. For payment products, an SDK success response is not final proof. Verify the destination settlement against the intended asset, recipient, and exact amount.

## Official Sources

Start with the current Arc documentation index:

- https://docs.arc.io/
- https://docs.arc.io/llms.txt

For Circle integrations:

- https://developers.circle.com/
- https://developers.circle.com/llms.txt

Relevant Arc capability areas currently documented include:

- Connect to Arc / RPC
- Contract addresses
- Gas and fees
- EVM compatibility/differences
- Contract deployment and interaction
- Event/log monitoring
- App Kit Send
- App Kit Bridge
- App Kit Unified Balance
- Agentic economy / AI-agent workflows

## Project Scope

Arc PayLink is a payment-request product on Arc Testnet. The request represents machine-readable payment intent: asset, amount, recipient, and fulfillment condition.

Current milestone:

- Same-chain Arc USDC payment is the proven path.
- Cross-chain Base Sepolia → Arc is a planned Circle App Kit Bridge/CCTP path.
- Unified Balance is a later/stretch path, not part of the critical MVP path.

Do not expand scope merely because another Arc capability exists. Prefer the smallest working flow that produces a verifiable onchain result.

## Builder Workflow

### Phase 1 — Understand

- State the user problem.
- Explain why Arc is a good fit.
- Identify which Arc/Circle primitives are actually needed.
- Check current official docs before making technical assumptions.

### Phase 2 — Plan

Before changing code, produce:

- MVP scope
- architecture
- user flow
- transaction flow
- file structure
- security risks
- test plan
- deployment plan

### Phase 3 — Build

- Implement the smallest end-to-end path first.
- Keep network configuration centralized.
- Use integer base units for token amounts.
- Keep wallet/provider logic separate from payment-state logic.
- Make transaction states explicit: ready, awaiting wallet, processing, paid, failed.

### Phase 4 — Verify

At minimum:

- lint
- unit tests
- production build
- manual end-to-end test on the official testnet
- explorer verification of the destination transaction

For payment fulfillment, verify:

- destination transaction succeeded
- official token contract was used
- expected recipient matches
- exact requested amount matches
- the request cannot be fulfilled twice

### Phase 5 — Deploy

Deploy only after the local checks pass. Re-check current network configuration and environment variables before deployment.

### Phase 6 — Learn

After every meaningful milestone, record:

- What worked?
- What failed?
- What was surprising?
- Which official documentation resolved the issue?
- Which pattern should become reusable?
- What should the next Builder project do differently?

## AI Agent Operating Instructions

When an AI coding agent works in this repository:

1. Read this file before making Arc-specific implementation decisions.
2. Inspect the existing project before proposing changes.
3. Prefer official Arc/Circle documentation over memory or stale examples.
4. If a critical fact is uncertain, stop and verify it rather than guessing.
5. Do not replace a working implementation with a different model, framework, provider, or architecture unless there is a concrete project reason.
6. Make the smallest safe change that advances the current milestone.
7. After changes, run the narrowest useful verification first, then the full project checks.
8. Report exactly what changed, what was tested, and what remains uncertain.

## Reuse Contract

Any reusable discovery from this project should eventually be promoted into the shared Builder knowledge base.

Examples:

- Arc payment verification patterns
- App Kit integration patterns
- cross-chain failure/recovery patterns
- USDC precision rules
- wallet/network UX patterns
- testnet funding/rehearsal practices
- deployment gotchas
- AI-agent prompts that consistently produce better results

## Current Status

- Project: Arc PayLink v2
- Repository: Mabolla/arc-paylink
- Primary network: Arc Testnet
- Proven flow: Arc → Arc USDC payment
- Verified payment: **25 USDC** on Arc Testnet
- Verified transaction: `0x4f7a17dd033ea30628b8f3b5a8ec519920277731a7b8382153dc8c36515db379`
- Verification report: `ARC_PAYLINK_TEST_REPORT.md`
- Automated checks: lint, 14 unit tests, TypeScript, and production build **PASS**
- Local runtime: **PASS**
- Planned flow: Base Sepolia → Arc through App Kit Bridge/CCTP
- Shared Builder methodology: **adopted**
- Context file: **v0.1**

## Change Discipline

This file is a project-local context layer. It must not become a dumping ground for every implementation detail. Keep stable Builder rules here; put project-specific implementation details in the README and code, and promote broadly reusable lessons to the shared Builder guide.

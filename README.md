# Arc PayLink v2

## Obligation-aware settlement milestone

Arc PayLink is moving beyond a generic payment link. New requests can carry a validated `invoice`, `milestone`, or `agent-task` obligation ID. The cross-chain settlement adapter classifies destination outcomes as `settled`, `fee-adjusted`, `pending`, `partial`, `duplicate`, or `mismatched`, with an explicit next recovery action. Verified bridge receipts now surface gross amount, recipient net amount, and recorded bridge fees in the payment UI.

This first milestone is deliberately deterministic and non-custodial. It does not automatically retry, refund, or top up funds. Persistence, source/destination correlation records, and controlled recovery execution remain the next product milestones.

### Source-to-destination correlation milestone

Completed cross-chain obligations now produce a versioned audit record that binds:

- the obligation type and ID;
- the source-chain burn transaction;
- the CCTP event nonce plus hashes of the message and attestation;
- the Arc destination mint transaction and block;
- gross, recipient-net, fee, outstanding amount, settlement state, and read-only recovery action.

Raw CCTP message and attestation bytes are not retained. The immutable correlation record is saved in browser storage and can be downloaded as JSON for independent audit or later ingestion. A conflicting record for the same correlation ID is preserved rather than overwritten and is surfaced for manual review. Browser persistence is the current MVP boundary; shared server-side persistence remains future work.

Arc PayLink v2 is a small hackathon MVP for creating shareable USDC payment requests that always settle and produce a verifiable receipt on Arc Testnet. A payer can pay with USDC already on Arc or bring USDC from Base Sepolia through Circle App Kit.

This is an Arc project. Base Sepolia is only a supported source network for a payment. This repository must not share files, directories, dependencies, or Git history with any Base builder project.

## Experimental claimable escrow

The repository now includes a tested contract foundation for the next Arc PayLink milestone: cross-chain funded payment links that can be claimed by a recipient wallet created after the link is shared.

- `ArcPayLinkFactory` creates one deterministic minimal-proxy escrow per payment link and is locked to one configured payment token.
- Each escrow recognizes USDC delivered directly to its address, including a CCTP destination mint.
- A recipient authorizes a claim with an address-bound EIP-712 signature. EOA signatures and EIP-1271 smart-account signatures are supported.
- The link secret alone cannot redirect funds to an attacker because the signed recipient address is part of the claim digest.
- A link can be claimed once. After expiry, only the original sender can refund it.
- The implementation contract is locked against direct initialization.

The factory and implementation are deployed on Arc Testnet. Two live payment lifecycles are verified end to end. The latest proof uses Google authentication to recover a Circle user-controlled SCA, deploys the lazy wallet on Arc, signs the address-bound EIP-712 claim, and executes the claim from that wallet. The escrow reached `Claimed` with a zero balance and the recipient SCA received exactly 1 USDC. Production persistence is not included yet.

Arc Testnet deployment:

- Factory: [`0x8C377F5Bb508ece6De8090209619122edd4bC453`](https://testnet.arcscan.app/address/0x8C377F5Bb508ece6De8090209619122edd4bC453)
- Implementation: [`0x7003489E29F29E21d15200f61AD5C918E4BCE61C`](https://testnet.arcscan.app/address/0x7003489E29F29E21d15200f61AD5C918E4BCE61C)
- Deployment transaction: [`0xa805888c85d0d783617ed877228b32591488ef63dd37a7ac682787159a4c9060`](https://testnet.arcscan.app/tx/0xa805888c85d0d783617ed877228b32591488ef63dd37a7ac682787159a4c9060)

Verified cross-chain escrow funding:

- Escrow: [`0x5321E75Be8c1814C205eda13c26cDD067dc225BD`](https://testnet.arcscan.app/address/0x5321E75Be8c1814C205eda13c26cDD067dc225BD)
- Base Sepolia burn: `0xee5cf435e0b17874ed0b9415763d976ae2e20d4caf11be1b4e0154cef8fe62bf`
- Arc Testnet mint: [`0x9e1b8d1ff72ed2b4d4d133a14b90ef68875c76b068d0826d96b8aae96f913f31`](https://testnet.arcscan.app/tx/0x9e1b8d1ff72ed2b4d4d133a14b90ef68875c76b068d0826d96b8aae96f913f31)
- Verified escrow balance: **1 USDC**
- Arc Testnet claim: [`0xa2eb1fabb90d317dd187d2cb7d29cf67e39b819c1af2894610fa70b94c2d12a1`](https://testnet.arcscan.app/tx/0xa2eb1fabb90d317dd187d2cb7d29cf67e39b819c1af2894610fa70b94c2d12a1)
- Final state: **Claimed**, escrow balance **0 USDC**

Verified Circle recipient onboarding and claim:

- Escrow: [`0xFae2e1ed55aEf5D51fbc5de1fEeC8afAca14410B`](https://testnet.arcscan.app/address/0xFae2e1ed55aEf5D51fbc5de1fEeC8afAca14410B)
- Circle recipient SCA: [`0xecf09f594a229a95315f4dcbdbfc26c0a7709608`](https://testnet.arcscan.app/address/0xecf09f594a229a95315f4dcbdbfc26c0a7709608)
- SCA deployment transaction: [`0xdf4e98dc6bc5e4a3045dd3982813be20532ece04c5525ab13c66b14b8c6ffed2`](https://testnet.arcscan.app/tx/0xdf4e98dc6bc5e4a3045dd3982813be20532ece04c5525ab13c66b14b8c6ffed2)
- EIP-1271 claim transaction: [`0x8ecb1ad158790512c74abe59138c87fb49af1b3e18b55be8b099dc94fec66102`](https://testnet.arcscan.app/tx/0x8ecb1ad158790512c74abe59138c87fb49af1b3e18b55be8b099dc94fec66102)
- Final state: **Claimed**, escrow balance **0 USDC**, recipient balance **1 USDC**
- Non-secret evidence: [`deployments/arc-testnet-circle-claim.json`](./deployments/arc-testnet-circle-claim.json)

Contract checks:

```bash
npm run contracts:compile
npm run contracts:test
```

## Current Milestone

The implemented milestone is intentionally limited to same-chain Arc Testnet USDC payments. A seller creates a request in the browser, shares the generated URL, and a payer connects an injected EVM wallet to send USDC through Circle App Kit Send. The application then reads the Arc receipt and accepts payment only when the transaction succeeded and the official USDC contract emitted an exact transfer to the requested recipient for the requested base-unit amount.

Base Sepolia bridging, CCTP, and Unified Balance remain documented future work and are not present in the current source code.

## Verified Testnet Milestone

- Successful Arc Testnet USDC payment: **25 USDC**
- Transaction hash: `0x4f7a17dd033ea30628b8f3b5a8ec519920277731a7b8382153dc8c36515db379`
- ArcScan: https://testnet.arcscan.app/tx/0x4f7a17dd033ea30628b8f3b5a8ec519920277731a7b8382153dc8c36515db379
- Verified result: application reached `PAID` after checking the successful Arc receipt, official USDC transfer log, exact recipient, and exact requested amount.
- Negative validation: payer == recipient was correctly rejected.
- Local verification: lint, 14 unit tests, TypeScript, production build, and local runtime all passed in a normal Windows environment.
- Full evidence and test details: [`ARC_PAYLINK_TEST_REPORT.md`](./ARC_PAYLINK_TEST_REPORT.md)

This was a manual end-to-end test on Arc Testnet using a browser wallet and testnet funds. This milestone does not claim Base Sepolia bridging, Unified Balance, hosted deployment, or mainnet readiness.

## Run Locally

Requirements: Node.js 20.9 or newer and an npm-compatible environment.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. No API key, private key, seed phrase, or database is required. The official public Arc Testnet RPC is the default; copy `.env.example` to `.env.local` only when an RPC override is needed.

Quality checks:

```bash
npm run lint
npm test
npm run build
```

## Demo Flow

1. On the home page, enter a payment title, USDC amount, and Arc recipient address.
2. Create the payment link and share the resulting `/pay` URL.
3. On the payment page, connect an injected browser wallet such as MetaMask.
4. Approve adding or switching to Arc Testnet if the wallet requests it.
5. Submit the App Kit Send transaction and sign it in the wallet.
6. Wait while Arc PayLink fetches the receipt and checks transaction status, official USDC contract address, recipient, and exact six-decimal amount.
7. Open the verified transaction on ArcScan from the paid state.

Use only faucet-issued testnet USDC. Arc Testnet uses USDC for gas, while application token transfers use the official six-decimal ERC-20 interface at `0x3600000000000000000000000000000000000000`.

## Project Goal

Let a freelancer or seller create a fixed-price USDC request, share a link, and receive a payment on Arc Testnet through one of two clear routes:

1. **Same-chain:** Arc Testnet USDC is sent directly to the seller with Circle App Kit Send.
2. **Cross-chain:** Base Sepolia USDC is moved to the seller on Arc Testnet with Circle App Kit Bridge, which abstracts Circle CCTP.

The final screen is an Arc payment receipt that identifies the request, amount, recipient, source route, and successful destination transaction.

Success means the hosted demo can repeatedly create, pay, and verify one request without custody, manual explorer reconciliation, or custom bridge contracts by August 22, 2026.

## Target User

The primary user is a freelancer or small seller who wants to price and receive work in USDC on Arc while allowing a client to pay from either Arc Testnet or Base Sepolia.

The seller should not need to explain networks, copy transaction hashes, or manually determine whether bridged funds arrived. The payer chooses an available source balance; Arc PayLink handles the appropriate supported route.

## Core Problem

A payment request is currently fragmented across an amount, recipient address, wallet network, bridge UI, and block explorer. A payer may hold USDC on a different chain from the seller, while the seller still needs a reliable answer to one question: did the requested USDC arrive on Arc?

Arc PayLink turns that coordination into one link and one Arc-denominated result. It uses programmable money infrastructure to select an execution path from the payer's chain, move native USDC when necessary, and verify the destination settlement against the payment request.

## MVP Scope

### In scope

- Create an immutable request with a title, USDC amount, Arc recipient address, and unique request ID.
- Generate a shareable payment URL.
- Display the amount, Arc destination, supported source networks, and payment status.
- Connect a browser wallet through a Viem-compatible App Kit adapter.
- Detect whether the payer is using Arc Testnet or Base Sepolia.
- For Arc Testnet, call App Kit `send` to transfer USDC wallet-to-wallet on the same chain.
- For Base Sepolia, call App Kit `bridge` to transfer native USDC to the Arc recipient through CCTP.
- Track a compact state model: `ready`, `awaiting_wallet`, `processing`, `paid`, and `failed`.
- Verify the final Arc-side USDC transfer against the official token contract, expected recipient, and expected base-unit amount.
- Show an Arc receipt with source network, route, amount, recipient, destination transaction hash, and Arc explorer link.
- Prepare one funded same-chain demo and one funded Base-Sepolia-to-Arc demo.

### Out of scope

- Production accounts, teams, seller dashboards, notifications, refunds, disputes, or recurring billing.
- Mainnet deployment, fiat or card entry, swaps, non-USDC assets, or arbitrary source chains.
- Custodial wallets, private-key handling, custom bridge contracts, or direct low-level CCTP orchestration.
- Aggregating multiple chains in the primary flow.
- A production indexer or generalized accounting system.

## Arc/Circle Integration Plan

### Same-chain Arc USDC payment

Circle App Kit Send supports wallet-to-wallet token transfers on the same blockchain. When the payer is connected to Arc Testnet, Arc PayLink calls `kit.send` with `Arc_Testnet`, the seller's Arc address, the request amount, and the `USDC` token alias.

Arc is an EVM-compatible Layer 1 built for programmable money, uses USDC as its native gas token, and is currently available on testnet. The implementation must load current Arc RPC, explorer, and contract data from official documentation rather than copying unverified constants.

### Cross-chain Base Sepolia to Arc Testnet payment

Circle's official App Kit support table lists both Base Sepolia and Arc Testnet for Bridge. When the payer holds USDC on Base Sepolia, Arc PayLink calls App Kit Bridge with `Base_Sepolia` as the source and `Arc_Testnet` as the destination.

App Kit Bridge abstracts CCTP's low-level burn, attestation, and mint sequence. CCTP transfers native USDC by burning it on the source chain and minting it on the destination, without wrapped assets or traditional bridge liquidity pools. Circle documents both Base and Arc Testnet as supported CCTP domains; official testnets are included for listed mainnets, while Arc is testnet-only.

The product must present this as one processing flow, while preserving useful route and transaction progress for error recovery. Payment is complete only when the expected USDC is verifiably delivered to the seller on Arc Testnet.

### Primary flow: App Kit Bridge backed by CCTP

**Bridge/CCTP is the primary cross-chain flow.** It is the stronger three-day MVP choice because it maps one payment request to one explicit point-to-point native USDC transfer, App Kit provides a direct bridge method, and the final Arc delivery can be reconciled with a specific request and recipient. It requires no pre-existing Gateway deposit or separate unified-balance lifecycle.

The MVP uses App Kit rather than implementing CCTP contracts and attestation polling directly. This keeps the demo focused on payment execution and Arc receipt verification while retaining real Circle cross-chain infrastructure.

### Stretch goal: Unified Balance

App Kit Unified Balance is built on Circle Gateway. It combines deposited USDC from multiple supported chains into a single chain-agnostic balance that can be spent on another supported chain. The official example explicitly includes depositing USDC from Base and spending on Arc, and the support table lists Base Sepolia and Arc Testnet.

Unified Balance is a compelling follow-up for repeat payers or treasury-style users who have already deposited funds and want near-instant cross-chain spending. It is a stretch goal because a first-time PayLink payer must understand and complete a deposit before spending, and the MVP would need to represent deposit state, available unified balance, spend authorization, and recovery or withdrawal considerations. That extra lifecycle is less reliable for a three-day, single-payment demo than Bridge/CCTP.

If the primary flow is finished early, the stretch demo may allow a pre-funded Unified Balance to pay the same Arc request. It must not replace or delay the Bridge flow.

### Arc receipt verification

- Use the current official Arc Testnet network and USDC contract information.
- Store the payment request amount as integer USDC base units.
- Treat an SDK success response as progress, not final proof.
- Confirm the destination transaction succeeded on Arc and match the official USDC transfer to the request recipient and exact amount.
- Save the destination hash and route metadata, then link the receipt to the Arc Testnet explorer.
- Make a paid request immutable and reject a second transaction as fulfillment of the same request.

## Why This Is Programmable Money

Arc PayLink does more than display an address or embed a generic wallet transfer. The payment request is machine-readable intent: a fixed asset, amount, destination, and fulfillment rule. The application then selects a supported execution program based on where the payer's USDC exists:

- Arc USDC follows a same-chain Send route.
- Base Sepolia USDC follows a CCTP-backed Bridge route.
- Both routes converge on the same verifiable Arc settlement condition.

Money movement, cross-chain routing, and receipt reconciliation are composed into one deterministic product workflow. The seller specifies the economic outcome on Arc; the software executes and verifies the appropriate Circle-powered path without changing the requested unit of account or accepting a wrapped substitute.

## Technical Stack

- TypeScript end to end.
- Next.js App Router and React for request creation, payment, and receipt pages.
- Circle App Kit for Send and Bridge capabilities.
- App Kit's Viem adapter plus `viem` for browser-wallet access and Arc receipt/event reads.
- Tailwind CSS for fast interface execution.
- Zod for environment, request, and SDK-result validation.
- SQLite with Prisma locally, moving to a small persistent hosted Postgres database only if deployment storage requires it.
- Vitest for amount conversion, route selection, and receipt matching.
- Vercel for the hosted demo, after confirming Arc RPC behavior.

Dependencies will be selected only after checking the current App Kit installation and adapter documentation. Chain identifiers, RPC URLs, explorer URLs, USDC addresses, and CCTP contract addresses must not be guessed or stale-copied.

## 3-day Build Plan

### Day 1: Prove both real payment rails

- Confirm current official Arc Testnet, App Kit, USDC, and Base Sepolia support data.
- Create the minimal TypeScript/Next.js shell and wallet adapter configuration.
- Execute one Arc-to-Arc USDC payment with App Kit Send.
- Execute one Base-Sepolia-to-Arc USDC payment with App Kit Bridge.
- Capture SDK results and prove that the destination Arc transfer can be verified.

Exit criterion: both funded test wallets can deliver a known USDC amount to the same Arc recipient through the intended route.

### Day 2: Build the PayLink flow

- Add request creation and minimal persistence.
- Build the shareable request page and source-network detection.
- Route Arc to Send and Base Sepolia to Bridge.
- Add progress, wallet rejection, wrong-network, insufficient-balance, and bridge-failure states.
- Build exact Arc-side fulfillment verification and the receipt page.

Exit criterion: two browser sessions can create and fulfill a request through either source route without manual data changes.

### Day 3: Harden and present

- Refine mobile, loading, processing, failure, and success states.
- Add focused tests for USDC precision, route choice, and receipt matching.
- Deploy and repeat both flows against the official testnets.
- Pre-fund demo wallets and prepare backup evidence for a previously completed same-chain and cross-chain payment.
- Attempt a pre-funded Unified Balance route only after the primary demo is stable.

Exit criterion: the hosted demo reliably shows that USDC from Arc or Base Sepolia can fulfill one Arc PayLink and produce a verified Arc receipt.

## Risks / Unknowns

- Arc and Circle testnet configuration, SDK behavior, contract addresses, faucets, fees, and support matrices can change. Re-check official docs immediately before implementation and demo day.
- App Kit package/API signatures may evolve. Implement against the installed version's official reference and lock versions after the first successful flows.
- The Base Sepolia Bridge flow is asynchronous and may expose separate source, attestation, and destination phases. The UI needs bounded progress and retry guidance.
- Testnet USDC or Arc gas funding may be rate-limited. Fund both demo routes early; Arc uses USDC for gas.
- A source-chain transaction is not proof of payment. Only the verified destination Arc transfer fulfills the request.
- Decimal mistakes can misprice requests. Use integer base units and test conversions.
- Wallet network switching may fail or be rejected. Preserve the request and offer a clear retry.
- Unified Balance introduces deposits, spend authorization, and fund-removal considerations. Keep it out of the critical path.
- Public links expose non-sensitive payment metadata. Do not collect client names, invoices, or personal information in the MVP.
- Hosted storage must persist across sessions. Confirm the deployment database before final rehearsal.

## Official Documentation Used

Technical assumptions in this plan were checked against official Arc and Circle documentation on August 12, 2026:

- Arc documentation index and network guidance: https://docs.arc.io/llms.txt
- Arc App Kit overview: https://docs.arc.io/app-kit.md
- App Kit Send: https://docs.arc.io/app-kit/send.md
- App Kit Bridge: https://docs.arc.io/app-kit/bridge.md
- App Kit Unified Balance: https://docs.arc.io/app-kit/unified-balance.md
- App Kit supported blockchains and tokens: https://docs.arc.io/app-kit/references/supported-blockchains.md
- Circle documentation index: https://developers.circle.com/llms.txt
- Circle CCTP overview: https://developers.circle.com/cctp.md
- CCTP supported chains and domains: https://developers.circle.com/cctp/concepts/supported-chains-and-domains.md
- Official USDC contract-address reference to check during implementation: https://developers.circle.com/stablecoins/usdc-contract-addresses.md
- Official Arc contract-address reference to check during implementation: https://docs.arc.io/arc/references/contract-addresses.md

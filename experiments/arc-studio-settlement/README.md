# Arc Studio settlement experiment

> **Scope boundary:** This is an isolated Arc Studio experiment and is **not** the canonical Arc PayLink product, production deployment, or replacement for the escrow/claim-link architecture on `main`.

## Purpose

This experiment evaluated how far Arc Studio could take a plain-English USDC payment-link idea through contract generation, iteration, compilation, contract inspection, and deployment. Arc Studio produced the prototype and deployed it to Arc Testnet. A separate, deliberately small Arc Mainnet smoke test was then executed through Remix to validate the generated settlement contract with real USDC.

## What Arc Studio contributed

- Prompt-to-project scaffolding for an Arc USDC payment-link prototype.
- A `PayLinkSettlement` contract with request creation, bounded payment, cancellation/closure, request inspection, and explicit status reporting.
- Contract compilation artifacts and ABI inspection inside the Studio workspace.
- Iterative contract and application refinement.
- Arc Testnet deployment and contract metadata:
  - Contract: [`0x10495fc18e4d38d31f83e3d469e8f3e1e5fd7826`](https://explorer.testnet.arc.io/address/0x10495fc18e4d38d31f83e3d469e8f3e1e5fd7826)
  - Deployment transaction: [`0x44ae52e2787f21448be50205d7f0cfff4d5b7a4f54963a70b4051414e5d5a121`](https://explorer.testnet.arc.io/tx/0x44ae52e2787f21448be50205d7f0cfff4d5b7a4f54963a70b4051414e5d5a121)

## Arc Mainnet smoke test

Date: 2026-10-06  
Network: Arc Mainnet (`5042`)  
Official Arc USDC: `0x3600000000000000000000000000000000000000`

| Item | Evidence |
| --- | --- |
| Experimental settlement contract | [`0x685C78cD28FBC788D70962B67fEF1691ef9f18cD`](https://explorer.arc.io/address/0x685C78cD28FBC788D70962B67fEF1691ef9f18cD) |
| Request creation | [`0xfffe4eac13789deb6b1a4d4d387f64bf2bd4a2adce3539210bb5f4ef755b154d`](https://explorer.arc.io/tx/0xfffe4eac13789deb6b1a4d4d387f64bf2bd4a2adce3539210bb5f4ef755b154d) |
| Exact allowance (`0.01 USDC`) | [`0x43bfdd0c843c1398b1a9dea0c8b5a59c52d55d8217285a5353b48f84ba5db888`](https://explorer.arc.io/tx/0x43bfdd0c843c1398b1a9dea0c8b5a59c52d55d8217285a5353b48f84ba5db888) |
| Payment | [`0xc70fd448f7d10028593f1e58be51299b458eb3e6bcace0e2b6fe9c67b773b9ae`](https://explorer.arc.io/tx/0xc70fd448f7d10028593f1e58be51299b458eb3e6bcace0e2b6fe9c67b773b9ae) |
| Request key | `0x057408c61f8ec23aaacec0c62b8386440bc2a6a4211b40ddc60a398e2a8336d1` |
| Final contract status | `3` — fully paid and closed |

### Verified flow

1. Created a request for `10,000` USDC base units (`0.01 USDC`).
2. Approved only `10,000` base units to the experimental settlement contract; no unlimited allowance was used.
3. Paid the request to a separate recipient address.
4. Observed the USDC transfer and the contract payment event in the same mainnet transaction.
5. Read `status(requestKey)` and received `uint8: 3`, confirming that the request was fully paid and closed.

## What this experiment does not claim

- It is not the production Arc PayLink factory or escrow deployment.
- It does not replace Arc PayLink's private single-use claim links, Google-authenticated Circle wallet onboarding, EIP-1271 recipient authorization, expiry/refund controls, creator recovery, or production frontend.
- The Arc Mainnet transaction was executed through Remix after the Arc Studio prototype phase; it should not be described as an Arc Studio mainnet deployment.
- The experiment demonstrates a smaller direct-settlement contract and a successful real-value smoke test only.

## Takeaway

Arc Studio materially reduced the time from idea to compiled and testnet-deployed prototype. Human review and a separate wallet-controlled mainnet validation were still required for the real-value path. The useful result is therefore both the working experiment and a clear boundary between rapid Studio prototyping and the separately maintained production Arc PayLink system.

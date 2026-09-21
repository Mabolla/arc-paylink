# Arc PayLink Mainnet Microgrants Evidence

Status: **LIVE MAINNET PILOT — public application and acceptance flow verified**

This document tracks the isolated Arc mainnet pilot. It does not replace or modify the preserved V3 and V3.1 testnet evidence.

## Preserved baselines

- V3 branch: `release/v3.0.0`
- V3 commit: `215d3476afe26882b8575cfa26bf90ee56ba9452`
- V3.1 baseline commit: `d7ef4bafb7919be6f392916b0baeac5a0e3a7a2e`
- Mainnet work branch: `feat/mainnet-microgrants`

## Mainnet scope

- One invoice obligation ID
- Exact Arc USDC amount and recipient
- Receipt-verified settlement and visible lifecycle state
- Pending-only revoke and revoke-and-replace with no automatic fund movement
- A new obligation ID for every replacement
- Non-custodial walletless claim proof

Excluded from the first mainnet pilot: combined obligation types, production PII, bridge UI, complex escrow automation, automatic refund/retry/top-up, x402, Arc Studio contract rebuilds, and deterministic recovery UI.

## Read-only network preflight

Verified on 2026-09-18 without a funded wallet or transaction:

| Check | Expected | Result |
| --- | --- | --- |
| Arc chain ID | `5042` | PASS |
| Arc RPC | `https://rpc.mainnet.arc.io` | PASS |
| Arc USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` | PASS — bytecode present |
| Arc USDC ERC-20 decimals | `6` | PASS |
| Circle Wallets chain code | `ARC` | PASS — Circle lists Arc mainnet user-controlled EOA and SCA support |

Native Arc USDC uses 18 decimals for gas accounting. Arc PayLink payment obligations use only the 6-decimal ERC-20 interface.

## Release gates

The mainnet application must not be described as live until every required gate is complete.

| Gate | State | Evidence |
| --- | --- | --- |
| Application and contract regression suite | PASS | 125 Vitest tests and 13 Hardhat tests |
| Mainnet production build | PASS | `NEXT_PUBLIC_ARC_NETWORK=mainnet npm run build` |
| Mainnet deployment safety latch | PASS | Deployment refuses without the explicit confirmation value |
| Active V2 factory and implementation deployment | PASS | Factory `0x23c6DAed3617812249C3b9A3Db8525532D0787B9`; implementation `0xA51932CB63aF7B1Bb5d401eaA4052ED17194E760`; transaction `0x430c4cfb2dd859efa2e9468d9023c8a53e591e146947a6c28378c2ab5c32e249`; block `21876743`; `deployments/arc-mainnet-escrow-v2.json` |
| Source/bytecode verification | PASS | `npm run contracts:verify:arc-mainnet` matches the implementation exactly and the factory outside compiler-linked immutable slots; getters confirm the implementation and Arc USDC addresses |
| Isolated live mainnet application | PASS | `https://arc-paylink-two.vercel.app`; public HTTP 200; production sender flow identifies Arc and `USDC · Mainnet pilot` |
| Exact direct-USDC settlement | PASS | Request `fea1571a-17ef-42f4-aae2-875916552165`, obligation `MICROGRANT-PILOT-SETTLE-001`; exact `0.01 USDC` transfer `0xed753a04b8fc731599d636bf1be0f750917c362f110fa61acb06d4481b542c61`; block `21700478`; managed request status `settled` |
| Pending revoke | PASS | Replacement request `0cd59ec5-f2f2-4442-a7af-a0c0c6da42f2` (`MICROGRANT-PILOT-REV-002`) moved from `pending` to `revoked` without a transaction |
| Revoke-and-replace | PASS | Original request `3f03485a-f4b4-44f2-91cf-63e38370ca98` (`MICROGRANT-PILOT-REV-001`) is `replaced`; replacement has a new request ID and new obligation ID `MICROGRANT-PILOT-REV-002` |
| 0.01 USDC walletless acceptance flow | PASS | Separate Google recipient; Circle user-controlled SCA deployment; address-bound EIP-1271 claim; recipient balance display and transfer; creator recovery from a clean browser |
| Base to Arc mainnet bridge/claim evidence | PENDING | Kept outside the public first-slice UI |

## Safety invariants

- Mainnet requires explicit network selection and an explicit deployment confirmation value.
- Mainnet request and settlement storage is namespaced by chain ID.
- One settlement transaction hash can be assigned to only one managed request.
- Mainnet requests expose only direct Arc invoice payments.
- The server never receives a user private key or seed phrase.
- Recovery metadata never initiates a transaction.
- Secrets and private claim packages must never be published in evidence.

## Published evidence

1. Source commit and deployment provenance.
2. Factory address, implementation address, deployment transaction, block number, and timestamp.
3. Deployed bytecode and immutable configuration verification.
4. Live application URL and mainnet product surface.
5. Exact settlement transaction and obligation record.
6. Revoke and revoke-and-replace lifecycle records.
7. Redacted walletless acceptance record; no claim secret or recipient PII is published.
8. Automated application, contract, and production-build verification.

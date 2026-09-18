# Arc PayLink Mainnet Microgrants Evidence

Status: **CONDITIONAL — mainnet pilot implementation in progress**

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

Native Arc USDC uses 18 decimals for gas accounting. Arc PayLink payment obligations use only the 6-decimal ERC-20 interface.

## Release gates

The mainnet application must not be described as live until every required gate is complete.

| Gate | State | Evidence |
| --- | --- | --- |
| Testnet regression suite | PASS | 80 Vitest tests and 8 Hardhat tests |
| Mainnet production build | PASS | `NEXT_PUBLIC_ARC_NETWORK=mainnet npm run build` |
| Mainnet deployment safety latch | PASS | Deployment refuses without the explicit confirmation value |
| Factory and implementation deployment | PENDING | Explorer links and deployment JSON |
| Source/bytecode verification | PENDING | Explorer verification links and bytecode match |
| Exact direct-USDC settlement | PENDING | Transaction hash and managed request status |
| Pending revoke | PENDING | Request ID and lifecycle evidence |
| Revoke-and-replace | PENDING | Old and replacement obligation IDs |
| 0.01 USDC walletless claim | PENDING | Escrow, EIP-1271 claim, and recipient balance evidence |
| Base to Arc mainnet bridge/claim evidence | PENDING | Kept outside the public first-slice UI |

## Safety invariants

- Mainnet requires explicit network selection and an explicit deployment confirmation value.
- Mainnet request and settlement storage is namespaced by chain ID.
- One settlement transaction hash can be assigned to only one managed request.
- Mainnet requests expose only direct Arc invoice payments.
- The server never receives a user private key or seed phrase.
- Recovery metadata never initiates a transaction.
- Secrets and private claim packages must never be published in evidence.

## Evidence to append after deployment

1. Source commit and release tag.
2. Factory address, implementation address, deployment transaction, block number, and timestamp.
3. Verified source and deployed bytecode comparison.
4. Live application URL and environment fingerprint.
5. Exact settlement transaction and obligation record.
6. Revoke and revoke-and-replace lifecycle exports.
7. Walletless claim transaction and redacted Circle SCA evidence.
8. Test output and mainnet smoke-test record.


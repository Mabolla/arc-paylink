# Arc PayLink — Verified Test Report

## Status

**Milestone: PASS — local runtime + production build + real Arc Testnet payment verified.**

This report records the first complete end-to-end verification of the current Arc PayLink implementation. The test was performed locally against Arc Testnet with a browser wallet and testnet USDC.

## Environment

- Project: Arc PayLink v2
- Repository: `Mabolla/arc-paylink`
- Network: Arc Testnet
- Chain ID: `5042002`
- Runtime: Next.js 16.3.0
- Node.js: 24.19.0
- Platform: Windows x64

## Automated / Local Checks

| Check | Result |
|---|---|
| `npm install` | PASS |
| ESLint / `npm run lint` | PASS |
| Unit tests / `npm test` | PASS — 3 test files, 14 tests |
| TypeScript / `npx tsc --noEmit` | PASS |
| Production build / `npm.cmd run build` | PASS |
| Local dev runtime | PASS — `http://localhost:3000` |

The Codex sandbox could not create Node child processes and returned `spawn EPERM`. A direct Node child-process test returned `exit 0` in a normal Windows PowerShell environment, confirming that this was a Codex execution-environment restriction rather than an application or Node installation failure.

## Real Arc Testnet E2E Test

### Payment request

- Title: `Arc Test Payment`
- Amount: `25 USDC`
- Recipient: `0xB7af2334f788CFCa498f145b491400c812891468`
- Network: Arc Testnet

### Payment execution

A separate payer wallet was connected and submitted the payment. The application correctly rejected the earlier invalid test where payer and recipient were the same address. After using a separate recipient, the 25 USDC payment was submitted successfully.

### On-chain evidence

Transaction hash:

`0x4f7a17dd033ea30628b8f3b5a8ec519920277731a7b8382153dc8c36515db379`

ArcScan:

https://testnet.arcscan.app/tx/0x4f7a17dd033ea30628b8f3b5a8ec519920277731a7b8382153dc8c36515db379

The application displayed:

- `PAID`
- `Payment verified on Arc Testnet.`
- the destination transaction link

The implementation's receipt verification confirmed the successful transaction, official USDC transfer log, requested recipient, and exact requested amount before accepting the payment as fulfilled.

## Negative / Validation Test

The first payment attempt intentionally used the same wallet as payer and recipient. The application rejected it with:

`Expected a different address than the sender.`

This confirms that the payer/recipient separation rule is enforced before the payment can be fulfilled.

## What This Milestone Proves

- A seller can create a shareable Arc PayLink.
- A payer can connect a browser wallet.
- The application can execute a same-chain Arc Testnet USDC payment.
- The payer and recipient are required to be different addresses.
- The requested amount is represented and checked as USDC base units.
- The application waits for the Arc receipt and verifies settlement rather than treating an SDK success response as final proof.
- The official USDC transfer log is checked for recipient and exact amount.
- A successful verified payment transitions the request to `PAID`.
- The resulting Arc transaction can be opened from the payment receipt.

## Changes Required for Build Verification

The only tracked source changes made during this verification were:

- `src/app/layout.tsx`
- `src/app/globals.css`

They remove the `next/font/google` build-time dependency and use local/system font fallbacks instead. This was required because the restricted build environment could not fetch Google Fonts. No wallet, payment, Arc RPC, USDC, or receipt-verification logic was changed.

Commit:

`c70669a fix: remove build-time Google Fonts dependency`

## Not Yet Proven by This Milestone

- Base Sepolia → Arc cross-chain Bridge/CCTP flow
- Unified Balance
- Hosted deployment
- Arc Mainnet / production payments
- Production persistence

These remain separate future milestones and are intentionally not treated as complete.

## Builder Lesson

The PayLink MVP is considered verified only after the full chain is demonstrated:

**build → local runtime → real testnet transaction → on-chain settlement verification → receipt evidence → GitHub record**

A successful UI render or wallet SDK response alone is not considered sufficient proof of payment fulfillment.

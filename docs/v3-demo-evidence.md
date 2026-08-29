# Arc PayLink V3 demo evidence

This file records reproducible, non-secret evidence for the safe V3 milestone. Testnet transactions are real Arc Testnet executions. The shared-settlement audit fixture is synthetic and contains no private package, API key, raw CCTP message, or attestation bytes.

## Walletless recipient claim

| Evidence | Value |
| --- | --- |
| Escrow | [`0xFae2e1ed55aEf5D51fbc5de1fEeC8afAca14410B`](https://testnet.arcscan.app/address/0xFae2e1ed55aEf5D51fbc5de1fEeC8afAca14410B) |
| Google-authenticated Circle SCA | [`0xecf09f594a229a95315f4dcbdbfc26c0a7709608`](https://testnet.arcscan.app/address/0xecf09f594a229a95315f4dcbdbfc26c0a7709608) |
| SCA deployment | [`0xdf4e98dc6bc5e4a3045dd3982813be20532ece04c5525ab13c66b14b8c6ffed2`](https://testnet.arcscan.app/tx/0xdf4e98dc6bc5e4a3045dd3982813be20532ece04c5525ab13c66b14b8c6ffed2) |
| EIP-1271 claim | [`0x8ecb1ad158790512c74abe59138c87fb49af1b3e18b55be8b099dc94fec66102`](https://testnet.arcscan.app/tx/0x8ecb1ad158790512c74abe59138c87fb49af1b3e18b55be8b099dc94fec66102) |
| Result | Escrow claimed; recipient received exactly 1 USDC |

The recipient authenticated with Google, Circle secured the user-controlled SCA, the lazy wallet was deployed on Arc Testnet, and the SCA approved the address-bound claim. Arc PayLink never received a private key.

## Private shared audit fixture

| Evidence | Value |
| --- | --- |
| Production service | `https://arc-paylink-two.vercel.app` |
| Correlation ID | `0x3bce0692d4b8d2d9ef27b8af5718e89022d7cfe8d5380a77ba12722b0b0d6751` |
| Obligation | `invoice / LIVE-BLOB-TEST-1` |
| Storage | Private, content-addressed Vercel Blob record |
| Correct lookup | HTTP 200; immutable record verified |
| Wrong obligation | HTTP 404; `recordDisclosed: false` |
| Duplicate identical write | Idempotent; original record preserved |
| Conflicting write | HTTP 409; both records preserved for manual review |

## Controlled recovery proof

The settled fixture returned the deterministic plan ID `0x4866656262b77b599cffb318f210657fa09ea36d91ecfc0faacd95134694492e` with:

```json
{
  "status": "no-action",
  "action": "none",
  "fundMovement": false,
  "executable": false
}
```

`GET /api/settlements/recover` returns HTTP 405. The only supported operation is a controlled `POST` that requires the exact correlation ID, obligation reference, and source payment reference. It creates a plan, never a transaction.

## Exception matrix

| Case | Verified behavior |
| --- | --- |
| Wrong payment reference | HTTP 404; no settlement data disclosed |
| Already settled | `no-action` |
| Conflicting immutable records | HTTP 409; no record selected |
| Partial settlement | Exact `outstandingBaseUnits` top-up plan |
| Mismatched settlement | HTTP 202; `manual-review` |
| Repeated recovery request | Same deterministic plan ID |

## Quality gate

- 65 application tests passed.
- 8 escrow contract tests passed.
- ESLint passed.
- TypeScript passed with no emit.
- Next.js production build passed.
- Vercel preview and production deployments passed for the recovery API milestone.

The final V3 packaging deployment must repeat this quality gate and verify the `/audit` recovery screen in production before V3 is marked complete.

# Arc PayLink security, privacy, and trust boundary

This document describes the implemented walletless PayLink flow. It is a release constraint, not a marketing claim.

## Authorization model

- The escrow accepts a claim only when the caller supplies the private 32-byte link secret and a valid EIP-712 signature from the recipient address.
- The recipient address is therefore bound to the claim transaction; possession of the link alone cannot redirect funds without a signature from the destination wallet.
- The intended email address is not stored onchain and is not a contract-level authorization factor. Google/Circle email matching is an additional application control. The private claim link remains a bearer secret and must be sent only to the intended recipient.
- A party that obtains the complete private link and bypasses the application could attempt a direct contract claim to a wallet they control. Product copy must not describe the current contract as cryptographically email-bound.

## Secret handling

- New claim secrets are generated in the sender's browser.
- The recipient link stores the private package in the URL fragment. Fragments are not included in HTTP requests.
- The application removes the fragment from browser history after loading it and keeps the active package in session storage through the Google redirect.
- The plaintext claim secret is never included in creator API records, server logs, analytics payloads, or onchain metadata.
- Automatic server-side email delivery is intentionally disabled because it would disclose the full private claim link to the application backend and email provider. The current mail draft is composed locally under the sender's control.

## Creator recovery

- The sender signs a stable, payment-specific recovery message that explicitly cannot move funds.
- The browser derives an AES-GCM-256 key from that signature and encrypts the private claim package locally.
- The server stores only the ciphertext, a management-token hash, non-secret creator metadata, and independently verified Arc transaction evidence.
- Restoring in another browser requires the payment ID and the original sender wallet. The same recovery signature derives the management capability and decryption key locally.
- Records created before encrypted recovery was introduced cannot be retroactively restored if their only local secret copy is lost.

## Server and chain validation

- Creator registration requires a fresh sender signature and verifies the trusted factory, official Arc USDC token, payment ID, escrow address, amount, expiry, secret hash, funded state, factory creation event, and exact sender-to-escrow funding transfer.
- Recipient Circle operations verify that the Circle session owns the selected Arc wallet and re-read the claim context from Arc before deployment, signing, or execution.
- Claim completion is not shown from a local callback alone. The application confirms the Arc transaction and escrow state, and stores receipts per escrow.

## PII and retention

- Recipient email, title, and reference are stored only in the creator's local record and private server-side creator record. They are not written onchain.
- Public recovery context exposes only already-public chain identifiers: factory, payment ID, escrow, and sender.
- A production release still requires an explicit retention/deletion period and user-facing privacy notice. Those are open release gates.

## Remaining release controls

- Configure durable atomic rate limiting at the deployment layer; Vercel Blob is not an atomic rate-limit counter.
- Rotate any credential or 2FA seed exposed during setup and retain evidence of rotation.
- Complete dependency review, contract review, mobile testing, and 3–5 independent clean-account mainnet runs.
- Validate encrypted recovery, expiry/refund, rejected approval, interrupted redirect, and slow-confirmation behavior on the deployed build.

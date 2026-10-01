# Account configuration and release acceptance

Status observed on 2026-10-01 UTC / 2026-10-02 Europe/Istanbul. Google preview sign-in and Circle wallet readback pass. The account owner also reports a successful Circle subscription activation retest after correcting its signing-key read permission; subscription metadata and real payment notification acceptance are still pending. Existing production and `main` remain unchanged.

## Google / Circle embedded customer checkout

The preview's Google login initially returned `400 redirect_uri_mismatch`. This historical failure was later resolved after the account owner added the exact preview callback to the Google OAuth redirect allowlist and approved the Google sign-in. The current public OAuth client is:

```text
502826689977-dg922ghg177oibp3ep2b5scvmdegafka.apps.googleusercontent.com
```

The additional exact authorized redirect URI used by the successful preview sign-in is:

```text
https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app/wallet
```

If an authorized JavaScript origin is required for this client, the matching origin is:

```text
https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app
```

Existing entries must be retained. Do not redirect preview authentication through the production wallet page; the order return state belongs to the preview origin. A wildcard is not a valid redirect URI. The same web client ID must be configured in Circle's Wallets → User Controlled → Configurator → Google Client ID (Web). The deployed App ID and server API key must belong to that configuration and support the selected Arc network. A configured environment variable is not proof of account authorization or network support.

Passed acceptance: on the actual preview `/wallet` page, the authorized Google account completed sign-in and connected its Circle user-controlled wallet `0xcffc8fee9d782497fdb74909a3843948df34df31`. The page displayed `Wallet connected. Your balance is read directly from Arc.` and an Arc balance of **0 USDC**. This is a real authenticated wallet readback, not a simulated checkout or payment. Evidence: [sanitized Google/Circle sign-in record](evidence/collections-google-auth.json) and [connected wallet screenshot](evidence/collections-google-auth.jpg).

Remaining payment acceptance: open a new preview order with that authenticated account, fund the customer wallet with sufficient USDC, approve the exact order payment and verify its receipt through both checkout and scoped merchant MCP. No new transfer occurred during the sign-in check, and verified external customers remain **0**. Successful wallet connection alone does not prove a purchase or Circle notification delivery. Card/fiat funding is not implemented.

Historical console attempt: the Google management console returned `Site Unavailable` in this execution environment, and the agent changed no OAuth setting during that attempt. The account owner subsequently added the callback through their own console session; the later successful preview sign-in supersedes the earlier unresolved redirect gate. No credential, token or API key was extracted.

Official sources: [Google OAuth client settings](https://support.google.com/cloud/answer/15549257), [Circle wallet app setup](https://developers.circle.com/wallets/user-controlled/build-a-wallet-app).

## Circle signed outbound notifications

Restricted subscription configuration, on the existing owning Wallets API account; actual enabled metadata still needs to be retained:

```json
{
  "endpoint": "https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app/api/checkout/webhooks/circle",
  "notificationTypes": ["transactions.outbound"]
}
```

List existing subscriptions before creating one; reuse an identical enabled subscription rather than duplicating it. The endpoint must be publicly reachable over HTTPS. It requires Circle's `X-Circle-Key-Id` and `X-Circle-Signature`, verifies the raw body using Circle's public key, matches the reserved wallet/order, then independently verifies the exact Arc transfer. Unsigned requests remain rejected. The account's existing outbound events may include unrelated transactions; these are ignored. Do not broaden the subscription to every event or export the account's API key into public code.

Acceptance: retain the subscription ID and enabled status; complete a Circle-backed internal order with its customer tab closed after submission; observe the signed notification; confirm the order becomes paid without browser polling; replay the notification and confirm one receipt event only. A locally signed fixture or the EOA pilot cannot substitute for Circle's real delivery.

Historical console attempt: Circle Console displayed `This is a protected area` and denied this browser on the initial request and one reload. No alternate route was tried, and the agent created no subscription during that attempt. The browser restriction is specific to this environment; it does not establish that the user's account lacks access.

Later account-owner setup exposed a separate permission issue. The existing mainnet restricted API key showed **Webhooks: No Permissions** and **Wallets: Read + Write**. During an actual signed activation test, the deployed handler returned HTTP **502** because its Circle signing-key lookup (`GET /v2/notifications/publicKey/<key-id>`) returned HTTP **403**, provider error code **3**. The handler did not acknowledge an unverified signature or record a payment.

The account owner then saved **only Webhooks: Read Only** on that same key, preserving Wallets permissions, the key itself and the IP policy. The owner subsequently reported that the activation retest turned green. This is an owner-reported successful activation test; the enabled subscription screenshot and subscription ID have not yet been retained. It does not establish delivery of a paid-order event, browser-independent order completion or live replay deduplication. No key, prefix, raw provider log or console screenshot is included in this record.

Ten additional webhook HTTP tests passed locally. They cover signed activation acknowledgement, unsigned or altered bodies, signing-key permission/not-found/unavailable failures, missing credentials, mismatched key metadata, unsupported algorithms and an unrelated signed outbound sample without inventing a payment. These fixtures validate handler behavior; they are not real Circle delivery evidence. No new funds were transferred during permission troubleshooting; verified external customers remain **0**.

Official sources: [subscription API](https://developers.circle.com/api-reference/contracts/common/create-subscription), [signature public key](https://developers.circle.com/api-reference/wallets/common/get-notification-signature).

## Browser-independent company agent

The [reference watcher](COLLECTIONS_WATCH.md) is implemented. Two actual deployed one-shot passes observed the already-paid internal order, kept its exact receipt and suppressed a duplicate. Its temporary reader key was revoked. This closes read-only worker acceptance, not deployment of a continuously running service.

Production scheduling still requires a selected worker host, a scoped reader key stored as a host secret, and persistent checkpoint storage. One worker must own each checkpoint; downstream consumers deduplicate by event ID. The website and MCP connection do not start a process by themselves. No recurring service or new persistent credential has been silently provisioned.

The company panel now implements an owner-only **Check now** action for an immediate server scan. It creates a temporary reader key for that workspace, calls the existing monitor refresh endpoint and attempts revocation in cleanup; leaving the page triggers best-effort cleanup. Failed cleanup is surfaced for retry, and an interrupted browser session can leave a key that must be checked in Agent access. Workspace changes reset the local key/setup state. Users do not have to construct API requests or install a worker to request this one-shot check. The action does not activate recurring scheduling or send funds.

Targeted lint, TypeScript and production build checks and six mocked UI lifecycle checks passed. Live deployed **Check now** UI acceptance remains pending. Integration verification passed on the exact source being published: 248 application tests, 13 contract tests, full lint, production build (including TypeScript) and `git diff --check`. Live deployed UI acceptance remains a separate gate.

## Separate payer-side Circle Agent Wallet

Its local policy, human approval, durable reservation and reconciliation tests pass. Live CLI acceptance still requires explicit service-terms consent, an authenticated `type: agent` wallet on Arc, funds, and an approved exact test transfer. The existing GitHub signer is an EOA; Circle CLI imports it as `type: local`, which cannot meet the Agent Wallet preflight. The adapter disables optional telemetry and strips inherited automatic terms acceptance. No new login or transfer was attempted to bypass that gate.

## Definition of a complete release

| Gate | Current evidence |
| --- | --- |
| Existing-wallet collection → receipt → business → merchant MCP | Passed, one internal 0.01-USDC mainnet payment |
| Existing-wallet browser approval and recovery | Live extension UI acceptance pending; the real EOA test used the API/GitHub signer |
| Read-only worker persistence and duplicate suppression | Passed, two actual deployed one-shot reads |
| Hosted monitor owner API → report → merchant MCP | Passed, two recorded complete scans of the existing internal receipt |
| Company panel Check now | Implemented; targeted checks and six mocked lifecycle checks passed, live UI acceptance pending |
| Google sign-in → Circle wallet → Arc balance readback | Passed after the account owner added the preview callback; connected wallet showed 0 USDC |
| Google / Circle authenticated customer payment | Wallet funding, exact purchase approval and receipt acceptance pending; sign-in is verified separately |
| Circle signed activation test | Owner reports a green retest after Webhooks Read Only was enabled; subscription ID and enabled metadata pending |
| Circle notification with customer browser closed | Real paid-order notification and live replay acceptance pending; activation success alone is insufficient |
| Continuously scheduled worker | Host provisioning pending |
| Separate Circle payer extension | Local tests passed; live CLI gate pending |
| Stable production release | Draft PR only; main untouched |

The real receipt and watcher evidence are valid now. They do not make the unverified gates complete or establish customer traction.

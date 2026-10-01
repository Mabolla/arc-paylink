# Account configuration and release acceptance

Status observed on 2026-10-01. These are exact proposed settings and acceptance criteria, not a claim that account settings have been applied. Existing production and `main` remain unchanged.

## Google / Circle embedded customer checkout

The preview's Google login returned `400 redirect_uri_mismatch`. The current public OAuth client is:

```text
502826689977-dg922ghg177oibp3ep2b5scvmdegafka.apps.googleusercontent.com
```

The existing web client needs this additional exact authorized redirect URI:

```text
https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app/wallet
```

If an authorized JavaScript origin is required for this client, the matching origin is:

```text
https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app
```

Existing entries must be retained. Do not redirect preview authentication through the production wallet page; the order return state belongs to the preview origin. A wildcard is not a valid redirect URI. The same web client ID must be configured in Circle's Wallets → User Controlled → Configurator → Google Client ID (Web). The deployed App ID and server API key must belong to that configuration and support the selected Arc network. A configured environment variable is not proof of account authorization or network support.

Acceptance: open a new preview order; authenticate with the authorized test account; create or recover its Circle user-controlled wallet; confirm the wallet's Arc network and USDC balance; approve the exact order payment; verify the receipt through both the checkout and scoped merchant MCP. A newly created empty wallet cannot buy without USDC. Card/fiat funding is not implemented.

The Google management console returned `Site Unavailable` in this execution environment. No OAuth setting was changed. No credential, token or API key was extracted.

Official sources: [Google OAuth client settings](https://support.google.com/cloud/answer/15549257), [Circle wallet app setup](https://developers.circle.com/wallets/user-controlled/build-a-wallet-app).

## Circle signed outbound notifications

Proposed restricted subscription, on the existing owning Wallets API account:

```json
{
  "endpoint": "https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app/api/checkout/webhooks/circle",
  "notificationTypes": ["transactions.outbound"]
}
```

List existing subscriptions before creating one; reuse an identical enabled subscription rather than duplicating it. The endpoint must be publicly reachable over HTTPS. It requires Circle's `X-Circle-Key-Id` and `X-Circle-Signature`, verifies the raw body using Circle's public key, matches the reserved wallet/order, then independently verifies the exact Arc transfer. Unsigned requests remain rejected. The account's existing outbound events may include unrelated transactions; these are ignored. Do not broaden the subscription to every event or export the account's API key into public code.

Acceptance: retain the subscription ID and enabled status; complete a Circle-backed internal order with its customer tab closed after submission; observe the signed notification; confirm the order becomes paid without browser polling; replay the notification and confirm one receipt event only. A locally signed fixture or the EOA pilot cannot substitute for Circle's real delivery.

Circle Console displayed `This is a protected area` and denied this browser on the initial request and one reload. No alternate route was tried, no subscription was created, and delivery is unverified. The browser restriction is specific to this environment; it does not establish that the user's account lacks access.

Official sources: [subscription API](https://developers.circle.com/api-reference/contracts/common/create-subscription), [signature public key](https://developers.circle.com/api-reference/gateway/all/get-notification-signature).

## Browser-independent company agent

The [reference watcher](COLLECTIONS_WATCH.md) is implemented. Two actual deployed one-shot passes observed the already-paid internal order, kept its exact receipt and suppressed a duplicate. Its temporary reader key was revoked. This closes read-only worker acceptance, not deployment of a continuously running service.

Production scheduling still requires a selected worker host, a scoped reader key stored as a host secret, and persistent checkpoint storage. One worker must own each checkpoint; downstream consumers deduplicate by event ID. The website and MCP connection do not start a process by themselves. No recurring service or new persistent credential has been silently provisioned.

## Separate payer-side Circle Agent Wallet

Its local policy, human approval, durable reservation and reconciliation tests pass. Live CLI acceptance still requires explicit service-terms consent, an authenticated `type: agent` wallet on Arc, funds, and an approved exact test transfer. The existing GitHub signer is an EOA; Circle CLI imports it as `type: local`, which cannot meet the Agent Wallet preflight. The adapter disables optional telemetry and strips inherited automatic terms acceptance. No new login or transfer was attempted to bypass that gate.

## Definition of a complete release

| Gate | Current evidence |
| --- | --- |
| Existing-wallet collection → receipt → business → merchant MCP | Passed, one internal 0.01-USDC mainnet payment |
| Existing-wallet browser approval and recovery | Live extension UI acceptance pending; the real EOA test used the API/GitHub signer |
| Read-only worker persistence and duplicate suppression | Passed, two actual deployed one-shot reads |
| Google / Circle authenticated customer payment | Account callback configuration and live acceptance pending |
| Circle notification with customer browser closed | Account subscription and live delivery pending |
| Continuously scheduled worker | Host provisioning pending |
| Separate Circle payer extension | Local tests passed; live CLI gate pending |
| Stable production release | Draft PR only; main untouched |

The real receipt and watcher evidence are valid now. They do not make the unverified gates complete or establish customer traction.

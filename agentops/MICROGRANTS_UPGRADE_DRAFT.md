# Arc Microgrants upgrade — prepared draft

Prepared text for the [existing Arc PayLink project](https://dorahacks.io/buidl/49049), which already has a Microgrants submission. This upgrade has not yet been applied to that existing application.

## Title

**Arc PayLink — verified USDC collections for companies and their agents**

## Description

Arc PayLink lets a company create orders, share checkout links and track USDC settlement on Arc. Its dashboard tracks due dates, payment status and receipts. Five scoped, read-only MCP tools expose orders, collections totals, payment events and the latest monitor report to company agents without authority to move funds.

Independent server verification ties each settled transfer to its order. Reservations and deduplication prevent checks from counting a payment twice. An owner can request a hosted scan with **Check now**; it creates a temporary reader key and attempts cleanup after the check. Customer checkout supports existing Arc wallets and an implemented Google/Circle embedded-account path.

## Upgrade since the original application

The existing payment-link product now has persistent company workspaces, fixed-amount customer checkout, revocable reader access, remote merchant MCP and a hosted monitor. The company and its agent read the same verified receipt and saved report, bringing collections evidence into business workflows while preserving explicit payment approval.

## Validation and current scope

On 3 October 2026, an internal customer completed Google sign-in and explicitly approved a **0.01-USDC Arc mainnet payment through Circle**. The company order became paid, with a verified receipt from the embedded account. The scoped reader then returned one paid order, collected **0.01 USDC**, outstanding **0**, and one payment event. A repeated hosted scan discovered **zero additional receipts**.

The earlier payment window included signed Circle notifications. On 4 October, a separate strict closed-tab acceptance recorded the customer tab absent while the order remained Processing, followed by a Paid receipt sourced from `circle-webhook`. The real 0.01-USDC mainnet transfer is `0x40c4b1029b175da4f63b380190b2d4172e83ac55cb95d4f4dc9c00efc76f07cd`, block 24203301. A temporary single-order notification delay made the timing observable and was then removed; this is recovery evidence, not a normal-latency measurement.

The actual company dashboard **Check now** action succeeded and its temporary reader key was revoked. An isolated production monitor is deployed, with a production-only reader credential and cron secret. Its daily schedule is enabled; a Vercel-triggered run returned HTTP 200 and wrote a durable report. The first naturally scheduled daily invocation remains to be observed.

**External customers: zero. These are internal acceptance payments, not customer traction or revenue.** Sample dashboard amounts are simulated. The latest application source previously passed 270 application tests and 13 contract tests; subsequent commits record deployment and acceptance evidence.

## Proposed use of support

1. Recruit and support a first external business pilot, with measured checkout completion and collections reporting.
2. Observe natural recurring daily operation over time and complete the remaining privacy/retention controls.
3. Improve business onboarding, recovery-key retention and the product walkthrough using pilot feedback.

## Reviewer links

- [Original live product](https://arc-paylink-two.vercel.app)
- [New product and evidence tour](https://arc-paylink-collections-pilot.vercel.app/collections-demo/index.html)
- [Public extension source](https://github.com/Mabolla/arc-paylink/tree/deploy/collections-pilot) · [draft PR #14](https://github.com/Mabolla/arc-paylink/pull/14)
- [Google/Circle paid checkout and agent report](https://github.com/Mabolla/arc-paylink/blob/deploy/collections-pilot/agentops/evidence/collections-circle-payment-20261003.json)
- [Activated isolated monitor](https://github.com/Mabolla/arc-paylink/blob/deploy/collections-pilot/agentops/evidence/collections-monitor-activation-20261003.json)
- [Mainnet acceptance](https://github.com/Mabolla/arc-paylink/blob/deploy/collections-pilot/agentops/evidence/collections-mainnet.json) · [hosted monitor](https://github.com/Mabolla/arc-paylink/blob/deploy/collections-pilot/agentops/evidence/collections-monitor.json) · [Google/Circle sign-in](https://github.com/Mabolla/arc-paylink/blob/deploy/collections-pilot/agentops/evidence/collections-google-auth.json)

Release context: original production and `main` remain unchanged.

## Türkçe durum

3 Ekim gerçek Google/Circle ödemesi ve agent raporu doğrulandı. 4 Ekim, müşteri sekmesi kapanmış ve sipariş henüz Processing durumundayken başlayan gözlem, sonradan circle-webhook kaynaklı Paid makbuzuyla tamamlandı. İlk doğal günlük zamanlayıcı çalışması hâlâ bekleniyor. Dış müşteri yok. Mevcut başvuruya bu taslak gönderilmedi; kullanıcı kararı doğrultusunda kalan sürüm kapıları kapanmadan başvuru güncellenmeyecek.

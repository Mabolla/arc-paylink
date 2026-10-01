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

One internal **0.01-USDC Arc mainnet** payment passed order, receipt and merchant-agent verification. Repeated hosted scans retained one receipt with no additional transfer. Google/Circle sign-in and a live zero-USDC wallet balance are verified. **External customers: zero.** Sample dashboard amounts are simulated.

The existing-key receipt-only [run 36935708985](https://github.com/Mabolla/arc-paylink/actions/runs/36935708985) and full [source verification run 36935713582](https://github.com/Mabolla/arc-paylink/actions/runs/36935713582) passed on `181eb8e`. Additional checkout recovery fixes passed **270 application tests, 13 contract tests and 15 mocked checkout checks** locally. Final publication checks also passed on [run 36939330362](https://github.com/Mabolla/arc-paylink/actions/runs/36939330362), source `20e61cf`.

The deployed owner readiness check independently confirms an enabled Circle outbound subscription. Actual paid-order notification delivery with the customer browser closed, live replay acceptance and recurring scheduling remain unverified; automatic scheduling is inactive. Sign-in acceptance is separate from a completed embedded-wallet purchase.

## Proposed use of support

1. Complete and document the live embedded customer purchase and signed notification acceptance.
2. Activate isolated recurring monitoring and verify restart, replay and reader-key revocation.
3. Publish the resulting walkthrough and recruit a first external business pilot.

## Reviewer links

- [Original live product](https://arc-paylink-two.vercel.app)
- [New product and evidence tour](https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app/collections-demo/index.html)
- [Public extension source](https://github.com/Mabolla/arc-paylink/tree/feat/tameion-agentops) · [draft PR #14](https://github.com/Mabolla/arc-paylink/pull/14)
- [Mainnet acceptance](https://github.com/Mabolla/arc-paylink/blob/feat/tameion-agentops/agentops/evidence/collections-mainnet.json) · [hosted monitor](https://github.com/Mabolla/arc-paylink/blob/feat/tameion-agentops/agentops/evidence/collections-monitor.json) · [Google/Circle sign-in](https://github.com/Mabolla/arc-paylink/blob/feat/tameion-agentops/agentops/evidence/collections-google-auth.json)

Release context: original production and `main` remain unchanged.

## Türkçe durum

Daha önce gönderilmiş mevcut Microgrants kaydını güçlendirecek metin hazırlandı; bu yükseltme o başvuru kaydına henüz uygulanmadı. Şirket tahsilatı, beş salt-okuma agent aracı ve sunucuda kontrol çalışan ürün kapsamına yazıldı. Gerçek 0,01 USDC iç test ile Google/Circle giriş kanıtı açık; örnek rakamlar müşteri veya gelir sayılmadı. Son ödeme ekranı düzeltmeleri yerelde doğrulandı, yayın kontrolleri de geçti. Etkin Circle bildirim aboneliği sunucudan doğrulandı. Circle üzerinden gerçek satın alma/bildirim ve otomatik zamanlama tamamlanmadan tamamlandı iddiası yapılmıyor.

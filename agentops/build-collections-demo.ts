import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const preview = "https://arc-paylink-git-feat-tameion-agentops-mabolla1.vercel.app";
const repository = "https://github.com/Mabolla/arc-paylink";
const orderId = "604c797f-68d3-40bd-a483-bc7a36e7a33c";

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

async function main() {
  const collection = JSON.parse(await readFile("agentops/evidence/collections-mainnet.json", "utf8"));
  const transfer = JSON.parse(await readFile("agentops/evidence/collections-mainnet-transaction.json", "utf8"));
  const watcher = JSON.parse(await readFile("agentops/evidence/collections-watch.json", "utf8"));
  const hostedMonitor = JSON.parse(await readFile("agentops/evidence/collections-monitor.json", "utf8"));
  const googleAuthentication = JSON.parse(await readFile("agentops/evidence/collections-google-auth.json", "utf8"));

  assert.equal(collection.mode, "REAL_INTERNAL_MAINNET_COLLECTIONS_ACCEPTANCE");
  assert.equal(collection.orderId, orderId);
  assert.equal(collection.chainId, 5042);
  assert.equal(collection.amountUsdc, "0.01");
  assert.equal(collection.externalCustomers, 0);
  assert.equal(collection.merchantPaid, true);
  assert.equal(collection.remoteMcpReceiptMatched, true);
  assert.equal(collection.receiptEventsAfterRetry, 1);
  assert.equal(transfer.internalAcceptance, true);
  assert.equal(transfer.realTransfers, 1);
  assert.equal(transfer.transactionHash, collection.transactionHash);
  assert.equal(watcher.transactionHash, collection.transactionHash);
  assert.equal(watcher.exactReceiptMatched, true);
  assert.equal(watcher.firstPassNewEvents, 1);
  assert.equal(watcher.secondPassNewEvents, 0);
  assert.equal(watcher.noBrowserSessionUsed, true);
  assert.equal(watcher.allWatcherRequestsReadOnly, true);
  assert.equal(watcher.newTransfers, 0);
  assert.equal(watcher.productionSchedulerInstalled, false);
  assert.equal(watcher.circleWebhookDeliveryTested, false);
  assert.equal(collection.googleLoginPassed, false);
  assert.equal(collection.circleApprovalTested, false);
  assert.equal(hostedMonitor.mode, "REAL_HOSTED_INTERNAL_COLLECTIONS_MONITOR_ACCEPTANCE");
  assert.equal(hostedMonitor.orderId, collection.orderId);
  assert.equal(hostedMonitor.workspaceId, collection.workspaceId);
  assert.equal(hostedMonitor.transactionHash, collection.transactionHash);
  assert.equal(hostedMonitor.chainId, collection.chainId);
  assert.equal(hostedMonitor.allChecksPassed, true);
  assert.equal(hostedMonitor.newTransfers, 0);
  assert.equal(hostedMonitor.externalCustomers, 0);
  assert.equal(hostedMonitor.scheduledInvocationVerified, false);
  assert.equal(hostedMonitor.ownerAndReaderStatusMatched, true);
  assert.equal(hostedMonitor.readerRefreshDenied, true);
  assert.equal(hostedMonitor.unconfiguredCronHttpStatus, 503);
  assert.equal(hostedMonitor.remoteMcpMonitorMatched, true);
  assert.equal(hostedMonitor.sourceReceiptUnchanged, true);
  assert.equal(hostedMonitor.temporaryReaderRevoked, true);
  assert.equal(hostedMonitor.revokedReaderDenied, true);
  assert.equal(hostedMonitor.scans.length, 2);
  for (const scan of hostedMonitor.scans) {
    assert.equal(scan.report.outcome, "complete");
    assert.equal(scan.report.trackedReceipts, 1);
    assert.equal(scan.report.paidUsdc, "0.01");
    assert.equal(scan.report.outstandingUsdc, "0");
    assert.equal(scan.report.newReceipts, 0);
  }
  const monitorReport = hostedMonitor.scans.at(-1).report;
  assert.equal(googleAuthentication.baseUrl, preview);
  assert.equal(googleAuthentication.path, "/wallet");
  assert.equal(googleAuthentication.acceptance.googleAuthenticationCompleted, true);
  assert.equal(googleAuthentication.acceptance.targetDomainSignedInSignal, "Wallet connected. Your balance is read directly from Arc.");
  assert.equal(googleAuthentication.acceptance.displayedAvailableUsdc, "0");
  assert.equal(googleAuthentication.customerCheckoutPaymentVerified, false);
  assert.equal(googleAuthentication.newTransfers, 0);
  assert.equal(googleAuthentication.externalCustomers, 0);
  assert.equal(googleAuthentication.signedCircleNotificationDeliveryVerified, false);
  assert.equal(googleAuthentication.scheduledInvocationVerified, false);
  assert.equal(googleAuthentication.privateCredentialsRecorded, false);

  const e = escapeHtml;
  const summary = {
    paidCount: collection.remoteMcpSummary.paidCount,
    paidUsdc: collection.remoteMcpSummary.paidUsdc,
    outstandingUsdc: collection.remoteMcpSummary.outstandingUsdc,
    chainId: collection.remoteMcpSummary.chainId,
  };
  const evidence = {
    collection,
    transfer,
    watcher,
    hostedMonitor,
    googleAuthentication,
    scope: "One real 0.01 USDC internal existing-wallet collection, two read-only reference watcher passes and two recorded hosted server scans. The server and remote MCP returned the same saved monitor report; the original receipt was unchanged and no new funds were sent. A separate later Google authentication and existing Circle wallet read-back passed on /wallet, displaying 0 USDC; this did not approve or send a customer checkout payment. Interactive sandbox purchases are simulated. Zero verified external customers. Customer checkout payment, Circle webhook delivery and automatic scheduling are not verified. Historical acceptance records retain their original Google sign-in status.",
  };
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Explore Arc PayLink business collections: customer payment links, verified USDC receipts and scoped read-only agent reporting. Includes clearly labelled sandbox and internal mainnet evidence.">
  <meta name="theme-color" content="#10243a">
  <title>Arc PayLink — Business collections tour</title>
  <style>
    :root{color-scheme:light;--ink:#13273d;--muted:#526577;--line:#dce5ea;--paper:#f6f8f9;--green:#006f57;--mint:#d7f5e6;--navy:#10243a;--radius:20px}
    *{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:24px}body{margin:0;background:var(--paper);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);line-height:1.55}a{color:var(--green);text-underline-offset:4px}a:focus-visible{outline:3px solid #27bd90;outline-offset:5px}button:focus-visible{outline:3px solid #27bd90;outline-offset:5px}.wrap{width:min(1160px,calc(100% - 64px));margin:auto}.top{background:white;border-bottom:1px solid var(--line)}.nav{min-height:84px;display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{text-decoration:none;color:var(--ink);font-weight:750;letter-spacing:-.8px;font-size:24px;display:flex;gap:12px;align-items:center}.mark{width:34px;height:34px;background:var(--navy);color:#9ce6ca;border-radius:10px;display:grid;place-items:center;font-size:19px;letter-spacing:-2px}.navlinks{display:flex;gap:26px;font-size:14px;font-weight:650}.navlinks a{text-decoration:none;color:var(--muted)}.tag{display:inline-flex;align-items:center;gap:7px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-weight:750;padding:6px 10px;border-radius:7px;background:var(--mint);color:var(--green)}.tag:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}.tag.neutral{background:#eaf0f4;color:#385065}.hero{padding:64px 0 42px}.hero-grid{display:grid;grid-template-columns:1.12fr .88fr;gap:56px;align-items:start}h1{font-size:clamp(36px,4.4vw,58px);line-height:1.08;letter-spacing:-2.3px;font-weight:740;margin:20px 0 24px;max-width:650px}h1 span{color:var(--green)}.lead{font-size:18px;color:var(--muted);max-width:565px;margin:0 0 28px}.actions{display:flex;flex-wrap:wrap;gap:12px}.button{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border-radius:10px;min-height:46px;padding:10px 17px;font-size:14px;font-weight:700;color:white;background:var(--green);border:1px solid var(--green)}.button.secondary{color:var(--ink);background:white;border-color:#cbd7df}.helper{font-size:12px;color:var(--muted);margin:14px 0 0;max-width:530px}.hero-note{font-size:13px;color:var(--muted);border-left:3px solid #b4d9cd;padding-left:14px;margin-top:30px}.proof-card{background:var(--navy);border-radius:var(--radius);color:white;padding:28px;box-shadow:0 12px 36px #16345212}.proof-top{display:flex;gap:14px;align-items:start;justify-content:space-between}.proof-top .tag{background:#214b43;color:#b6f6d6}.proof-card h2{font-size:18px;font-weight:650;letter-spacing:-.3px;margin:0}.amount{font-size:53px;letter-spacing:-2px;font-weight:700;line-height:1.2;margin:28px 0 4px}.amount small{font-size:18px;font-weight:500;color:#b7c9d9;letter-spacing:0}.proof-sub{font-size:13px;color:#b7c9d9;margin:0}.proof-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px 16px;border-top:1px solid #345064;margin-top:24px;padding-top:22px}.label{display:block;text-transform:uppercase;font-size:10px;letter-spacing:.11em;font-weight:700;color:#adc3d4;margin-bottom:6px}.value{display:block;font-size:14px;font-weight:600}.hash{display:block;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;overflow-wrap:anywhere;color:#d2dfeb;border-top:1px solid #345064;padding-top:18px;margin-top:24px}.proof-card .fine{color:#b7c9d9;font-size:12px;margin:14px 0 0}.metrics{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);border-radius:16px;background:white;margin:0 0 56px;overflow:hidden}.metric{padding:22px 28px}.metric+.metric{border-left:1px solid var(--line)}.metric strong{font-size:24px;letter-spacing:-.6px;display:block}.metric span{color:var(--muted);font-size:13px}.section{padding:0 0 56px}.section-head{display:flex;justify-content:space-between;align-items:end;gap:28px;margin-bottom:22px}.kicker{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--green);font-weight:750;margin:0 0 8px}h2{font-size:29px;line-height:1.2;letter-spacing:-.8px;margin:0}h3{font-size:17px;margin:0 0 10px;letter-spacing:-.2px}.section-head p:last-child{color:var(--muted);font-size:14px;max-width:380px;margin:0}.workflow{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.step{background:white;border:1px solid var(--line);border-radius:14px;padding:24px 20px}.number{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--green);font-size:13px;margin-bottom:30px}.step p{font-size:13px;color:var(--muted);margin:0}.evidence-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:24px;align-items:start}.receipt{margin:0;border:1px solid var(--line);background:white;border-radius:var(--radius);overflow:hidden}.receipt img{width:100%;height:auto;display:block}.receipt figcaption{border-top:1px solid var(--line);font-size:12px;color:var(--muted);padding:14px 18px}.evidence-copy{padding:8px 2px}.evidence-copy h3{font-size:22px;margin:15px 0}.evidence-copy p{font-size:14px;color:var(--muted);margin:0 0 18px}.checklist{list-style:none;padding:0;margin:0 0 24px}.checklist li{border-top:1px solid var(--line);padding:13px 0;display:flex;gap:12px;font-size:13px}.check{color:var(--green);font-weight:800}.checklist strong{font-weight:650}.small-links{display:flex;flex-wrap:wrap;gap:12px 20px;font-size:13px}.agent-box{border:1px solid var(--line);border-radius:var(--radius);background:white;display:grid;grid-template-columns:1fr 1fr;overflow:hidden}.agent-main{padding:32px}.agent-main p{font-size:14px;color:var(--muted);margin:13px 0 22px}.tools{display:grid;gap:0}.tool{padding:11px 0;border-top:1px solid var(--line);display:grid;grid-template-columns:1fr;gap:4px}.tool code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:var(--green);overflow-wrap:anywhere}.tool span{font-size:12px;color:var(--muted)}.agent-result{background:#eef4f3;padding:32px;border-left:1px solid var(--line)}.agent-result .tag{margin-bottom:18px}.agent-result h3{margin-bottom:16px}pre{background:var(--navy);color:#d6f5e9;border-radius:12px;padding:20px;overflow:auto;line-height:1.8;font-size:13px;margin:0 0 20px}.watch-results{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 18px}.watch-results div{padding:13px 10px;border-radius:10px;border:1px solid #cfdeda;text-align:center}.watch-results strong{display:block;font-size:22px}.watch-results span{font-size:11px;color:var(--muted)}.scope{font-size:12px;color:var(--muted);margin:0 0 18px}.scope strong{color:var(--ink);font-weight:650}.status{display:grid;grid-template-columns:1fr 1fr;gap:24px;background:#ecf0f3;border-radius:var(--radius);padding:28px 32px}.status h3{font-size:16px}.status p{font-size:13px;color:var(--muted);margin:0}.status-title{display:flex;gap:10px;align-items:center;margin-bottom:12px}.dot{width:8px;height:8px;border-radius:50%;background:var(--green)}.dot.pending{background:#8d6d36}footer{border-top:1px solid var(--line);padding:24px 0 32px}.footer-row{display:flex;justify-content:space-between;gap:20px;align-items:center;color:var(--muted);font-size:12px}.footer-row p{margin:0}.footer-row a{font-size:12px} @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media(max-width:900px){.hero-grid{gap:26px;grid-template-columns:1fr 1fr}h1{font-size:43px;letter-spacing:-1.6px}.proof-card{padding:22px}.workflow{grid-template-columns:1fr 1fr}.evidence-grid{gap:24px;grid-template-columns:1fr 1fr}.agent-main,.agent-result{padding:24px}.section-head{align-items:start}.amount{font-size:46px}}@media(max-width:640px){.wrap{width:calc(100% - 36px)}.nav{min-height:72px;gap:15px}.brand{font-size:20px}.mark{width:29px;height:29px;font-size:17px}.navlinks{gap:15px;font-size:12px}.navlinks a:first-child{display:none}.hero{padding:36px 0 28px}.hero-grid{grid-template-columns:1fr;gap:26px}h1{font-size:41px;letter-spacing:-1.8px;margin:18px 0}.lead{font-size:16px;margin-bottom:22px}.hero-note{margin-top:22px}.proof-card{padding:24px}.proof-grid{gap:18px}.metrics{margin-bottom:40px}.metric{padding:18px 12px}.metric strong{font-size:21px}.metric span{font-size:11px}.section{padding-bottom:40px}.section-head{display:block;margin-bottom:18px}.section-head p:last-child{margin-top:14px;max-width:none}h2{font-size:26px}.workflow{gap:10px}.step{padding:18px 14px}.number{margin-bottom:20px}.step h3{font-size:15px}.step p{font-size:12px}.evidence-grid,.agent-box,.status{grid-template-columns:1fr}.evidence-copy{padding:0}.agent-result{border-left:0;border-top:1px solid var(--line)}.status{padding:24px;gap:26px}.footer-row{align-items:start;flex-direction:column;gap:12px}.small-links{gap:12px 18px}}
  </style>
</head>
<body>
  <header class="top"><nav class="wrap nav" aria-label="Main navigation">
    <a class="brand" href="/" aria-label="Arc PayLink home"><span class="mark" aria-hidden="true">ap</span>Arc PayLink</a>
    <div class="navlinks"><a href="#workflow">How it works</a><a href="#proof">Evidence</a><a href="#agents">For agents</a></div>
  </nav></header>
  <main class="wrap">
    <section class="hero" aria-labelledby="hero-title"><div class="hero-grid">
      <div>
        <span class="tag neutral">Business collections · Product preview</span>
        <h1 id="hero-title">Customer payments.<br><span>Company clarity.</span><br>Agent access.</h1>
        <p class="lead">Create a purchase link. Verify the USDC payment on Arc. Give your company's agent a scoped, read-only view of orders, receipts and outstanding balances.</p>
        <div class="actions"><a class="button" href="/business/demo">Try the interactive sandbox <span aria-hidden="true">&nbsp;↗</span></a><a class="button secondary" href="${e(preview)}/checkout/${e(orderId)}">View the real paid receipt <span aria-hidden="true">&nbsp;↗</span></a></div>
        <p class="helper">Sandbox payments are simulated. The real receipt is a 0.01 USDC internal mainnet self-test, using an existing wallet.</p>
        <p class="hero-note">Designed for companies tracking customer purchases. Companies connect their own agents; agents do not discover or start using the product automatically.</p>
      </div>
      <aside class="proof-card" aria-labelledby="verified-title">
        <div class="proof-top"><h2 id="verified-title">A collection we verified</h2><span class="tag">Actual mainnet</span></div>
        <div class="amount">${e(collection.amountUsdc)} <small>USDC</small></div>
        <p class="proof-sub">Internal existing-wallet test · Arc chain ${e(collection.chainId)}</p>
        <div class="proof-grid"><div><span class="label">Order status</span><span class="value">Paid &amp; receipt matched</span></div><div><span class="label">Block</span><span class="value">${e(collection.receipt.blockNumber)}</span></div><div><span class="label">Receipt events after retry</span><span class="value">${e(collection.receiptEventsAfterRetry)} · no duplicate</span></div><div><span class="label">External customers</span><span class="value">${e(collection.externalCustomers)} verified</span></div></div>
        <code class="hash">${e(collection.transactionHash)}</code>
        <p class="fine">The payer and recipient are controlled by the project. This is engineering acceptance, not a customer sale.</p>
      </aside>
    </div></section>
    <div class="metrics" aria-label="Recorded internal acceptance results"><div class="metric"><strong>1 verified</strong><span>internal USDC transfer</span></div><div class="metric"><strong>0 duplicate</strong><span>events on the second watcher pass</span></div><div class="metric"><strong>Read-only</strong><span>scoped company agent access</span></div></div>
    <section class="section" id="workflow" aria-labelledby="workflow-title">
      <div class="section-head"><div><p class="kicker">One order, shared evidence</p><h2 id="workflow-title">A company workflow, from link to receipt.</h2></div><p>Try these steps in the browser sandbox. Every sample approval there is explicitly simulated.</p></div>
      <div class="workflow"><article class="step"><div class="number">01 / COMPANY</div><h3>Create the order</h3><p>Set the amount, receiving address and customer reference. Share the purchase link.</p></article><article class="step"><div class="number">02 / CUSTOMER</div><h3>Review the purchase</h3><p>See the company, amount and destination. Approve the payment using a supported wallet.</p></article><article class="step"><div class="number">03 / PAYLINK</div><h3>Verify settlement</h3><p>Check the chain, token, sender, recipient and exact amount before recording a paid order.</p></article><article class="step"><div class="number">04 / AGENT</div><h3>Read the result</h3><p>Retrieve the receipt, paid total and remaining balance with a revocable company key.</p></article></div>
    </section>
    <section class="section" id="proof" aria-labelledby="proof-title">
      <div class="section-head"><div><p class="kicker">Recorded on 1 October 2026</p><h2 id="proof-title">Evidence from the deployed product.</h2></div><p>A real transfer, a paid company order and the same receipt returned through the remote MCP endpoint.</p></div>
      <div class="evidence-grid">
        <figure class="receipt"><img src="receipt.jpg" alt="Actual Arc PayLink checkout displaying the internally tested 0.01 USDC order as paid, with its verified mainnet transaction receipt." width="1363" height="936" loading="lazy"><figcaption>Actual deployed checkout screenshot. Internal test payment; no external customer purchase is claimed.</figcaption></figure>
        <div class="evidence-copy"><span class="tag">Real internal acceptance</span><h3>The company and its agent agree.</h3><p>The order became paid after independent Arc settlement checks. A scoped reader retrieved the exact receipt and totals from the deployed service.</p><ul class="checklist"><li><span class="check" aria-hidden="true">✓</span><div><strong>Receipt matched through remote MCP</strong><br>The company record and agent response contain the same transaction hash.</div></li><li><span class="check" aria-hidden="true">✓</span><div><strong>Paid ${e(summary.paidUsdc)} USDC · outstanding ${e(summary.outstandingUsdc)} USDC</strong><br>Totals from the real internal test workspace.</div></li><li><span class="check" aria-hidden="true">✓</span><div><strong>One durable payment event</strong><br>Re-confirmation did not create another receipt event.</div></li><li><span class="check" aria-hidden="true">✓</span><div><strong>Restricted access checked</strong><br>Reader writes were denied. The temporary test key was revoked.</div></li></ul><div class="small-links"><a href="evidence.json">Inspect the recorded JSON</a><a href="${e(repository)}/pull/14">Review the separate development PR</a></div></div>
      </div>
    </section>
    <section class="section" id="agents" aria-labelledby="agents-title">
      <div class="section-head"><div><p class="kicker">Agents read. Companies stay in control.</p><h2 id="agents-title">A useful interface beyond the dashboard.</h2></div><p>The company's agent connects to an authenticated Streamable HTTP MCP endpoint with a scoped read-only key.</p></div>
      <div class="agent-box"><div class="agent-main"><h3>Five focused collection tools</h3><p>Orders and references remain scoped to one company. Access can be revoked. These tools cannot sign or send a payment.</p><div class="tools"><div class="tool"><code>list_customer_orders</code><span>Purchase states and private customer references.</span></div><div class="tool"><code>get_customer_order</code><span>One owned order and its verified receipt.</span></div><div class="tool"><code>get_receivables_summary</code><span>Paid, outstanding, overdue and processing totals.</span></div><div class="tool"><code>list_payment_events</code><span>Receipt events with IDs for deduplication.</span></div><div class="tool"><code>get_collections_monitor</code><span>The latest saved server report; reading it does not start a scan.</span></div></div><p><a href="${e(repository)}/blob/feat/tameion-agentops/agentops/COLLECTIONS.md#agent-integration">Read the scoped MCP integration guide ↗</a></p><p class="scope">Endpoint: <code>/api/business/mcp</code><br>Credentials are never embedded in this tour.</p></div><div class="agent-result"><span class="tag">Actual read-only watcher proof</span><h3>Checked without a browser session.</h3><pre aria-label="Recorded real receivables summary"><code>${e(JSON.stringify(summary, null, 2))}</code></pre><div class="watch-results"><div><strong>${e(watcher.firstPassNewEvents)}</strong><span>first-pass new event</span></div><div><strong>${e(watcher.secondPassNewEvents)}</strong><span>second-pass new events</span></div><div><strong>${e(watcher.newTransfers)}</strong><span>new transfers</span></div></div><p class="scope"><strong>Two one-shot reader passes</strong> observed the already-paid internal order and kept one durable receipt. This does not demonstrate an installed production scheduler, a continuously running agent or Circle webhook delivery.</p><a href="${e(repository)}/blob/feat/tameion-agentops/agentops/COLLECTIONS_WATCH.md">Read the watcher setup and limitations ↗</a></div></div>
    </section>
    <section class="section" aria-labelledby="monitor-title">
      <div class="section-head"><div><p class="kicker">Recorded hosted server acceptance</p><h2 id="monitor-title">A saved report beyond the browser.</h2></div><p>Two bounded server scans observed the same existing internal payment. Automatic scheduling has not been activated or verified.</p></div>
      <div class="agent-box"><div class="agent-main"><span class="tag">Actual server checks</span><h3>Private checkpoints and one receipt.</h3><p>The hosted monitor retained one receipt across both recorded scans. The owner, scoped reader and remote MCP returned the same saved report; reader refresh was denied and the temporary reader was revoked.</p><div class="watch-results"><div><strong>${e(hostedMonitor.scans.length)}</strong><span>recorded server scans</span></div><div><strong>${e(monitorReport.trackedReceipts)}</strong><span>tracked receipt</span></div><div><strong>${e(hostedMonitor.newTransfers)}</strong><span>new transfers</span></div></div><p class="scope">Report completed at ${e(monitorReport.lastCompletedAt)}. These totals are a saved, paginated observation of the internal workspace, not a live balance snapshot or customer revenue.</p><a href="${e(repository)}/blob/feat/tameion-agentops/agentops/COLLECTIONS_MONITOR.md">Read the hosted monitor design and activation gates ↗</a></div><div class="agent-result"><span class="tag neutral">Automatic schedule unverified</span><h3>The recorded server report</h3><pre aria-label="Saved real hosted collections monitor report"><code>${e(JSON.stringify({ outcome: monitorReport.outcome, trackedReceipts: monitorReport.trackedReceipts, paidUsdc: monitorReport.paidUsdc, outstandingUsdc: monitorReport.outstandingUsdc, newReceipts: monitorReport.newReceipts, chainId: monitorReport.chainId }, null, 2))}</code></pre><p class="scope"><strong>Server refresh acceptance is complete.</strong> The deployed cron endpoint remains unconfigured. This does not prove a recurring scheduler, a continuously running agent or Circle webhook delivery.</p><a href="evidence.json">Inspect the recorded monitor acceptance ↗</a></div></div>
    </section>
    <section class="section" aria-labelledby="google-auth-title"><div class="status"><div><div class="status-title"><span class="dot" aria-hidden="true"></span><h3 id="google-auth-title">Google sign-in and wallet read-back verified</h3></div><p>A separate later acceptance at <code>/wallet</code> completed Google authentication through Circle and displayed the existing Arc wallet with ${e(googleAuthentication.acceptance.displayedAvailableUsdc)} USDC available. Verified at ${e(googleAuthentication.verifiedAt)}. No new transfer was sent.</p></div><div><div class="status-title"><span class="dot pending" aria-hidden="true"></span><h3>Customer payment acceptance remains pending</h3></div><p>This proves authentication and wallet read-back only. A customer checkout approval, funded embedded payment, signed Circle notification delivery and automatic scheduling are still unverified. <a href="evidence.json">Inspect the separate Google authentication record</a>.</p></div></div></section>
    <section class="section" aria-labelledby="video-title"><div class="section-head"><div><p class="kicker">72-second screenshot walkthrough</p><h2 id="video-title">See the company and customer screens.</h2></div><p>Captioned still screenshots: simulated UI first, then the saved real internal receipt and watcher results. This is not a live signing recording. It was recorded before the later Google authentication acceptance shown above; its pending labels reflect that earlier recording.</p></div><video controls preload="none" poster="frames/business-sandbox.jpg" style="display:block;width:100%;max-width:100%;border-radius:16px;background:#10243a" aria-label="Captioned company collections walkthrough"><source src="walkthrough.mp4" type="video/mp4"><track kind="captions" src="captions.vtt" srclang="en" label="English captions">Your browser cannot play this video. <a href="walkthrough.mp4">Download the walkthrough</a>.</video></section>
    <section class="section" aria-labelledby="scope-title"><div class="status"><div><div class="status-title"><span class="dot" aria-hidden="true"></span><h3 id="scope-title">What this preview demonstrates</h3></div><p>Company orders, interactive sandbox checkout, a real internal existing-wallet payment, verified receipts, scoped remote MCP reading, durable watcher deduplication, two recorded hosted server scans and separate Google authentication with existing wallet read-back. The original production branch remains separate.</p></div><div><div class="status-title"><span class="dot pending" aria-hidden="true"></span><h3>What remains unverified</h3></div><p>Google/Circle customer checkout payment approval, signed Circle webhook delivery and a deployed recurring watcher. Verified external customers: zero. A USDC balance is required; card or fiat checkout is not included.</p></div></div></section>
  </main>
  <footer><div class="wrap footer-row"><p>Arc PayLink · Business collections preview<br>Evidence scope: internal acceptance, not customer traction.</p><div class="small-links"><a href="${e(repository)}/blob/feat/tameion-agentops/agentops/RELEASE_REPORT.md">Release report</a><a href="https://arc-paylink-two.vercel.app">Original product ↗</a><a href="${e(repository)}">GitHub ↗</a></div></div></footer>
</body>
</html>
`;
  await mkdir("public/collections-demo", { recursive: true });
  await writeFile("public/collections-demo/index.html", html);
  await writeFile("public/collections-demo/evidence.json", `${JSON.stringify(evidence, null, 2)}\n`);
  await copyFile("agentops/evidence/collections-mainnet.jpg", "public/collections-demo/receipt.jpg");
  console.log("Built public/collections-demo from recorded internal mainnet, read-only watcher, hosted monitor and Google authentication evidence. No network requests or transfers were made.");
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

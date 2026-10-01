import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(
    `${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules"}/playwright`,
  ));
}
const { spawn } = require("node:child_process");
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  { stdio: "ignore" },
);
(async () => {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch("http://127.0.0.1:3100/business/demo");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const browser = await chromium.launch({
    executablePath: process.env.ARCPAYLINK_DEMO_CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-software-rasterizer",
      "--no-zygote",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3100/business/demo");
  await page.getByText("Your collections, in view.").waitFor();
  await page.screenshot({
    path: "/tmp/commerce-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "+ Create payment link" }).click();
  await page.getByLabel("Order / invoice reference").fill("QA-1043");
  await page
    .getByLabel("What is the customer buying?")
    .fill("Customer workflow");
  await page.getByLabel("USDC amount").fill("12.50");
  await page
    .getByLabel("Internal customer reference (optional)")
    .fill("QA customer");
  await page
    .getByRole("button", { name: "Create link →", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: "QA-1043" });
  await row.waitFor();
  await row.getByRole("link", { name: "Open checkout" }).click();
  await page.getByText("Customer workflow", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/commerce-checkout.png", fullPage: true });
  await page
    .getByRole("button", { name: "Simulate approved purchase" })
    .click();
  await page.getByText("Sandbox purchase recorded.").waitFor();
  await page.getByRole("link", { name: "Back to business dashboard" }).click();
  const paid = page.getByRole("row").filter({ hasText: "QA-1043" });
  await paid.getByText("Paid", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Preview agent report" }).click();
  if (!(await page.getByText('"paidUsdc": "137.5"', { exact: false }).count()))
    throw new Error("Agent summary mismatch");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/commerce-mobile.png", fullPage: true });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile overflow");
  await page.goto("http://127.0.0.1:3100/business");
  await page.getByText("Start collecting", { exact: true }).waitFor();
  await page.screenshot({
    path: "/tmp/commerce-onboarding.png",
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:3100/wallet");
  await page.getByRole("heading", { name: "Your Arc wallet" }).waitFor();
  const evidence = {
    mode: "SIMULATED_UI_ACCEPTANCE",
    generatedAt: new Date().toISOString(),
    sandboxCreateCheckoutPayTrack: true,
    agentSummary: true,
    mobileNoOverflow: true,
    existingWalletFallback: true,
    pageErrors: errors,
  };
  if (errors.length) throw new Error(errors.join("; "));
  writeFileSync(
    "agentops/evidence/collections-ui.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
  await browser.close();
  server.kill();
})().catch((e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});

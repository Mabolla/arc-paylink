# Business collections product tour

The static tour is served at `/collections-demo/index.html` on the new-version deployment. It is separate from the earlier payer AgentOps demo and the original production product.

Build from the current recorded evidence:

```sh
node --import tsx agentops/build-collections-demo.ts
```

No external requests, credentials or transfers are used during this build. It reads the sanitized mainnet collection, transaction and one-shot watcher reports, verifies the recorded scope, and copies the actual public checkout screenshot. Every evidence value interpolated into the page is HTML-escaped. Evidence JSON is served as a separate file, not executable inline script.

The tour links to the interactive company sandbox, actual paid checkout, scoped MCP guide, watcher guide and draft development PR. The sandbox is explicitly simulated. The real transfer is one 0.01-USDC internal existing-wallet self-test on Arc mainnet, not an external customer sale. The watcher proof is two browser-independent read-only passes, not an installed scheduler or an always-running agent. Google/Circle checkout and Circle webhook delivery remain unverified.

## Suggested review or recording sequence

1. Open `/collections-demo/index.html`. Show the product purpose and the real internal receipt card.
2. Open **Try the interactive sandbox**. Create a purchase and follow its customer checkout; keep the sandbox simulation label visible.
3. Return to the tour's **Evidence** section. Open **View the real paid receipt** to show the genuine internal mainnet result.
4. Show **For agents**: the four read-only tools, exact recorded totals and one-shot watcher deduplication.
5. Finish on the scope panel so the proof and remaining acceptance gates are visible together.

Suggested caption: “Arc PayLink company collections preview: interactive sandbox plus one real 0.01 USDC internal mainnet test. Scoped agents can read verified receipts; Google/Circle checkout and background webhook delivery are pending acceptance. No external customer activity is claimed.”

## Delivered walkthrough

[72-second captioned video](../public/collections-demo/walkthrough.mp4) uses actual saved UI screenshots, not a live payment recording. Its first three scenes show the explicitly simulated dashboard, customer review and sample receipt. Its final scenes show the previously saved real internal 0.01-USDC receipt and explain actual read-only watcher results plus remaining gates. It is silent, with burned-in English captions and a separate VTT track. No Google/Circle purchase is shown as real.

Rebuild with `npm run collections:demo:build` and `npm run collections:video:build`; video tooling needs ffmpeg and DejaVu Sans. The captured source frames are committed under `public/collections-demo/frames`. Scope and captions are recorded in `evidence/collections-video.json`.

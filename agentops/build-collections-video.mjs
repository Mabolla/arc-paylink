// Optional release tooling: ffmpeg and DejaVu Sans are needed on the rendering host.
// Input frames are actual product screenshots captured with the controlled browser.
// This is a captioned still-image walkthrough, not a live payment recording.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const output = resolve("public/collections-demo");
const evidence = JSON.parse(await readFile(join(output, "evidence.json"), "utf8"));
assert.equal(evidence.collection.externalCustomers, 0);
assert.equal(evidence.watcher.productionSchedulerInstalled, false);
assert.equal(evidence.collection.googleLoginPassed, false);
const scenes = [
  ["frames/business-sandbox.jpg", "SIMULATED UI · Company creates purchase links and tracks orders.\nSample totals here are local demo data, not customer revenue."],
  ["frames/customer-sandbox.jpg", "SIMULATED UI · Customer reviews the fixed amount and recipient.\nThis walkthrough does not authenticate with Google or send funds."],
  ["frames/paid-sandbox.jpg", "SIMULATED UI · Example approval updates the local order and receipt.\nThe sample transaction hash is not a blockchain payment."],
  ["receipt.jpg", "REAL INTERNAL TEST · Earlier 0.01-USDC EOA payment on Arc mainnet.\nThis is a saved receipt screenshot, not a live signing recording."],
  ["receipt.jpg", "REAL READ-ONLY CHECK · Two worker passes observed this saved receipt.\nFirst pass: 1 new event. Second: 0. No new transfer or browser used."],
  ["receipt.jpg", "PENDING · Google/Circle purchase, Circle webhook delivery, worker host.\nZero verified external customers. Original production is unchanged."],
];
const stamp = seconds => `00:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.000`;
const directory = await mkdtemp(join(tmpdir(), "collections-video-"));
try {
  const frames = join(directory, "frames.txt");
  const paths = scenes.map(([file]) => join(output, file));
  assert(paths.every(path => !path.includes("'")), "Use an apostrophe-free checkout path for ffmpeg tooling.");
  await writeFile(frames, paths.map(path => `file '${path}'\nduration 12\n`).join("") + `file '${paths.at(-1)}'\n`);
  const overlays = [];
  for (const [index, [, caption]] of scenes.entries()) {
    const file = join(directory, `caption-${index}.txt`);
    await writeFile(file, caption);
    overlays.push(`drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile=${file}:fontsize=24:fontcolor=white:x=32:y=805:line_spacing=10:enable='gte(t,${index * 12})*lt(t,${(index + 1) * 12})'`);
  }
  const filter = [
    "scale=1280:780:force_original_aspect_ratio=decrease",
    "pad=1280:900:(ow-iw)/2:0:color=0x10243a",
    "setsar=1", ...overlays,
  ].join(",");
  const encoded = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", frames,
    "-t", "72", "-r", "12", "-vf", filter, "-c:v", "libx264", "-preset", "medium", "-crf", "23",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(output, "walkthrough.mp4"),
  ], { encoding: "utf8", maxBuffer: 1_000_000 });
  assert.equal(encoded.status, 0, encoded.stderr);
  await writeFile(join(output, "captions.vtt"), "WEBVTT\n\n" + scenes.map(([,caption], index) =>
    `${stamp(index * 12)} --> ${stamp((index + 1) * 12)}\n${caption}\n`).join("\n"));
  await writeFile("agentops/evidence/collections-video.json", `${JSON.stringify({
    mode: "CAPTIONED_STILL_SCREENSHOT_WALKTHROUGH", durationSeconds: 72,
    video: "public/collections-demo/walkthrough.mp4", scenes: scenes.map(([frame, caption]) => ({frame, caption})),
    simulatedScenes: 3, realInternalReceiptScenes: 3, livePaymentRecording: false,
    googleCirclePaymentRecorded: false, externalCustomers: 0,
    proofTransactionHash: evidence.collection.transactionHash,
  }, null, 2)}\n`);
  console.log("Created 72-second captioned screenshot walkthrough with explicit simulation and real internal proof labels.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

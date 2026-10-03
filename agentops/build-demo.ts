import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

async function main() {
  const raw = await readFile("agentops/evidence/local-rehearsal.json", "utf8");
  const evidence = JSON.parse(raw);
  assert(evidence.mode.startsWith("SIMULATED"), "Only simulated evidence may be embedded in the public demo.");
  assert(evidence.transcript.length === 7 && Object.values(evidence.checks).every(Boolean), "Run the current integration rehearsal first.");
  const template = await readFile("agentops/demo-ui.html", "utf8");
  assert.equal(template.split("__EVIDENCE_JSON__").length, 2);
  const serialized = JSON.stringify(evidence).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
  await mkdir("public/agentops-demo", { recursive: true });
  await writeFile("public/agentops-demo/index.html", template.replace("__EVIDENCE_JSON__", serialized));
  await writeFile("public/agentops-demo/evidence.json", raw);
  console.log("Built public/agentops-demo from the recorded MCP rehearsal. No external service was called.");
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

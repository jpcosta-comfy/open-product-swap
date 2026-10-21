#!/usr/bin/env node
/**
 * End-to-end: upload demo/input assets to the local Next.js API, which
 * submits the LTX product-swap graph to COMFY_BASE_URL and polls until done.
 *
 *   npm run build && npm start
 *   node scripts/e2e.mjs
 *
 * Requires COMFY_API_KEY (single key) on the Next.js server. Never prints the key.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const BASE = process.env.OPS_BASE || "http://127.0.0.1:3000";
const ROOT = new URL("..", import.meta.url).pathname;
const DEMO = join(ROOT, "demo");

async function main() {
  await mkdir(join(DEMO, "output"), { recursive: true });

  const health = await fetch(`${BASE}/api/health`);
  const healthJson = await health.json();
  console.log("health", health.ok, healthJson.cloud || healthJson.error || "");

  const form = new FormData();
  const videoPath = join(DEMO, "input", "source.mp4");
  const skuPath = join(DEMO, "input", "sku_haven_ginger.jpg");
  form.append(
    "video",
    new Blob([await read(videoPath)]),
    basename(videoPath),
  );
  form.append(
    "sku_sku-1",
    new Blob([await read(skuPath)]),
    basename(skuPath),
  );
  form.append("pipeline", "ltx");
  form.append(
    "skus",
    JSON.stringify([{ id: "sku-1", name: "Haven Ginger" }]),
  );
  form.append(
    "prompt",
    "A person holds the amber Haven Ginger bottle. Photorealistic, original lighting, hands and motion unchanged.",
  );
  form.append("maskObject", "red soda can, can in the person's hand");
  form.append("durationSec", "2.5");

  const submit = await fetch(`${BASE}/api/jobs`, { method: "POST", body: form });
  const submitted = await submit.json();
  await writeFile(join(DEMO, "output", "submit.json"), JSON.stringify(submitted, null, 2));
  console.log("submit", submit.status);
  if (!submit.ok) {
    console.error("Comfy Cloud rejected the job. See demo/output/submit.json");
    process.exit(1);
  }

  const job = submitted.jobs[0];
  console.log("job", job.id);
  for (;;) {
    const poll = await fetch(`${BASE}/api/jobs/${job.id}`);
    const snap = await poll.json();
    console.log(new Date().toISOString(), snap.status, snap.message || snap.error || "");
    if (["success", "error", "cancelled", "lost"].includes(snap.status)) {
      await writeFile(join(DEMO, "output", "job.json"), JSON.stringify(snap, null, 2));
      if (snap.status !== "success") process.exit(1);
      for (const file of snap.outputs || []) {
        const params = new URLSearchParams({
          filename: file.filename,
          subfolder: file.subfolder || "",
          type: file.type || "output",
        });
        const res = await fetch(`${BASE}/api/jobs/${job.id}/file?${params}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const dest = join(DEMO, "output", file.filename.replace(/[^\w.-]+/g, "_"));
        await writeFile(dest, buf);
        console.log("saved", dest, buf.length);
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

function read(p) {
  return import("node:fs/promises").then((fs) => fs.readFile(p));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

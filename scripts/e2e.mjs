#!/usr/bin/env node
/**
 * End-to-end: upload demo/input assets to the local Next.js API, which
 * submits the Wan VACE product-swap graph via Comfy Cloud API v2 and polls.
 *
 *   npm run build && npm start
 *   node scripts/e2e.mjs
 *
 * Requires COMFY_API_KEY on the Next.js server. Never prints the key.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const BASE = process.env.OPS_BASE || "http://127.0.0.1:3000";
const ROOT = new URL("..", import.meta.url).pathname;
const DEMO = join(ROOT, "demo");
const POLL_MS = 4000;
const MAX_WAIT_MS = 20 * 60 * 1000;

function redact(s) {
  const prefix = ["comfy", "ui-"].join("");
  return String(s)
    .replace(new RegExp(`(${prefix}|sk-)[A-Za-z0-9_\\-]{8,}`, "gi"), "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

async function main() {
  await mkdir(join(DEMO, "output"), { recursive: true });

  const health = await fetch(`${BASE}/api/health`);
  const healthJson = await health.json();
  const host = healthJson.base ? new URL(healthJson.base).host : "";
  console.log(
    "health",
    health.ok,
    "hasKey",
    Boolean(healthJson.hasKey),
    "host",
    host,
    healthJson.cloud || healthJson.error || "",
  );
  if (!healthJson.hasKey) {
    console.error("Server is missing COMFY_API_KEY");
    process.exit(1);
  }

  let submitted = await submitOnce(false);
  if (!submitted.ok && isMissingPartner(submitted.body)) {
    console.log("Flux3 unavailable on worker; retrying open-weights Wan VACE");
    submitted = await submitOnce(true);
  }

  await writeFile(
    join(DEMO, "output", "submit.json"),
    JSON.stringify(submitted.body, null, 2),
  );
  console.log("submit", submitted.status);
  if (!submitted.ok) {
    console.error("Comfy rejected the job. See demo/output/submit.json");
    process.exit(1);
  }

  const job = submitted.body.jobs[0];
  console.log("job", job.id);
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > MAX_WAIT_MS) {
      console.error("Timed out waiting for job");
      process.exit(1);
    }
    const poll = await fetch(`${BASE}/api/jobs/${job.id}`);
    const snap = await poll.json();
    console.log(
      new Date().toISOString(),
      snap.status,
      snap.rawStatus || "",
      snap.message || snap.error || "",
    );
    if (["success", "error", "cancelled", "lost"].includes(snap.status)) {
      await writeFile(
        join(DEMO, "output", "job.json"),
        JSON.stringify(snap, null, 2),
      );
      if (snap.status !== "success") process.exit(1);
      let savedVideo = false;
      for (const file of snap.outputs || []) {
        const params = new URLSearchParams({
          filename: file.filename || "output",
          subfolder: file.subfolder || "",
          type: file.type || "output",
        });
        if (file.id) params.set("id", file.id);
        const res = await fetch(`${BASE}/api/jobs/${job.id}/file?${params}`);
        if (!res.ok) {
          console.error("download failed", res.status, redact(await res.text()));
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const video =
          /video/i.test(`${file.type || ""} ${file.format || ""}`) ||
          /\.(mp4|webm|mov|mkv)$/i.test(file.filename || "") ||
          String(file.filename || "").includes("video/");
        const destName = video
          ? "open_product_swap_wan.mp4"
          : String(file.filename || file.id || "output").replace(/[^\w.-]+/g, "_");
        const dest = join(DEMO, "output", destName);
        await writeFile(dest, buf);
        console.log("saved", dest, buf.length);
        if (video) savedVideo = true;
      }
      if (!savedVideo) {
        console.error("Job succeeded but no video output was saved");
        process.exit(1);
      }
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function submitOnce(skipPartner) {
  const form = new FormData();
  const videoPath = join(DEMO, "input", "source.mp4");
  const skuPath = join(DEMO, "input", "sku_haven_ginger.jpg");
  form.append("video", new Blob([await read(videoPath)]), basename(videoPath));
  form.append("sku_sku-1", new Blob([await read(skuPath)]), basename(skuPath));
  form.append("pipeline", "wan-vace");
  form.append("skus", JSON.stringify([{ id: "sku-1", name: "Haven Ginger" }]));
  form.append(
    "prompt",
    "A person holds the amber Haven Ginger bottle. Photorealistic, original lighting, hands and motion unchanged.",
  );
  form.append("maskObject", "red soda can, can in the person's hand");
  form.append("durationSec", "1.5");
  form.append("width", "480");
  form.append("height", "480");
  form.append("frames", "17");
  if (skipPartner) form.append("skipPartner", "1");

  const submit = await fetch(`${BASE}/api/jobs`, { method: "POST", body: form });
  const body = await submit.json();
  return { ok: submit.ok, status: submit.status, body };
}

function isMissingPartner(body) {
  const msg = redact(JSON.stringify(body || {})).toLowerCase();
  return (
    msg.includes("flux3") ||
    msg.includes("flux 3") ||
    msg.includes("class_type") ||
    msg.includes("unknown node")
  );
}

function read(p) {
  return import("node:fs/promises").then((fs) => fs.readFile(p));
}

main().catch((err) => {
  console.error(redact(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});

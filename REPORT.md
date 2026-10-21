# Open Product Swap — report

## Architecture

Next.js 15 App Router (TypeScript, Tailwind) talks to **`COMFY_BASE_URL`**: a Comfy Build serverless deployment (`https://dep-xxxx.run.comfy.app`) or public Comfy Cloud (`https://cloud.comfy.org`, the default). Auth is the single env var `COMFY_API_KEY`, sent as `X-API-Key` and as `extra_data.api_key_comfy_org`. Nothing runs a local ComfyUI.

```
browser
  │  FormData: video + 1–5 SKU photos per SKU, batch list
  ▼
POST /api/jobs
  │  1. upload each file to {COMFY_BASE_URL}/api/upload/image (X-API-Key)
  │  2. load workflows/product-swap-{ltx|wan-vace}.json
  │  3. patch node 1 (video), node 6+ (SKU), prompts, seed
  │  4. POST /api/v2/jobs (fallback POST /api/prompt) with extra_data.api_key_comfy_org
  ▼
GET /api/jobs/[id]  →  GET /api/v2/jobs/{id}
                       fallback GET /api/job/{id}/status + history
GET /api/jobs/[id]/file  →  /api/view (follows signed URL without forwarding the key)
```

Batch mode: one source clip is uploaded once; the server submits **one Comfy job per SKU**.

The graphs are API-format JSON in [`workflows/`](workflows/). Node/input map: [`workflows/NODE_MAP.md`](workflows/NODE_MAP.md).

## Models

| Stage | Model | Weights | Role |
| --- | --- | --- | --- |
| Mask | SAM 3.1 multiplex `sam3.1_multiplex_fp16.safetensors` | Open | Text-prompted product mask (`SAM3_Detect`) |
| Keyframe | FLUX 3 Image (`Flux3ImageNode`) | Partner | Swap SKU into the first frame; hands stay |
| Video (default) | **LTX-2.3 22B distilled** + `ltx-2.3-22b-ic-lora-in-outpainting-0.9` | Open | Core video model (contest LTX bonus) |
| Video (alt) | Wan 2.1 VACE 14B + CausVid LoRA | Open | Masked video inpaint / ref2v |

Open-weights-only variant: skip `Flux3ImageNode` and use the SKU photo as `reference_image` / first-frame guide. Documented in `NODE_MAP.md`.

## How to run

```bash
npm install
export COMFY_API_KEY=comfyui-...   # https://platform.comfy.org/profile/api-keys
export COMFY_BASE_URL=https://dep-xxxx.run.comfy.app   # or omit for Cloud
npm run dev                        # http://localhost:3000
npm run typecheck
npm run build
```

Do not commit the key. `.env.example` lists placeholders only. Publish the spec in [`build/comfy-build.yaml`](build/comfy-build.yaml) with `comfy-cli` (see README “Run your own endpoint”).

## Sample output path

Attempted live run 2026-10-20 against `https://cloud.comfy.org` with the env key.

| Path | Result |
| --- | --- |
| `demo/input/source.mp4` | Source clip (person holding a can) |
| `demo/input/sku_haven_ginger.jpg` | Replacement SKU |
| `demo/input/source_frame.jpg` | First frame still |
| `demo/output/submit.json` | App-level submit response (402 from Cloud) |

Upload to Cloud **succeeded**. Queueing a workflow returned **402** `insufficient_credits` on both:

- `POST https://cloud.comfy.org/api/prompt`
- `POST https://cloud.comfy.org/api/v2/jobs`

The same key on Comfy Router (`POST https://api.comfy.org/v2/models/bfl/flux-3-image/requests`) also returned 402. No generated MP4 was written because Cloud would not enqueue. Re-run with credits: `node scripts/e2e.mjs` (server must be up).

## Open issues

1. **Cloud credits.** The provisioned `COMFY_API_KEY` authenticates and can upload inputs, but cannot queue workflows or Router models until the workspace has a subscription/credits.
2. **Partner keyframe.** FLUX 3 Image is a partner node. It needs `extra_data.api_key_comfy_org` (wired) and partner billing. The LTX/Wan video graphs stay open-weights if that node is bypassed.
3. **Mask quality.** `SAM3_Detect` is text-prompted; busy hands can leak. A points editor is not in the web UI yet (the graph accepts the prompt from the form).
4. **Duration / resolution.** Defaults are short (LTX 25 frames at 768×512, Wan 480²) to keep jobs cheap. Longer clips need `8n+1` frames on LTX and more GPU time.
5. **SaveVideo format widget.** `SaveVideo.format` is a dynamic combo; `auto` matches the official templates. If a worker rejects it, switch to `VHS_VideoCombine`.
6. **No browser MCP in this session.** UI was verified by production build + `/api/health` + `/api/jobs` against a running server, not a headed browser.

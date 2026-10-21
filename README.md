# Open Product Swap

Open-source product swap for video. An open alternative to [Higgsfield Genjutsu Object Swap](https://higgsfield.ai/blog/higgsfield-genjutsu) and Runway Product Swap.

Drop a short clip of a person holding a product, add 1–5 photos of *your* SKU, and the app replaces the held object while keeping hands, motion, and lighting. Batch mode runs **one video × many SKUs**. The ComfyUI graphs live in this repo and run on a **Comfy Build serverless deployment** (or public Comfy Cloud).

Built for the [Comfy Open Source Higgsfield](https://comfy.org/open-source-higgsfield) challenge (closes 30 Oct 2026, 9am PT).

## Why this is better than Higgsfield Genjutsu

| | Higgsfield Genjutsu Object Swap | Open Product Swap |
| --- | --- | --- |
| License | Closed product | **MIT**, graphs included |
| Models | Proprietary | **Open weights** path (SAM 3.1, Wan 2.1 VACE, LTX-2.3) plus optional FLUX 3 keyframe |
| Batch | One clip, one swap | **One clip × many SKUs** in one queue |
| Workflow | Hidden | **Editable API-format JSON** in [`workflows/`](workflows/) |
| Cost | Credits on a closed meter | Your Comfy credits on a serverless GPU (or Cloud) |
| Masking | Implicit | **SAM 3.1** text prompt you can edit (`can`, `bottle`, …) |

Higgsfield is a polished closed demo. This repo is the thing you can fork, inspect, and run.

## Pipeline

```
source video ─┬─ SAM 3.1 ── product mask (grown)
              │
              └─ first frame ─┐
SKU photos (1–5) ─────────────┴─ FLUX 3 Image edit ── product keyframe
                                                      │
                         ┌────────────────────────────┤
                         ▼                            ▼
              LTX-2.3 distilled              Wan 2.1 VACE 14B
              + in-outpainting IC-LoRA       + CausVid 4-step
              (core video model, contest     (open-weights inpaint)
               LTX bonus)
```

- **Masking:** SAM 3.1 multiplex (`SAM3_Detect`) with a text prompt.
- **Keyframe:** FLUX 3 Image (partner node) composites the SKU into the first frame. Hands stay.
- **LTX path (default):** green-screen the masked product (`LTXVInpaintPreprocess`), guide LTX-2.3 distilled with `ltx-2.3-22b-ic-lora-in-outpainting-0.9`.
- **Wan path:** `WanVaceToVideo` with `control_video`, `control_masks`, and the FLUX 3 keyframe as `reference_image`.

Node ids and patch points: [`workflows/NODE_MAP.md`](workflows/NODE_MAP.md).

## Run

You need a [Comfy API key](https://platform.comfy.org/profile/api-keys). The server reads **only** `COMFY_API_KEY` (sent as `X-API-Key` and as `extra_data.api_key_comfy_org` for partner nodes) and `COMFY_BASE_URL` (defaults to `https://cloud.comfy.org`).

```bash
git clone <this-repo>
cd open-product-swap
npm install
export COMFY_API_KEY=comfyui-...
# serverless deployment, or omit to use Cloud:
export COMFY_BASE_URL=https://dep-xxxx.run.comfy.app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Drop a video, add SKU photos, queue.

```bash
npm run typecheck
npm run build
```

Never put the key in a committed `.env`. `.env.example` lists placeholders only.

## Run your own endpoint

[`build/comfy-build.yaml`](build/comfy-build.yaml) is the Comfy Build spec (models + Comfy version). Publish it on [platform.comfy.org](https://platform.comfy.org), then point this app at the deployment URL.

```bash
pip install -U comfy-cli
comfy build push build/
comfy build release create build/ --target linux/nvidia --watch
comfy deploy up build/ --gpu rtx-pro-6000-server --region us --min 0 --max 1
```

Set `COMFY_BASE_URL` to the printed `endpointUrl` (for example `https://dep-xxxx.run.comfy.app`). When you are done:

```bash
comfy deploy stop build/
```

## Demo

Demo inputs and a prior Cloud submit log are under [`demo/`](demo/). A live Cloud queue returned 402 (no workflow credits on the test key). Point `COMFY_BASE_URL` at a running Comfy Build deployment and re-run `node scripts/e2e.mjs`.

## Stack

- Next.js 15 App Router, TypeScript, Tailwind
- `POST /api/jobs` uploads to `COMFY_BASE_URL`, patches the graph, submits, returns job ids
- `GET /api/jobs/[id]` polls `/api/v2/jobs/{id}` (falls back to `/api/job/{id}/status` + history)
- `GET /api/jobs/[id]/file` proxies outputs so the browser never sees the API key

## License

[MIT](LICENSE)

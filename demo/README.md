# Demo assets

## Inputs

| File | What |
| --- | --- |
| `input/source.mp4` | 3s 768×512 clip of a person holding a red “Ridge Cola” can (Ken Burns from the still) |
| `input/source_frame.jpg` | First-frame still |
| `input/sku_haven_ginger.jpg` | Studio SKU photo of the replacement bottle |

## Sample output

A live Comfy Cloud run was attempted from this repo with `COMFY_API_KEY`. Upload to `https://cloud.comfy.org/api/upload/image` succeeded. Queueing `POST /api/prompt` and `POST /api/v2/jobs` both returned **402** (`insufficient_credits` / “Subscription or credits required to queue workflows”). The same key against Comfy Router (`POST https://api.comfy.org/v2/models/bfl/flux-3-image/requests`) also returned 402.

When the workspace has Cloud credits, run:

```bash
export COMFY_API_KEY=comfyui-...
npm run build && npm start
node scripts/e2e.mjs
```

Outputs land in `demo/output/`.

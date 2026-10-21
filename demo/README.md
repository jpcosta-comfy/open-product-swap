# Demo assets

## Inputs

| File | What |
| --- | --- |
| `input/source.mp4` | 3s 768×512 clip of a person holding a red “Ridge Cola” can (Ken Burns from the still) |
| `input/source_frame.jpg` | First-frame still |
| `input/sku_haven_ginger.jpg` | Studio SKU photo of the replacement bottle |

## Sample output

Live Wan 2.1 VACE swap on 2026-10-21 (Comfy Build serverless, Cloud API v2). Job `f4989ed7-c16d-4653-8d75-624282d37d1d` succeeded. Outputs:

- `output/open_product_swap_wan.mp4` — H.264 480×480, 1.5s, 24 frames
- `output/open_product_swap_keyframe_00001_.png` — FLUX 3 keyframe
- `output/job.json` / `output/submit.json` — poll and submit records (no secrets)

To re-run:

```bash
export COMFY_API_KEY=your-api-key-here
export COMFY_BASE_URL=https://dep-xxxx.run.comfy.app
npm run build && npm start
node scripts/e2e.mjs
```

Outputs land in `demo/output/`.

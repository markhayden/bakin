# Evidence: Reranker Benchmark (#846, W4)

2026-09-19, target M4, antfly 0.2.2, ephemeral engine :3863 (temp data dir,
machine models read-only), 301-doc hybrid corpus (FTS + bge-small sem leg),
production wire shapes. Scripts: `~/eval-reranker-846/` (engine.log, bench.py).

## Query-integrated reranker (per-table `reranker` on /query)

Warm, n=20/cell, production hybrid body (rsf fusion), mxbai-rerank-base-v1:

| Cell | p50 | p95 | Δp95 vs control |
|---|---|---|---|
| no-rerank control (limit 10) | ~0ms | 147ms | — |
| rerank top-5 | 128ms | 168ms | +21ms |
| rerank top-10 | 150ms | 175ms | **+28ms** |
| rerank top-20 | 204ms | 229ms | +82ms |

- rc-era baseline was ~200ms/CANDIDATE (top-10 ≈ 2s) — the 0.2.1 Metal
  acceleration is real (~70x at top-10).
- **Backend: metal AUTO-SELECTS** for the pinned safetensors distribution —
  the rc-era `TERMITE_PREFERRED_BACKEND=metal` requirement is GONE (engine
  log: "selected backend metal for …mxbai-rerank-base-v1"). The distribution
  also ships `onnx/model.onnx`; not needed (metal wins, auto).
- Concurrency: 3-way top-10 all succeed (worst 464ms, stair-stepped — one
  Metal queue). **10-way: ~6/10 REJECTED 502** (admission control) —
  per-table rerank can never ride the global fan-out shape.
- Sanity: gold doc #1 by fusion stays #1 reranked (non-degradation); rc-era
  live check proved reorder correctness (0.998 vs 0.0006, defaults.ts note).

## Standalone `/ml/v1/rerank` (the global merged-list primitive)

Shape from antfly source (`RerankRequest`, antfly_inference_config_openapi):
`{ model, query, prompts: string[] }` → `{ data: [{index, score}...] }`
(OpenAI-style list; scores same order as prompts). Discovered after three
wrong guesses — `prompts`, not texts/documents.

Warm, n=15/cell: **~116ms p50 FLAT for 5, 10, and 20 prompts** (batched — a
20-text rerank costs the same as 5). Cold-ish first call ~400ms. Scoring
sharp: right doc 0.996, distractors ≤0.0002.

## Verdict (gate: Δp95 ≤300ms top-10 + fan-out inside 2s budget)

PASS → full design (Mark, 2026-09-19):
1. Single-table default-on: adapter attaches the reranker when the caller
   didn't specify, `reranker.enabled`, and a rerankField exists (+28ms).
2. Global search: ONE standalone rerank of the merged top-20 (+~116ms) —
   fixes the actual cross-table calibration weakness; per-table rerank on
   the fan-out stays off (502 evidence above).
3. multiQuery rerank serialization RETAINED (the 502 cap is real).
4. Model/pin unchanged (metal + pinned safetensors auto-select and win).

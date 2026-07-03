# Search Tuning — Why These Defaults

Measured record (spec T21). Engine: antfly dev build `6538c0774` + the
bakin#317 double-free patch (Zig, macOS arm64, Metal), local models
(`BAAI/bge-small-en-v1.5`, `antflydb/clipclap`, `mixedbread-ai/mxbai-rerank-base-v1`).
Measured 2026-07-03. Re-run: `bun tests/integration/antfly/tuning-run.ts`
(golden set + helpers in `tests/integration/antfly/golden-queries.ts`).

## Method

20-doc synthetic corpus (6 image-like docs whose pixels carry only color and
whose captions carry the semantics, 8 notes, 6 tasks) with 18 labeled queries
across five categories (caption / semantic / keyword / visual / conflict),
indexed into an assets-shaped table (full-text + text-embedding + media-embedding
legs). hit@1/hit@3 + mean end-to-end latency per config. Small and synthetic —
treat deltas as directional, magnitudes as approximate.

## Results

| config | hit@1 | hit@3 | visual h@1 | semantic h@1 | mean ms |
|---|---|---|---|---|---|
| rrf t0.5/v2 (inherited defaults) | 28% | 33% | 2/3 | 1/6 | 449 |
| rrf t1/v1 | 72% | 94% | 1/3 | 4/6 | 453 |
| rrf t0.5/v3 | 28% | 33% | 2/3 | 1/6 | 449 |
| rrf t1/v2 | 33% | 56% | 2/3 | 2/6 | 452 |
| rsf t0.5/v2 | 33% | 72% | 3/3 | 1/6 | 449 |
| **rsf t1/v1 (new defaults)** | **83%** | **100%** | **3/3** | **4/6** | **447** |
| rrf t0.5/v2 + rerank@10(title) | 94% | 100% | 2/3 | 6/6 | 4354 |

## Decisions

1. **Fusion default: `rsf`** (`settings.search.fusionStrategy`,
   `packages/adapter-antfly/src/defaults.ts`). At equal weights RSF beats RRF
   83% vs 72% hit@1 at identical latency. RSF's score-preserving
   normalization lets a decisively strong single leg (an exact caption match,
   a dead-on visual match) win outright; rank-only RRF dilutes it.
2. **Assets leg weights: balanced 1.0/1.0** (was text 0.5 / visual 2.0,
   `plugins/assets/index.ts`). The old skew was tuned for auto-generated
   image descriptions (noise). Post-enrichment (P2), images carry REAL
   vision-LLM captions/OCR in the text leg — the skew now lets color-similar
   swatches outrank exact caption matches (28% hit@1). Weight changes ride
   the table-config fingerprint, so the switch blue/green-migrates
   automatically on next boot; queries stay on the old table until the new
   one converges.
3. **Reranker: stays OFF by default, per-query opt-in.** +11pts hit@1 over
   the best non-reranked config but ~10× latency (4.35s mean over a 20-doc
   corpus; ~350-400ms/candidate serialized on one Metal queue). Right call
   for a bounded top-K on a single deliberate query; wrong as a default under
   multi-table fan-out. Revisit if upstream moves reranking off the
   serialized path.

## Caveats

- The corpus is synthetic and small; visual queries use color swatches as a
  CLIP proxy. Directionally solid (the same ordering held across three runs),
  but re-measure on real data if relevance feels off after launch — the
  golden set is designed to grow.
- The reranker row was measured on the OLD default base config; its hit@1
  gain partially reflects rescuing that config's bad first-stage ranking.
- Query latency (~450ms mean) is dominated by per-query embedding of the
  query text through both embedders. FTS-only queries are ~5-15ms.

## Upstream finding from this pass

Mixed corpora (docs the media template skips) leave embeddings-leg backfill
accounting stuck at `running` forever — filed as
[antflydb/antfly#319](https://github.com/antflydb/antfly/issues/319);
adapter workaround (idle-detection in `mapIndexStatuses`) + regression
pin/canary in `tests/integration/antfly/workaround-regressions.test.ts`.
Without it, every assets-table blue/green migration would park.

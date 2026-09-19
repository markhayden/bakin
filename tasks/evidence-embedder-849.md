# Evidence: Embedder Evaluation (#849, W5)

2026-09-19, target M4, antfly 0.2.2, ephemeral engine :3873 (temp data,
machine models read-only). Corpus: 250 REAL docs harvested read-only from the
live tables (tasks/memory/agent-lessons/workflows/brands). Query set: 17
auto-derived (12 title→doc + 5 shuffled-fragment), semantic lane ONLY
(isolates the embedder; hybrid would mask differences with FTS).
Script: `~/eval-embedder-849/eval.py`.

## Results

| | BAAI/bge-small-en-v1.5 (pinned, 384d) | Qwen/Qwen3-Embedding-0.6B-GGUF Q8 (1024d) |
|---|---|---|
| MRR@10 | **0.733** | 0.678 |
| Recall@5 | 14/17 | 14/17 |
| warm query p50 / p95 | **14 / 42 ms** | 81 / 90 ms |
| sync seed throughput | **49 docs/s** | 9 docs/s |
| Metal | auto-selects | auto-selects (warm 372 ms; suffix dirs resolve) |

**BGE-M3: untestable** — `antfly inference pull BAAI/bge-m3:safetensors@84790c1…`
fails DETERMINISTICALLY (3 attempts incl. fresh staging): `tokenizer_config.json`
→ HTTP 416 on resume / DownloadSizeMismatch fresh — upstream's pinned manifest
disagrees with what HF serves today. Upstream-ticket material.

## Verdict: KEEP bge-small (no switch)

The spec's bar was "clearly better retrieval quality with query latency ≤
current." Qwen3-0.6B fails both prongs on this corpus: slightly WORSE MRR
(equal recall), **~6× slower query embeds** (would sit on every interactive
semantic search), and **~5× slower ingest** (drags every rebuild event and
blue/green backfill). Its MTEB advantages (multilingual, long context) don't
apply to this English short-text corpus; 384 dims is matched to the workload.

Caveats recorded honestly: n=17 auto-derived queries (small; title-heavy),
single corpus snapshot. A future re-run should add hand-labeled hard queries
and BGE-M3 once upstream's pull manifest is fixed.

Cleanup: eval engine + data dir removed. The pulled Qwen3 distribution
(~610 MB, `~/.antfly/inference/models/Qwen/`) was DELETED with the verdict —
re-pull via `antfly inference pull Qwen/Qwen3-Embedding-0.6B-GGUF:q8-0-bundle-v1`.

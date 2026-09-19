# Spec: Reranker Default-On Revisit (#846)

W4 of the antfly/search follow-up arc. Empirical workstream: a benchmark
campaign decides the code change; the gate was fixed in the kickoff interview.

## Objective

Decide — with measurements, on the target M4, against antfly 0.2.2 — whether
the reranker flips default-on for hybrid searches, and which mxbai
distribution (pinned safetensors/Metal vs 0.2.1's quantized ONNX) we ship.
The `defaults.ts` comment's revisit condition ("if upstream gets the reranker
onto a faster path") is plausibly met by upstream #480/#588/#591.

## The Gate (decided)

Default-on for hybrid searches IFF, warm, on the M4:
1. **Δp95 ≤ 300 ms** for a bounded top-10 rerank vs the same query unreranked.
2. A **3-table concurrent reranked fan-out** completes inside the 2 s query
   budget (also re-probes whether the Metal-queue serialization in
   `client.ts multiQuery` is still required).
Miss either → stays opt-in; findings recorded in #846 + the defaults comment
updated with 0.2.2 numbers. rc-era baseline: ~200 ms/candidate, linear.

## Benchmark Protocol

- **Isolation:** ephemeral engine via the conformance harness
  (`spawnEphemeralAntfly`, temp data dir, machine models read-only) — never
  the prod engine on 3738. New model downloads (`antfly inference pull` for
  the quantized ONNX variant) are ADDITIVE under `~/.antfly/inference/models`
  and never touch the two pinned distributions.
- **Corpus:** ~300 realistic short docs (title+body, distinct topics) in one
  FTS+bge table; rerank field = body.
- **Matrix:** {safetensors/Metal, quantized ONNX (if pullable and loadable)}
  × {5, 10, 20 candidates} × 20 warm runs → p50/p95 per cell; plus the
  3-way concurrent fan-out cell (top-10 each) and one no-rerank control.
- **Backend note:** rc-era needed `TERMITE_PREFERRED_BACKEND=metal` for the
  safetensors distribution (auto-select → ONNX → MissingWeight); probe both
  auto and forced-metal on 0.2.2, record which works.
- **Sanity, not IR eval:** one seeded relevance case (known-best doc buried
  at fusion rank ~8) must surface top-3 after rerank for the winning config.
- Evidence file: `tasks/evidence-reranker-846.md` (protocol output tables).

## FINAL DESIGN (post-discovery, Mark-approved 2026-09-19)

Benchmarks: `tasks/evidence-reranker-846.md`. Gate PASSED; discovery of the
standalone `/ml/v1/rerank` endpoint (`{model, query, prompts[]}` → scores,
~116ms FLAT for 5-20 prompts, batched) replaced the per-table global option:

1. **Single-table default-on** — ADAPTER-side (D17-clean): translate attaches
   the reranker when the caller left `q.rerank` undefined, `reranker.enabled`
   is true, and the query carries a rerankField. Explicit `rerank: false`
   always wins. `reranker.enabled` default flips to true with the 0.2.2
   numbers in the comment.
2. **Global merged rerank** — `SearchAdapter` gains OPTIONAL neutral
   `rerank(query, texts) => Promise<number[] | null>` (null = unavailable/
   disabled/failed — honest degrade to fusion order, never an error).
   Antfly impl via `/ml/v1/rerank`; mock adapter gets a lexical fake.
   `crossTableSearch` reranks its merged top-20 (texts from each hit's
   rerankField, bounded length) and keeps fusion order beyond.
3. Per-table rerank on the fan-out stays OFF (10-way = 502 storm, measured);
   the multiQuery serialization guard is RETAINED.
4. No model/pin change (metal auto-selects the pinned safetensors and wins).

## Code Change (superseded original plan)

- **PASS:** `reranker.enabled: true` default + investigate/set a bounded
  candidate count for default reranks (plan phase determines the engine's
  top-K control; if the engine reranks all `limit` docs, bound via the wire
  request); update the defaults comment with the numbers; if ONNX wins,
  add its files to `model-pins.ts` (verified hashes) and switch
  `reranker.model`/provider accordingly; remove the multiQuery rerank
  serialization if the concurrent cell shows it unnecessary (keep if within
  budget only WITH serialization).
- **FAIL:** no default change; findings + numbers into #846 (close as
  answered) and the defaults comment; keep serialization as-is.

## Commands

Benchmark runs via a script in the eval dir (`~/eval-reranker-846/`), suites
via `bun test tests/adapter-antfly tests/integration/search-conformance
--isolate`; typecheck/lint as always.

## Boundaries

- Always: ephemeral engines only; additive model downloads; evidence file
  records every cell including failures.
- Ask first: shipping a default-on that only passes WITH serialization
  (latency stacking risk on fan-out) — present numbers first.
- Never: benchmark against the prod engine; unpinned model files shipped as
  default; default-on on a failed gate.

## Commit Strategy

Branch `feat/search-reranker-846`. Commit 1: evidence file + (if PASS)
defaults flip + bounded-candidates wiring + tests; commit 2 (only if ONNX
wins): model-pins entry + provider/model switch. FAIL outcome = docs-only
commit (defaults comment + evidence) closing #846 as answered.

## Open Questions

None — gate and scope fixed in the kickoff interview.

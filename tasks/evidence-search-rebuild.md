# P0 Evidence — Search & Asset Rebuild

Working evidence log for `tasks/plan-search-rebuild.md`. Everything here is live-verified on this machine; dates are absolute.

## P0.1 — Dev binary build recipe

- **Source:** `/Users/roscoe/go/src/github.com/antflydb/antfly-main` — detached git worktree of `antflydb/antfly` at `origin/main` = **`6538c0774`** (2026-07-02, "Merge PR #311 runround-notleader-diagnostics"). Created via:
  ```sh
  git -C /Users/roscoe/go/src/github.com/antflydb/antfly worktree add ../antfly-main --detach origin/main
  ```
- **Toolchain:** zig **0.16.0** (repo `minimum_zig_version = "0.16.0"`), NOT on PATH — lives at `/Users/roscoe/toolchains/zig-aarch64-macos-0.16.0/`. `uv` (for the onnx download script) at `/opt/homebrew/bin/uv`.
- **Build invocation:**
  ```sh
  cd /Users/roscoe/go/src/github.com/antflydb/antfly-main
  PATH="/Users/roscoe/toolchains/zig-aarch64-macos-0.16.0:$PATH" make -C zig build
  # = download-onnx (ONNXRUNTIME 1.24.3 + GenAI 0.12.1) + zig build install
  # output: zig/zig-out/bin/antfly
  ```
- Status: build in progress (started 2026-07-02). `--version` reports `antfly dev (zig runtime)` — no commit stamp; track provenance via this file.
- Note: a stale pre-existing binary sits in the ORIGINAL checkout (`antfly/zig/zig-out/bin/antfly`, built 2026-07-02 15:28 from `verify-main-rc14` @ `c3d0b3d21`) — do NOT confuse the two. The rebuild uses only the worktree binary.

## P0.2 — Workaround verdicts (live verification)

### 🔴 NEW UPSTREAM BUG FOUND (P0.2 finding #1): batch-write double-free segfault

- **Symptom:** server segfaults processing `POST /db/v1/tables/{t}/batch` — first contact killed the whole probe suite twice (2/2 runs); stripped-down repros pass because the trigger is an *internal job error* (most likely batch-vs-table-still-provisioning timing right after create), not the request shape.
- **Root cause (by inspection, `zig/pkg/antfly/src/api/httpx_handler.zig:186-198` @ `6538c0774`):** `handleTableBatchOffEventLoop` registers `errdefer job_alloc.free(...)` AND `defer job_alloc.free(...)` for BOTH `owned_table_name` and `owned_body_data`. Any error return after the defers register — `try runtime_io.concurrent(...)` failing, or `if (job.err) |err| return err` when the offloaded batch job fails — runs errdefer + defer → **double free → segfault**. So ANY failed batch crashes the server instead of returning 500. Present in rc.17 too (file identical rc.17→main). rc.9 predates the off-event-loop offload path entirely, which is why the current pin never hit it.
- **Local patch applied to the dev worktree:** replace the errdefer+late-defer pattern with `defer` immediately after each `dupe` (idiomatic, covers both paths, no double free). Worktree is now `6538c0774 + this patch` — provenance matters for every probe result below.
- **Filed upstream: [antflydb/antfly#317](https://github.com/antflydb/antfly/issues/317)** (with the fix). Patched rebuild confirmed: same trigger now yields an error response, node stays up, full probe suite survives.
- Local patch retained at `tasks/antfly-main-local-patches.diff` (re-apply to a fresh worktree with `git apply`). The dev binary provenance is `6538c0774 + this patch` until upstream merges a fix.

### Verdict table (live, vs patched dev binary @ 6538c0774; probe scripts in session scratchpad)

| rc.9 workaround / behavior | Verdict on main (Zig engine) | Consequence for the adapter rewrite |
|---|---|---|
| `filter_query` zeroes hits | **FIXED** — returns correct filtered hits (2/2 expected) | DELETE filter-in-AST workaround; send `filter_query` |
| Semantic hits can't be server-filtered | **FIXED** — `filter_query` filters the semantic lane (verified exclusion) | DELETE client-side `hitMatchesFilters` post-filter |
| `rebuilding=true` never finalizes | **FIXED** — converges to `false`, `backfill_state: "ready"` | DELETE readiness heuristics; trust `/tables/{t}/indexes` |
| Image enrichment rejects embedders (finding 8) | **FIXED** — clipclap + `file://` media doc indexes cleanly | Visual leg works end-to-end |
| CLIP text-embed broken (finding 9) | **FIXED** — text query vs visual index returns the image | Text→image search works |
| Bare `{query}` matches nothing (`_all`) | **FIXED** — but keep field-scoped queries anyway (better relevance control) | No behavior change needed |
| `order_by` rejected | **STILL UNSUPPORTED on Zig** — hard-rejected in `query_contract.zig:1804` (`analyses`/`search_after`/`search_before`/`join` too). NOTE: the Go server supports it — earlier "fixed on main" verdict was Go-only. | Keep not sending order_by; document Zig-vs-Go skew |
| Totals page-scoped without `count:true` | **UNCHANGED** — limit=2 → total=2 (FTS and semantic) | KEEP `count:true` companion for true totals |
| `semantic + offset>0` hard 400 | **UNCHANGED** | KEEP offset gating |
| `sync_level: 'aknn'` | **REMOVED** — 500 on use; `full_index` accepted | Translation must use `full_index` |
| No server-side query cancellation | Unchanged (Zig `/cancel` is agent-runs only) | KEEP abandon-on-timeout |

### New wire-contract facts (main vs rc.9) — adapter `translate.ts` requirements

- **Query response is wrapped**: `{"responses":[{hits:{total,hits:[...]},...}]}` even for single-table POST `/db/v1/tables/{t}/query`. Hits carry **`_id`** (not `key`), `_score`, `_index_scores`, `_source`, `_sort`.
- **`_index_scores` uses NEUTRAL leg keys**: `{"full_text": 0.75, "sem": -0.19}` — the full-text leg is literally `full_text` (no more absolute-filesystem-path bleve keys). Generic `scoreBreakdown` (D17) maps 1:1; embedding legs still report `-cosine_distance`.
- **Index status endpoint**: `GET /db/v1/tables/{t}/indexes` → `[{config, status}]` with `rebuilding`, `total_indexed`, `backfill_state`, `doc_count`, replay/catch-up/merge detail — feeds `tables.health()` per-leg.
- **`merge_config.strategy: 'rsf'` accepted** — the T21 tuning comparison is live-possible.
- **`count: true`** returns true totals with empty hits — unchanged mechanism.
- `/readyz` on `--health-port` semantics unchanged (`{"status":"ready"}`).
- ⚠ readyz ≠ table-writable: a batch immediately after table create can fail internally while the shard group settles (this error path is what the double-free crash rode on). The outbox's retry-on-transient covers it; the conformance harness should also tolerate it.

## P0.3 — SDK sourcing decision (DECIDED)

- npm `@antfly/sdk` latest = `0.0.14`, published **2026-03-19**; dist-tag mechanism exists (`ts/antfly/sdk/v0.0.14` tag) but no publish since.
- `git log --since=2026-03-19 origin/main -- ts/packages/sdk` → **77 commits** the npm artifact lacks, including the `sync_level` enum change (`aknn` removed → `full_index`), artifact/enrichment API surface (PR #274/#301), model-pull helpers, regenerated `public-api.d.ts`.
- Upstream never bumps the package version string (still 0.0.14 in-source), so version-matching is meaningless — **content is tag-driven**.
- **Decision (per D1):** build the vendored tarball from `ts/packages/sdk` at the SAME commit as the dev binary (`6538c0774`); replace `vendor/antfly-sdk-0.2.0-rc.2.tgz`. Re-evaluate npm at ship time (T23): if upstream cuts a fresh `ts/antfly/sdk/v*` tag matching the ship pin, switch to npm and delete the tarball.

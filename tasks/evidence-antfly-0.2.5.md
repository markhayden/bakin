# Evidence: Antfly 0.2.5 Evaluation (repin gate)

## GATE VERDICT: PASS — ADOPT (2026-10-18)

Every rung green. One code-facing change: 0.2.5's secure defaults (upstream
#898) deny `file://` in remote templates unless
`remote_content.security.allowed_paths` names the directory, and Bakin embeds
assets by `file://` URL — so on 0.2.5 as shipped every batch carrying an image
500s whole, text docs included. Bakin now passes `--config` with the asset
store allowlisted (`renderEngineConfig`, `~/.bakin/antfly-engine.json`). No
workaround pins flip.

Prior gate: `tasks/evidence-antfly-0.2.2.md` (0.2.2 adopted 2026-09-18).
Candidate: v0.2.5 (published 2026-09-28). 0.2.3 is ~18 v0.2.x backports
(metadata/runtime/backup/secrets fixes, exact aggregations during concurrent
index publication #794, shutdown worker races #853, reranker query fixes
#848); 0.2.4 has no published release; 0.2.5 adds #886 (legacy graph artifact
metadata) and #898 (secure deployment defaults). v0.3.0-rc.1 (2026-10-18) was
NOT taken: a release candidate, it drops the `onnx` backend, and it regresses
clipclap's ONNX variant on every platform (filed antfly#1201).
Machine: the target M4 (macOS) plus linux-arm64/x64 containers. Every engine
ran on scratch ports with scratch data dirs and machine models symlinked
read-only; the live `io.bakin.antfly` service and `~/.antfly` were untouched.

## Gate Verdict Table

| Rung | Verdict | Evidence |
|---|---|---|
| T1 binary + checksum | **PASS** | SHA256 `4fc5a948…` (Darwin_arm64), `ad166bed…` (Linux_arm64), `d123bd0f…` (Linux_x86_64) exact vs `v0.2.5/antfly_zig_checksums.txt` |
| T1 version/subcommand | **PASS** | `antfly 0.2.5 (zig runtime)`; `standalone` + every flag Bakin passes survive; `--config <path>` is the JSON common config file |
| T1 watchdog byte-grep | **PASS — patterns intact** | workaround suite's signature pin (`catch-up debt persists`, `StorageReadTemporarilyUnavailable`) green |
| **NEW: `file://` media default (#898)** | **BREAKING → HANDLED** | Without config: image+text batch → 500 `batch failed`, engine log `remoteMedia fetch failed error=PathNotAllowed`. With `--config` allowlisting the media dir: 201, both docs inserted. Pinned by workaround-regressions "file:// media needs Bakin's engine config" |
| Workaround pin suite + search-conformance | **32/32 PASS** | `BAKIN_ANTFLY_BIN` at the verified 0.2.5 binary; the two media GUARD tests failed (500) before the engine config, pass after; order_by still 422 and undecodable media still poisons its batch — no pins flip |
| Chaos drills (5) | **ALL PASS** | engine-SIGKILL resume, process-SIGKILL resume, 550-write outage drain (550/550, re-enqueue no-op), wipe+rebuild, upgrade-under-load (73/73 landed) |
| Backfill pacing (20k) | **PASS** | 20k-doc bge table to ready in 312–322 s (62–64 docs/s; 0.2.2: ~65–70) |
| #617 add-leg-to-populated (20k) | **PASS** | sem2 on the populated 20k table: 201, worker started in 2 s (0.2.2: 10 s), converged 20k/20k in 1,113–1,159 s (17–18 docs/s; 0.2.2: ~20) |
| Reindex-under-load HTTP starvation | **PASS — heavier than 0.2.2's rung** | **318** build→fill→query→drop cycles of the assets shape (bge text leg + clipclap `remoteMedia` leg, 55 docs in sync `full_index` chunks of 10, 15 images) run continuously for the whole 18.5-min sem2 catch-up: **1,321 probes (status, control read, control write), 0 failures**, worst status 2 ms / read 900 ms / write 902 ms (0.2.2 rung: 3 cycles, 316 probes, worst 411 ms) |
| Model compat + pins | **PASS** | 0.2.5's own pulls of `antflydb/clipclap:gguf:Q4_K`, `BAAI/bge-small-en-v1.5`, `mixedbread-ai/mxbai-rerank-base-v1` are byte-identical to every `model-pins.ts` sha256 → pins unchanged; Linux container load probes record all three `loadable` on `engineVersion 0.2.5` |
| Linux end-to-end (container check) | **16/16 PASS** | `scripts/dev/search-container-check.ts` on HEAD (linux-arm64): install search + models, every model loads (`engineVersion 0.2.5`), server boots, search 200, **an imported PNG asset is embedded by the media leg (`assets_visual total_indexed=1`) and re-embedded from the asset store by the reindex**, the engine log never shows `PathNotAllowed`, reset, visible-wait reindex, tray |

## Leg status on mixed corpora (not a regression)

On 0.2.5 a media leg over a mixed corpus (some docs without `media_url`)
reports `backfill_state: "degraded"`, `readiness.state: "failed"`,
`pending_reasons: ["enrichment_failure", "coverage"]` with `worker_failed:
false` and zero fatal errors. The same table on a checksum-verified 0.2.2
reports byte-identical fields, so this is pre-existing engine behavior.
`mapIndexStatuses` maps it `ready` (`degraded` is the sticky-honest scar;
`pendingReasons` is evidence only — no health verdict reads it).

## `400 invalid query request` in container logs (not a regression)

The Linux container check's first `/api/search` runs moments after boot,
before Bakin has provisioned its tables, so it queries logical names
(`bakin_memory`, no `_v…` suffix) that don't exist yet. Both 0.2.2 and 0.2.5
answer a query against a missing table with `400 invalid query request`, and
Bakin serves the labelled scan fallback. Against a real table Bakin's exact
hybrid request is 200 on 0.2.5 with the hit scored on both the full-text and
vector legs (`_index_scores`). Every saved container log back to the first
#993 commit shows the same pattern.

## Release/Wire Notes

- `remote_content.security.allowed_paths` is canonical-path checked (symlink
  and sibling-prefix escapes rejected) — Bakin passes the canonical asset
  store, never the Bakin home (`secrets.json`). The config lives at
  `~/.bakin/antfly-engine.json`, outside the data dir a version change wipes,
  and is rewritten (atomic, only on change) before every launchd/systemd/child
  start. Changing the argv rewrites the unit → one engine restart on upgrade.
- #898 also: CORS denies cross-origin by default (Bakin is a server-side
  client — unaffected), authenticated deployments need a bootstrap password
  (Bakin runs without `--auth` — unaffected).
- Linux stays on the static (`Linux_*`) tarballs: the static-only GGUF+ONNX
  artifact mix-up (antfly#1202) needs an install Bakin no longer creates
  (`MODEL_PULL_VARIANTS`, #993), and `*_gnu` would break musl hosts.

## Cutover (post-merge, per machine)

1. `bakin install search` — downloads + SHA256-verifies 0.2.5, writes
   `~/.bakin/antfly-engine.json`, re-provisions the unit with `--config`, and
   treats the version change as a REBUILD EVENT (derived data dir cleared →
   repair reindex regenerates at ~60 docs/s).
2. `bakin install search-models` — re-pulls clipclap as its GGUF variant
   (drops the unused ~1.4 GB ONNX set) and re-probes every model on 0.2.5.
3. `bakin check search` + `bakin check search-models` green; image assets
   reappear in visual search once the reindex converges.

## Repro scripts

In-repo now (the 0.2.2 rung scripts lived outside it and were lost):
- `bun scripts/dev/antfly-repin-rungs.ts <antfly-binary>` — 20k backfill,
  add-leg-to-populated, sustained starvation cycles + probes.
- `bun scripts/dev/antfly-mixed-corpus-status.ts <antfly-binary> <port>` —
  media-leg status on a mixed corpus; run it on the old and the new pin.
- `BAKIN_ANTFLY_BIN=<binary> bun scripts/dev/search-chaos-drills.ts` and
  `BAKIN_ANTFLY_BIN=<binary> bun test tests/integration/search-conformance tests/integration/antfly --isolate`.
- `bun scripts/dev/search-container-check.ts` (Linux, real engine, HEAD).

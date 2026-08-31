# Evidence: Antfly 0.2.0 Evaluation (Hard Gate)

## GATE VERDICT: PASS — ADOPT (2026-08-31)

Every rung green. All four dossier blockers (#382/#383/#384/#386) are locally
disproven on 0.2.0 despite two of them being closed upstream without evidence.
The rc.21 killer (R4 concurrent embed writes) survived 45 min / 9,843 batches.
Reindex-under-load — the headline requirement — is FIXED (194× median query
latency improvement, zero failures vs 15 on rc.18). Two NEW 0.2.0 bugs found
(neither on Bakin's production path, both ticketed): the add-leg-to-populated-
table wedge and the silent inline-index no-op — the latter forces the T8
provisioning change (per-index endpoint creates). Backfill throughput is paced
(~4 docs/s, unchanged from rc.18); Bakin-side sync-write backfill is the lever.

Spec: `SPEC.md` · Plan: `tasks/plan-antfly-020-adoption.md` · Started 2026-08-30.
Machine: `roscoe@100.91.112.69` — Apple M4, macOS 26.6 (25G72), darwin-arm64.
Eval root: `~/eval-antfly-020/` (ephemeral data dirs, ports 3843/3844 engine A
FTS-only, 3853/3854 engine B with models). Live rc.18 launchd service untouched.

## Gate Verdict Table

| Rung | Verdict | Evidence |
|---|---|---|
| T1 binary + checksum | **PASS** | SHA256 exact match vs `v0.2.0/antfly_zig_checksums.txt` |
| T1 subcommand | **CONFIRMED `standalone`** | `swarm` = "unknown subcommand"; flags compatible |
| T1 wire probes | **PASS with findings** | see Wire-Contract Findings |
| T1 model compat | **PASS** | clipclap GGUF warms on Metal 4281 ms, no MissingWeight |
| T2 R1–R3 + empty-dir | **PASS** | create/batch/query/scan/get all green on EMPTY data dir |
| T3 R4 concurrency soak | **PASS** | 45 min, 9,843 batches all 201, zero query blips, engine alive |
| T4 #382 poison-read | **PASS** (whole-batch poison remains → EMBED_SAFE_RE stays) | see T4 |
| T4 #386 hot-queue drop | **PASS** | drop with pending enrichment + in-flight maintenance survives |
| NEW: add-leg-to-populated-table wedge | **FOUND — not Bakin's flow; upstream ticket** | see T6 findings |
| T5 #383 version round-trip | **PASS — refusal both ways, no silent migration** | see T5 section |
| T6 reindex crucible + rc.18 baseline | **PASS — availability fixed (194× median, 0 failures)** | see T6-A2/T6-B |
| T7 #319 scale repro (media + text-skip, interrupted) | **PASS — lying flags fixed; new sticky-honest `degraded` state** | see T7 |

## Release Facts

- `v0.2.0` published 2026-08-11 (tag `ec260b5e8`), tarball `antfly_0.2.0_Darwin_arm64.tar.gz`,
  SHA256 `82690d5c7e7cac5f7cd56c46ced8f4dd9acace577fb7982060667bcdb2632db6`
  (Linux_arm64 `a4993e854f…`, Linux_x86_64 `1eb63abba8…`). `latest` == 0.2.0.
- `--version` → `antfly 0.2.0 (zig runtime)`.
- Tarball layout grew: `antfly` + `include/`, `lib/`, `share/`, LICENSE, README
  (installer extract path must tolerate the extra dirs).
- Upstream issue closures: #317/#322/#350/#386/#384 closed pre/at release;
  **#382 + #383 closed 2026-08-30 by maintainer, no comment/commit/fix-version —
  unverified, tested locally below.**

## Subcommand + Service Surface

- Server subcommands: `data`, `metadata`, `standalone`, `inference`,
  `serverless`, `lite`, `ha`. **`swarm` is gone** — flip to `standalone` at the
  three spawn sites + harness default confirmed as the T8 change.
- `standalone` flags: `--host --port --health-port --data-dir --models-dir
  --preload-model` all survive (argv shape compatible). New: `--health`,
  `--config`, `--storage-engine lite`, inference budget overrides,
  `--control-tick-ms`, ARD/A2A options.
- Health endpoint moved `/health` → `/healthz` on the health port. INERT for
  Bakin: readiness probes ride `GET /db/v1/tables` on the public port
  (`client.ts` `paths.tables()`); `--health-port` only appears in argv.
- Log format unchanged (same JSON lines + a few plain lines as rc.18) —
  `server-logs.ts` filter rules still need a T8 re-check against 0.2.0 output,
  but no format break.

## Wedge-Pattern String Audit (binary byte-grep)

| String | rc.18 | 0.2.0 | Consequence |
|---|---|---|---|
| `catch-up debt persists` | present | **present** | #350 byte-grep pin still passes; pattern stays |
| `error.SendFailed` | present | **GONE** | pattern is a dead letter on 0.2.0 → remove/re-baseline |
| `error.TableReadChurn` | present | **GONE** | same |
| `error.ReadUnavailable` | present | **GONE** | rc.20 storm cannot emit under this name → supports T14 removal |

## Wire-Contract Findings (engine A, empty data dir, FTS probes)

Raw battery: `~/eval-antfly-020/probes.sh` output, 2026-08-30.

| Probe | rc.18 pinned | 0.2.0 observed | Consequence |
|---|---|---|---|
| create table `{num_shards:1}` on EMPTY dir | rc.20 died mid-create | **200**, richer response (`field_capabilities`, `artifact_enrichments`) | rc.20 killer gone |
| batch insert `sync_level: full_index` | 201 | **201 `{"status":"committed"}`** | unchanged |
| totals | corpus-true `{value,relation}` | **same** (`{value:3,relation:"exact"}`) | GUARD holds |
| `order_by` inferred field | 422 | **still 422** `unsupported_exact_sort/unmapped_field` (now with structured rejection fields) | PIN HOLDS — no sort; but `field_capabilities` suggests schema-mapped sort is reachable → enhancement ticket |
| `filter_query` + `match_phrase` | 400 | **200, filters correctly** (1 hit) | **PIN FLIPS → T11 remove `composeFtsWithFilters`** (pending e2e keyword-eq re-probe) |
| `/lookup` | 405 | 405 | unchanged (CLI `lookup` verb exists; REST stays `/documents`) |
| `/documents` bodyless | ≥400 | **200** | **PIN half FLIPS → clean up client.scan** |
| `sync_level: aknn` | ≥400 | 400 `invalid batch request` | pin intact |
| `timeout_ms` | accepted; 504 on breach | accepted (200; corpus too small to force 504 — crucible will exercise) | keep; verify at T6 |
| composed-FTS canary (conjuncts + match_phrase) | works | works (2 hits) | migration-safe either way |
| GET `/documents/{id}` | 200 | 200 | unchanged |
| DELETE `/documents/{id}` | (unused) | 405 | inert — adapter deletes via batch `deletes[]` |
| `/ml/v1/*` move | n/a | no adapter impact — no ML HTTP calls; models are filesystem distributions | none |

## CRITICAL FINDING: inline embeddings indexes are silently dead

**0.2.0 accepts the rc.18 inline `indexes:{...}` map at table-create (200, config
stored and echoed faithfully) but NEVER starts the enrichment worker** —
`enrichment_runtime: {enabled:false, worker_started:false, processed_requests:0}`
forever, `backfill_state:"running"` forever, zero log lines. Reproduced for both
media (clipclap) and text (bge) legs on engine B.

**Working path: the dedicated index-create endpoint**
`POST /db/v1/tables/{table}/indexes/{name}` with the same body
(`{"type":"embeddings","template":…,"embedder":…,"dimension":…,"distance_metric":"cosine"}`)
→ 201, `worker_started:true`, backfills pre-existing docs, `backfill_state:"ready"`,
semantic queries return correct results (`semantic_search` string + `indexes:[…]`,
score = distance). Quickstart docs confirm this endpoint as the blessed path.
(Bare `POST …/indexes` without the name is 405; CLI `index create` needs `--type`.)

**Forced adapter change (T8): split table provisioning** — create table, then
create each embeddings leg via the per-index endpoint. FTS default leg
(`full_text_index_v0`) auto-creates and works. Filed-worthy as a silent-failure
bug upstream (accepting + storing config that will never run).

## Index-Status Surface (0.2.0)

Much richer per-leg status: `backfill_state` (`running|ready`), `runtime_present`,
`runtime_fresh`, `catch_up_*`, `repair_*`, `resolution`, `promotion`, `text_merge`,
and a ~40-field `enrichment_runtime` (incl. `worker_started`, `stalled`,
`skip_by_hash_count`, `skipped_source_count`, `fatal_error_count`, embed batch
counters/timings). `mapIndexStatuses` gets strictly more signal than rc.18.

**Empty-table honesty: FIXED.** A never-written table reports
`rebuilding:false, backfill_active:false, backfill_state:"ready"` —
**the empty-table PIN FLIPS → T12 remove the `!runtime` idle block.**

## T2 — R1–R3 + empty-dir (PASS)

On engine A (EMPTY data dir): boot clean (3 log lines, listening), table create
200, 3-doc batch 201, match_all query 200 with corpus-true totals, doc GET 200,
`/documents` scan 200, second table create 200. The rc.20 empty-dir mid-create
exit did not reproduce.

## T3 — R4 concurrency soak (PASS)

45 min 3-stream soak completed 2026-08-31 ~05:07Z: **9,843 batches (3,599 +
3,628 media / 2,616 text), every one 201; engine alive throughout; every 10 s
query probe 200.** Final embed state: soakm1 ti 14,396 / soakm2 ti 14,512 /
soakt1 ti 20,928 — all `ready`, pending 0, fatal 0, not stalled. rc.21 died in
51 s under this shape. CPU sustained ~140–250%, RSS grew 0.4 → 4.6 GB over the
run (no OOM; flag for burn-in memory watch).

## T4 — #382 poison-read + #386 hot-queue drop (PASS)

**#382:** undecodable-media `full_index` batch → 500 (whole-batch poison STILL
exists — the EMBED_SAFE_RE pin HOLDS, T13 stays retained) — but unrelated-table
reads stayed 200 immediately and after idle. No engine-wide ReadUnavailable
flip; the poisoned-read state of rc.20/21 is gone (its error string no longer
exists in the binary). Failed batch is atomic: neither doc retrievable (404).

**#386:** DROP with a hot enrichment queue (200-doc async media batch, pending
sequence registered, bounded maintenance in flight — log:
`structural reconcile waiting for bounded maintenance attempts=16`) → 204,
engine alive, no Metal errors, subsequent queries 200. Combined with 45 min of
concurrent embed load: the dossier crash does not reproduce.

## T6 finding — add-leg-to-POPULATED-table wedge (NEW upstream bug, not Bakin's flow)

Adding a second embeddings leg (`POST …/indexes/sem2`) to a table already
holding 20,928 docs + one ready embeddings leg produced a severe wedge:

- sem2 worker never starts (`worker_started:false` 10+ min), leg stuck `running`.
- The TABLE becomes unreadable: queries/writes hang to client timeout (no HTTP
  status at all), log spams `error.StorageReadTemporarilyUnavailable`.
- **Writes stall ENGINE-WIDE** while the wedge is live (async write to an
  unrelated table also hangs) — reads on other tables keep working.
- **SIGTERM is ignored** while wedged (process still at 95% CPU 2+ min after
  kill; needed SIGKILL).
- **The wedge is durable across restart**: after force-kill + clean boot, other
  tables are fully healthy (reads AND writes fast — the global write stall does
  not survive), but the poisoned table stays unreadable, all its legs
  `running`/ti 0, silent ~50–60% CPU spin, no self-heal in 4+ min.
- **Repair works:** DELETE of the wedged table exceeds a 30 s HTTP timeout but
  completes (404 afterward); engine healthy after. Blue/green drop-and-rebuild
  (the existing search-spin repair) is the correct remedy.

Bakin never adds legs to populated tables — blue/green creates empty tables,
adds legs, then backfills by writing (validated separately below). Action:
upstream ticket with the scale-dependent repro (tiny tables don't wedge —
tsmoke2 with 1 doc backfilled fine); Bakin-side, the T8 provisioning change
must keep the strict order create-table → create-legs → first write.

## T6-A2 — production-shape reindex crucible (0.2.0)

Empty `soakt2` + sem leg via endpoint → worker starts immediately on first
write; 20,000 docs pumped async in **7 s**; enrichment drains under a 5 q/s
mixed query load.

**Availability under reindex: PERFECT.** 10,483 queries over the first 40 min
of backfill, **zero non-200s**:

| Query type | n | non-200 | p50 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| FTS on backfilling table | 3,495 | 0 | 1 ms | 1 ms | 1 ms | 8 ms |
| semantic on backfilling table | 3,494 | 0 | 1 ms | 5 ms | 17 ms | 737 ms |
| FTS on unrelated table | 3,494 | 0 | 1 ms | 1 ms | 1 ms | 6 ms |

This is the headline requirement ("reindex makes search slow or unusable")
answered: on 0.2.0, queries are effectively unaffected by a full backfill.

**Embed drain throughput: SLOW and suspiciously paced.** ti climbs perfectly
linearly at ~4 docs/s (1,200 docs per 300 s poll window, zero variance) with
`active_embed_batch_items: 0`, `embed_batches_completed: 0`,
`last_embed_batch_items: 0` — the backfill is NOT using the batch-embed path;
it looks like a fixed-rate single-doc catch-up loop (~250 ms/doc), not compute
saturation. Small corpora don't show it (tsmoke2 backfilled instantly). 20k
docs ⇒ ~83 min. Upstream perf ticket material + rc.18 baseline comparison
below decides how loudly. (Contrast: soak-time enrichment of freshly WRITTEN
docs sustained ~7.7 docs/s per text table while sharing Metal with two clipclap
streams — and write-path `sync_level: full_index` batches of 8 completed in
~1 s each. The slow path is specifically the provisioned backfill/catch-up.)

**Bakin-path consequence (feeds T8/T15):** Bakin's blue/green backfill writes
`{ sync: false }` (`packages/core/src/search/tables.ts:293`) — the exact path
that rides this slow catch-up loop. The async choice was an rc.18-era
constraint (`translate.ts:299-302`: "full_index on 50-doc chunks serializes
behind one Metal embed queue" + the concurrent-write crash that forced the
process-wide gate). The T3 soak proves concurrent `full_index` writes are now
safe AND fast (~30–40 docs/s combined embed throughput across 3 streams). So
the de-hardening phase has a concrete reindex-speed win available: backfill
with sync chunks, potentially concurrent once the write gate is removed —
measure as the T15 before/after.

3 concurrent streams, 45 min, against engine B: 2× media batches (4 docs/batch,
60 distinct PNGs, clipclap/Metal) into `soakm1`/`soakm2` + 1× text batches
(8 docs/batch, unique text, bge) into `soakt1`; all legs created via the working
per-index endpoint; `sync_level: full_index`. Monitor logs engine pid liveness,
CPU/RSS, and a query probe every 10 s (availability under load). Early state:
all 201s, CPU ~156% (real Metal embed work), queries 200. rc.21 died at 51 s
under this shape. (First launch attempt had a malformed-JSON bug in the
generator — every write 400'd; fixed and relaunched with counters reset.)

## T5 — #383 version round-trip (PASS)

The dossier's one-way silent migration is GONE, replaced by refusal in both
directions with the source data left intact:

- **rc.18 opening 0.2.0-written data**: process survives; startup catch-up and
  queries fail loudly with `error.UnsupportedVersion` (HTTP 500) — an explicit
  version gate, not the old silent `InvalidTableFile` corruption.
- **0.2.0 opening rc.18-written data**: process survives; queries return
  structured `{"code":"table_storage_unreadable","error":"InvalidManifest",
  "retryable":false}` (500). **No migration is attempted and no bytes are
  touched** — rc.18 subsequently reopened the same data dir and served the
  document correctly (200, doc intact).

Consequences: (a) the installer's wipe-on-version-change + repair-reindex is
REQUIRED (0.2.0 will not read rc.18 data) and already correct; (b) rollback is
symmetric and safe — rc.18 data would need the same wipe, which our derived-
data + outbox design absorbs; (c) the `read-unavailable-storm` heal semantics
of the era are moot (see wedge audit).

## Model Pins (T1)

Same distributions load on 0.2.0: engine B booted with symlinked
`~/.antfly/inference/models/{BAAI,antflydb}` + `--preload-model
embedder:antflydb/clipclap` → `trying backend metal … warmed inference embedder
model=antflydb/clipclap elapsed_ms=4281`. No MissingWeight, no crash-loop.
Hash re-verification of `model-pins.ts` values happens in the repin commit.
New in docs: `antflydb/Florence-2-base` OCR reader for `document_extraction`
(not required; enhancement-ticket material).

## T6-B — rc.18 baseline crucible (same shape, same box, run serially)

Identical procedure on the parked rc.18 binary (`swarm`, inline index create —
which works on rc.18): 20k docs pumped in 6 s, same 5 q/s query loop.

| During backfill | rc.18 | 0.2.0 | Δ |
|---|---|---|---|
| FTS p50 / p95 / p99 / max | 194 ms / 1.29 s / 3.57 s / 5.72 s | 1 / 1 / 1 / 8 ms | **~194× at p50** |
| semantic p50 / p99 / max | 468 ms / 4.67 s / 6.02 s | 1 ms / 17 ms / 737 ms | ~470× at p50 |
| control (`GET /tables` rc.18; unrelated-table FTS 0.2.0) p50 | 142 ms | 1 ms | — |
| failed queries | 15 (5 fts + 10 sem) | **0** | — |
| query loop throughput | ~1,500/type (loop stalled on slow queries) | ~3,495/type | 2.3× |
| backfill drain rate | ~4.3 docs/s (11,617 @ 45 min cap, unfinished) | ~4 docs/s (converged `ready` @ 20,000, ~83 min) | equal (pre-existing pacing, NOT a regression) |

**Verdict: the "reindex makes search slow or unusable" complaint is an rc.18
behavior that 0.2.0 fixes outright.** Backfill *throughput* is equally paced on
both; Bakin-side sync-write backfill (see T8/T15 note) is the lever, plus
upstream Draft 3.

## T7 — #319 interrupted-rebuild scale repros (PASS)

Two corpora on 0.2.0, each interrupted mid-backfill with SIGKILL + restart:

- **T7A (original #319 shape):** 3,000 docs, 75 embeddable (media template,
  clipclap), killed at ti 15 → after restart, backfill resumed and completed
  **ti 75/75**, flags dropped honestly (`rebuilding:false,
  backfill_active:false`, pending 0, not retrying).
- **T7B (the production memory-table shape that forced the override's
  restoration):** 3,000 rows, 60 embeddable (text template, bge), killed at
  ti 6 → resumed, completed **ti 60/60**, flags honest.

**The #319 lying-flags family is fixed.** The override's documented retirement
condition — "prove a full-scale interrupted rebuild converges without it" — is
met: no idle-with-raised-flags state exists to override. **T16 = REMOVE.**

**New behavior: `backfill_state: "degraded"`** after an interrupted backfill —
sticky (25+ min, not cleared by subsequent writes) but HONEST: the leg is fully
functional (new docs embed, ti advances, semantic queries 200,
`repair_degraded:false`, `repair_issue_count:0`). It is a permanent
"was interrupted" scar, not an error. Mapping policy for T8/T12: `degraded` +
idle runtime + repair clean ⇒ ready (advisory-grade surface at most);
`repair_degraded:true` / repair issues ⇒ failed. Blue/green convergence is
unaffected (converged() sees ready legs).

## Phase 2 — De-Hardening Census + Outcomes (2026-08-31)

Pin census vs the 0.2.0 binary (post-repin): 4 pins flipped red, 8 held.

| Candidate | Outcome | Commit |
|---|---|---|
| composeFtsWithFilters (filter-in-AST) | **REMOVED** — filter_query works for every production shape; bonus: filtered searches keep the semantic lane (no-leak probed + guarded); pure-negation gets a match_all base | 3a |
| mapIndexStatuses `!runtime` empty-table idle block | **REMOVED** — empty-table flags honest | 3b |
| `{}` scan-body fallback | **REMOVED** — bodyless /documents legal | 3c |
| rc-era wedge patterns (SendFailed / TableReadChurn / ReadUnavailable) | **REMOVED** — error names gone from the binary; replaced by the observed 0.2.0 `StorageReadTemporarilyUnavailable` storm signature (byte-grep pinned) | 3d |
| antfly#319 idle-detection override | **REMOVED** — retirement condition met at scale (gate T7); pin suite moved to per-index endpoint creation (inline legs are dead) | 3e |
| Process-wide write serialization gate | **REMOVED** — T3 soak + 8-way concurrent structural create/drop probe both clean; backfill switched to sync writes (fast lane) with a 120 s chunk ceiling | 3f |
| EMBED_SAFE_RE + thumbs-first | **RETAINED** — undecodable media still poisons the whole batch (pin held); no per-doc error policy yet | — |
| order_by / Query.sort | **RETAINED** — inferred fields still 422; `field_capabilities` schema-mapping is the enhancement path | — |

Structural-concurrency probe (pre-3f): 8 parallel create+embeddings-leg+
sync-write pipelines then 8 parallel drops on engine B — all 200/201/204,
engine alive, queries healthy.

Post-Phase-2 verification: the full workaround suite (12 tests incl. the new
guards) is GREEN against the 0.2.0 binary in 16 s (vs 120 s+ with dead legs);
search-conformance 18/18.

## Drafted Upstream Tickets (file in P5 via gh against antflydb/antfly)

**Draft 1 — "0.2.0: adding an embeddings index to a populated table wedges the
table durably and stalls writes engine-wide"**
Repro (shell-only, darwin-arm64, `antfly 0.2.0 (zig runtime)`, standalone):
(1) create table `{num_shards:1}`; (2) create embeddings index via
`POST /db/v1/tables/T/indexes/sem` (antfly-provider bge-small); (3) write ~20k
small text docs (async batches); wait until leg `ready`; (4) add a SECOND
embeddings leg via `POST /db/v1/tables/T/indexes/sem2`. Observed: sem2
`worker_started:false` forever; table reads/writes hang with no HTTP response
(`error.StorageReadTemporarilyUnavailable` log spam); writes to OTHER tables
hang too (reads elsewhere fine); SIGTERM ignored (SIGKILL required); after
restart the table remains unreadable (silent CPU spin, no log lines) with all
legs `running`/ti 0 — no self-heal in 4+ min. DELETE of the table takes >30 s
but completes and fully heals the engine. A 1-doc table does NOT reproduce
(backfills fine) — scale-dependent. Also note: the same add-leg on a FRESH
EMPTY table + subsequent writes works perfectly (that's the safe path).

**Draft 2 — "0.2.0: inline `indexes` in table-create are accepted but
enrichment never starts (silent no-op)"**
`POST /db/v1/tables/T` with `indexes:{sem:{type:"embeddings",…}}` → 200, config
stored and echoed by GET, but `enrichment_runtime.enabled:false`,
`worker_started:false` forever; writes commit and FTS indexes, embeddings leg
stays `running`/ti 0 with zero log output. Same body via
`POST /db/v1/tables/T/indexes/{name}` works fully. Either wire the inline path
or reject it — silent acceptance of a dead config is the trap. (This silently
breaks any pre-0.2.0 client.)

**Draft 3 — "0.2.0: provisioned backfill/catch-up embeds at a fixed ~4 docs/s
(single-doc path, batch embed counters stay 0)"**
Async-written corpus of 20k short text docs, bge-small on M4 Metal: backfill
ti climbs at exactly ~4 docs/s (linear, zero variance) with
`embed_batches_completed:0`, `active_embed_batch_items:0` — the catch-up loop
does not use the batch-embed path. Write-path `sync_level:full_index` embeds
the same docs at ~30–40 docs/s across concurrent streams. 20k docs ⇒ 83 min
backfill vs ~10 min via the write path. Availability during backfill is
excellent (separate note of praise); throughput is the issue.

## New-Surface Notes (T18 feed)

- `backup`/`restore` (AFB portable format), `artifact` (enrichment
  reprocessing), `agents` (retrieval/query-builder), `auth`, `ha`, `lite`
  (embedded single-file engine), `serverless` server mode.
- Table create now returns `field_capabilities` (per-field sortability +
  lifecycle) — the path to schema-mapped `order_by`.
- `x-antfly-types: ["link"]` schema annotation for auto-processed remote
  fields; `document_extraction` asset producer for durable PDF ingestion
  (page-level units + OCR fallback) — overlaps Bakin #747's page-render path.

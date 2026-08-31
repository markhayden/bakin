# Search System — Deep Reference

## Overview

Search goes through `AppServices.search` / `ctx.search`. Antfly (v0.2, zig
engine) is the **default** search adapter implementation in
`packages/adapter-antfly/` — default, not the design: everything upstream of
the adapter is expressed against the generic `SearchAdapter` contract
(`packages/core/src/adapters/search/`), and the architecture test bans
antfly-specific identifiers from core, SDK, `src/`, and plugin code
(`tests/architecture/adapter-boundary.test.ts`, D17).

The system is built on **record-keeping, not inference**. Every index write is
journaled to a durable SQLite outbox at write time and drained into the
engine; the engine being down just means rows wait. Boot resumes the drain and
does nothing else — no filesystem scans, no mtime reconcile, no warming, ever.
Schema changes are per-table **blue/green migrations**: queries keep answering
from the old physical table until a fully-converged replacement flips in.
(This replaced the pre-2026-07 reconcile/warmup/adoption architecture
wholesale; none of that machinery exists anymore.)

Degradation is honest, never silent, and never lossy:

- **Writes are never dropped.** `ctx.search.index/remove/transform` enqueue
  durably whether or not the engine is up.
- **Queries** against an unavailable engine return `503
  { error: 'search_unavailable' }` at both HTTP boundaries; the `useSearch`
  hook reports `status: 'unavailable'` and UIs render the shared
  `SearchUnavailable` component (doctor link + retry). No silent fallbacks
  exist anywhere (D11).
- Browse/filter/listing paths never touch the search engine and keep working.

## Install & Runtime: OS-Supervised Service

`bakin install search` direct-downloads the pinned release tarball from the
adapter's release host (SHA256-verified against
`packages/adapter-antfly/src/pin.ts` — no brew/npm/python/sudo) into
`~/.antfly/bin/antfly`, then provisions an **OS-supervised service** running
`antfly standalone` on `127.0.0.1:3738` (health port 3739) with data under
`~/.bakin/antfly/` and logs at `~/.bakin/logs/antfly.log`. Bakin is a pure
HTTP client; the OS owns start, keep-alive, and crash-restart.

`packages/adapter-antfly/src/service.ts` owns the lifecycle. Four modes,
resolved by `detectServiceMode()` (env `BAKIN_SEARCH_SERVICE_MODE` override →
platform detection):

| Mode | When | Mechanism |
|---|---|---|
| `launchd` | macOS with `launchctl` | LaunchAgent `~/Library/LaunchAgents/io.bakin.antfly.plist`, `KeepAlive=true`, managed via `bootstrap`/`kickstart`/`bootout` (legacy `load`/`unload` fallback) |
| `systemd` | Linux with `systemctl` | User unit `~/.config/systemd/user/bakin-antfly.service`, `Restart=always` |
| `child` | No service manager (Docker rig, CI, tests) | Strict attached child: spawn on boot, kill on exit. No adoption, no sidecar, no restart ladder |
| `guest` | Non-default `settings.url` | Externally managed engine — never provision, never spawn, never touch its disk |

> **Dev-rig invariant:** the LaunchAgent label + port 3738 are machine
> singletons and the unit is a byte-compared fingerprint of `getBakinPaths()` —
> a foreign BAKIN_HOME that reaches `ensureProvisioned` REWRITES the real unit
> (this fired live on 2026-07-11 from a rig isolated home). Rig instances are
> therefore pinned to guest mode via a non-default URL (`127.0.0.1:3838`) and
> get a rig-spawned child instead; `BAKIN_SEARCH_SERVICE_MODE=child` is the
> belt. See `.claude/knowledge/dev-rig.md` § Search isolation.

**The unit file IS the fingerprint.** `ensureProvisioned()` renders the
desired plist/unit (argv includes `--data-dir`, `--models-dir`, and one
`--preload-model` per configured embedder so the first embed never races a
cold model load) and byte-compares it with what's on disk. Identical → nothing
to do (the entire boot-time cost is one file read). Drift — pin bump, embedder
change, different preloads — → rewrite + restart. There is no sidecar state
file and no adoption probing.

The adapter (`packages/adapter-antfly/src/adapter.ts`) calls
`ensureProvisioned()` from `initialize()`; provisioning failures **never throw
out of initialize** — search degrades honestly (writes queue, doctor reports)
instead of blocking boot. `shutdown()` stops **only** a strict child:
OS-supervised instances stay warm across Bakin restarts by design. Upgrades
are `stopService()` → swap binary (verify-then-commit, `installer.ts`) →
`startService()`. `ANTFLY_PATH` overrides binary discovery for dev builds.

## Architecture

```
Plugin activate()
  → ctx.search.registerContentType(def)             — direct registration, plugin owns sync
  → ctx.search.registerFileBackedContentType(def)   — also wires watcher hooks → outbox
  → SearchRegistry stores definition (globalThis-backed)

Mutation (create/update/delete)
  → ctx.search.index(key, doc) / remove(key) / transform(key, ops)
  → durable enqueue into the search outbox (~/.bakin/search.db) — the enqueue
    IS the write from the caller's perspective
  → nudgeOutboxPump(): single-flight drain lands rows via the adapter
    (engine up → immediately; engine down → rows wait, backoff retries)

Query
  → ctx.search.query(params) / GET /api/search / per-plugin GET /search
  → registry resolves logical table → CURRENT physical table (blue/green pointer)
  → adapter hybrid query: full-text + embedding legs, RRF/RSF fusion
  → hits carry a neutral per-leg scoreBreakdown

Boot (the whole story)
  → startOutboxPump(): resume draining whatever the journal holds
  → startSearchEngine(): ensure registered tables (a matching registry row is
    ZERO adapter calls) + resume any crash/park-interrupted migration
  → nothing else — no scans, no reconcile, no warmup
```

### The durable outbox (write path)

`packages/core/src/search/outbox.ts`, app facade + pump in
`src/core/search-outbox.ts`. Lives in its own SQLite store,
`~/.bakin/search.db`, opened through the keyed multi-db core
(`openNamedDb('search', ...)` from `packages/core/src/storage/db.ts` — still
the sole `bun:sqlite` importer). **Never** the execution ledger, which stays
coordination-facts-only.

- **Coalescing:** `UNIQUE(logical_table, key)`, last-write-wins. The outbox
  holds at most one row per live document; re-enqueueing replaces the pending
  payload and resets retry state.
- **Acked-hash dedupe:** `search_acked` remembers the last successfully
  written content hash (canonical sorted-key JSON, SHA256) per key. Enqueueing
  a doc whose hash matches the acked one with nothing in flight is a no-op.
  This one mechanism replaces every per-plugin boot dedupe cache the old
  world grew (team content-hash scan, memory indexed-cache). Indexer writes
  are unconditional — the outbox owns change detection.
- **Transform semantics:** `transform(key, ops)` journals real
  `$set`/`$inc`/`$push` ops (`applyTransformOps`). Merged into a pending
  `index` payload when one exists (stays one row), appended to a pending
  `transform`, dropped on a pending `remove`. At drain time transforms apply
  read-modify-write through `adapter.documents.transform`.
- **Typed error classification** (`packages/core/src/adapters/search/errors.ts`):
  adapters throw `SearchEngineUnavailableError` (network/timeout/5xx —
  transient, retry-forever safe) or `SearchRequestRejectedError` (4xx —
  retrying the identical payload cannot succeed). The outbox classifies by
  **type, never message text** (same rule as dispatch `RuntimeError`s).
- **Backoff & quarantine:** transient failures back off 1s → 5s → 30s → 2m →
  10m → 30m cap without advancing toward quarantine; permanent failures
  quarantine the row after 5 attempts. `retryQuarantined()` /
  `listQuarantined()` are the doctor/CLI repair surface; `outboxStats()`
  (pending/inflight/quarantined/oldest) feeds status and telemetry.
- **Crash recovery:** rows are marked `inflight` while a batch lands; any
  inflight row at drain-cycle start is orphaned (single process) and reset to
  pending. Nothing is lost to a mid-write crash.
- **The pump** (`src/core/search-outbox.ts`): a globalThis-backed single-flight
  drain chain. Every enqueue calls `nudgeOutboxPump()` — when the engine is
  up, the write lands before the caller's promise resolves. A 30s safety tick
  retries when the engine was down (with its own 5s/10s/30s down-cycle gate so
  a dead engine isn't hammered). `startOutboxPump()` in `server.ts` wires the
  live adapter + the blue/green `resolveDrainTargets` and resumes whatever the
  journal holds — that line is the whole recovery story for writes.

### Blue/green versioned tables (migrations)

`packages/core/src/search/tables.ts` (state in the same `search.db`), driven
from `src/core/search-registry-core.ts`. There is no global schema version and
no state file — each content type declares its own `schemaVersion`.

- **Naming & fingerprint:** logical names (what plugins and queries use, e.g.
  `bakin_assets`) map to versioned physicals
  `{logical}_v{schemaVersion}_{fp8}`, where `fp8` is the first 8 hex chars of
  SHA256 over the table config **plus the adapter's `mappingFingerprint()`**
  (a hash over adapter settings that change the physical index layout —
  embedder models, dimensions). A plugin bumping `schemaVersion` OR the
  adapter swapping an embedder model yields a new desired physical and
  triggers a migration — no plugin edit needed for a model swap.
- **Migrator state machine:** `creating → backfilling → converging → flip →
  drop`, persisted per step in the `search_tables` registry.
  `migrating_to` is written **before** backfill starts, which turns on
  dual-write: the outbox pump's `resolveDrainTargets(logical)` returns both
  physicals during a migration, so a doc written mid-backfill exists in the
  green either way. Backfill streams the content type's `reindex()` generator
  in 50-doc chunks.
- **Convergence (progress-aware, 2026-07-21 redesign):** green flips only
  when `tables.stats()` doc count reaches the backfilled count (or is stable
  across polls — a live source can shrink) AND every leg from
  `tables.health()` reports `ready`. Poll every 2s. Parking is driven by
  EVIDENCE, not a flat timeout: a leg in `error` state parks immediately;
  ZERO observed progress (doc count + indexed + pending all frozen) parks
  after ~60s (`zeroProgressParkMs`); the 30-min hard cap only bounds a green
  that is still progressing. A failed `stats()` read observes `count: null`
  and can never satisfy the flip criteria — evidence failure is not
  stability. Engine ready/building flags never get to veto forever: the
  adapter's honesty layer (idle-detection in `mapIndexStatuses`) plus the
  zero-progress park bound the damage of lying flags.
- **Park, never flip early — and parked work SELF-HEALS:** on park,
  dual-write stays on and queries keep hitting the old table. The
  **migration pump** (started by `startSearchEngine()`, 5-min tick — the
  migrations counterpart of the outbox safety tick) resumes parked
  migrations automatically, attempt-capped at 5 per table before standing
  down to the doctor. `pumpParkedMigrations()` is also the doctor repair
  path.
- **Migration identity is PERSISTED:** the green's full fingerprint
  (including any rebuild nonce) is recorded as `migrating_fp` when the
  migration starts; resume replays `migrating_to`/`migrating_fp` verbatim
  and NEVER recomputes the target (the recompute path lost rebuild nonces,
  aliased the live physical, and the post-flip drop deleted it — 2026-07-21
  critical finding). Invariants: a migration target equal to the active
  physical is repaired (row → active), never staged and never dropped.
- **Resume at boot:** `startSearchEngine()` → `resumeTableMigrations()` reads
  only the registry (recorded work, allowed by the boot-does-nothing rule) and
  re-runs any in-flight migration. A desired-layout change underneath an
  in-flight migration abandons the stale green and retargets.
- **Drops are tolerant:** a failed drop of the old physical is tombstoned
  (`search_table_tombstones`); `sweepTombstones()` retries from the doctor
  sweep.
- **Serialization bounds BACKFILL only:** the embed-heavy backfill runs one
  at a time process-wide; converge-waits run per-table OFF the chain
  (holding the chain through converge turned three stuck tables into a
  ~30-minute global stall on 2026-07-21). Rebuild passes run tables with
  bounded concurrency (3).
- **Rebuild = repair by default:** `POST /api/reindex[?table=t][&force=1]`
  (the `bakin reindex [--force]` CLI verb) runs `rebuildRegisteredTables()`.
  The DEFAULT pass repairs: parked migrations resume (recorded target, no
  re-embed via the resume fast path), tables whose physical vanished
  engine-side (data-dir wipe) get a fresh nonce'd generation, drifted
  layouts migrate via plain ensure, and healthy tables are untouched.
  `--force` mints fresh generations for every targeted table (the old
  always-on behavior — it once churned a healthy table through five
  generations in one evening). Overlapping calls **single-flight** into the
  running pass. Progress broadcasts `search.rebuild.{start,progress,complete}`
  SSE events; the response reports `ok/errors/parked` per table. There is no
  separate "reset" surface — rebuild IS the repair verb.
- **Engine version change = rebuild event:** `bakin install search`
  re-provisions the OS service unit unconditionally (argv must match the
  binary being installed) and, on a version change, CLEARS the derived
  engine data dir — the repair reindex regenerates every table from source.
  In-place engine-side file-format migrations are never trusted (the rc
  line migrated one-way and broke rollback; 0.2.0 doesn't migrate at all —
  it refuses foreign-version data loudly in BOTH directions and leaves the
  bytes untouched, so wipe+reindex is the only correct move either way).

### Boot does nothing (guarantee)

`src/core/search-startup.ts` is deliberately near-empty: `startSearchEngine()`
ensures registered tables and resumes in-flight migrations. A matching
registry row performs **zero adapter calls** — enforced by a call-spy test
(`tests/core/search-boot-does-nothing.test.ts`). The bounded boot budget
survives from the old world because a wedged engine must never brick server
boot: the first attempt gets 10s (`SEARCH_BOOTSTRAP_BOOT_BUDGET_MS`) before
boot proceeds with search degraded, and failed table setup retries on a
5s/15s/60s/300s schedule.

### Three consistency paths

The index stays in sync with source data through three paths. There is no
startup reconcile — it was deleted, not demoted.

1. **REST/MCP mutation path (authoritative, immediate).** Routes and exec
   tools call `ctx.search.index()` / `remove()` / `transform()` inline when
   they mutate data. These journal through the outbox and (engine up) land
   before the response. Every plugin that writes via REST/MCP must call the
   search mutators inline — waiting for the watcher would race the response.
2. **Watcher hook path (filesystem-driven, eventually consistent).** For
   writes that bypass REST — manual `cp`, restored backups, another process —
   `registerFileBackedContentType()` wires chokidar sync/unlink hooks that
   fire ~300ms after the write settles and **enqueue into the outbox** (into
   the content type's own table, correct for secondary file-backed types).
   Glob scoping lives in `src/core/search-file-patterns.ts`.
3. **Doctor sweep (deep-consistency backstop, never at boot).**
   `src/core/search-orphan-sweep.ts` exports `runOrphanSweep()` /
   `sweepTableOrphans()`: scan each table's indexed keys, call the content
   type's `verifyExists(key)`, batch-remove orphans. Single-flight per
   process, exists solely for doctor scheduling and explicit repair — nothing
   invokes it on the boot path. `sweepTombstones()` (retry dropping old
   physicals) belongs to the same tier, and black-swan recovery (wiped index)
   is by design a doctor-surfaced count mismatch whose repair is an explicit
   blue/green rebuild — never an automatic boot scan. (The doctor
   health-check wiring for this tier lands with the rebuild's P4 tranche.)

### Auto-registered `/search` route (canonical wiring path)

Plugins don't register their own `/search` route. When a plugin calls
`ctx.search.registerContentType()` or `registerFileBackedContentType()` during
`activate()`, `buildSearchAPI(pluginId, { registerRoute })`
(`src/core/search-plugin-api.ts`) auto-wires a `GET /search` route on the
plugin's router that forwards `q`/`limit`/`offset`/`facets` to
`ctx.search.query()` and returns the standard `SearchResponse`. Registration
is idempotent. The plugin catch-all dispatch path uses
`BuildSearchAPIOptions.skipFileBackedWiring` to avoid double-wiring watcher
hooks when the API is constructed outside plugin activation.

`getTableForPlugin(pluginId)` returns the plugin's **primary** content-type
table — what bare `ctx.search.index/remove/transform/query` target and what
the auto-wired `/search` route + MCP plugin-param routing resolve to. A plugin
has exactly one primary (a second *direct* registration throws early);
**file-backed content types register as secondary** and index into their own
table directly, so a plugin like `team` can register a direct primary
(`agents`) plus a file-backed secondary (`agent-lessons`) without the resolver
misrouting.

### Key files

| File | Purpose |
|---|---|
| `packages/core/src/adapters/search/index.ts` | `SearchAdapter` contract: required `capabilities()`, `mappingFingerprint()`, `tables.{list,create,drop,stats,health}`, documents, query/multiQuery/scan; setup-component types |
| `packages/core/src/adapters/search/concepts.ts` | Contract types: `TableConfig` (+ capability `legs`), `SearchLegCapability`, `TableLegHealth`, `Query`, `SearchHit`, neutral `ScoreBreakdown` |
| `packages/core/src/adapters/search/errors.ts` | Typed error taxonomy: `SearchEngineUnavailableError` / `SearchRequestRejectedError`, `isEngineUnavailable()` |
| `packages/core/src/search/outbox.ts` | Durable write journal: coalescing, acked-hash dedupe, transform merge, backoff, quarantine, `drainOnce` |
| `packages/core/src/search/tables.ts` | Blue/green registry + migrator: fingerprints, state machine, park/resume, tombstones, `resolveDrainTargets` |
| `packages/core/src/storage/db.ts` | Keyed multi-db SQLite core (`openNamedDb`) — sole `bun:sqlite` importer (architecture-test enforced) |
| `src/core/search-outbox.ts` | App facade + the drain pump (single-flight, nudge-on-enqueue, 30s safety tick) |
| `src/core/search-registry.ts` | The stable public barrel (`@/core/search-registry`) over the four registry modules below |
| `src/core/search-registry-core.ts` | Registry singleton, table provisioning (`ensureRegisteredTables`), `rebuildRegisteredTables` (blue/green rebuild + `search.rebuild.*` SSE), logical→physical resolution, query/result mappers |
| `src/core/search-plugin-api.ts` | `buildSearchAPI()` → `ctx.search`; watcher-hook wiring for file-backed types |
| `src/core/search-query.ts` | `crossTableSearch()` — the `/api/search` engine (multiQuery + merge) |
| `src/core/search-reindex.ts` | `getSearchHealth()` — per-table stats + per-leg health snapshot |
| `src/core/search-startup.ts` | `startSearchEngine()` — ensure + resume, bounded boot budget |
| `src/core/search-orphan-sweep.ts` | Doctor-scheduled deep-consistency sweep (`runOrphanSweep`) |
| `src/core/search-file-patterns.ts` | Glob matching for file-backed patterns (watcher scoping) |
| `src/core/search-adapter-factory.ts` | The ONLY production importer of `@bakin/adapter-antfly` |
| `src/core/api-search-handler.ts` | Cross-plugin `/api/search` request handler |
| `packages/adapter-antfly/src/` | The default adapter implementation (see below) |
| `src/hooks/use-search.ts` | Client-side `useSearch` hook + `reorderBySearchResults` (re-exported via the SDK hooks surface) |

### The antfly adapter package

`packages/adapter-antfly/src/` after the rebuild:

| Module | Purpose |
|---|---|
| `adapter.ts` | `AntflyAdapter` — lifecycle wrapper: settings merge + service provisioning + client construction |
| `client.ts` | Stateless raw-fetch HTTP client implementing the full contract; one request path, one error taxonomy (network/timeout/5xx → unavailable, 4xx → rejected); timeouts ABANDON the request (the engine has no server-side cancellation) |
| `translate.ts` | Pure Bakin ⇄ wire shape translation (queries, filters, batches, table creates, leg health) |
| `wire.ts` | Hand-derived wire types + endpoint paths, probe-verified against upstream main |
| `service.ts` | launchd/systemd/child/guest lifecycle (above) |
| `defaults.ts` | `AntflySettings` + `mergeSettings` (deep-merge with per-embedder dimension preservation) |
| `pin.ts` | Pinned release version + per-platform SHA256 checksums |
| `installer.ts` | Direct-download verify-then-commit binary install; upgrade = stop → swap → start |
| `models.ts` | Inference-model prefetch (`antfly inference pull`) + presence checks |
| `setup.ts` | Onboarding composition (`bakin install search` / `search-models` components) |
| `paths.ts` | `~/.antfly` binary/model path helpers |
| `server-logs.ts` | Engine log-tail annotation for `bakin logs` |

Deleted from the old adapter: `server.ts` (the 739-line process-supervision
lattice — sidecar `instance.json`, adoption probes, restart ladder),
`legacy-cleanup.ts`, `search.ts` (the 955-line monolith), and the old
`query-translation.ts`.

**No `@antfly/sdk` dependency — deliberate.** The adapter speaks raw HTTP with
hand-written wire types covering exactly the shapes it uses. Rationale: the
npm SDK publish lags upstream main by months (version strings never bump, so
version-matching is meaningless), and a vendored tarball reintroduces the
binary-vs-SDK skew problem class. The contract check is the **conformance +
workaround-regression suites run against real binaries**, not generated types.
Wire facts are recorded in `wire.ts` doc comments and
`tasks/evidence-search-rebuild.md`.

## Capability Legs & Neutral Scores (D17)

Core and the SDK speak in **capability terms**, never engine/model names:

- The adapter declares what it can build via `capabilities()`:
  `{ legs: ['full-text', 'text-embedding', 'media-embedding'], rerank,
  facets, transform }`.
- The contract's `TableConfig.legs` (`TableLegConfig`) declares WHAT a table
  needs — a leg `name` (the stable `scoreBreakdown` key), a `capability`,
  source `fields`/`template`, optional `mediaUrlField`, fusion `weight`, and
  chunker. The adapter maps each leg to its own engine/model specifics
  (embedder refs, dimensions, GGUF vs ONNX — all adapter settings).
  Plugin-facing `SearchContentTypeDefinition` currently declares
  `indexes[]` (embedder-ref shaped); the registry passes those through
  `TableConfig.indexes` and the adapter's `translate.ts` converts them to
  legs (`legFromLegacyIndex`) — media-url indexes become `media-embedding`
  legs, the rest `text-embedding`.
- **Scores are generic:** every hit may carry `scoreBreakdown:
  Record<legName, number>` (plus adapter extras like `rerank`). The antfly
  wire's `_index_scores` keys are already neutral leg names (`full_text`,
  declared embedding-leg names) and pass through verbatim. Debug UI renders
  whatever legs appear — no engine-specific key sniffing upstream.
- `tables.health(name)` returns per-leg `TableLegHealth`
  (`ready | building | error`, indexed count, error) — this drives blue/green
  convergence, `getSearchHealth()`, and the doctor.

A second search adapter starts by passing the adapter-agnostic conformance
suite (`tests/integration/search-conformance/` — `conformance.ts` runs against
the mock in `mock.conformance.test.ts` and the real engine in
`antfly.conformance.test.ts`); antfly-specific tests (workaround-regression
pins, service provisioning) live in `tests/integration/antfly/` and
`tests/adapter-antfly/`.

## Table Naming

All logical tables use the `bakin_` prefix: `bakin_tasks`, `bakin_assets`,
`bakin_memory`, etc. The **physical** table in the engine is versioned
(`bakin_assets_v1_a1b2c3d4`); code never hardcodes physicals — the registry
resolves logical→physical at dispatch time (`resolvePhysicalTable`).

Core tables are registered by their owning core plugin (tasks, schedule,
memory, team ×2, assets, workflows); official external plugins add their own
(e.g. Projects → `bakin_projects`, Messaging → `bakin_messaging_*`). The
**memory** plugin owns `bakin_memory` — a single unified table with a `tier`
facet across 7 memory tiers (audit, session, turn, checkpoint, daily_note,
durable, dream).

`bakin_assets` is the only multi-leg table today: `assets_text` (text
embedding over description + tags + filename + surface + extracted content,
fusion weight 0.5) and `assets_visual` (media embedding over raster pixels via
`image_url`, weight 2.0 — pixel similarity is the reliable signal for image
search). All other tables use a single default embedding index named
`embeddings`.

## SearchContentTypeDefinition

Canonical type in `packages/sdk/src/types/services.ts` (re-exported through
`packages/core/src/plugin-types.ts`):

```typescript
interface SearchContentTypeDefinition {
  table: string                              // e.g. 'tasks' — auto-prefixed to 'bakin_tasks'
  /** REQUIRED. Doc-shape version. Bumping it triggers a blue/green
   *  background migration to a fresh physical table — queries stay on
   *  the old one until the new converges. */
  schemaVersion: number
  schema: Record<string, SearchSchemaField>  // { type: 'text' | 'keyword' | 'number' | 'boolean' | 'datetime' | 'array' }
  searchableFields: string[]                 // fields the full-text leg matches over
  embeddingTemplate: string                  // used when `indexes` is NOT set (default single-index path)
  indexes?: SearchIndexDefinition[]          // named embedding indexes (embedderRef, template, mediaUrlField, weight, chunker)
  facets?: string[]
  rerankField?: string                       // unset → reranker never attaches for this type
  ttl?: string                               // Go duration ('90d'); ttlField defaults to 'created_at'
  ttlField?: string
  chunker?: { enabled: boolean; targetTokens?: number; overlapTokens?: number }
  reindex: () => AsyncGenerator<SearchReindexItem>   // { key, doc } — see contract below
  verifyExists: (key: string) => Promise<boolean>    // drives the doctor orphan sweep
}

interface FileBackedContentTypeDefinition extends SearchContentTypeDefinition {
  filePatterns: FilePatternMapper[]  // { pattern, fileToId, fileToDoc? }
  excludePatterns?: string[]
  onSync?: (relPath: string, content: string) => Promise<void>   // owns doc-building when set
  onUnlink?: (relPath: string) => Promise<void>
}
```

**The `reindex()` contract matters more than it used to:** it is the
blue/green **backfill source**. It MUST be side-effect free and restartable —
it re-derives every row from source without mutating live state, and it runs
whenever a migration or rebuild needs to populate a green table. A generator
that silently yields nothing would let a thin green table converge and flip;
the memory plugin's generator therefore **fails loudly** when the runtime is
unreachable (the migration parks instead of flipping to an empty table). The
old world's `mtimeMs` freshness stamps, `whenReady` gating, and
`fileToDoc: () => null` hacks are gone — `fileToDoc` is simply optional now
(omit it when `onSync` owns doc-building, as assets does).

**When to bump `schemaVersion`:** any change that requires the physical table
to be rebuilt — schema field add/remove/rename, index/leg add/remove, template
changes that affect chunking, chunker config changes. Adapter-side changes
(embedder model/dimension swaps) migrate automatically via
`mappingFingerprint()` without a plugin edit. Pure data additions need no bump
— they flow through normal writes, and `/api/reindex` exists for explicit
repopulation.

## SearchAPI (per plugin)

Exposed on `PluginContext` as `ctx.search`:

```typescript
interface SearchAPI {
  registerContentType(def: SearchContentTypeDefinition): void
  registerFileBackedContentType(def: FileBackedContentTypeDefinition): void
  index(key: string, doc: Record<string, unknown>): Promise<void>   // durable enqueue + pump nudge
  remove(key: string): Promise<void>                                 // durable enqueue + pump nudge
  transform(key: string, ops: SearchTransformOp[]): Promise<void>    // $set/$inc/$push via outbox
  query(params: SearchQueryParams): Promise<SearchResponse>
  health?(): Promise<SearchHealthSnapshot>                           // per-table stats + per-leg health
  maintenance?: SearchMaintenanceAPI                                 // available() / scan(fields?) / batchRemove(keys)
}
```

All three mutators are **fire-and-forget safe and never lossy**: they resolve
once the row is journaled (and, engine up, landed). `transform()` is for
metadata-only updates where re-embedding would be wasteful; each op is
`{ op: '$set' | '$inc' | '$push', field, value }` and the outbox owns the
merge semantics.

`ctx.search.maintenance.scan(opts?)` supports field projection
(`{ fields: [...] }`) — adapters may return keys only when no projection is
requested, so any consumer reading fields off scanned rows MUST project them
explicitly.

## Hybrid Search & the Wire Contract

Queries combine a full-text leg and embedding legs, fused server-side:

| Strategy | Behavior |
|---|---|
| `rrf` (default) | Full-text + semantic legs fused (RRF or RSF per `fusionStrategy`) |
| `semantic_only` | Embedding legs only |
| `full_text_only` | Full-text only, no embeddings required |

Global default: `settings.search.settings.search.strategy`;
`settings.search.settings.search.fusionStrategy` picks `rrf` vs `rsf`
(upstream supports both; the tuning pass owns the default). Per-leg fusion
weights come from the content type's `indexes[].weight` and ride
`merge_config.weights`.

**Wire-contract facts vs antfly main** (probe-verified — recorded in
`packages/adapter-antfly/src/wire.ts` and `tasks/evidence-search-rebuild.md`):

- **Query responses are always wrapped**: `{ responses: [...] }` even for a
  single-table `POST /db/v1/tables/{t}/query`. Hits carry **`_id`** (not
  `key`), `_score`, `_index_scores`, `_source`, `_sort`.
- **`_index_scores` keys are neutral leg names** (`full_text`, the declared
  embedding-leg names) — they map 1:1 onto `scoreBreakdown` with no
  normalization. Embedding legs report `-cosine_distance`.
- **`filter_query` WORKS on 0.2.0 and filters BOTH lanes** (keyword
  equality incl. hyphenated values, should-IN disjuncts, numeric ranges,
  must_not — live-probed 2026-08-31; the rc.17 filter-in-AST workaround is
  gone). Filtered searches keep the semantic lane: the no-leak property is
  guarded in workaround-regressions. One engine rule: a pure-negation
  filter_query matches NOTHING — `buildFilterQuery` adds a `match_all`
  base conjunct for exclusion-only filters.
- **`order_by` still 422s on inferred fields** (0.2.0 unchanged: only
  schema-mapped sortable fields sort; the create response now returns
  `field_capabilities` per field — the adoption path if a sort feature ever
  exists). Bakin sends no schema, so `Query.sort` is never sent.
- **`timeout_ms` (rc.18) is the cooperative server-side query deadline**
  (expiry → 504). Bakin sends it on every budgeted query — see Latency
  Contract below.
- **Totals are corpus-true `{value, relation}` objects on every response**
  (since rc.18; the page-scoped count twin was deleted and this is now a
  guard). `limit: 0` flows still send `count: true` (count-only; a reranker
  cannot ride a count — server 400).
- **`semantic + offset > 0` hard-400s** — offset is only sent on
  FTS-only queries.
- **The semantic leg requires concrete index names** — naming none (or a
  table without vector indexes) is a hard 400. The registry passes the
  table's embedding-index names via `adapterOptions.indexes`; without them a
  query is naturally FTS-only. No server introspection.
- **`sync_level: 'full_index'`** on every batch write (`aknn` was removed
  upstream — using it 500s).
- **Scans** go through `POST /db/v1/tables/{t}/documents` (the old
  `/lookup` is 405), bodyless for all-keys (legal since 0.2.0; a body only
  narrows `fields`), streaming NDJSON rows keyed by `_id`. `batchRemove`
  returns attempted counts.
- **Table creates carry no `schema`** (type inference covers Bakin's needs)
  and no full-text index entry (the server always creates its own).
  **Embedding legs are created via `POST /db/v1/tables/{t}/indexes/{name}`
  AFTER the table create and BEFORE the first doc write** — 0.2.0 silently
  ignores inline `indexes` at table-create (accepted + stored, enrichment
  never starts; ticketed upstream), and adding a leg to a POPULATED table
  wedges it durably (drop-and-rebuild is the repair). Embedding indexes
  carry explicit `dimension`; embedders always run **in-process** — an
  inference `url` flips antfly onto an external HTTP path whose failures
  wedge backfills.
- **No server-side query cancellation** — client timeouts abandon the request
  (15s queries, 30s writes).
- `GET /db/v1/tables/{t}/indexes` → per-index `{config, status}` with
  `rebuilding`, `total_indexed`, `backfill_state`, `doc_count`,
  `worker_failed`, and (0.2.0) a rich `enrichment_runtime`
  (`worker_started`, pending/active/error counters) — the source for
  `tables.health()` and doc counts (`tables.stats()` reads it too; **never
  a query**, which can hang during backfill). Flags are honest on 0.2.0
  (the empty-table and #319 idle-detection overrides are gone); an
  interrupted backfill leaves a sticky-honest `backfill_state:"degraded"`
  scar on a fully functional leg, which maps ready.
- **Writes are concurrency-safe on 0.2.0** — the rc.18 process-wide client
  write gate is gone (45-min 3-stream embed soak + 8-way structural
  concurrency probed on the target hardware). Blue/green backfills write
  sync chunks (contract default) on the fast write-path embed lane; async
  (`sync:false`) docs drain through the engine's paced catch-up loop at
  ~4 docs/s — avoid it for bulk work.

Each still-standing engine constraint has a regression pin in
`tests/integration/antfly/workaround-regressions.test.ts` written to FAIL when
upstream fixes it — dead workarounds announce themselves.

**Cross-table search** (`/api/search`, `src/core/search-query.ts`): fans out
via `multiQuery` across all registered tables (logical→physical resolved at
dispatch; correlation back to logical names is positional), asks each table
for the full page window, and takes the global top-N by score. Per-table
scores come from each table's own fusion config, so the merged ordering is
approximate — right for a global search box, not a calibrated ranking.
`multiQuery` runs parallel unless something reranks (the reranker serializes
on one Metal queue anyway).

### Reranker

Cross-encoder reranking is **per-query opt-in** and off by default: the
adapter attaches a reranker only when the query passes `rerank: true` and a
model is configured (`settings.search.settings.search.reranker`), and the
registry passes the content type's `rerankField` via
`adapterOptions.rerankField`. It stays off by default because it is
throughput-bound (~200ms per candidate on Metal, linear, serialized on one
Metal queue) — a bounded top-K rerank is a viable per-query opt-in; default-on
across the multi-table fan-out is not. The tuning pass re-benchmarks on the
current pin.

**Structural limitation:** the reranker scores a query against a **single
document field**. Fine for single-modality text tables; it creates inversions
on multi-modality tables where different modalities live in different fields.

**Per-table choices (current):**

| Table | rerankField |
|---|---|
| `bakin_tasks` | `description` |
| `bakin_workflows` | `description` |
| `bakin_schedule` | `command` |
| `bakin_team` | `soul` |
| `bakin_agent-lessons` | `body` |
| `bakin_memory` | `content` |
| **`bakin_assets`** | **(unset — intentional)** |

`bakin_assets` mixes modalities (PDF body in `content`, pixels in the visual
leg, metadata in `description`/`tags`); no single field captures a doc's
signal, and scoring against any one of them produced consistent inversions
(the `"tzatziki"` case: full-text found the PDF, the reranker scored an
unrelated image's `description` higher). Multimodal tables get raw fusion of
full-text + text-embedding + media-embedding legs; the cross-encoder pass is
skipped entirely.

## Latency Contract & Query Budget (search-trust-and-speed)

One wall budget for every search request:
`settings.search.settings.search.queryBudgetMs` (default **2000**). Tables
fan out in parallel, so the budget applies per table:

- `crossTableSearch` stamps `Query.deadlineMs` on every table query.
- The adapter sends it server-side (`timeout_ms`, rc.18 — expiry 504) and
  aborts client-side at deadline + 500ms grace (dead-engine backstop only).
- A table whose semantic lane misses the deadline retries ONCE fts-only
  inside the REMAINING budget → `diagnostics.budget = 'degraded'`. A table
  that can't answer at all contributes zero hits with
  `diagnostics.budget = 'omitted'` (multiQuery isolation).
- The response meta carries per-source outcomes — `meta.tables[]`
  (`table`/`hits`/`took_ms`/`budget?`) and `meta.partial: true` when any
  source degraded/omitted. HTTP surfaces pass it through verbatim.
- UI: `SearchPartialChip` (SDK component) renders the amber "Partial
  results" chip with a tooltip naming each slow source. The ⌘K overlay and
  plugin surfaces all use it — slowness is never anonymous, degradation is
  never silent (D11).
- The page-scoped-totals companion count query runs CONCURRENTLY with the
  main query (it used to double per-table latency).

## Embedders

Model choices live in **adapter settings**, never in content-type definitions
(content types request capabilities; the adapter maps them). Both defaults run
locally through the engine's embedded inference runtime — no cloud dependency.

| Purpose | ref name | Default model | Dims |
|---|---|---|---|
| Default text | `default` | `BAAI/bge-small-en-v1.5` | 384 |
| Visual/media | `visual` | `antflydb/clipclap` (CLIP+CLAP multimodal, GGUF) | 512 |

Models are pulled via `bakin install search-models`
(`packages/adapter-antfly/src/models.ts` → `antfly inference pull`) into
`~/.antfly/inference/models/{owner}/{name}/`. Prefetch matters: index-time
embedding does NOT lazy-download a missing model — the backfill fails.
Recovery is cheap: once the model is on disk, any write heals the index;
`bakin install search-models` + `bakin reindex` fully repairs.
The service argv preloads every configured antfly-provider embedder
(`--preload-model`) so first embeds never race a cold model load.

**`dimension` is required** on every embedder entry (the server demands
declared dims at table-create time). Embedder settings feed
`mappingFingerprint()`, so changing a model or dimension triggers blue/green
migrations of every affected table automatically.

Model names MUST be qualified `{owner}/{name}` HuggingFace-style names — they
map directly to the models directory layout.

## Content Extraction & Media URLs (assets)

Still Bakin-side, unchanged in principle: `plugins/assets/lib/content-extractor.ts`
extracts PDF/text body content server-side (pdf-parse + `readFileSync`, 50K
char cap) into the search doc's `content` field, because upstream's PDF
library and loopback-fetch path are broken and server-side extraction also
makes body text full-text-searchable. `plugins/assets/lib/asset-url.ts`
`buildAssetFileUrl()` produces percent-encoded `file://` URLs for raster
images (`.png/.jpg/.jpeg/.gif/.webp/.bmp` — `RASTER_RE` in
`plugins/assets/lib/search-doc.ts`), which the visual leg dereferences via the
adapter's media template. Full rationale:
`.claude/knowledge/multimodal-search.md`.

## Health, Status & Telemetry

- `ctx.search.health()` / `getSearchHealth()` (`src/core/search-reindex.ts`):
  per registered table — physical-resolved stats + per-leg
  `indexHealth` (`name`/`totalIndexed`/`rebuilding`/`pending?`/`error`) from
  `tables.health()`, `healthy` = no leg in `error`, plus **freshness &
  backlog**: `lastIndexedAt` (newest journal ack, falling back to the
  registry transition), `lastRebuildAt`, `journalPending` (pending+inflight
  rows for that table). Health cards render "indexed 3m ago · N queued · M
  embedding"; `bakin search:stats` prints the same. Read from status
  surfaces, never a query.
- **Backfill-spin watchdog** (`search-spin` check, health plugin): two
  doctor-cadence samples ≥10min apart where a leg is `building` with zero
  `indexedCount` progress and an empty journal ⇒ error finding naming the
  tables + a confirmed (never automatic) blue/green rebuild repair. This is
  the antfly#319 signature that burned 300% CPU for weeks on rc.17.
- **Orphan registry-row sweep** (`sweepOrphanRegistryRows`, rides the
  hourly deep sweep): drops `search_tables` rows whose content type has no
  live registrant (plugin removed without purge) — engine physicals,
  registry row, and journal rows. `purgeContentType` now tears all three
  down at removal time, so the sweep is the backstop.
- `GET /api/plugins/health/search-status` (health plugin) serves that
  snapshot to the health page.
- `search.rebuild.{start,progress,complete}` SSE events drive live rebuild
  progress in the health page (`usePluginEvent` on the shared connection).
- `outboxStats()` (pending/inflight/quarantined/oldest) is the queue-depth
  surface for doctor checks and telemetry.
- Telemetry rides the existing usage recorder + doctor results — no parallel
  stat system (hard rule).

## Settings Reference

All under `settings.search.settings` (defaults merged by the adapter's
`mergeSettings` — per-embedder entries deep-merge so a partial override keeps
the default `dimension`):

| Key | Type | Purpose |
|---|---|---|
| `enabled` | `boolean` | Enable/disable the search integration |
| `url` | `string` | Engine base URL, no path suffix (default `http://127.0.0.1:3738` — Bakin's private instance; `localhost` is normalized to `127.0.0.1` so the client dials exactly what the server binds). A non-default URL = guest mode (externally managed; never provisioned). |
| `auth` | `object?` | Optional basic auth `{ username }` — the password lives in the secret store and is injected at adapter init, never stored in settings.json |
| `search.strategy` | `string` | Default strategy (`rrf` \| `semantic_only` \| `full_text_only`) |
| `search.fusionStrategy` | `string` | Hybrid fusion algorithm (`rrf` \| `rsf`, default `rrf`) |
| `search.defaultLimit` | `number` | Default result count |
| `search.queryBudgetMs` | `number` | Per-table cooperative query deadline (default `2000`) — see Latency Contract |
| `search.reranker.provider` / `.model` | `string` | Reranker config; attaches only on per-query `rerank: true` (the content type's `rerankField` rides along when declared) |
| `search.reranker.enabled` | `boolean` | Legacy master switch (default `false`); the current gate is per-query opt-in |
| `embedders.default.{provider,model,dimension}` | | Text embedder (default `384` dims) |
| `embedders.visual.{provider,model,dimension,multimodal?}` | | Media embedder (default `512` dims; `multimodal` only for models outside the engine's built-in registry) |
| `embedders.<custom>` | `object?` | Additional named embedders referenced by `embedderRef` |
| `chunking.defaultTargetTokens` / `.defaultOverlapTokens` | `number` | Chunker defaults (200 / 25) |
| `auditTtl` | `string` | TTL for audit-tier entries (Go duration: `'90d'`) |
| `cleanupInterval` | `string` | Orphan-sweep cadence hint (Go duration: `'7d'`). The old periodic backstop timer is gone; the doctor owns sweep scheduling. |

**Override hygiene:** code that persists settings must write **minimal
partials** via `updateSettings()` — never the merged settings object.
Persisting merged settings freezes every then-current default into
`settings.json` as explicit overrides, silently pinning the install to stale
defaults.

## Chunking

Long documents are split before embedding, per index/leg via
`chunker: { enabled, targetTokens, overlapTokens }` (defaults from
`settings.search.settings.chunking`). Indexes without a chunker embed the
template output whole; media-embedding legs don't declare chunkers (image/audio
embeddings are whole-doc).

## Related docs

- `.claude/knowledge/search-plugin-guide.md` — plugin author walkthrough
- `.claude/knowledge/search-api-reference.md` — REST/MCP surface for agent-facing search
- `.claude/knowledge/multimodal-search.md` — multimodal architecture, extraction, media legs
- `.claude/knowledge/adapter-architecture.md` — adapter boundary + D17 enforcement
- `.claude/specs/search-asset-rebuild.md` — the 17 locked decisions behind this architecture
- `tasks/evidence-search-rebuild.md` — live-verified wire-contract evidence vs upstream main

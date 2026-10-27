# Plan: Margo performance — kill the whole-home snapshot and bound the hot paths

Spec: `.claude/specs/margo-perf-state-snapshot.md` (D1–D8) · Branch: `fix/margo-perf-state-snapshot` · One Bakin PR +
one Bits companion PR.

## Dependency graph

```
T1 audit tail path ─┬─> T2 activity ids + bounded activity ─┐
                    ├─> T3 tasks history route + TaskLogTable ─┤
                    └─> T4 bakin logs bounded ─────────────────┴─> T5 arch guard (needs every whole-file reader gone)

T2 (shared id helpers) ──> T6 useHostStore (merge/dedupe uses the helpers; drops /api/state + /api/agents/health fetches)
T6 ──> T7 delete /api/state + readAll contract      (caller gone first → every commit builds)
T6 ──> T8 delete /api/agents/health                 (caller gone first; instance.ts probe replaced in T8)
T6 ──> T9 SSE invalidation-only                     (client stops reading content in T6)

T10a avatar plumbing ──> T10b avatar display variant ──> T11 avatar route consolidation
T12 network-address log (independent)
T13 docs/gates sweep + perf record  (after all)
T14 follow-up issue (after T13, outward-facing → confirm before filing)
B1  Bits companion (prepared + green against the candidate Bakin SHA BEFORE merge; merged SHA pinned after) ──> B2 repin Bakin compatibility.json
```

Ordering rule: **delete a server surface only after the commit that removes its last caller**; every commit passes
typecheck + lint + its focused tests on its own (bisectable, revertable).

## Commit strategy

One commit per task, conventional-commit scope, in the order below. Each commit:
- is buildable and green on its own (typecheck, lint, the task's focused tests + any test file it touched);
- carries its own docs/knowledge edits and, whenever it changes a route declaration OR an SDK export, the regenerated
  `docs/public/openapi.json` + `docs/src/content/docs/reference/generated/{api.mdx,sdk.md}` (`bun run docs:generate`,
  then `bun run docs:validate`) so `docs:check` stays green per commit;
- never stages build artifacts (`git add` explicit paths — never `-A`; restore `packages/core/src/generated-version.ts`
  stamp churn and inspect `packages/host/src/api/_embedded-assets-static.ts` churn separately — commit it only when a
  task intentionally changes embedded assets);
- ends with the `Co-Authored-By` trailer.

Rollback checkpoints (safe revert points; each restores a coherent system):

| Checkpoint | After | Revert effect |
|---|---|---|
| CP-A "server reads bounded" | T5 | Before T6 lands: revert T5→T1 in reverse order → old full-file audit reads. After T6: T6 uses T2's id helpers, so roll back T9→T7, then T6, then T5→T1 (strict reverse order) |
| CP-B "client off the snapshot" | T6 | Revert T6 alone → old store returns; T7–T9 must be reverted first if landed |
| CP-C "surfaces deleted" | T9 | Revert T7/T8/T9 independently (each is a pure deletion/payload change) |
| CP-D "avatars" | T11 | Revert T11, then T10b (raw avatars), then T10a (sync serveAvatar) → team GET route back |
| CP-E "merge-ready" | T13 | Full gates green; PR opened |

Commit list (planned messages):
```
T0  docs(specs): margo perf spec + plan
T1  perf(audit): limited unwindowed queries use the tail reader
T2  fix(activity): one activity identity and a bounded audit read
T3  fix(tasks): task history from the tasks plugin; drop the host memory /audit override
T4  perf(cli): bakin logs reads only the last N audit entries
T5  test(architecture): no whole-file audit reads outside core
T6  refactor(sdk)!: useHostStore — host state only, activity refresh per SSE connection
T7  refactor(core)!: delete /api/state and StorageAdapter.readAll
T8  refactor(core)!: delete /api/agents/health
T9  perf(watcher): SSE file events are invalidation-only
T10a refactor(agents): async serveAvatar and a cache path
T10b perf(agents): serve a cached display-size avatar
T11 refactor(team)!: one avatar GET route
T12 fix(server): log the detected network address, not a hardcoded IP
T13 docs: knowledge + generated references sweep; perf record
```

---

## Phase 1 — Bounded audit reads (server)

### T1 — `queryAuditEvents`: limited unwindowed queries use the tail reader
- **Change:** `src/core/audit.ts` — when `sinceMs` is undefined and `limit` is defined, call the reverse-chunk reader
  with no cutoff (generalize `queryAuditEventsTail(auditFile, cutoffMs | null, …)`). No-cutoff path keeps entries with
  unparseable `ts` (parity with the full read). `limit <= 0` throws a typed `RangeError` at the boundary. Unlimited
  unwindowed keeps the full read. Windowed behaviour byte-identical.
- **Acceptance:** parity test — generated fixture (mixed kinds/agents, malformed lines, unparseable ts, multibyte UTF-8
  straddling a 64 KiB boundary, one line > 64 KiB) returns the same array via old full-read semantics and new tail path
  for kinds/agent/match/limit combos; zero matches → `[]`; `limit: 0` throws; I/O budget — Bun-safe instrumentation
  (pattern from `tests/core/operations/resources-failure.test.ts`): capture the original `fs` functions BEFORE
  `mock.module('fs', …)`, wrap `readSync` to sum bytes, then dynamically `import()` `src/core/audit.ts`; on an ≥ 8 MB
  fixture with ≤ 2 KiB lines an unfiltered `limit: 50` query reads > 0 and ≤ 128 KiB (assert both bounds).
- **Verify:** `bun test tests/core/audit-query.test.ts --isolate` AND `bun test tests/core/audit-query-io.test.ts --isolate`
  (byte counter enabled/reset immediately around the measured query) (+ existing health-check tests that use the
  reader, unchanged); typecheck.
- **Files:** `src/core/audit.ts`, `tests/core/audit-query.test.ts` (new cases), new `tests/core/audit-query-io.test.ts`
  (instrumented, own process).

### T2 — One activity identity + bounded `/api/activity`
- **Change:**
  - Pure helpers in SDK utils (`packages/sdk/src/utils/activity-id.ts`, exported from `@makinbakin/sdk/utils`):
    `taskLogActivityId(taskId, timestamp, author, message)` (short stable hash of message to separate same-ms entries —
    synchronous, browser-safe, dependency-free: FNV-1a 32-bit over UTF-16 code units, base36) and
    `auditActivityId({ ts, event, agent })`.
  - `src/core/task-service.ts` `logProgress`: resolve/require the CANONICAL task id FIRST — before the workflow
    authorization (identifier may be a title — `packages/core/src/tasks/store.ts` `findSync`; today authorization runs on
    the raw identifier and workflow lookup tolerates a missing instance, so a title could slip past ownership) — then
    use that id for authorization, heartbeat bump, broadcast and persistence. Mint one ISO `timestamp`, pass both to
    `addTaskLog` (new optional `timestamp` param in `src/core/task-store.ts` → persisted entry) and to the broadcast.
  - `packages/host/src/api/activity.ts`: audit side via `queryAuditEvents(getContentDir(), { limit: 50 })`; ids via the
    helpers; empty `catch {}` → logged (`createLogger('activity')`).
  - `packages/sdk/src/hooks/use-sse.ts`: `activity` and audit SSE events build ids with the same helpers.
- **Acceptance:** unknown task rejects with NO side effects (no broadcast, no heartbeat bump, no persistence);
  title-identified call by a non-owning agent on a workflow task is denied; operator (human) bypass preserved;
  persisted + broadcast timestamp identical; a title-identified `logProgress` broadcasts the canonical
  id and its HTTP id equals its SSE id; HTTP and SSE ids identical for the same entry; two
  same-author same-ms entries with different messages get different ids; entries from two tasks never collide;
  activity calls `queryAuditEvents` with a finite limit (spy); handler errors are logged.
- **Verify:** focused tests (`tests/core/task-service*.test.ts` touched cases, new `tests/api/activity.test.ts`,
  `tests/sdk/activity-id.test.ts`); typecheck; lint; `docs:generate` + `docs:validate` (new SDK utils exports → `sdk.md`),
  `bun run ui:public-api:check` (regenerate if the utils export list is inventoried). Note partial task-store mocks:
  adding the `timestamp` param must not break mocks across `tests/` — sweep (memory: partial-task-store-mocks).
- **Files:** `packages/sdk/src/utils/{activity-id.ts,index.ts}`, `src/core/task-service.ts`, `src/core/task-store.ts`,
  `packages/host/src/api/activity.ts`, `packages/sdk/src/hooks/use-sse.ts` (+ tests).

### T3 — Task history from the tasks plugin; drop the host memory `/audit` override
- **Change:** tasks plugin route `GET /history` (`/api/plugins/tasks/history`) → `queryAuditEvents({ match: e =>
  e.event.startsWith('task.'), limit: 500 })`, raw `{ ts, event, agent, data }`, file order. `task-log-table.tsx` fetches
  it, reads `event`/`ts`, drops `.reverse()`. Delete `packages/host/src/api/plugins/memory/audit.ts`, its dispatch branch
  in `request-handler.ts`, its `core-routes` entry. Regenerate docs.
- **UI:** load `bakin-ui-conformance` first; no presentation change (same table, same `SystemState` fallbacks).
- **Acceptance:** route returns only `task.*`, ≤ 500, oldest first; TaskLogTable renders historical rows from a fixture
  of raw records (regression for today's `entry.type` crash); fetch failure/timeout degrades to current tasks;
  `/api/plugins/memory/audit` now dispatches to the memory plugin's search-backed route (dispatch test).
- **Verify:** focused tests (`tests/plugins/tasks/routes-rest.test.ts` new case via `tests/plugins/test-helpers.ts`
  `callRoute`; TaskLogTable RTL test with `rtl-settle`/`actRender`); `tests/docs/route-contract-check.test.ts` +
  `tests/core/route-registry.test.ts`; `bun run ui:conformance --quick`; `docs:generate` clean diff committed.
- **Files:** `plugins/tasks/lib/routes.ts`, `plugins/tasks/components/task-log-table.tsx`,
  `packages/host/src/api/plugins/memory/audit.ts` (deleted), `src/core/server/request-handler.ts`,
  `packages/host/src/core-routes/index.ts`, generated docs, tests/fixtures.

### T4 — `bakin logs` bounded
- **Change:** `src/cli/commands/lifecycle.ts` history: `lines > 0 ? queryAuditEvents(auditDir, { limit: lines })
  .map(e => JSON.stringify(e)) : []` → `emitLine`. Follow mode unchanged.
- **Acceptance:** output for the last N lines matches the previous behaviour on a fixture (incl. `--filter`, JSON
  output); `lines = 0` emits nothing without calling the reader.
- **Verify:** `bun test tests/cli/readonly-logs.test.ts --isolate` (+ new case); typecheck.
- **Files:** `src/cli/commands/lifecycle.ts`, `tests/cli/readonly-logs.test.ts`.

### T5 — Architecture guard: no whole-file audit reads outside core
- **Change:** `tests/architecture/audit-reads.test.ts` — pure scanner over `src packages plugins cli server.ts`: flags
  `readFileSync`/`Bun.file(...).text()`/`createReadStream` whose argument is an `'audit.jsonl'` literal, a
  `getBakinPaths().audit` expression, or an identifier assigned from either in the same file. Allowlist with rationale:
  `src/core/audit.ts` (owner), `plugins/team/lib/agent-status.ts` (64 KB tail), `plugins/memory/lib/indexer.ts`
  (offset-incremental). Teeth: inline fixture strings proving literal, path-variable, and allowlisted cases.
- **Acceptance:** green on the tree after T2–T4; red on each teeth fixture.
- **Verify:** `bun test tests/architecture/audit-reads.test.ts`.
- **Files:** new test file only.

**▶ CP-A checkpoint:** typecheck, lint, `bun test tests/core tests/api tests/architecture tests/plugins/tasks --isolate`
(bare, no pipes). Codex/self review of T1–T5 diff before Phase 2.

---

## Phase 2 — Client off the snapshot

### T6 — `useHostStore`
- **Change:**
  - `git mv packages/sdk/src/hooks/use-content-store.ts use-host-store.ts`; export `useHostStore` only. State:
    `connected`/`setConnected`, `debug`/`setDebug`/`toggleDebug` (localStorage persistence kept),
    `activityEvents` + `appendActivityEvent` + `refreshActivity()`. `refreshActivity` fetches `/api/activity`, merges
    with live events (dedupe by id, newest first, cap 100), discards a response older than the latest request
    (request sequence number).
  - Delete `files`/`setFiles`/`updateFile`, `heartbeats`/`setHeartbeats`, `auditEntries`/`appendAuditEntry`,
    `sseConnected`/`setSseConnected`, `loading`, `initialize`. Debug hydration (`localStorage['bakin-debug']`, today
    inside `initialize()`) moves to the store's initial state (guarded read at creation) — `tests/hooks/use-debug.test.ts`
    (calls `initialize()` at :64/:72/:81) migrates to the new hydration path, testing GENUINE creation (fresh module
    import per case, not the shared singleton): absent `window`/`localStorage`, throwing getter / `getItem`, stored
    `true`/`false`. The `?debug=true` one-shot `DebugSeed` in `packages/host/src/providers/Providers.tsx` is preserved;
    test URL activation → toggle off → SSE reconnect does not reseed. `ContentState` → delete (or `HostState` if the
    public types index needs one — decide by the SDK types index); delete the `Heartbeat` type.
  - `use-sse.ts`: call `refreshActivity()` exactly once per successful `onopen`; delete the mount `initialize()`, the
    workflow/approval `initialize()` calls, `updateFile`, heartbeat debounce timer + cleanup, `appendAuditEntry`,
    `setSseConnected`. `bakin.file.changed`, `bakin.reconcile`, audit/plugin fan-out unchanged.
  - Migrate consumers: `packages/host/src/providers/Providers.tsx`, `packages/host/src/components/layout/connection-dot.tsx`,
    `src/components/tasks/activity-feed.tsx`, `packages/sdk/src/hooks/{use-debug.ts,index.ts}`,
    `scripts/docs/lib/sdk-reference.ts`, every test mock of the store.
  - `plugins/tasks/components/kanban-board.tsx`: drop the store import; `initialLoading = !boardFailed && !boardLoaded`.
- **UI:** load `bakin-ui-conformance`; re-run `SystemState` `StateMatrix`, tasks board stories/fixtures.
- **Acceptance:** exact store shape test; one `/api/activity` fetch per SSE open (first + reconnect — tested through
  the real close/backoff/reopen path in `use-sse.ts` with a fake EventSource, not by calling the handler directly;
  `bakin.reconcile` still emitted on reconnect), zero
  `/api/state`/`/api/agents/health` requests anywhere in the client (grep + test); merge/dedupe + stale rejection tests;
  board renders when its own fetch resolves even if `/api/activity` hangs; board failure/retry unchanged; RTL files use
  `rtl-settle`, act discipline clean.
- **Verify:** focused SDK/host/tasks tests (`tests/hooks/use-debug.test.ts` + use-sse/store/kanban tests);
  `bun run ui:conformance --quick`; typecheck; lint; `bun run ui:public-api:check` (regenerate via
  `ui:public-api:generate` if it lists the hook); `docs:generate` + `docs:validate` (`sdk.md` `useContentStore` row →
  `useHostStore`) committed in this commit.
- **Files:** ~10 (SDK hooks, host shell 2, activity feed, kanban, docs script, tests). Over the 5-file guideline because
  a rename must land atomically with its consumers (no aliases).

### T7 — Delete `/api/state` and `StorageAdapter.readAll`
- **Change:** delete `packages/host/src/api/state.ts`, its dispatch, `core-routes` entry, `rest-activity-class` entry,
  `readAllContent`; remove `readAll` from `packages/sdk/src/types/context.ts`, `packages/core/src/plugin-types.ts`,
  `MarkdownStorageAdapter`, `ScopedPluginStorage`, `src/lib/plugin-permissions.ts` (`storage.readAll`), test mocks
  (`tests/core/plugin-registry.test.ts`, `tests/integration/*`, `tests/lib/{storage-adapter,plugin-permissions}.test.ts`,
  `tests/plugins/search-hit-renderer-contract.test.ts`), the `/api/state` assertions in
  `tests/core/rest-activity-class.test.ts` (:37 and :117); knowledge `plugin-system.md` / `storage-model.md` rows;
  regenerate docs. Run `tests/core/rest-activity-class.test.ts` + route-contract tests with the storage tests.
- **Acceptance:** `rg -n "readAll\b|readAllContent|/api/state"` over src/packages/plugins/tests/docs/.claude → only the
  spec/plan; `GET /api/state` → 404 test; storage-adapter tests keep every other method's coverage.
- **Verify:** typecheck; lint; touched tests; `docs:generate` diff committed.

### T8 — Delete `/api/agents/health`
- **Change:** replace the `scripts/instance.ts:274` HTTP probe with `GET /api/operations` (always registered, tiny,
  no side effects — same "server answers" semantics; confirm by reading the surrounding status code before editing); delete
  `packages/host/src/api/agents/health.ts`, dispatch, `core-routes`, `rest-activity-class` entry + its test row;
  regenerate docs. `readHeartbeats()` stays (Team).
- **Acceptance:** `bun run instance status` (or the touched function's unit test) still reports up/down correctly;
  `/api/agents/health` → 404; no references remain.
- **Verify:** typecheck; `bun test tests/scripts/instance/ --isolate`; `tests/core/rest-activity-class.test.ts`.

### T9 — SSE file events are invalidation-only
- **Change:** `src/core/watcher.ts` — all four broadcasts send `{ file, event, timestamp }`; `injectFileEvent` + sync/unlink
  hooks unchanged. Rewrite `tests/core/watcher.test.ts` content assertions → exact payload (no `content` key) + hooks still
  receive content. Realtime knowledge + public `realtime.md` state the invalidation-only contract.
- **Acceptance:** exact payload tests for text/asset/binary/unlink; hook delivery preserved; messaging-style consumer
  (`bakin.file.changed` → `file`) test still green.
- **Verify:** `bun test tests/core/watcher.test.ts --isolate`; typecheck.

**▶ CP-C checkpoint:** typecheck, lint, full `bun run test` (bare), `bun run ui:conformance --quick`, `bun run docs:check`.
Review T6–T9 diff.

---

## Phase 3 — Avatars, boot log

### T10a — Avatar plumbing: cache path + async `serveAvatar` (no behaviour change)
- **Change:** `packages/core/src/content-dir.ts` adds `cache: string` to the `BakinPaths` interface (:97) and
  `cache: join(home, '.cache')` to `getBakinPaths()` (:127) (dot dir → watcher-ignored); sweep every `getBakinPaths` mock
  in `tests/` that can reach avatar code (core avatar, host `/api/agents/avatar` API tests, team plugin tests) to include
  temp `cache` AND `media` (CLAUDE.md: media-store code resolves `getBakinPaths().media`), keeping both content-dir
  resolver mocks, the OpenClaw home mock, cleanup and logger isolation. `serveAvatar` becomes
  `async (…): Promise<Response>` — update both callers (host route, team route until T11; both handlers are already
  async) and `await` every call in `tests/core/agents/avatar.test.ts` (:98, :112, …). Still serves originals.
- **Acceptance:** existing avatar tests green awaited; typecheck clean.
- **Verify:** `bun test tests/core/agents/avatar.test.ts tests/plugins/team/routes.test.ts --isolate`; typecheck.
- **Commit:** `refactor(agents): async serveAvatar and a cache path`.

### T10b — Cached display-size avatar
- **Change:** `packages/core/src/agents/avatar.ts`: `serveAvatar` — source ≤ 64 KiB → original; else derive via `loadSharp()` →
  `<cache>/avatars/<agentId>.webp` + `<agentId>.json` (source path, mtimeMs, size, transform version, etag or
  failure marker). Resize `fit: inside`, 256 px, no enlargement; WebP q80 → q60 → q40 until ≤ 65,536 bytes, else failure.
  Single-flight `Map<agentId, Promise>`; atomic write (tmp + rename); re-stat source before publish. ETag =
  `"<kind>-<size>-<mtime>-<v>"` with distinct `kind` for derived vs original; conditional-GET + Cache-Control unchanged.
  Failure handling: `loadSharp()` → null is NOT recorded (the loader owns its own cache/re-probe, so installing media via
  `bakin install media` starts deriving without a restart); a conversion failure or over-budget result is suppressed
  IN MEMORY per source key (path+mtime+size+v) ⇒ serve original without retrying until the source changes; cache dir
  created recursively; any mkdir/write/rename error ⇒ serve original + log once per source key.
- **Acceptance (unit, temp `BAKIN_HOME`, real sharp when available + mocked `loadSharp` null/throwing):** small source
  as-is; large → WebP ≤ 256 px & ≤ 64 KiB; second GET is a cache hit (no sharp call); source mtime/size change
  regenerates; derived vs original ETags differ; 304 on matching `If-None-Match`; sharp null → original; conversion throw
  → original and no second attempt; 5 concurrent GETs → one conversion; originals byte-identical after; `loadSharp`
  null then installed → next GET derives (no restart); unwritable cache dir (EACCES) → original, no throw; cold vs warm
  GET timings logged by the test (informational).
- **Verify:** `bun test tests/core/agents/avatar.test.ts --isolate`; typecheck. Compiled-binary sharp path is covered by the
  existing media-store tests (local compiled tests die 137 on this Mac — memory; rely on CI).
- **Files:** `packages/core/src/content-dir.ts`, `packages/core/src/agents/avatar.ts`, tests (+ mock sweeps).

### T11 — One avatar GET route
- **Change:** delete the team plugin `GET /:agentId/avatar` route; `plugins/team/lib/runtime-agents.ts` `headshot` →
  `/api/agents/avatar?id=<id>`; `agent-detail.tsx` post-upload cache-bust → same URL + `&t=`; `plugins/team/client.tsx`
  hit renderer thumbnail → same URL (fixes today's unregistered `/api/agents/<id>/avatar`). Team POST unchanged.
  Host route-contract parity: `packages/host/src/core-routes/index.ts:34` gains the 304 + 400 responses the team route
  declared (`plugins/team/lib/routes/agents.ts:764`); host handler validates the id exactly as the team route did.
  Migrate the team GET assertions in `tests/plugins/team/routes.test.ts` (:357, :395, :413 — validation, cache headers,
  304) to host-route tests. Regenerate docs. Grep Bits for team avatar URLs (none known).
- **UI:** load `bakin-ui-conformance`; re-run `AgentAvatar` `CanonicalUsage` + Team stories.
- **Acceptance:** team GET → 404/unmatched; host route serves derived variant; ⌘K team hit shows the avatar (renderer
  test); agent detail upload refreshes the image.
- **Verify:** focused team tests; `ui:conformance --quick`; `docs:generate`.

### T12 — Detected network address in the boot log
- **Change:** new `src/core/network-address.ts` (`findCgnatIPv4`, spec code); `server.ts:290` logs
  `Listening on 0.0.0.0:${port}` + ` (network: http://<ip>:${port})` only when found.
- **Acceptance:** unit tests — 100.63.255.255 / 100.128.0.0 rejected, 100.64.0.0 / 100.127.255.255 accepted, internal and
  IPv6 skipped, none → null, deterministic with multiple interfaces.
- **Verify:** `bun test tests/core/network-address.test.ts`; typecheck.

---

## Phase 4 — Docs, gates, delivery

### T13 — Docs + gates sweep, perf record
- **Change:** grep `.claude/knowledge`, `docs/src/content`, `README.md`, `CLAUDE.md`, `CONTRIBUTING.md` for every removed/
  renamed surface (`/api/state`, `readAll`, `useContentStore`, `ContentState`, `Heartbeat`, `/api/agents/health`, memory
  `/audit`, team avatar GET, file-event `content`); fix leftovers (D8). Full build chain (memory: full-build-chain-before-commit),
  record before/after vendor sizes vs `design-system/performance.json` in the PR body (ask before any ceiling increase).
- **Verify (all bare):** `bun run typecheck`, `bun run lint`, `bun run test`, `bun run ui:conformance --full`, the
  Tasks + Team UI fixtures (`bun run ui:test:conformance`; inspect its report per `bakin-ui-conformance`),
  `bun run docs:check`, `bun run build`, `/verify` isolated boot (Pi runtime, dispatch paused, guest antfly URL):
  `/api/state` 404, `/api/activity` < 50 KB, SSE frame has no `content`, avatar derived, task history route,
  boot log line. Revert the build stamp before committing.
- **Deliver:** push branch, open PR (spec + plan linked, checkpoint table, perf numbers, Bits companion note).

### T14 — Follow-up issue (confirm before filing — outward-facing)
- Task-store full walk (`readTaskboard()`/`listSync()` on board + activity) and the 3.0 MB board payload: slim board
  record with explicit dispatch-failure summary, on-demand task detail, archive pagination, bounded activity task-log reads.

### B1/B2 — Bits companion (validated BEFORE the Bakin merge, pins finalized after)
- B1 (Bits repo, own branch/PR, prepared during T13): remove `readAll` from `types/sdk-ambient.d.ts` +
  `plugins/test-helpers.ts`; set `BAKIN_SDK_REF` to the candidate Bakin branch head SHA; Bits CI (or the same commands
  locally) green against it — this is the "Bits companion green against the changed SDK" merge gate. After the Bakin PR
  merges, update `BAKIN_SDK_REF` to the merged SHA and merge B1.
- B2 (Bakin): repin `design-system/compatibility.json` to the merged Bits revision (memory: ratchet ledger needs pinned Bits).

### Post-release verification on Margo (after the operator cuts a release)
Re-measure with the same probes used for diagnosis: cold `/tasks` load (criterion 2), reconnect cost (3), avatar bytes (6),
boot log line (7); confirm fresh `dispatch.run-dirs` sweep evidence.

## Success criteria → tasks

| Spec criterion | Delivered by | Demonstrated by |
|---|---|---|
| 1 surfaces gone, no `readAll` | T3, T7, T8, B1 | T7/T8 grep + 404 tests; B1 green |
| 2 cold load < 1 MB JSON excl. board | T6 (+T7) | `/verify` HAR-style probe in T13; Margo post-release |
| 3 one refresh per SSE connection | T2, T6 | T6 fake-EventSource test; Margo post-release |
| 4 no file content in SSE | T9 | T9 exact-payload tests; `/verify` frame check |
| 5 bounded audit read | T1, T2 | T1 I/O test; T2 spy |
| 6 avatar ≤ 64 KiB / originals intact | T10a, T10b, T11 | T10b tests; `/verify` |
| 7 correct boot address | T12 | T12 tests; Margo post-release |
| 8 gates, docs, follow-up | T13, T14, B1, B2 | T13 gate run; issue link; pins |

## Risks

| Risk | Mitigation |
|---|---|
| Partial task-store mocks break when `addTaskLog` gains a param (T2) | Sweep all mocks in one pass (known trap) |
| `getBakinPaths` mocks missing `cache` (T10) | Grep-sweep mocks that reach avatar code; spec'd in T10 |
| Store rename touches many files at once (T6) | Atomic commit, CP-B revert point; tests on every consumer |
| docs:check fails mid-series | Regenerate docs in every route-changing commit |
| Bits CI red between Bakin merge and B1 | Bits pins `BAKIN_SDK_REF`; B1 bumps it deliberately |
| sharp absent in compiled binary | Original-serving fallback is a tested path |
| Reconnect storms re-fetching activity | One refresh per open; stale-response guard; bounded handler (T1/T2) |

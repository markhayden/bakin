# Spec: Margo performance — kill the whole-home snapshot and bound the hot paths

Status: draft (2026-10-26) · Branch: `fix/margo-perf-state-snapshot`

## Objective

Bakin on Margo (M4 mini, rc.45, reached over Tailscale) is slow to come back after a restart, the UI spins for
seconds, and interactions lag. The machine is idle and the server boots in ~1.5 s, so the cost is in what the
browser is made to download and hold.

Measured on Margo, 2026-10-26:

| Surface | Cost | Root cause |
|---|---|---|
| `GET /api/state` | **155 MB** (21 MB gzip, ~6 s over Tailscale), 350–800 ms synchronous server walk | `MarkdownStorageAdapter.readAll()` reads every `.md/.json/.jsonl` under `~/.bakin` — run-workspaces agent scratch (127 MB), `npm/node_modules`, `audit.jsonl` |
| Content store `initialize()` | Re-runs that fetch on mount, every SSE reconnect, workflow gate/completion and approval events | The `files` map it fills is read by nothing |
| Task board first paint | Waits for the store's `loading` → waits for the 155 MB | `kanban-board.tsx:547` gates on store `loading` |
| Store memory | `auditEntries` appended on every audit event forever, never read | Dead state |
| Watcher SSE | Full file content on every change, kept in the 200-event replay buffer | Nobody reads `content` client-side |
| `GET /api/activity` | ~50 ms, parses the whole 7.6 MB / 30.6k-line `audit.jsonl` (+ every task) per call | Unbounded reader |
| Agent avatar | 1.9 MB JPEG for a ≤48 CSS-px render | Original served raw |
| Boot log | `Tailscale: http://100.91.112.69` — another machine | Hardcoded literal |

Out of scope (already fixed on main): `doctor-repair-store` "Skipping invalid doctor repair request" spam —
`archiveRefusedRepairRequests` runs at boot (`server.ts:132`); Margo's warnings stopped 2026-10-25.

Deferred to a separately spec'd follow-up issue (filed as part of this work): the task-store full walk
(`readTaskboard()` → `listSync()` reads all 588 task files per call) and the 3.0 MB board payload. The board
UI reads `task.log` (failure signals on cards, Notes section, archive filters), so slimming it is a contract
change that needs its own spec.

**User:** the single operator. **Priority:** reduce tech debt; no backwards compatibility, no shims, no aliases.

## Decisions

### D1 — Delete `/api/state` and `readAll()` everywhere
- Delete `packages/host/src/api/state.ts`, its dispatch in `src/core/server/request-handler.ts`, the
  `core-routes/index.ts` entry, the `src/core/rest-activity-class.ts` entry, `readAllContent()` in
  `src/lib/content-files.ts`.
- Remove `readAll()` from the storage contract: `packages/sdk/src/types/context.ts`, `packages/core/src/plugin-types.ts`,
  `MarkdownStorageAdapter`, `ScopedPluginStorage`, the `storage.readAll` permission mapping
  (`src/lib/plugin-permissions.ts`), every test mock, and the knowledge docs. Keep the shared `walkFiles` utility (other callers).
- Regenerate `docs/public/openapi.json` + `docs/src/content/docs/reference/generated/api.mdx` via `docs:generate`.
- Bits companion PR: drop `readAll` from `types/sdk-ambient.d.ts` and `plugins/test-helpers.ts`.
- The externals-contract release guard is unaffected (it checks import-map family, not `ctx` shape).

### D2 — Prune and rename the content store → `useHostStore`
- `packages/sdk/src/hooks/use-content-store.ts` → `use-host-store.ts`, export `useHostStore` (no alias). State is
  exactly what is read: `connected`/`setConnected`, `debug`/`setDebug`/`toggleDebug`, `activityEvents` +
  `appendActivityEvent`/`setActivityEvents`, plus an `initialize()`/`refreshActivity()` that fetches only `/api/activity`.
- Delete: `files`/`setFiles`/`updateFile`, `heartbeats`/`setHeartbeats`, `auditEntries`/`appendAuditEntry`,
  `sseConnected`/`setSseConnected`, `loading`, the `ContentState` type (replace with `HostState` if a public type is
  still needed), the unused SDK `Heartbeat` type, the heartbeat debounce timer in `use-sse.ts`.
- Activity refresh is explicit: **each successful SSE connection (first open and every reconnect) triggers exactly one
  host-store activity refresh** — there is no separate mount fetch. Drop the "full UI refresh" `initialize()` calls on
  workflow/approval events (they only exist to refetch the dead snapshot). Existing domain reconciliation subscribers
  (`bakin.reconcile`, e.g. `plugins/tasks/hooks/use-task-approvals.ts`) are untouched. The snapshot **merges** with live
  SSE events (dedupe by id, newest first, cap 100) and a response older than the latest request is discarded.
- **One stable activity identity.** Today HTTP ids (`${ts}-log-${author}`, `packages/host/src/api/activity.ts`) and SSE
  ids (`${ts}-activity-${agent}`, `use-sse.ts`) never match, and `logProgress` (`src/core/task-service.ts`) broadcasts
  with one `new Date()` while `addTaskLog` (`src/core/task-store.ts`) persists another. `logProgress` mints ONE timestamp,
  passes it to `addTaskLog` (persisted entry) and the broadcast; both HTTP and SSE derive the id with one shared helper
  `taskLogActivityId(taskId, timestamp, author, message)` (SDK utils, pure). Audit events use one shared
  `auditActivityId(entry)` on both paths. Tests cover snapshot/live overlap and two same-author entries in the same ms.
- Full migration inventory for the rename: `packages/host/src/providers/Providers.tsx`,
  `packages/host/src/components/layout/connection-dot.tsx`, `src/components/tasks/activity-feed.tsx`,
  `packages/sdk/src/hooks/{use-debug.ts,use-sse.ts,index.ts}`, `plugins/tasks/components/kanban-board.tsx`,
  `scripts/docs/lib/sdk-reference.ts`, every test mocking the store.
- Delete `GET /api/agents/health` (handler, dispatch, core-route, activity class) after replacing its one other
  caller, `scripts/instance.ts:274`, with a probe of an existing endpoint. Keep `readHeartbeats()` (Team uses it).
- Kanban: drop the store dependency; `initialLoading = !boardFailed && !boardLoaded`, preserving its existing
  error/retry state and `SystemState` presentation.
- Update the generated SDK reference (`useContentStore` row) and the public-api inventory if it lists the hook.

### D3 — SSE file events are invalidation-only
- All four watcher broadcasts (text, asset sidecar, binary asset, unlink) send `{ file, event, timestamp }` — no
  `content` key. `eventBus.injectFileEvent(rel, event, content)` and sync/unlink hooks are unchanged (server-side
  consumers still get content).
- `use-sse.ts` keeps emitting `bakin.file.changed { file, change }`.
- Watcher tests that assert YAML/YML `content` are rewritten to assert absence + preserved hook delivery; realtime docs
  state the invalidation-only contract.

### D4 — Bounded audit reads through the one sanctioned reader
- `queryAuditEvents` (`src/core/audit.ts`) keeps its contract exactly: file order (oldest first), `limit` keeps the
  last N matches, filter (`kinds`/`agent`/`match`) before limit, time-windowed queries unchanged. **Change:** an
  unwindowed query WITH a `limit` uses the existing reverse-chunk tail reader (no cutoff) and stops at `limit` matches
  instead of `readFileSync`-ing the whole file. No caller changes ordering; no `maxBytes`/completeness metadata is
  introduced (time-windowed health checks are already bounded by their window and keep their semantics).
  The unwindowed, unlimited full read stays for exhaustive callers. Parity edges, specified and tested: the no-cutoff
  tail path must NOT drop entries with unparseable timestamps (the full read keeps them; only the windowed path skips
  them); `limit <= 0` is rejected at the boundary (today `slice(-0)` silently returns everything) — `bakin logs` keeps its
  own zero-lines behaviour by not calling the reader. A filtered query on a rare kind may scan to the start: correct,
  and accepted.
- `/api/activity` uses `queryAuditEvents(contentDir, { limit: 50 })` for the audit side (replaces its private
  whole-file parse) — reads ~1–2 chunks on Margo instead of 7.6 MB. Task-log side unchanged (deferred). Ids per D2.
  Replace the handler's empty `catch {}` blocks with logged ones.
- **Task history moves to its owner.** `plugins/tasks/components/task-log-table.tsx` is the one live consumer of the
  host `GET /api/plugins/memory/audit` override — and it is broken today (it reads `entry.type`; the host returns raw
  records with `event`, so the parse throws inside its `try` and historical rows silently never render). Add a tasks
  plugin route `GET /api/plugins/tasks/history` → `queryAuditEvents({ match: e => e.event.startsWith('task.'), limit: 500 })`
  returning raw `{ ts, event, agent, data }` in file order (oldest first); migrate TaskLogTable (+ its fixture) to it:
  read `event` (not `type`) and `ts` (not `timestamp`), and drop its `.reverse()` so later transitions win. Then delete the
  host memory `/audit` handler, dispatch branch, and core-route so the memory plugin's own search-backed `/audit` route
  is reachable. Tests: TaskLogTable renders historical rows from the new route; failure degrades to current tasks.
- `bakin logs` (`src/cli/commands/lifecycle.ts:299`) reads the whole file for the last N lines → use
  `queryAuditEvents({ limit: lines })` and emit `JSON.stringify(entry)` per line (same output shape).
- Team's `getLastAuditActivity` keeps its own 64 KB scan (a global entry limit would hide quiet agents). The memory
  indexer's offset-based incremental read (`plugins/memory/lib/indexer.ts`) is exhaustive by design and stays.

### D5 — Avatar display variant
- `serveAvatar` serves a derived WebP — ≤ 256 px on either axis, aspect preserved, never upscaled, and ≤ 65,536 body
  bytes (encode at q80; step down q60 → q40 if over budget; still over ⇒ treat as a conversion failure) — when the
  source exceeds 64 KiB and `loadSharp()` resolves. Originals (uploads, package projections with `.installedBy`) are never modified.
- Cache: dedicated, watcher-excluded directory, one replaceable entry per agent, validity keyed on source path +
  full-resolution mtime + size + transform version. Single-flight per agent, atomic write, source re-stat before publish.
- HTTP: representation-specific ETags (derived vs original never share a validator); existing conditional-GET
  precedence and Cache-Control kept. On sharp-absent or conversion failure, serve the original and remember the
  failure for that source key (no retry storm).
- Consolidate GET onto the host `GET /api/agents/avatar?id=<agentId>`; delete the team plugin's GET route; migrate
  `plugins/team/lib/runtime-agents.ts` (`headshot`), `agent-detail.tsx` (cache-bust after upload), and the ⌘K hit
  renderer in `plugins/team/client.tsx` (currently the unregistered `/api/agents/<id>/avatar`). Team POST unchanged.
- `avatar-full.png` is untouched (no serving consumer).

### D6 — Detected network address in the boot log
- Pure `findCgnatIPv4(interfaces)` in `src/core/network-address.ts` (input = `os.networkInterfaces()` shape): first
  non-internal IPv4 in `100.64.0.0/10`, deterministic order. `server.ts` logs it when present
  (`Listening on 0.0.0.0:3737 (network: http://100.80.53.60:3737)`), omits the parenthetical otherwise.
- Logging only — `BAKIN_URL`/approval-link and server-lock targeting policies are unchanged.

### D7 — Regression guards
- Unit tests for every decision (see Testing Strategy).
- One architecture test (`tests/architecture/`, pure scanner, allowlist style of `adapter-boundary.test.ts`):
  no whole-file reads of the audit log outside `src/core/audit.ts`; catches path variables (`AUDIT_PATH`,
  `getBakinPaths().audit`) not just `'audit.jsonl'` literals; explicit allowlist with a one-line rationale each:
  Team's 64 KB tail reader, the memory indexer's offset-incremental reader. Fixtures prove it bites (literal and
  path-variable forms) and that allowlisted files pass.
- No broad "whole-home walk" scanner (would miss transitive walks; D1 removes the only one).

### D8 — Docs inventory (updated in the same commit as the behavior)
- `.claude/knowledge/plugin-system.md` (storage `readAll` row ~1621; content-store notes ~1249/1350),
  `.claude/knowledge/storage-model.md` (~57), `.claude/knowledge/design-system.md` (~186, store/hook mention),
  the realtime/SSE knowledge + public `docs/src/content/docs/**/realtime.md` (~58: invalidation-only file events),
  the search/asset knowledge only if they reference the removed surfaces (grep, don't assume).
- Generated: `docs/public/openapi.json`, `docs/src/content/docs/reference/generated/{api.mdx,sdk.md}` via `docs:generate`.
- CLAUDE.md / README.md: grep for the removed surfaces; update only lines that name them (none known today).

## Tech Stack
Bun 1.4.3 (pinned), TypeScript strict, React 19 + Zustand (SDK store), zod at boundaries, `bun:test` + happy-dom +
RTL (`tests/rtl-settle.ts`), sharp via `loadSharp()`.

## Commands
```
Typecheck:        bun run typecheck
Lint:             bun run lint
Unit (one file):  bun test tests/path/to/file.test.ts --isolate
Full suite:       bun run test
Docs regenerate:  bun run docs:generate
UI conformance:   bun run ui:conformance --quick   (full mode before merge)
Build chain:      bun run build   (css + vendors + plugins + host; never `git add -A` after — build stamp trap)
Isolated verify:  /verify skill (BAKIN_HOME temp, guest antfly URL, Pi runtime, dispatch paused)
```

## Project Structure (touched areas)
```
packages/host/src/api/{state.ts (deleted), activity.ts, agents/health.ts (deleted), agents/avatar.ts, plugins/memory/audit.ts (deleted)}
packages/host/src/core-routes/index.ts          route declarations
src/core/server/request-handler.ts              dispatch branches
src/core/rest-activity-class.ts                 activity classes
src/core/{audit.ts, watcher.ts, network-address.ts (new)}
src/lib/{content-files.ts, plugin-permissions.ts}
packages/core/src/{plugin-types.ts, storage/markdown-adapter.ts, storage/scoped-plugin-storage.ts, agents/avatar.ts}
packages/sdk/src/{hooks/use-host-store.ts (renamed), hooks/use-sse.ts, hooks/index.ts, types/context.ts, types/host-state.ts}
plugins/tasks/{components/kanban-board.tsx, components/task-log-table.tsx, index.ts or lib/routes (history route)}
plugins/team/{client.tsx, lib/runtime-agents.ts, lib/routes/agents.ts, components/agent-detail.tsx}
packages/host/src/{providers/Providers.tsx, components/layout/connection-dot.tsx}
src/components/tasks/activity-feed.tsx
src/core/{task-service.ts, task-store.ts}       one activity timestamp
src/cli/commands/lifecycle.ts                   bakin logs bounded
scripts/{instance.ts, docs/lib/sdk-reference.ts}
server.ts
tests/**                                        unit + architecture tests
.claude/knowledge/*, docs/src/content/docs/**   docs
```

## Code Style
Match surrounding code: kebab-case files, `createLogger('module')`, no empty catches, `const`, pure helpers.
```ts
// src/core/network-address.ts
import type { NetworkInterfaceInfo } from 'os'

/** First non-internal IPv4 in 100.64.0.0/10 (CGNAT — the range Tailscale assigns), or null. */
export function findCgnatIPv4(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  for (const name of Object.keys(interfaces).sort()) {
    for (const info of interfaces[name] ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      const [a, b] = info.address.split('.').map(Number)
      if (a === 100 && b >= 64 && b <= 127) return info.address
    }
  }
  return null
}
```

## Testing Strategy
Every test file follows CLAUDE.md isolation (content-dir + OpenClaw home mocks, temp dirs, cleanup, logger/watcher mocks);
RTL files import `rtl-settle` and use `actRender`; waits use `waitUntil`/`settleFor`.
- **Store (`tests/sdk/use-host-store.test.ts`)**: exact state shape; refresh fetches only `/api/activity`; merge/dedupe
  with live events (snapshot/live overlap, two same-author entries in the same ms stay distinct); stale-response
  rejection; each successful SSE open triggers exactly one refresh; no other fetch on reconnect.
- **Activity identity**: `logProgress` persists and broadcasts the same timestamp; `taskLogActivityId`/`auditActivityId`
  produce identical ids on the HTTP and SSE paths.
- **Task history**: `GET /api/plugins/tasks/history` returns only `task.*` raw records, newest 500 in file order;
  TaskLogTable renders historical rows from it and degrades to current tasks on failure/timeout.
- **`bakin logs`**: last-N output unchanged in shape; reads bounded (no whole-file read).
- **use-sse**: file events forward `{file, change}` with no content; no heartbeat refetch; no `initialize()` on
  workflow/approval events.
- **Kanban**: board renders as soon as its own fetch resolves (no store dependency); failure/retry preserved.
- **Watcher**: exact payloads for text/asset/binary/unlink — no `content` key; `injectFileEvent` + sync hooks still get content.
- **Audit reader**: unwindowed+limit uses the tail path and returns exactly what the old full read returned (parity test
  over a generated fixture: kinds/agent/match filters, file order, last-N), zero matches (scans to start, returns []),
  malformed lines, UTF-8 boundary split, a single line longer than one chunk; existing time-windowed tests untouched.
  **I/O budget**: instrumented reads on a ≥ 8 MB fixture — an unfiltered `limit: 50` query reads ≤ 2 chunks (128 KiB).
- **Activity route**: calls `queryAuditEvents` with a finite limit (spy); ids unique across tasks; errors logged.
- **Avatar**: small source served as-is; large source → WebP ≤ 256 px; cache hit on second GET; invalidation on
  source mtime/size change; distinct ETags; 304s; sharp-absent → original; conversion failure → original without retry;
  single-flight under concurrent GETs; route consolidation (team GET gone, host GET serves).
- **network-address**: range boundaries (100.63.x, 100.64.0.0, 100.127.255.255, 100.128.x), internal/IPv6 excluded,
  none → null, deterministic multi-interface choice.
- **Architecture**: audit whole-file-read scanner + fixtures proving it bites (literal and path-variable forms).
- **Removals**: route-table / activity-class tests updated; `/api/state` and `/api/agents/health` return the standard
  404; `/api/plugins/memory/audit` now reaches the memory plugin's own route (dispatch test).
- **UI evidence (bakin-ui-conformance)**: no new patterns. Board loading/failure stays on `SystemState` — re-run its
  `StateMatrix` story; avatars stay on `AgentAvatar` — re-run its `CanonicalUsage` story; Tasks board + TaskLogTable and
  Team fixtures/stories re-run; `ui:conformance --quick` per UI commit, full mode before merge; public-api inventory
  reviewed for the hook rename; before/after vendor bundle sizes recorded against `design-system/performance.json`.
- **Gates before merge**: typecheck, lint (zero warnings), full suite, `ui:conformance` full, docs generate clean,
  full build chain, `/verify` isolated boot, Bits companion green against the changed SDK.

## Boundaries
- **Always:** keep each commit buildable + green; follow CLAUDE.md test isolation; update `.claude/knowledge` + public
  docs in the same commit as the behavior; run gates bare (no `| tail` masking); load `bakin-ui-conformance` before UI edits.
- **Ask first:** every `design-system/performance.json` ceiling increase (conformance contract); any other
  `design-system/` ratchet change; deleting data on Margo; widening scope into the deferred task-store/board work.
- **Never:** touch the real `~/.bakin` or the 3737 server from tests; add aliases/shims for removed APIs; `git add -A`
  after a local build; modify package-projected avatar originals.

## Success Criteria
1. `/api/state`, `/api/agents/health`, and the host memory `/audit` override are gone; no `readAll` anywhere in Bakin or Bits.
2. On a cache-disabled `/tasks` load against Margo, no whole-home request occurs, and the finite JSON response bodies
   received through board-ready — excluding the task-board responses (deferred) — total < 1,048,576 decoded bytes.
   Static assets are reported separately. Board readiness does not wait on the activity fetch.
3. Each successful SSE connection triggers exactly one host-store activity refresh and no other host-store fetch;
   existing domain reconciliation (`bakin.reconcile` subscribers) is unchanged. On Margo the refresh body is < 50 KB decoded.
4. Watcher SSE frames contain no file content.
5. On the representative fixture (≥ 8 MB of audit records shaped like Margo's: ≤ 2 KiB per line, well-formed tail), an
   unfiltered `limit: 50` audit query reads ≤ 128 KiB (instrumented test); read cost scales with the matched records,
   not file size. `/api/activity` always passes a finite limit.
6. Every successfully derived avatar is ≤ 65,536 body bytes and ≤ 256 px on either axis; originals stay byte-identical;
   conversion failure / sharp-absent serves the unchanged original (tested separately).
7. Boot log shows Margo's own `100.80.53.60` (or nothing) — never another host's IP.
8. All gates in Testing Strategy green; knowledge docs + generated references updated; follow-up issue filed for the
   task-store walk + board payload.

## Open Questions
None blocking. Margo's 115 MB `run-workspaces` stays with the existing sweep GC — confirm fresh `dispatch.run-dirs`
evidence on Margo during post-release verification.

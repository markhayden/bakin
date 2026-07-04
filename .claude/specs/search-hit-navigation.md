# Spec: Search Hit Navigation — every result has a home

**Status:** Draft (pending approval)
**Date:** 2026-07-03
**Origin:** Audit of issue #70 ("Ask Bakin"). The issue itself is unbuilt and stays open/untouched. This spec covers the real gap the audit surfaced: three of seven registered search content types have broken or lossy click navigation in the ⌘K global search overlay, and nothing guards against the regression class.

## 1. Objective

Every hit in the global search overlay navigates to the exact record it represents. No hit renders as clickable while doing nothing. A contract test makes it impossible to register a searchable content type without a working hit renderer.

**Non-goals:** Building the Ask feature (issue #70 stays as-is). Changing search indexing, ranking, or the overlay's look beyond the null-href affordance. Backwards-compatibility shims — single-user machine, none needed.

## 2. Current state (audited 2026-07-03)

| Table | Renderer | Click today | Verdict |
|---|---|---|---|
| `tasks` | `plugins/tasks/client.tsx:15` | `/tasks?taskId=<id>` → drawer | OK — reference pattern |
| `assets` | `plugins/assets/client.tsx:17` | `/assets/<id>` | OK |
| `team` | `plugins/team/client.tsx:14` — **keyed `agents`, table is `team`** | renderer never matched → falls to null-href default; phantom `agents` filter chip | **Broken (key mismatch — found during planning)** |
| `workflows` | `plugins/workflows/client.tsx:37` | `/tasks?taskId=…` / `/workflows/<id>` | OK |
| `memory` | `plugins/memory/client.tsx:12` | `/memory?q=<first-60-chars>` — fuzzy re-search, not the record | **Lossy** |
| `agent-lessons` | `plugins/team/client.tsx:21` | reads `hit.fields.agent`; schema field is `agent_id` → href **always null** | **Broken (field-name bug)** |
| `schedule` | none | falls to `defaultDescriptor` → `href: null` → silent no-op | **No destination** |

Cross-cutting: `global-search-overlay.tsx` renders null-href hits identically to clickable ones (`onSelect` at :153 silently returns). No test cross-references registered content types against hit renderers, which is why both bugs passed CI.

## 3. Requirements

### WS1 — Schedule renderer (smallest)
- Register a `schedule` hit renderer in `plugins/schedule/client.tsx` via `registerPlugin({ search: { hitRenderers } })`.
- `href: /schedule?jobId=<hit.id>` — the page already consumes `?jobId=` (`schedule-page.tsx:42`) and opens `JobDrawer`; hit id is the raw job id (no prefix strip, confirmed at `schedule-page.tsx:65`).
- Descriptor: title = `fields.name`, subtitle from `schedule`/`agent`, calendar-family icon consistent with `HIT_ICONS`.

### WS2 — Team plugin: renderer key mismatch + agent-lessons fix + exact-lesson deep link
- Rename the `agents` hit-renderer key to `team` in `plugins/team/client.tsx` — the overlay resolves renderers by bare table name and the registered table is `team`, so today every agent hit silently falls to the null-href default and a phantom `agents` chip appears.
- Fix `plugins/team/client.tsx:21` to read `hit.fields.agent_id` (schema: `plugins/team/index.ts:165`).
- href: `/team/<agent_id>?tab=lessons&lessonId=<fields.lesson_id>`.
- `agent-detail.tsx` already consumes `?tab=` (`:41`). Add `lessonId` handling: `LessonsTab`/`LessonToggleList` reads `useQueryState('lessonId', '')`, scrolls to and highlights the matching lesson row (transient highlight, e.g. ring that fades; param stays in URL per URL-state convention, omitted at default).
- If the lesson id doesn't exist in the fetched list (uninstalled/renamed), the tab renders normally — no error state needed beyond nothing highlighted.

### WS3 — Memory: exact-record deep link (largest)
- **New plugin route** `GET /api/plugins/memory/record?id=<rowId>` in `plugins/memory/lib/routes/` — resolves a unified rowId (`<tier>:<hash>` format, e.g. `durable:ab12…`) by parsing the tier prefix and enumerating that tier via the existing tier parsers (same source of truth as `/recent`). Returns one row in the same shape the recent feed emits (what `MemoryDetailDrawer` consumes), or 404. Deterministic and search-engine-independent — works even when antfly is down.
- **URL param:** `memory-shell.tsx` gains `useQueryState('recordId', '')`. When set, fetch `/record?id=…` and open `MemoryDetailDrawer` with the result. Closing the drawer clears the param. Existing local-state open path (`onSelect` from the list) now *sets* the param instead, so the drawer is URL-addressable everywhere (refresh survives, back button closes — per `url-state-deep-linking.md`).
- **Not-found:** honest empty state (toast or inline notice "Memory record not found — it may have been pruned"), never a silent fuzzy-search fallback.
- **Renderer:** `plugins/memory/client.tsx` emits `/memory?recordId=<hit.id>` (keep tier/agent context out — the drawer is self-sufficient).

### WS4 — Guards
- **Contract test** (new, `tests/host/` or `tests/plugins/`): for every table registered via `registerContentType`/`registerFileBackedContentType` across core plugins, assert a client hit renderer is registered AND that it returns a non-null `href` for a representative synthetic hit built from that type's schema fields. Must fail on: missing renderer (schedule's bug), wrong field name (lessons' bug).
- **Overlay affordance:** null-href hits render visibly inert — muted text, no hover/active affordance, skipped by Enter (already skipped in `onSelect`; make the *visual* match). `defaultDescriptor` keeps `href: null`; only the rendering changes.
- Extend `tests/host/global-search-overlay.test.tsx` with the negative path: null-href hit → Enter does not navigate, item carries the inert style.

## 4. Testing strategy

- All new tests follow CLAUDE.md testing rules: mock both content-dir resolvers + OpenClaw home, temp dirs, `afterAll` cleanup, mock logger/watcher; run via `bun run test` (preload), `--isolate` per-file.
- WS1/WS2 renderers: unit tests on descriptor output (href shape, encoding of ids with special chars).
- WS2 UI: `LessonToggleList` highlight behavior test (param present → row highlighted).
- WS3 route: tier-prefix parsing, found/404, malformed id; shell param wiring test (recordId → drawer opens; clear on close).
- WS4 contract test is itself the regression net; overlay negative-path test as above.
- TDD order per workstream: failing test first (Prove-It for the two bugs), then fix.

## 5. Commit strategy (checkpoints for rollback)

One branch `fix/search-hit-navigation`, one PR, commits ordered so each is independently revertable and green:

1. `test(host): prove null-href hits render as clickable no-ops` — failing-test checkpoint converted to the overlay affordance fix in the same commit pair: `fix(host): render null-href search hits as inert`
2. `feat(schedule): add search hit renderer deep-linking to job drawer` (+ manifest patch bump)
3. `fix(team): lesson hits read agent_id; deep-link to exact lesson` (+ highlight wiring, manifest patch bump)
4. `feat(memory): record deep link — /record route + ?recordId= drawer` (+ renderer change, manifest patch bump)
5. `test(plugins): contract test — every content type has a working hit renderer`
6. `docs(search): update knowledge docs for hit-renderer contract + memory deep link`

Each of 2–4 is a natural rollback point: reverting one workstream leaves the others functional. The contract test lands *after* the fixes (it would fail red otherwise) but *before* docs, so CI proves the full set.

## 6. Docs impact

- `.claude/knowledge/search-plugin-guide.md` — hit-renderer section: the renderer contract now includes "must produce a non-null href; contract-test enforced," plus the null-href inert rendering.
- `.claude/knowledge/memory-plugin.md` — document the `/record` route + `?recordId=` deep link.
- `.claude/knowledge/url-state-deep-linking.md` — add `recordId` (memory) and `lessonId` (team) to whatever param inventory exists there.
- `README.md` — no impact expected (no user-facing capability change at the README's altitude); verify at build time.
- Plugin manifests: patch bumps for `memory`, `schedule`, `team` (repo convention: bump touched plugins in the feature PR).

## 7. Boundaries

- **Always:** URL-state via `useQueryState` (params omitted at default); honest error states; Zod on new route input; renderer imports only from `@makinbakin/sdk`.
- **Ask first:** any change to overlay behavior beyond the inert-affordance styling; any new search-adapter capability.
- **Never:** touch issue #70's scope (no Ask code); silent fuzzy-search fallback for missed memory lookups; parallel stat/tracking systems; edits to `~/.openclaw` or writes outside temp dirs in tests.

## 8. Acceptance criteria

- [ ] Clicking a schedule hit opens that job's drawer at `/schedule?jobId=<id>`
- [ ] Clicking a lesson hit lands on `/team/<agent>?tab=lessons&lessonId=<id>` with the lesson highlighted
- [ ] Clicking a memory hit opens the exact record's detail drawer at `/memory?recordId=<rowId>`; URL survives refresh
- [ ] Memory record not found → visible notice, no silent fallback
- [ ] Null-href hits (future unrendered types) look inert and do nothing on Enter — with test coverage
- [ ] Contract test fails if any registered content type lacks a renderer or its renderer emits null href for a representative hit
- [ ] `bun run test` green; touched plugin manifests patch-bumped; knowledge docs updated

# Plan: Search Hit Navigation (spec: .claude/specs/search-hit-navigation.md)

Branch: `fix/search-hit-navigation`. Six commits, each a green, independently-revertable checkpoint. Verification gate between every task: `bun run test` passes.

## Update discovered during planning

A **fourth broken type**: `plugins/team/client.tsx:14` keys its agent renderer `agents`, but the server registers table `team` (`plugins/team/index.ts:128`). The overlay looks up renderers by bare table name (`global-search-overlay.tsx:246` — `renderers.get(type)` where type = table minus `bakin_`), so **team hits also fall to the null-href default** — and a phantom `agents` filter chip appears that matches no table (chips come from renderer keys, `:128`). Fix folded into T3. Spec §2 amended.

## Dependency graph

```
T1 (overlay inert affordance) ──── independent
T2 (schedule renderer) ─────────── independent
T3 (team renderers + lessonId) ─── independent
T4 (memory /record + recordId) ─── independent
T5 (contract test) ─── depends on T2,T3,T4 (lands green only after fixes)
T6 (docs + spec sync) ─ depends on all
```

T1–T4 are vertically sliced (each = renderer + page wiring + tests for one path) and could land in any order; chosen order is smallest-risk-first.

---

## T1 — Overlay: null-href hits render inert  (commit 1)

**Files:** `packages/host/src/components/search/global-search-overlay.tsx`, `tests/host/global-search-overlay.test.tsx`

- Prove-It first: extend the overlay test with a hit whose renderer yields `href: null`; assert Enter/click does NOT navigate (passes today via the `onSelect` guard at `:154`) AND assert an inert marker (`data-inert="true"` + muted classes) — fails today.
- Implement: in both card and list `CommandItem` branches, when `!descriptor.href`: add `data-inert="true"`, muted styling (`opacity-60`, `cursor-default`), no hover affordance. Prefer class-based treatment over cmdk `disabled` unless keyboard nav survives — verify.
- `defaultDescriptor` unchanged (`href: null` stays).

**Acceptance:** null-href hit visually muted, Enter no-op, both covered by test.
**Verify:** `bun test tests/host/global-search-overlay.test.tsx --isolate`, then full suite.

## T2 — Schedule: hit renderer → job drawer  (commit 2)

**Files:** `plugins/schedule/client.tsx`, new renderer test under `tests/plugins/schedule/`, `plugins/schedule/bakin-plugin.json` (1.0.0 → 1.0.1)

- Add `search.hitRenderers.schedule` to `registerPlugin`:
  - title: `fields.name` (fallback `hit.id`)
  - subtitle: `fields.schedule` + `fields.agent` joined with `·`
  - href: `/schedule?jobId=${encodeURIComponent(hit.id)}` (page consumes `jobId` at `schedule-page.tsx:42`; hit id = raw job id, no prefix strip per `:65-74`)
  - icon: `'calendar'` (already in `HIT_ICONS`)
- Test: descriptor shape, href encoding for special-char ids, fallbacks when fields missing.

**Acceptance:** clicking a schedule hit opens that job's drawer; renderer unit-tested.
**Verify:** unit test + manual dev check (⌘K → job → drawer).

## T3 — Team: renderer key fix + lessons exact deep link  (commit 3)

**Files:** `plugins/team/client.tsx`, `plugins/team/components/lesson-toggle-list.tsx`, `plugins/team/components/agent-detail.tsx` (only if prop threading needed), tests under `tests/plugins/team/`, `plugins/team/bakin-plugin.json` (1.0.1 → 1.0.2)

Three fixes, one vertical slice:
1. Rename renderer key `agents` → `team` (matches table; kills the phantom chip).
2. `agent-lessons` renderer: read `fields.agent_id` (schema `plugins/team/index.ts:165`) + `fields.lesson_id`; href `/team/${agent_id}?tab=lessons&lessonId=${lesson_id}`; `href: null` (inert per T1) only when `agent_id` genuinely absent (malformed doc).
3. `LessonToggleList`: read `useQueryState('lessonId', '')`; when set and present in the fetched list, scroll into view + highlight ring that fades. Unknown id → normal render, nothing highlighted.

Tests: renderer unit tests (both keys, href shape, missing-field fallback); `LessonToggleList` highlight test (param → marker present; absent/unknown → not).

**Acceptance:** agent hits navigate again; lesson hits land highlighted on the exact lesson; `agents` chip replaced by `team`.
**Verify:** unit tests + manual ⌘K on an agent and a lesson.

## T4 — Memory: exact-record deep link  (commit 4)

**Files:** new `plugins/memory/lib/routes/record.ts`, `plugins/memory/index.ts` (register route), `plugins/memory/components/memory-shell.tsx`, `plugins/memory/client.tsx`, tests under `tests/plugins/memory/`, `plugins/memory/bakin-plugin.json` (2.0.1 → 2.0.2)

**Route** `GET /api/plugins/memory/record?id=<rowId>` (defineRoute, Zod on `id`):
- Tier = prefix of `id` before first `:`, validated against `MEMORY_TIERS`; 400 on malformed.
- `indexer.enumerateTier(tier)` (side-effect-free, lazy generator) — early-exit on `key === id`.
- Found → `{ result: { id: key, table: 'memory', fields: doc, score: 0 } }` (SearchResult shape the drawer consumes). Not found → 404 `{ error: 'record not found' }`.
- Get the indexer the same way recent/detail routes do.

**Shell** (`memory-shell.tsx`):
- `const [recordId, setRecordId] = useQueryState('recordId', '')`
- Param set → fetch `/record?id=…`; 200 → open `MemoryDetailDrawer` with result; 404/error → honest inline notice ("Memory record not found — it may have been pruned"). Never a silent fuzzy fallback.
- In-page row `onSelect` now sets `recordId` (drawer becomes URL-addressable everywhere); keep the clicked row in local state as a fetch-skip cache. Drawer close → clear param.

**Renderer** (`client.tsx`): href → `/memory?recordId=${encodeURIComponent(hit.id)}`; rest unchanged.

Tests (CLAUDE.md rules — both content-dir mocks + OpenClaw home, temp dirs, cleanup, logger/watcher mocks):
- Route: found (seed temp fixtures for one durable row), 404 unknown hash, 400 malformed, tier-prefix parse table.
- Shell: param → drawer opens; 404 → notice; close clears; row click sets param.
- Renderer: href shape.

**Acceptance:** memory hit → exact record drawer; URL survives refresh; miss → visible notice.
**Verify:** unit + route tests, manual dev check against real data.

## T5 — Contract test: every content type has a working renderer  (commit 5)

**Files:** new `tests/plugins/search-hit-renderer-contract.test.ts`

- Activate every core plugin registering search content types via `tests/plugins/test-helpers.ts` with a mock ctx recording `{ table, schema }` from `registerContentType`/`registerFileBackedContentType`.
- Import each plugin's `client.tsx` (side-effect `registerPlugin`), read `getSearchHitRenderersSnapshot()`.
- For each recorded table: renderer exists for the bare table name; synthetic hit (every schema field = plausible dummy) → `renderer(hit).href` is a non-null string starting `/`.
- Must catch all three bug classes: missing renderer (schedule), key mismatch (`agents` vs `team`), wrong field name (`agent` vs `agent_id`). Sanity-check red by locally reverting one fix before committing.

**Acceptance:** green post-T2–T4; demonstrably red against any single reverted fix.
**Verify:** full suite + revert sanity check.

## T6 — Docs + spec sync  (commit 6)

**Files:** `.claude/knowledge/search-plugin-guide.md`, `.claude/knowledge/memory-plugin.md`, `.claude/knowledge/url-state-deep-linking.md`, `.claude/specs/search-hit-navigation.md` (status → Implemented), `README.md` (verify — no impact expected)

- search-plugin-guide: renderer contract — key MUST equal bare table name, href non-null, contract-test enforced; null-href renders inert.
- memory-plugin: `/record` route + `?recordId=` + drawer URL-addressability.
- url-state-deep-linking: add `recordId` (memory), `lessonId` (team) to the param inventory.

**Acceptance:** docs match shipped behavior; README confirmed unaffected.

---

## Rollback map

| Revert | Loses | Leaves intact |
|---|---|---|
| commit 4 | memory deep link (client.tsx reverts to fuzzy href with it — clean) | schedule, team, guards |
| commit 3 | team/lesson fixes | rest |
| commit 2 | schedule renderer | rest |
| commit 5 | regression net only | all fixes |

## Final gate (before PR)

- `bun run test` full suite green
- Manual pass: all four hit types clicked end-to-end in dev against real data
- No stray dev servers on 3737 (kill + verify ports free before ending)
- PR: `fix/search-hit-navigation` → main, title `fix(search): every global-search hit navigates to its exact record`

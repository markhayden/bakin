# Plan: Health Plugin Overhaul

**Spec:** `.claude/specs/health-plugin-overhaul.md`
**Branch:** `fix/health-plugin-overhaul`
**Created:** 2026-04-14

---

## Ground truth (verified from source, not assumed)

Before planning I verified the key code paths. The spec assumptions were mostly right but one audit claim was wrong — correcting it here:

1. **`server.ts:147-166` middleware DOES catch plugin catch-all REST traffic.** It wraps `res.end()` at the Node HTTP layer, so every response — including ones Next.js produces for `/api/plugins/*` — flows through `recordRequest()`. The audit that claimed GET requests silently bypass tracking was wrong at the architectural level. GET tracking is real; it's just in-memory only and uses a *different* agent-attribution path than the catch-all.

2. **Agent attribution is currently split in two:**
   - `server.ts:162` reads `url.searchParams.get('agent')` — for clients that pass `?agent=` as a query param.
   - `src/app/api/plugins/[pluginId]/[[...path]]/route.ts:249` reads `req.headers.get('x-bakin-agent')` — for agents that set a header.
   Neither path reads the other. Unified recorder must check header first, then query param, then `'unknown'`.

3. **The catch-all does its own audit + duration tracking** in parallel with the middleware. This is redundant — the middleware already records duration. The catch-all's audit behavior (writes + errors only, skips successful GETs) stays, but its duration/stat tracking is dead work once we unify.

4. **Consumers of `request-log.ts` outside health**: `src/core/watchdog.ts` uses `getRecentStatsForPathPrefix` for MCP 5xx alerting. Must be retargeted to `getUsageStats({kind: 'mcp'})` before we can delete the module.

5. **Existing test at `tests/core/request-log.test.ts`** will be deleted in Phase 5 alongside the module.

6. **`scripts/lib/registry.ts:22-24, 56-93`** holds a parallel in-memory stats map (`toolStats`). Delete in Phase 5.

7. **`setInterval` cleanup in `mcp-server.ts:88`** for stale sessions is unrelated and stays untouched.

---

## Strategy: vertical slices with feature-flag-free safe rollback

The central design constraint: each commit must leave the app **in a working, deployable state**, so any one commit can be reverted independently. That rules out "delete the old system, then build the new one in 6 commits" because the middle commits would be broken.

Strategy: **build the new system alongside the old, switch the consumers, then delete the old**. Five phases with commit-sized rollback points between each.

```
Phase 1    Recorder exists in isolation            ← rollback here is free
Phase 2    Producers feed BOTH old & new           ← rollback safely, UI still works
Phase 3    New API route alongside old             ← rollback, UI unaffected
Phase 4    UI switches to new API                  ← rollback reverts the UI only
Phase 5    Old code deleted                        ← final — rollback from here
                                                     goes back to phase 4 state
```

Between every phase, `pnpm lint && pnpm test && pnpm typecheck` must be green.

---

## Dependency graph

```
┌─────────────────────────────────────────────────┐
│ Phase 1: Recorder                               │
│   T1.1  src/core/usage.ts  + unit tests         │
└─────────────────────────┬───────────────────────┘
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
┌──────▼─────┐   ┌────────▼────────┐  ┌──────▼──────────┐
│ Phase 2a   │   │ Phase 2b        │  │ Phase 2c        │
│ T2.1  MCP  │   │ T2.2  REST      │  │ T2.3  Agent     │
│ producer   │   │ producers       │  │ producers       │
│            │   │ (server.ts +    │  │ (dispatch +     │
│            │   │  catch-all)     │  │  heartbeat +    │
│            │   │                 │  │  task-service)  │
└──────┬─────┘   └────────┬────────┘  └──────┬──────────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
┌─────────────────────────▼───────────────────────┐
│ Phase 3: API route                              │
│   T3.1  /usage-feed + trim /summary             │
└─────────────────────────┬───────────────────────┘
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
┌──────▼──────┐   ┌───────▼────────┐  ┌──────▼────────┐
│ T4.1        │   │ T4.2           │  │ T4.3          │
│ Top row     │   │ Tabs shell     │  │ Tab contents  │
│ rebuild     │   │ + window       │  │ (Tool/Endpt/  │
│             │   │ filter         │  │  Agent)       │
└──────┬──────┘   └───────┬────────┘  └──────┬────────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
┌─────────────────────────▼───────────────────────┐
│ Phase 5: Cleanup                                │
│   T5.1  Delete old code + retarget watchdog     │
│   T5.2  Rewrite routes.test.ts with real wiring │
│   T5.3  Docs: CLAUDE.md + .claude/knowledge     │
└─────────────────────────────────────────────────┘
```

---

## Tasks

### Phase 1 — Recorder foundation

#### T1.1  Create `src/core/usage.ts` + unit tests
- **Files:** `src/core/usage.ts` (new), `tests/core/usage.test.ts` (new)
- **What:** Module exports `recordUsage`, `getUsageFeed`, `getUsageStats`, `getErrorCount`, `getCurrentAgentActivity`, `clearUsage` (test-only), and the `UsageEntry` type. State is a `globalThis.__bakinUsage`-backed array with FIFO eviction at `MAX_ENTRIES = 10_000`. Window constants: `WINDOW_MS = { '5m': 300_000, '1h': 3_600_000, '24h': 86_400_000 }`.
- **API surface:**
  ```ts
  type UsageKind = 'mcp' | 'rest' | 'agent'
  interface UsageEntry {
    ts: string
    kind: UsageKind
    name: string
    agent: string | null
    durationMs: number | null
    status: 'ok' | 'error'
    meta?: Record<string, unknown>
  }
  interface UsageQuery {
    kind?: UsageKind
    window: '5m' | '1h' | '24h'
    agent?: string
  }
  interface UsageFeed {
    totals: { count: number; errors: number; errorRate: number }
    topByName: Array<{ name: string; count: number; errors: number; medianDurationMs: number | null }>
    recent: UsageEntry[]  // last 50 matching the filter, newest first
    byAgent: Array<{ agent: string; count: number; errors: number; lastActivity: UsageEntry | null }>
  }
  ```
- **Acceptance:**
  - [ ] `recordUsage` inserts an entry; `getUsageFeed` returns it.
  - [ ] Window filter excludes entries older than window.
  - [ ] Kind filter narrows to one kind.
  - [ ] Agent filter narrows to one agent.
  - [ ] Ring buffer evicts oldest on overflow; entry count never exceeds `MAX_ENTRIES`.
  - [ ] `getCurrentAgentActivity` returns `{ agent, latest, idleSec }` per agent. `idleSec >= 30` means idle.
  - [ ] `getErrorCount(windowMs)` returns `{ total, byKind: { mcp, rest, agent } }`.
  - [ ] `topByName` is sorted by count desc, top 10.
  - [ ] Median duration computed correctly for entries with non-null `durationMs`; returns `null` when no entries have durations.
  - [ ] `globalThis.__bakinUsage` is used — not a module-level array (per `feedback_globalthis_sse.md`).
- **Verify:** `pnpm vitest tests/core/usage.test.ts` green.
- **Commit:** `feat(core): add unified usage recorder`

**Checkpoint 1** — recorder lives alongside nothing else; can be deleted without affecting any other module. ✅

---

### Phase 2 — Wire producers (parallel after Phase 1)

All three tasks can be worked in parallel. Each writes to the new recorder **in addition to** the existing systems. The old systems keep working; the new recorder just gets populated too. Every task includes a *real-wiring* integration test — no mocks on the recorder.

#### T2.1  MCP producer
- **Files:** `src/core/mcp-server.ts` (lines 80-84, 120-151), `tests/integration/usage-wiring-mcp.test.ts` (new)
- **What:** Inside the `registerTools` callback, after `recordToolCall` / `recordExecToolCall`, call `recordUsage({ kind: 'mcp', name: tool.name, agent, durationMs, status, meta: { taskId } })`. Measure duration around the `tool.handler(...)` call. Status `'error'` on `!result.ok` or thrown exception. Leave `recordToolCall` / `recordExecToolCall` calls in place — Phase 5 removes them.
- **Integration test:** Import `registerTools` and `recordUsage`, register a dummy exec tool that returns `{ ok: true }`, invoke the MCP server's JSON-RPC handler directly with a `tools/call` payload, assert `getUsageFeed({ kind: 'mcp', window: '5m' })` contains the tool name with status ok and a non-null duration. Also test an error case where the handler throws. Mock `getContentDir` + `logger` per project rules.
- **Acceptance:**
  - [ ] Success path writes `status: 'ok'` entry.
  - [ ] Thrown error writes `status: 'error'` entry with `meta.error`.
  - [ ] Handler-returned `{ ok: false }` writes `status: 'error'` entry.
  - [ ] `durationMs` is > 0 and < 1000 for a no-op handler.
  - [ ] Integration test fails if you comment out the `recordUsage` call.
- **Verify:** `pnpm vitest tests/integration/usage-wiring-mcp.test.ts` green.
- **Commit:** `feat(mcp): record tool calls to unified usage store`

#### T2.2  REST producers (server.ts middleware + catch-all)
- **Files:** `server.ts` (lines 147-166), `src/app/api/plugins/[pluginId]/[[...path]]/route.ts` (lines 245-303), `tests/integration/usage-wiring-rest.test.ts` (new)
- **What (server.ts):** In the `res.end` override, after `recordRequest(...)`, also call `recordUsage({ kind: 'rest', name: normalizedPath, agent, durationMs, status, meta: { method, status } })`. Normalize path: strip query string, keep `/api/plugins/{pluginId}/{...}` verbatim, replace UUID-shaped segments elsewhere with `:id`. Status = `'ok'` if `< 400`, else `'error'`. Agent = header `x-bakin-agent` if present (need to peek from `req.headers['x-bakin-agent']`), else query param `agent`, else `null`.
- **What (catch-all route.ts):** Remove the now-redundant `appendAudit` block at lines 276-289 only if it's fully replaced by middleware recording — **no, keep `appendAudit` calls**, they feed the audit log/SSE which is a separate system. Just ensure the middleware is the sole source of usage tracking. No new code here unless the integration test reveals a gap.
- **Integration test:**
  - Extract the middleware logic from `server.ts` into a tiny helper if necessary to make it testable without booting a full Next server. OR: spin up a minimal `http.createServer` in the test that runs the exact middleware closure, fire a real `http.request`, assert the recorder got the entry.
  - Test three cases: (a) `/api/plugins/tasks/list` with `x-bakin-agent: roscoe` header → entry has `agent: 'roscoe'`; (b) `/api/plugins/tasks/list?agent=pixel` without header → entry has `agent: 'pixel'`; (c) `/api/version` 200 response → entry with `kind: 'rest'`, status `'ok'`.
  - Test path normalization: `/api/some/resource/550e8400-e29b-41d4-a716-446655440000/edit` → `/api/some/resource/:id/edit`.
- **Acceptance:**
  - [ ] Every `/api/*` and `/mcp*` request writes one usage entry.
  - [ ] Agent attribution precedence: header → query param → null.
  - [ ] Path normalization preserves plugin IDs, replaces UUIDs elsewhere.
  - [ ] Integration test fires a real HTTP request and observes it in the recorder.
- **Verify:** `pnpm vitest tests/integration/usage-wiring-rest.test.ts` green.
- **Commit:** `feat(server): record REST requests to unified usage store`

#### T2.3  Agent producers (dispatch + heartbeat + task-service)
- **Files:** `src/core/dispatch.ts` (around `dispatchSingleTask` line 236), `scripts/lib/heartbeat.ts` (inside the handler around line 36), `src/core/task-service.ts` (wherever task status transitions happen), `tests/integration/usage-wiring-agent.test.ts` (new)
- **What:**
  - **dispatch.ts:** In `dispatchSingleTask`, record `{ kind: 'agent', name: 'dispatch', agent: <task.agent>, durationMs: <measured>, status: <ok|error>, meta: { taskId, title } }` when dispatch completes.
  - **heartbeat.ts:** After writing the heartbeat file, record `{ kind: 'agent', name: 'heartbeat', agent, durationMs: null, status: 'ok', meta: { status: params.status, currentTask: params.currentTask } }`.
  - **task-service.ts:** On task status change (claim/start/complete/fail), record `{ kind: 'agent', name: 'task.<status>', agent, ..., meta: { taskId } }`.
- **Integration test:**
  - Call `dispatchSingleTask` against a real fixture task with a stubbed OpenClaw client, assert recorder entry.
  - Call `heartbeat` handler directly as the MCP server would, assert recorder entry with `name: 'heartbeat'`.
  - Call task-service lifecycle transition, assert recorder entry.
- **Acceptance:**
  - [ ] Dispatch emits an entry with `name: 'dispatch'` and the task's assigned agent.
  - [ ] Heartbeat emits an entry with `name: 'heartbeat'` and the agent that called it.
  - [ ] Task status transitions emit entries with `name: 'task.<status>'`.
  - [ ] Integration test fails if any of the three `recordUsage` calls is commented out.
- **Verify:** `pnpm vitest tests/integration/usage-wiring-agent.test.ts` green.
- **Commit:** `feat(agents): record agent lifecycle events to unified usage store`

**Checkpoint 2** — all three producers feed the recorder. Old systems still populated in parallel. Old health UI still works. ✅

---

### Phase 3 — API route

#### T3.1  Add `/api/plugins/health/usage-feed` + trim `/summary`
- **Files:** `plugins/health/index.ts`, `tests/plugins/health/routes.test.ts` (update existing)
- **What:**
  - Register `GET /usage-feed` that accepts `?kind=mcp|rest|agent&window=5m|1h|24h&agent=<id>`, parsed via Zod. Returns `UsageFeed` from `getUsageFeed(...)`.
  - Add `errors1h` field to `/summary` response: `{ total, byKind: { mcp, rest, agent } }` sourced from `getErrorCount(WINDOW_MS['1h'])`.
  - **Do NOT remove `/requests`, `/registry.execTools`, `mcp`, `restHealth`, `requests` fields yet.** Phase 5 does the deletion. This keeps the old UI working.
- **Tests:**
  - Seed recorder via `recordUsage`, fire `GET /usage-feed?kind=mcp&window=1h`, assert response shape.
  - Test that window filter narrows results.
  - Test Zod validation rejects bad params (400 response).
  - Test `errors1h` field populated in `/summary` from real recorder state.
- **Acceptance:**
  - [ ] New route returns valid `UsageFeed` for all three kinds.
  - [ ] Zod rejects unknown kinds and windows.
  - [ ] Existing `/summary`, `/requests`, `/registry`, `/usage`, `/doctor` routes still pass their original tests.
- **Verify:** `pnpm vitest tests/plugins/health/routes.test.ts` green.
- **Commit:** `feat(health): add usage-feed route backed by unified recorder`

**Checkpoint 3** — new API exists alongside old. Frontend still uses old fields. Safe to deploy. ✅

---

### Phase 4 — UI rebuild

These three tasks touch the same file (`plugins/health/components/health-page.tsx`) and must be sequential. But each is small and produces a visually verifiable state.

#### T4.1  Top row rebuild
- **Files:** `plugins/health/components/health-page.tsx` (lines 453-575)
- **What:** Replace the 6-card grid with a 4-card grid: `Uptime`, `Active Sessions`, `Memory`, `Errors (1h)`. Errors card reads `data.errors1h` (added in T3.1). Card shows total count big; subtext `mcp: N · rest: N · agent: N`; color red if total > 0, emerald if 0.
- **Acceptance:**
  - [ ] API Requests, MCP Health, REST Health cards gone.
  - [ ] Errors card renders with breakdown.
  - [ ] Grid is 4 columns on desktop, 2 on mobile.
- **Verify:** Start dev server, load `/health`, visually confirm.
- **Commit:** `feat(health): rebuild top row — drop redundant cards, add errors tile`

#### T4.2  Usage tabs shell + window filter
- **Files:** `plugins/health/components/health-page.tsx`, reuse `src/components/ui/tabs.tsx`
- **What:** Replace the 4-up usage grid with a single `Card` containing `<Tabs value={activeTab}>` with three `TabsTrigger` (Tool Usage / Endpoint Usage / Agent Usage). Shared window state via `useQueryState('usage_window', '1h')` per CLAUDE.md URL-state rule. A small segmented control renders `5m | 1h | 24h`. Active tab state via `useQueryState('usage_tab', 'tools')`. Content panels render placeholder text; T4.3 fills them.
- **Acceptance:**
  - [ ] Tab state is in URL, bookmarkable.
  - [ ] Window state is in URL.
  - [ ] Switching tabs/windows triggers a re-fetch of `/usage-feed`.
  - [ ] Context Usage and Cost Breakdown still render below, unchanged.
- **Verify:** Visually confirm; reload page with `?usage_tab=endpoints&usage_window=24h` and state is restored.
- **Commit:** `feat(health): tabbed usage section with window filter`

#### T4.3  Tab contents — Tool / Endpoint / Agent
- **Files:** `plugins/health/components/health-page.tsx`
- **What:** Populate each `TabsContent`:
  - **Tool Usage:** `HorizontalBars` of `topByName` with count badge; small line underneath each showing `{errors} err · {median}ms`; footer row showing `recent[0]` as "firing right now: {name} · {agent} · Xs ago".
  - **Endpoint Usage:** Same pattern on REST data. Below bars, a compact per-plugin rollup derived client-side from `topByName` (group by plugin id extracted from path).
  - **Agent Usage:** One row per entry in `byAgent`. Left column agent id. Middle column "current activity" string derived from `lastActivity` (the latest entry): format `calling {name} · {age}s ago` (mcp), `handling {method} {path} · {age}s ago` (rest), or `{name} · {age}s ago` (agent). If age > 30s, show `idle {age}s`. Right column total calls in window and error count.
- **Acceptance:**
  - [ ] Each tab populates with real data once the dev server has seen traffic.
  - [ ] "Firing right now" row updates as new data arrives on refresh.
  - [ ] Idle agents labelled correctly.
  - [ ] Empty state ("no data in this window") renders cleanly.
- **Verify:** Dev server. Trigger some MCP tool calls via the mock, click through all three tabs and all three windows, confirm data flows.
- **Commit:** `feat(health): populate tool/endpoint/agent usage tabs`

**Checkpoint 4** — new UI live, reads new API. Old API endpoints still present but the frontend no longer reads their deprecated fields. ✅

---

### Phase 5 — Cleanup

#### T5.1  Delete old code + retarget watchdog
- **Files:** delete `src/core/request-log.ts`, delete `tests/core/request-log.test.ts`, edit `scripts/lib/registry.ts` (drop `toolStats`, `recordExecToolCall`, `recordExecToolError`, `getExecToolStats`, `ExecToolStat`), edit `src/core/mcp-server.ts` (drop `recordToolCall`, `stats` object), edit `src/core/watchdog.ts` (retarget `getRecentStatsForPathPrefix` → `getUsageStats({kind:'mcp', window:...})` with matching semantics), edit `plugins/health/index.ts` (drop `/requests` route, drop `execTools` from `/registry`, drop `mcp`/`restHealth`/`requests` from `/summary`), edit `server.ts` (drop `recordRequest` call — middleware now writes only to recorder).
- **What:** Clean slate. No shims, no aliases.
- **Acceptance:**
  - [ ] Grep for `request-log`, `toolStats`, `recordToolCall`, `recordExecToolCall`, `getRestStatsByPlugin`, `getRecentStatsForPathPrefix`, `getExecToolStats` returns zero matches in `src/`, `plugins/`, `scripts/`, `server.ts`.
  - [ ] Watchdog MCP 5xx alerting still triggers — verified by unit test.
  - [ ] `pnpm typecheck` green.
  - [ ] `pnpm test` green.
- **Verify:** Full test suite + manual watchdog trigger.
- **Commit:** `refactor(health): remove legacy request-log and toolStats systems`

#### T5.2  Rewrite `routes.test.ts` with real wiring
- **Files:** `tests/plugins/health/routes.test.ts`
- **What:** Remove mocks of usage sources. Tests now call `recordUsage` directly to seed recorder state, then hit the route handlers. Only `agent-usage.ts` (OpenClaw session files) and `doctor` remain mocked. Add a test that intentionally verifies the route is wired to the real `getUsageFeed` — if someone swaps it for a mock, the test fails.
- **Acceptance:**
  - [ ] No mock for `src/core/usage.ts` anywhere in the test file.
  - [ ] Every route test passes with real recorder backing.
  - [ ] Removing a `recordUsage` call from any producer would still fail at least one integration test (from Phase 2) — verified by deliberately breaking one producer momentarily.
- **Verify:** `pnpm vitest tests/plugins/health/routes.test.ts` green.
- **Commit:** `test(health): replace mocked stat sources with real recorder`

#### T5.3  Docs
- **Files:** `CLAUDE.md` (Key Patterns section), audit `.claude/knowledge/*` for health references
- **What:**
  - Add "Usage Recording" subsection to `CLAUDE.md` Key Patterns: describe `recordUsage()`, the three kinds, the globalThis pattern, and the rule that new producers must add a wiring integration test.
  - Grep `.claude/knowledge/` for `request-log`, `toolStats`, `/api/plugins/health/requests`, `mcpHealth`, `restHealth` and fix any stale refs.
  - Update `README.md` only if it mentions the health page features being removed.
- **Acceptance:**
  - [ ] CLAUDE.md has a "Usage Recording" subsection.
  - [ ] `.claude/knowledge/` has no stale references to deleted APIs.
  - [ ] Memory updated: add a `project_health_overhaul.md` pointing to this spec + plan.
- **Verify:** Read the subsection; skim the knowledge docs.
- **Commit:** `docs: document unified usage recorder pattern`

**Checkpoint 5 (final)** — overhaul complete. Every checkpoint between 1–4 is a valid rollback target. ✅

---

## Commit strategy summary

10 commits total, each a valid deployable state. Conventional-commit format with scope.

| # | Phase | Commit message | Rollback safety |
|---|-------|----------------|-----------------|
| 1 | 1 | `feat(core): add unified usage recorder` | Full — new code only |
| 2 | 2a | `feat(mcp): record tool calls to unified usage store` | Old system still runs |
| 3 | 2b | `feat(server): record REST requests to unified usage store` | Old system still runs |
| 4 | 2c | `feat(agents): record agent lifecycle events to unified usage store` | Old system still runs |
| 5 | 3 | `feat(health): add usage-feed route backed by unified recorder` | Old routes still work |
| 6 | 4a | `feat(health): rebuild top row — drop redundant cards, add errors tile` | Usage grid unchanged |
| 7 | 4b | `feat(health): tabbed usage section with window filter` | Content is placeholder |
| 8 | 4c | `feat(health): populate tool/endpoint/agent usage tabs` | New UI complete |
| 9 | 5a | `refactor(health): remove legacy request-log and toolStats systems` | Point of no return for old code |
| 10 | 5b | `test(health): replace mocked stat sources with real recorder` | — |
| 11 | 5c | `docs: document unified usage recorder pattern` | — |

**Rollback drill**: if commit 9 breaks something in production, `git revert` it; commits 1–8 leave us in a working state with the new UI and new recorder, minus the code deletion. Re-attempt commit 9 after fixing.

---

## Parallelization opportunities

The user asked to fan out work. Here's what can actually go in parallel without stepping on itself:

- **After Phase 1 lands**, Phase 2 tasks T2.1, T2.2, T2.3 are fully independent — three different agents, three different files, three different integration tests. Spawn all three simultaneously.
- **Phase 4 tasks are sequential** — same file (`health-page.tsx`) and each builds on the previous visual state. Don't parallelize.
- **Phase 5 tasks T5.1 and T5.2 can overlap** only if T5.2 is drafted but not committed until T5.1 lands, because the test rewrite depends on deletions. Cleaner to do them sequentially.
- **T5.3 docs** can be drafted in parallel with any other Phase 5 task.

Recommended execution:
- **Serial:** T1.1
- **Parallel fan-out (3 agents):** T2.1 + T2.2 + T2.3
- **Serial:** T3.1
- **Serial:** T4.1 → T4.2 → T4.3
- **Serial:** T5.1 → T5.2
- **Parallel with T5.1:** T5.3

---

## Verification gates between phases

Before committing each phase's final task:

1. `pnpm lint` — no new warnings
2. `pnpm typecheck` — no new errors
3. `pnpm test` — full suite green (not just the new tests)
4. Dev server loads `/health` without console errors
5. The integration tests from Phase 2 still pass — this is the regression safety net

If any of these fail, stop and fix before committing. No skipping gates.

---

## Known risks & mitigations

1. **Risk:** T2.2 test (REST wiring) is hard to write without booting a real HTTP server.
   **Mitigation:** Extract the middleware body into a pure `trackResponse(req, res, start)` helper exported from `server.ts` or a new `src/core/rest-tracking.ts`. Test the helper directly. The server.ts `res.end` override becomes a one-liner that calls the helper.

2. **Risk:** `globalThis.__bakinUsage` gets duplicated by webpack re-evaluation.
   **Mitigation:** This is exactly the case the `feedback_globalthis_sse.md` memory warns about. Use the `(globalThis as any).__bakinUsage ??= []` idiom, not a module-level `const`.

3. **Risk:** `watchdog.ts` MCP alerting semantics drift when retargeted.
   **Mitigation:** T5.1 includes a unit test that asserts watchdog fires on the same thresholds it used to fire on, using seeded recorder state. Match the semantics (5xx counts in window) exactly — `status === 'error' && kind === 'mcp'` in the new model.

4. **Risk:** Heartbeats dominate Agent Usage counts because they're frequent.
   **Mitigation:** T4.3 filters `name === 'heartbeat'` out of the activity-count column (shows separately) but includes them in `lastActivity` so "current state" is accurate.

5. **Risk:** Spec assumed the Next.js catch-all bypassed tracking; it doesn't. One of the motivating bullets (fix the GET bypass) may not be a real bug.
   **Mitigation:** T2.2 integration test will reveal the truth. If the middleware is capturing everything, the fix becomes "unify agent attribution paths" instead of "fix the bypass". Either way the test is the proof, not the spec bullet.

---

## Done definition

- All 11 commits merged.
- `pnpm test` fully green.
- Mark can open `/health`, see 4 top cards, switch tabs + windows, and see live data.
- `request-log.ts` gone from the repo.
- CLAUDE.md documents the pattern.
- Breaking any producer's `recordUsage` call fails at least one Phase 2 integration test.

# TODO: Health Plugin Overhaul

**Spec:** `.claude/specs/health-plugin-overhaul.md`
**Plan:** `tasks/plan.md`
**Branch:** `fix/health-plugin-overhaul`

---

## Phase 1 — Recorder foundation

- [ ] **T1.1** Create `src/core/usage.ts` + `tests/core/usage.test.ts`
  - API: `recordUsage`, `getUsageFeed`, `getUsageStats`, `getErrorCount`, `getCurrentAgentActivity`, `clearUsage` (test-only)
  - `UsageEntry` type + `UsageKind` union + `UsageFeed` shape
  - `globalThis.__bakinUsage` backing, 10k ring buffer, FIFO eviction
  - `WINDOW_MS = { '5m': 300_000, '1h': 3_600_000, '24h': 86_400_000 }`
  - Unit tests cover: insert, window/kind/agent filter, eviction, idle detection, error count, median duration
  - **Commit:** `feat(core): add unified usage recorder`

**▶ CHECKPOINT 1** — recorder exists in isolation, safe to roll back.

---

## Phase 2 — Wire producers (parallel fan-out, 3 agents)

- [ ] **T2.1** MCP producer
  - Edit `src/core/mcp-server.ts:120-151` — add `recordUsage({ kind: 'mcp', ... })` around `tool.handler`
  - Measure duration, capture status, record errors on throw or `!result.ok`
  - New test: `tests/integration/usage-wiring-mcp.test.ts` — real tool invocation via MCP JSON-RPC
  - Leave `recordToolCall` / `recordExecToolCall` in place (deleted in Phase 5)
  - **Commit:** `feat(mcp): record tool calls to unified usage store`

- [ ] **T2.2** REST producers
  - Extract middleware body from `server.ts:147-166` into `trackResponse()` helper for testability
  - Helper calls both `recordRequest` (legacy) and `recordUsage({ kind: 'rest', ... })`
  - Agent attribution: header `x-bakin-agent` → query `?agent=` → `null`
  - Path normalization: keep `/api/plugins/{id}/...` verbatim, UUID → `:id` elsewhere
  - New test: `tests/integration/usage-wiring-rest.test.ts` — real HTTP request through middleware
  - Tests cover: header attribution, query attribution, normalization, error status
  - **Commit:** `feat(server): record REST requests to unified usage store`

- [ ] **T2.3** Agent producers
  - `src/core/dispatch.ts:236` (`dispatchSingleTask`) — record `name: 'dispatch'`
  - `scripts/lib/heartbeat.ts:36` — record `name: 'heartbeat'`
  - `src/core/task-service.ts` — record `name: 'task.<status>'` on lifecycle transitions
  - New test: `tests/integration/usage-wiring-agent.test.ts`
  - Tests cover: each of the three producers emits correct entry
  - **Commit:** `feat(agents): record agent lifecycle events to unified usage store`

**▶ CHECKPOINT 2** — all producers feeding recorder; old systems still running in parallel; old UI still works.

---

## Phase 3 — API route

- [ ] **T3.1** Add `/api/plugins/health/usage-feed` + add `errors1h` to `/summary`
  - Register route in `plugins/health/index.ts`
  - Zod parse `?kind=&window=&agent=`
  - Returns `UsageFeed` shape from `getUsageFeed(...)`
  - Add `errors1h: { total, byKind }` to `/summary` response from `getErrorCount`
  - **Do not** drop `/requests`, `execTools`, `mcp`, `restHealth`, `requests` yet
  - Update existing `tests/plugins/health/routes.test.ts` — add usage-feed tests seeding via `recordUsage`
  - **Commit:** `feat(health): add usage-feed route backed by unified recorder`

**▶ CHECKPOINT 3** — new API alongside old; deployable.

---

## Phase 4 — UI rebuild (sequential, same file)

- [ ] **T4.1** Top row rebuild
  - Replace 6-card grid at `plugins/health/components/health-page.tsx:453-575`
  - New grid: `Uptime | Active Sessions | Memory | Errors (1h)` (4 cols desktop, 2 mobile)
  - Errors card: big count, subtext `mcp: N · rest: N · agent: N`, red if >0 else emerald
  - Drop references to `data.mcpHealth`, `data.restHealth`, `requests.totalRequests` in top row
  - Visual verify in dev server
  - **Commit:** `feat(health): rebuild top row — drop redundant cards, add errors tile`

- [ ] **T4.2** Usage tabs shell + window filter
  - Replace 4-up usage grid with `<Card>` containing `<Tabs>` (Tool / Endpoint / Agent)
  - URL state: `useQueryState('usage_tab', 'tools')`, `useQueryState('usage_window', '1h')`
  - Segmented window control `5m | 1h | 24h`
  - Wire fetch to `/api/plugins/health/usage-feed?kind=...&window=...`
  - Placeholder content in each `TabsContent`
  - Context Usage + Cost Breakdown cards stay below, unchanged
  - Wrap page content in `<Suspense>` per URL-state rule
  - **Commit:** `feat(health): tabbed usage section with window filter`

- [ ] **T4.3** Tab contents
  - **Tool Usage:** `HorizontalBars` of `topByName`, per-bar `err/median`, "firing right now" footer
  - **Endpoint Usage:** Same pattern for REST; per-plugin rollup strip below
  - **Agent Usage:** Row per agent — id | current activity string | count · errors
  - Activity string formats: `calling {name} · Xs ago` (mcp), `handling {method} {path} · Xs ago` (rest), `{name} · Xs ago` (agent), `idle Ys` (>30s)
  - Filter `name === 'heartbeat'` out of activity count column
  - Empty states rendered cleanly
  - Click through all 3 tabs × 3 windows in dev server
  - **Commit:** `feat(health): populate tool/endpoint/agent usage tabs`

**▶ CHECKPOINT 4** — new UI live; old API endpoints still present but unused.

---

## Phase 5 — Cleanup

- [ ] **T5.1** Delete old code + retarget watchdog
  - Delete `src/core/request-log.ts`
  - Delete `tests/core/request-log.test.ts`
  - `scripts/lib/registry.ts`: drop `toolStats`, `recordExecToolCall`, `recordExecToolError`, `getExecToolStats`, `ExecToolStat`
  - `src/core/mcp-server.ts`: drop `recordToolCall`, `stats` object, references to removed registry exports
  - `src/core/watchdog.ts`: retarget `getRecentStatsForPathPrefix` → `getUsageStats({ kind: 'mcp', ... })` with matching semantics
  - `plugins/health/index.ts`: drop `/requests` route, drop `execTools` from `/registry`, drop `mcp`/`restHealth`/`requests` from `/summary`
  - `server.ts`: drop legacy `recordRequest` call from middleware (now only calls `recordUsage`)
  - Grep verify: zero matches for `request-log|toolStats|recordToolCall|recordExecToolCall|getRestStatsByPlugin|getRecentStatsForPathPrefix|getExecToolStats` in `src/ plugins/ scripts/ server.ts`
  - `pnpm lint && pnpm typecheck && pnpm test` all green
  - **Commit:** `refactor(health): remove legacy request-log and toolStats systems`

- [ ] **T5.2** Rewrite `tests/plugins/health/routes.test.ts`
  - Remove all mocks of the deleted modules
  - Seed recorder state via real `recordUsage` calls
  - Only `agent-usage.ts` (OpenClaw) + `doctor` remain mocked
  - Briefly break one Phase 2 producer; confirm an integration test fails; restore
  - **Commit:** `test(health): replace mocked stat sources with real recorder`

- [ ] **T5.3** Docs (parallel with T5.1/T5.2)
  - Add "Usage Recording" subsection to `CLAUDE.md` Key Patterns
  - Grep `.claude/knowledge/` for stale refs, update where needed
  - Check `README.md` for references to removed features
  - Save memory: `project_health_overhaul.md`
  - **Commit:** `docs: document unified usage recorder pattern`

**▶ CHECKPOINT 5** — overhaul complete.

---

## Verification gates (between every commit)

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test` (full suite, not just new tests)
4. `/health` page loads with no console errors
5. All Phase 2 integration tests still pass

No skipping.

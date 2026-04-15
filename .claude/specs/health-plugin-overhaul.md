# Health Plugin Overhaul

_Created: 2026-04-14 | Owner: Mark | Status: Complete (shipped 2026-04-14 on branch `fix/health-plugin-overhaul`)_

---

## 1. Objective

The `/health` page is the single most important debugging surface in Bakin. When something goes wrong — an agent stalls, an MCP tool silently fails, a plugin starts erroring — this is the first place Mark looks. Today the page has three problems that make it untrustworthy:

1. **Redundant top-row cards.** "MCP Health", "REST Health", and "API Requests" duplicate information shown in more detail below, wasting attention on the most important part of the screen.
2. **Bloated usage grid.** Four usage cards compete horizontally, and there's no room to add more dimensions (models, errors, slow calls) without the layout falling apart.
3. **Silent data gaps.** MCP tool calls live in in-memory `globalThis` state, REST requests live in a separate in-memory ring buffer, and "agent usage" is read from OpenClaw session files — with no unified pipe and no consistent shape. Tests mock all three sources, so they pass even when real wiring is broken. This is the failure mode that led to the current investigation.

**Goal:** Turn `/health` into a production-grade observability panel — one unified in-memory usage recorder, one query API, three tabbed views, with tests that prove real tool calls and real HTTP requests actually flow through, not mocked facsimiles.

**Non-goal:** Historical persistence. This spec explicitly keeps tracking **in-memory, per-session**. A future rewrite can add JSONL-backed retention and historical dashboards.

**Target user:** Mark — single-user self-hosted Bakin. No multi-tenant concerns.

---

## 2. Scope

### In scope
- Remove `API Requests`, `MCP Health`, `REST Health` cards from the top row.
- Add an `Errors (1h)` card to the top row.
- Replace the four-up usage grid with a tabbed section: **Tool Usage** / **Endpoint Usage** / **Agent Usage**.
- Each tab gets a time-window filter: **5m / 1h / 24h** (default 1h).
- Keep `Context Usage` and `Cost Breakdown` as their own boxes, sourced from `agent-usage.ts` (OpenClaw sessions) as they are today.
- Introduce a single in-memory usage recorder: `src/core/usage.ts` — one store, one schema, one query API.
- Retarget MCP, REST, and agent tracking to flow through `recordUsage()`.
- New `/api/plugins/health/usage-feed` endpoint replaces `/requests` + the `execTools` slice of `/registry`.
- Tests that invoke real MCP tools, real HTTP requests, and real agent events and assert the recorder saw them.
- Fix any adjacent silent-logging gaps found during implementation.
- Update `.claude/knowledge/` if an existing doc touches health/usage.

### Out of scope
- Persistence to disk (JSONL, SQLite, or otherwise).
- Historical charts beyond the 24h window.
- Exporting metrics to external tooling (Prometheus, Grafana, etc).
- Redesign of Context Usage / Cost Breakdown.
- Any change to OpenClaw session file reading.
- Any change to the `/doctor`, `/antfly-status`, or `/summary` shapes beyond removing dead fields.

---

## 3. Acceptance Criteria

### UI
- [ ] Top-row summary shows exactly four cards: **Uptime**, **Active Sessions**, **Memory**, **Errors (1h)**.
- [ ] The `API Requests`, `MCP Health`, `REST Health` cards are gone from the top row and their backing fields removed from `/summary` response.
- [ ] The four-up usage grid is replaced with a single `<Tabs>` block containing three `TabsContent` panels.
- [ ] Each tab has a window selector (`5m` / `1h` / `24h`) and the content re-queries when it changes.
- [ ] `Context Usage` and `Cost Breakdown` still render as separate cards below the tabbed section, unchanged in data shape.
- [ ] `Errors (1h)` card shows total error count plus a breakdown by kind (mcp / rest / agent), with status-color text (red ≥1, amber 0 but recent spikes, emerald 0).

### Tool Usage tab
- [ ] Horizontal bars of top 10 tool calls by count in the selected window.
- [ ] Each bar shows call count and — on hover or a secondary line — error count and median duration.
- [ ] "What's firing right now" row: the most recent tool call across all agents (name + agent + age).

### Endpoint Usage tab
- [ ] Horizontal bars of top 10 endpoint paths by count in the selected window.
- [ ] Each bar shows count, error count, median duration.
- [ ] Per-plugin rollup strip below the bars (one row per plugin id with total / errors / p50).

### Agent Usage tab
- [ ] One row per agent that has any activity in the window.
- [ ] Row shows: agent id, current activity string ("calling `bakin_exec_tasks_list`", "handling `GET /api/plugins/tasks`", "idle 42s"), total calls in window, errors in window.
- [ ] "Current activity" is derived from the most recent `UsageEntry` for that agent — kind + name + age.
- [ ] Idle = no entries in the last 30s. Show "idle Ns".

### Recorder
- [ ] Single module `src/core/usage.ts` exports `recordUsage`, `getUsageFeed`, `getUsageStats`, `getErrorCount`, `getCurrentAgentActivity`.
- [ ] `UsageEntry` shape: `{ ts: string, kind: 'mcp'|'rest'|'agent', name: string, agent: string|null, durationMs: number|null, status: 'ok'|'error', meta?: Record<string, unknown> }`.
- [ ] In-memory ring buffer sized for 24h at realistic traffic (target 10,000 entries; older entries evicted FIFO).
- [ ] Query API accepts `{ kind?, window: '5m'|'1h'|'24h', agent? }` and returns aggregated stats.
- [ ] `globalThis.__bakinUsage` backs the store so Next.js webpack re-evaluation doesn't duplicate it — same pattern as SSE broadcast (see `feedback_globalthis_sse.md`).

### Wiring
- [ ] `src/core/mcp-server.ts` tool invocation path calls `recordUsage({ kind: 'mcp', ... })` — replaces the current split between `recordToolCall` / `recordExecToolCall`.
- [ ] `server.ts` middleware at lines ~147-166 calls `recordUsage({ kind: 'rest', ... })` — replaces the current `recordRequest()` call.
- [ ] `src/app/api/plugins/[pluginId]/[[...path]]/route.ts` does NOT silently bypass tracking. Verified: either the custom server middleware catches these too, or this route also calls `recordUsage`.
- [ ] Agent events recorded at three source points: `src/core/dispatch.ts` on task dispatch, `scripts/lib/heartbeat.ts` on heartbeat, `src/core/task-service.ts` on task lifecycle transitions.
- [ ] `src/core/request-log.ts` and the `toolStats` Map in `scripts/lib/registry.ts` are deleted (no backwards-compat shims — per project rule).
- [ ] `src/core/agent-usage.ts` is untouched (still feeds Context Usage + Cost tables).

### API
- [ ] `GET /api/plugins/health/usage-feed?kind=mcp&window=1h` returns `{ topByName: [...], totals: {...}, recent: [...], byAgent: [...] }`.
- [ ] `GET /api/plugins/health/summary` still works but the response no longer includes `mcp`, `restHealth`, `requests` fields — those become fields of the usage feed or are dropped entirely. `summary` keeps: `uptime`, `activeSessions`, `memory`, `errors1h`, `doctor`, `server`.
- [ ] `/api/plugins/health/requests` and the `execTools` portion of `/api/plugins/health/registry` are removed. `/registry` keeps only the `plugins` listing.

### Tests
- [ ] A real-wiring test for each `kind`:
  - **mcp**: boot the test MCP server, invoke a real exec tool, assert the recorder has an entry with the right name/status/duration.
  - **rest**: make a real HTTP request through the custom server middleware against a dummy `/api/` path, assert the recorder saw it.
  - **agent**: trigger a real dispatch, assert the recorder saw a `kind: 'agent'` entry.
- [ ] A test that proves the window filter correctly excludes entries older than the window.
- [ ] A test that proves `getCurrentAgentActivity` returns the most recent entry per agent and marks idle agents.
- [ ] A test that proves the ring buffer eviction works at the cap.
- [ ] Existing `tests/plugins/health/routes.test.ts` rewritten: mocks limited to OpenClaw session files + doctor. Everything that feeds the usage tabs uses the real recorder.
- [ ] All tests mock `getContentDir` to a temp dir per the project rule.

### Docs
- [ ] `.claude/knowledge/` audited for any health/usage references — updated or removed.
- [ ] `CLAUDE.md` "Key Patterns" section gets a new "Usage Recording" subsection describing the single-recorder pattern.

---

## 4. Project Structure (files touched)

### New files
- `src/core/usage.ts` — unified recorder + query API
- `tests/core/usage.test.ts` — recorder unit tests
- `tests/integration/usage-wiring.test.ts` — real MCP, real HTTP, real agent wiring tests

### Modified files
- `plugins/health/components/health-page.tsx` — remove 3 top cards, add Errors card, replace usage grid with tabs
- `plugins/health/index.ts` — add `/usage-feed` route, trim `/summary`, drop `/requests`, trim `/registry`
- `src/core/mcp-server.ts` — retarget tool-call recording
- `server.ts` — retarget REST middleware recording
- `src/app/api/plugins/[pluginId]/[[...path]]/route.ts` — verify or wire recording
- `src/core/dispatch.ts` — emit agent usage on dispatch
- `scripts/lib/heartbeat.ts` — emit agent usage on heartbeat
- `src/core/task-service.ts` — emit agent usage on task lifecycle
- `tests/plugins/health/routes.test.ts` — rewrite mocks
- `CLAUDE.md` — add "Usage Recording" subsection

### Deleted files
- `src/core/request-log.ts`
- `toolStats` Map + related exports in `scripts/lib/registry.ts` (the call-counting portion; exec tool registration stays)

### Not touched
- `src/core/agent-usage.ts`
- `src/core/audit.ts`
- `src/core/sse.ts`
- Every other plugin

---

## 5. Code Style & Patterns

Follow `CLAUDE.md` conventions as-is. Specifically for this feature:

- **Zod at boundaries.** The `/usage-feed` route parses query params through Zod. `UsageEntry` is a TS type, not a Zod schema, because the callers are internal and trusted.
- **Functional.** The recorder is a module with closure-backed state (via `globalThis`), not a class.
- **No backwards compat.** Delete `request-log.ts` outright. Delete the `toolStats` Map. No aliases, no shims, no re-exports. The project rule in `CLAUDE.md` and memory is explicit: "This machine is the only user. No focus should be spent on backwards compatibility or shims."
- **No comments explaining what.** One-line `// Why:` only when the reader would be surprised (e.g. the `globalThis` hack).
- **Logging.** `const log = createLogger('core/usage')`. No empty catches.
- **Time windows.** Use `Date.now() - windowMs` math, not date libraries. Define `WINDOW_MS = { '5m': 300_000, '1h': 3_600_000, '24h': 86_400_000 }`.
- **Ring buffer cap.** `MAX_ENTRIES = 10_000`. FIFO eviction on insert.

---

## 6. Testing Strategy

Three layers — all three are required.

**Layer 1: recorder unit tests** (`tests/core/usage.test.ts`)
- Insert / query / window filter / agent filter / kind filter / ring buffer eviction / idle detection. Pure functions against an isolated recorder instance.

**Layer 2: wiring integration tests** (`tests/integration/usage-wiring.test.ts`)
This is the layer that prevents the regression the user is hitting right now. Each test uses the *real* code path, not mocks:
- **MCP wiring**: spin up the real `createBakinMcpServer`, register a dummy exec tool, invoke it via the MCP JSON-RPC surface, assert `getUsageFeed({ kind: 'mcp' })` contains it.
- **REST wiring**: import `server.ts`'s middleware function, feed it a mock req/res for `/api/plugins/tasks/list`, run the middleware, assert `getUsageFeed({ kind: 'rest' })` contains it.
- **Next.js catch-all**: if the catch-all route bypasses the custom server middleware (which the audit suspects for GET requests), this test proves it and the fix must make it pass.
- **Agent dispatch**: call the real `dispatch` function with a no-op task, assert `getUsageFeed({ kind: 'agent' })` contains an entry.
- **Heartbeat**: call the real heartbeat tool, assert an entry.

**Layer 3: route tests** (`tests/plugins/health/routes.test.ts`, rewritten)
- Mocks limited to OpenClaw session files + doctor. Usage feed route is tested by seeding real entries via `recordUsage` and asserting the response.

All three layers follow the mandatory test rules in CLAUDE.md: mock `getContentDir`, `logger`, `watcher`, `openclaw-client`.

---

## 7. Boundaries

### Always
- Mock `getContentDir` to a temp dir in every test that touches the filesystem. **No exceptions.**
- Use `globalThis.__bakinUsage` for the recorder state so webpack re-evaluation doesn't duplicate it.
- Delete dead code outright instead of leaving shims — including `request-log.ts` and the `toolStats` map.
- When adding an agent-activity source, also check the surrounding function for other silent gaps and fix them.

### Ask first
- Before deleting the `/requests` route, confirm nothing else (CLI, MCP tool, another plugin) reads it.
- Before removing a field from `/summary`, confirm the frontend is the only consumer.
- Before widening scope to fix other plugins' silent-logging gaps beyond the ones at the dispatch/heartbeat/lifecycle source points.

### Never
- Add persistence in this spec. The user explicitly scoped that out for a future rewrite.
- Mock the recorder in the wiring tests. The whole point of those tests is to prove the real wiring works.
- Introduce `any` across module boundaries.
- Touch `agent-usage.ts`, `audit.ts`, or `sse.ts`.
- Write to `~/.bakin/` from any test.

---

## 8. Assumptions I'm Making

Call these out now so they can be corrected before I write the plan.

1. **`src/core/usage.ts` is the right name and location.** Alternatives considered: `src/core/metrics.ts`, `src/core/telemetry.ts`. "Usage" matches the UI tab language and the existing `agent-usage.ts` sibling.
2. **The Errors card uses a fixed 1h window** regardless of what the tab filter is set to. The top row is a glance-at-a-number area; making it follow the tab filter would be surprising.
3. **"What they're doing now" in Agent Usage** is derived from the most recent `UsageEntry` per agent across all kinds. Format: `calling bakin_exec_tasks_list · 2s ago` or `handling GET /api/plugins/tasks · 1m ago`, and `idle 42s` once the most recent entry is older than 30s.
4. **REST entries use the normalized path**, not the raw URL — `/api/plugins/tasks/:id` style — to avoid the top-paths list exploding with one bar per UUID. Normalization strategy: strip query strings, keep `/api/plugins/{pluginId}/...` verbatim (plugin paths are fixed), replace UUID-shaped segments elsewhere with `:id`.
5. **The MCP tool name in entries** is the raw tool name (e.g. `bakin_exec_tasks_list`), not the display name.
6. **The `agent` field on REST entries** comes from the `x-bakin-agent` header if the custom server middleware currently reads it; otherwise `null` for external calls (Mark's browser, curl from terminal).
7. **Heartbeats are recorded as agent usage entries with `name: 'heartbeat'`** so they show up in the "what they're doing now" row but don't dominate the Agent Usage counts (we'll filter `name === 'heartbeat'` out of the activity-count column, or count them separately).
8. **"Errors" count includes all three kinds.** The card breakdown shows `mcp: N · rest: N · agent: N`.
9. **No new settings in `bakin.config.ts` or plugin settings** — window defaults and the ring buffer cap are hardcoded constants. Can be made configurable later if needed.
10. **The custom server middleware is the single REST chokepoint.** If the audit is right and Next.js catch-all bypasses it for GET requests, the fix is to route through the middleware or call `recordUsage` directly from the catch-all — decision made during the wiring test in Layer 2 based on what the test reveals.

---

## 9. Success Definition

The overhaul is done when:

- Mark opens `/health`, sees four top cards, a three-tab usage section with a window filter, and Context/Cost below.
- He can switch time windows per tab and the data updates.
- He can see which tool fired most recently, which endpoint is hottest, and what each active agent is currently doing.
- The Errors card flips red when any of the three kinds reports a failure within the last hour.
- `pnpm test` passes, including the three new wiring tests — and if any of the three data flows silently breaks in the future, one of those tests fails loudly instead of passing against a mock.
- `request-log.ts` no longer exists in the codebase.
- `CLAUDE.md` documents the new recorder pattern so the next agent adding a new usage source knows exactly where to hook in.

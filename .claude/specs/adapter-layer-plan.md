# Adapter Layer — Migration Plan

**Companion to:** `.claude/specs/adapter-layer.md`
**Author:** Claude (drafted 2026-04-27)

## Plan summary

Six PRs. Each ships self-contained; system stays functional between
PRs. Each PR's description includes manual confirmation steps the
user runs locally before opening the next PR.

| PR | Title | LOC (approx) | Risk |
|---:|---|---:|---|
| PR 0 | feat(tasks): bakin-side task metadata store (prep, not wired) | 500 | low |
| PR 1 | feat(adapters): interfaces + scaffolded packages + boot wiring | 1500 | medium |
| PR 2 | refactor(core): bakin core uses ctx.runtime / SearchAdapter primitives | 2000 | medium-high |
| PR 3 | refactor(plugins): plugins migrate to ctx.runtime / ctx.search | 3000 | high |
| PR 4 | chore(adapters): delete old direct-import paths + final cleanup | 1000 | low (mostly deletes) |
| PR 5 | docs(adapters): adapter-architecture knowledge + check-adapter-boundary skill | 1500 | low |

Total: ~9500 lines across 6 PRs over a 1-2 week window.

---

## PR 0 — Bakin task metadata store (prep)

**Branch:** `feat/bakin-tasks-store`

### Scope

Add `~/.bakin/tasks/` storage layer in isolation. New code path; no
wiring yet. Tasks plugin still uses `flow_runs` for everything. Zero
behavior change in production.

### Files added

- `src/core/tasks-store/index.ts` — public API
- `src/core/tasks-store/io.ts` — atomic JSON read/write
- `src/core/tasks-store/types.ts` — `BakinTask` interface
- `src/core/tasks-store/index-cache.ts` — in-memory cache for fast list
- `tests/core/tasks-store.test.ts` — full coverage of the new module
- `packages/core/src/content-dir.ts` — add `tasks` to `BakinPaths`

### Files modified

- `packages/core/src/content-dir.ts` — `getBakinPaths()` returns
  `tasks: join(home, 'tasks')`
- `tests/...` — any consumer of `getBakinPaths()` may need shape update

### Order of commits (5)

1. `feat(tasks-store): BakinTask interface + paths`
2. `feat(tasks-store): atomic JSON IO`
3. `feat(tasks-store): in-memory index cache + list/get/put/delete`
4. `feat(tasks-store): chokidar watcher integration (broadcasts SSE)`
5. `test(tasks-store): full coverage`

### Verification

```bash
bunx tsc --noEmit -p tsconfig.app.json
bun test tests/core/tasks-store.test.ts --isolate
bun test --isolate                              # full suite still green
bun run lint:home-bypasses
```

### Manual confirmation steps

1. Pull this branch.
2. `bun install`
3. `bunx tsc --noEmit -p tsconfig.app.json` — should be clean.
4. `bun test --isolate` — should be all-green; baseline +N new tests
   for tasks-store.
5. `bakin start` — should boot identically to main (no behavior
   change yet).
6. `bakin tasks list` — same task list as before (still reading
   flow_runs).
7. `ls ~/.bakin/tasks/` — directory should NOT exist yet (storage
   layer is created on first write, which doesn't happen in PR 0).
8. **Confirm OK to proceed** before opening PR 1.

### Rollback

`git revert <merge>` cleanly undoes the entire PR. The new module is
unwired; revert removes it without breaking anything.

### What's NOT in this PR

- No tasks plugin changes.
- No reading from the new store.
- No data migration from flow_runs.
- No adapter work.

---

## PR 1 — Adapter interfaces + scaffolded packages + boot wiring

**Branch:** `feat/adapter-interfaces` (stacked on PR 0)

### Scope

Create the two adapter interfaces in `packages/core/src/adapters/`.
Create `packages/adapter-openclaw/` and `packages/adapter-antfly/` as
real workspace packages. Adapters are STUB implementations that
delegate to existing `src/core/openclaw-client.ts` / `src/core/antfly.ts`
unchanged. `selectRuntimeAdapter` / `selectSearchAdapter` wired into
`server.ts`. Boot-time compatibility check.

Lint rules + fitness test added; they pass because nothing has
migrated yet (the rules deliberately permit the pre-migration import
patterns until PR 2-3 land).

### Files added

```
packages/core/src/adapters/runtime/
  index.ts                      AgentRuntimeAdapter interface
  capabilities.ts               ChannelCapability + helpers
  concepts.ts                   Agent, Task, Skill, Channel, Asset...
  select.ts                     selectRuntimeAdapter(name)
  testing.ts                    createMockRuntimeAdapter

packages/core/src/adapters/search/
  index.ts                      SearchAdapter interface
  concepts.ts                   Query, ScoreBreakdown, QueryDiagnostics...
  select.ts                     selectSearchAdapter(name)
  testing.ts                    createMockSearchAdapter

packages/adapter-openclaw/
  package.json                  private: true, peer @bakin/core
  tsconfig.json                 extends root
  src/
    index.ts                    exports OpenClawAdapter
    runtime.ts                  STUB — delegates to existing src/core/openclaw-client
    lifecycle.ts                STUB
    agents.ts                   STUB
    messaging.ts                STUB
    tools.ts                    STUB
    skills.ts                   STUB
    sessions.ts                 STUB
    memory.ts                   STUB
    tasks.ts                    STUB
    cron.ts                     STUB
    config.ts                   STUB
    channels/index.ts           STUB

packages/adapter-antfly/
  package.json
  tsconfig.json
  src/
    index.ts                    exports AntflyAdapter
    search.ts                   STUB — delegates to existing src/core/antfly

src/core/plugin-types.ts        add `runtime: AgentRuntimeAdapter`
                                add `search: SearchAPI` (already there;
                                tightened to point at SearchAdapter)
src/lib/plugin-registry.ts      buildContext wires ctx.runtime
                                + bumps boot order (adapters before plugins)

server.ts                       new boot sequence:
                                  selectRuntimeAdapter('openclaw')
                                  assertAdapterCompatibility(...)
                                  await runtimeAdapter.initialize(...)
                                  ...

tests/architecture/adapter-boundary.test.ts   fitness test (passes today
                                              because no migration yet;
                                              tightens incrementally)
eslint.config.mjs               no-restricted-imports rules
                                (with deliberate allowlist for
                                pre-migration call sites — to be
                                tightened in PR 2-3)
```

### Order of commits (8)

1. `feat(adapters): runtime + search interfaces in packages/core/src/adapters/`
2. `feat(adapters): testing.ts mock factories`
3. `chore(packages): scaffold adapter-openclaw + adapter-antfly`
4. `feat(adapters): OpenClawAdapter stub delegates to existing core paths`
5. `feat(adapters): AntflyAdapter stub delegates to existing core paths`
6. `feat(boot): server.ts selects + initializes adapters before plugins`
7. `feat(plugins): ctx.runtime + ctx.search exposed on PluginContext`
8. `chore(eslint+arch): boundary lint rules + fitness test (lenient)`

### Verification

```bash
bunx tsc --noEmit -p tsconfig.app.json
bun run lint
bun test --isolate
bun run docs:check
bun run lint:home-bypasses
```

### Manual confirmation steps

1. Pull this branch (which includes PR 0).
2. `bun install` — new packages add minor dep resolution.
3. `bunx tsc --noEmit -p tsconfig.app.json` — clean.
4. `bun run lint` — clean (rules permit pre-migration imports).
5. `bun test --isolate` — full suite still green.
6. `bakin start`:
   - Boot logs should show: `Loaded runtime adapter: openclaw@1.0.0`
   - `Loaded search adapter: antfly@1.0.0`
   - Compatibility check passes.
   - Plugin registry initializes without error.
7. `bakin doctor` — runs all health checks; results identical to main.
8. **Live test message:**
   - In the bakin UI, send a chat message to your main agent.
   - Expect: streams normally; no broken behavior. (The stub adapter
     delegates straight through to existing `streamMessage` — should be
     identical to pre-PR.)
9. **Live test indexing:**
   - Edit a project markdown file under `~/.bakin/projects/`.
   - Watch SSE — should broadcast as before.
   - Search for a snippet in the project — Antfly returns it.
10. `bakin status` — gateway reachable; same output as before.
11. **Confirm OK to proceed** before opening PR 2.

### Rollback

`git revert` removes the adapter packages and reverts boot wiring.
Stub delegates mean nothing was actually using the adapter for real
work yet; revert is clean.

### What's NOT in this PR

- No bakin core code rewritten to use adapter (still uses
  `openclaw-client` + `antfly` directly via the stub delegation).
- No plugin code changed.
- No old files deleted.

### Why stubs delegate

This PR proves the boot sequence + interface compile + lint rules
work, without committing to a behavior change. PR 2 fills in real
implementations.

---

## PR 2 — Bakin core migration

**Branch:** `refactor/core-via-adapter` (stacked on PR 1)

### Scope

Move the actual implementation logic from `src/core/openclaw-client.ts`
and `src/core/antfly.ts` INTO the adapter packages. Refactor every
direct call in `src/core/`, `cli/`, `packages/host/api/` to go through
`ctx.runtime.*` (or the adapter directly for non-plugin contexts like
boot wiring).

Plugin code is UNTOUCHED in this PR. Plugins still use the old call
sites; PR 3 migrates them.

### Files modified

- `src/core/openclaw-client.ts` — implementation moves to
  `packages/adapter-openclaw/src/client.ts`; this file becomes a
  thin re-export for backward compat (deleted in PR 4)
- `src/core/antfly.ts`, `antfly-server.ts` — same pattern
- `packages/core/src/openclaw-home.ts`, `openclaw-config.ts` — moved
  into adapter package
- `src/core/dispatch.ts` — uses `runtimeAdapter.messaging.send` etc
- `src/core/task-service.ts` — uses adapter for execution dispatch
  + bakin tasks-store for metadata (the split-layer model)
- `src/core/agents.ts`, `agent-usage.ts` — use adapter
- `src/core/watchdog.ts` — uses adapter
- `src/core/continuation.ts` — uses adapter
- `src/core/mcporter.ts` — uses adapter for runtime config writes
- `src/core/onboarding/openclaw.ts` — delegates to adapter init
- `src/core/onboarding/antfly.ts` — delegates to adapter init
- `src/core/onboarding/credentials.ts` — asks adapter what creds it needs
- `src/core/agent-packages/{installer,projector,uninstaller,...}` — uses
  adapter for skill ops
- `src/core/plugins/uninstall-snapshot.ts` — uses adapter
- `src/core/search-registry.ts` — uses SearchAdapter primitives
- `src/core/lifecycle.ts` — uses adapter shutdown
- `src/core/discord-gateway.ts` — moves into `packages/adapter-openclaw/src/channels/discord/gateway.ts`
- `scripts/lib/post-discord.ts` — moves into adapter
- `cli/bakin.ts` — uses adapter for any direct calls
- `eslint.config.mjs` — tightens the allowlist (now bans direct
  imports from outside the adapter package)
- `tests/architecture/adapter-boundary.test.ts` — tightens to assert
  no direct imports from `src/core/openclaw-client` etc.

### Files deleted (in this PR)

None yet. Old files become re-export shims; PR 4 deletes them.

### Order of commits (12)

1. `refactor(adapter-openclaw): move openclaw-client implementation in`
2. `refactor(adapter-openclaw): move openclaw-home + openclaw-config in`
3. `refactor(adapter-antfly): move antfly + antfly-server in`
4. `refactor(adapter-openclaw): channels/discord — move discord-gateway`
5. `refactor(adapter-openclaw): channels/discord — move post-discord`
6. `refactor(core): dispatch + watchdog use ctx.runtime.messaging`
7. `refactor(core): task-service split — adapter for execution, store for metadata`
8. `refactor(core): agents + agent-packages use ctx.runtime.agents/skills`
9. `refactor(core): onboarding flows delegate to adapter init`
10. `refactor(core): search-registry uses SearchAdapter primitives`
11. `refactor(adapter-openclaw): health checks consolidate into adapter package`
12. `chore(eslint+arch): tighten boundary rules to ban direct imports`

### Verification

Each commit must pass:
```bash
bunx tsc --noEmit -p tsconfig.app.json
bun run lint
bun test --isolate
bun run lint:home-bypasses
```

### Manual confirmation steps

1. Pull this branch (which includes PR 0 + PR 1).
2. `bun install`
3. Full test + lint sweep — all green.
4. `bakin start`:
   - Boot succeeds.
   - **Look at gateway logs** — expect identical message-handling
     traffic to pre-PR (the adapter wraps the existing client; same
     HTTP calls hit OpenClaw).
5. **Critical: send a message; see streaming response.**
   - The adapter's `messaging.stream` returns
     `AsyncIterable<ChatChunk>` instead of raw `Response`.
   - The bakin UI should render tokens identically. If the streaming
     UI behaves differently, that's a regression worth catching here
     before plugins migrate in PR 3.
6. **Critical: trigger a task dispatch from the kanban UI.**
   - Bakin creates a `BakinTask` JSON file at
     `~/.bakin/tasks/YYYY-MM/task-<id>.json`.
   - Adapter dispatches; flow_runs row is created in OpenClaw.
   - Status updates flow back via `subscribeExecutionUpdates` and
     update bakin's UI.
   - **Verify both sides:** `cat ~/.bakin/tasks/YYYY-MM/task-*.json`
     shows bakin metadata; OpenClaw's flow_runs has matching execution
     row.
7. **Critical: trigger a Discord notification.**
   - Workflow gate approval or watchdog alert.
   - Discord adapter (now inside `packages/adapter-openclaw/`) posts
     the message with buttons.
   - Click a button — the response flows back through the adapter's
     interaction event.
   - Verify approval lands in workflows plugin correctly.
8. **Antfly:** save a project file; verify it indexes; search returns it.
   - The score breakdown should be visible in debug mode (toggle
     debug; inspect a search result).
9. `bakin doctor` — health checks pass identically.
10. `bakin tasks list` — shows tasks; metadata from new store, status
    from adapter.
11. **Confirm OK to proceed** before opening PR 3.

### Rollback

Each commit in the PR is granular enough to revert individually.
Whole-PR revert restores `src/core/openclaw-client.ts` and friends to
pre-PR-2 state; adapter packages stay (still scaffolded from PR 1) but
unused. System works identically to PR 1.

### What's NOT in this PR

- Plugins still import from old paths. They get migrated in PR 3.
- Old `src/core/openclaw-client.ts` etc. are NOT deleted — they
  become re-export shims pointing at the adapter package. PR 4
  deletes them.

---

## PR 3 — Plugin migration

**Branch:** `refactor/plugins-via-adapter` (stacked on PR 2)

### Scope

Every plugin migrates to `ctx.runtime.*` and `ctx.search.*`. Plugin-side
adapter files (`plugins/team/lib/openclaw-adapter.ts`,
`plugins/memory/lib/openclaw-adapter.ts`) get folded into the adapter
package and deleted from plugins.

### Plugins touched

| Plugin | Migration |
|---|---|
| `messaging` | imports → ctx.runtime.messaging + ctx.runtime.channels |
| `team` | imports → ctx.runtime.agents (incl. identity); plugin-side adapter file deleted |
| `memory` | imports → ctx.runtime.memory + ctx.runtime.sessions; plugin-side adapter files deleted |
| `tasks` | flow-store split: bakin-store for metadata; adapter for execution |
| `workflows` | imports → ctx.runtime.tools + ctx.runtime.channels (notifications + approvals) |
| `schedule` | imports → ctx.runtime.cron |
| `health` | system-checks moved into adapter packages (PR 2 already); plugin shrinks |
| `models` | imports → ctx.runtime.config |
| `projects` | imports → ctx.runtime.config + ctx.runtime.agents |
| `assets` | (likely no direct adapter use; verify) |

### Files added

- `tests/plugins/test-helpers.ts` — updated to consume mocks from
  `@bakin/sdk/testing`
- `packages/sdk/src/index.ts` — re-exports `createMockRuntimeAdapter`,
  `createMockSearchAdapter`
- `packages/sdk/package.json` — adds `/testing` to exports map

### Files deleted (in this PR)

- `plugins/team/lib/openclaw-adapter.ts`
- `plugins/memory/lib/openclaw-adapter.ts`
- `plugins/memory/lib/openclaw-cli.ts`
- `plugins/memory/lib/openclaw-gateway.ts`

### Order of commits (10)

1. `feat(sdk): re-export mock adapter factories from @bakin/sdk/testing`
2. `refactor(messaging): use ctx.runtime.messaging + .channels`
3. `refactor(team): use ctx.runtime.agents; remove plugin-side adapter`
4. `refactor(memory): use ctx.runtime.memory + .sessions; remove adapter`
5. `refactor(tasks): split bakin store + adapter dispatch (final wiring)`
6. `refactor(workflows): use ctx.runtime.tools + .channels`
7. `refactor(schedule): use ctx.runtime.cron`
8. `refactor(models+projects): use ctx.runtime.config + .agents`
9. `refactor(plugins/health): shrink — system checks live in adapters`
10. `chore(tests): migrate plugin tests to canonical mocks`

### Verification

```bash
bunx tsc --noEmit -p tsconfig.app.json
bun run lint
bun test --isolate
bun run docs:check
bun run lint:home-bypasses
```

### Manual confirmation steps

1. Pull this branch.
2. `bun install`
3. Full test + lint sweep — all green.
4. `bakin start` — boots; every plugin activates without error.
5. **Per-plugin smoke test (each must work end-to-end):**

   **messaging**
   - Open the messaging UI; create a brainstorm session.
   - Send a chat message to an agent; observe streaming response.
   - Schedule a content piece; verify it lands in the calendar.
   - Trigger a Discord post; verify it appears in Discord.

   **team**
   - Open the team UI; pick an agent; edit their identity (SOUL.md
     equivalent).
   - Save; verify the file is updated in the runtime's workspace
     (via the adapter; check via `bakin paths` for the workspace path).

   **memory**
   - Open the memory UI; navigate the tier breakdown.
   - Each tier loads; entries display.
   - Click into a session; the session reader streams events.

   **tasks**
   - Open the kanban board; tasks render.
   - Drag-drop a task between columns; the bakin task JSON file
     updates.
   - Create a new task; verify both bakin metadata file AND the
     runtime's flow_runs row are created.
   - Mark a task complete; status flows back through
     `subscribeExecutionUpdates`.

   **workflows**
   - Trigger a workflow that has a gate.
   - Discord approval message appears; click "Approve"; workflow
     advances.

   **schedule**
   - Open the schedule UI; cron jobs list correctly.
   - Verify run history displays.

   **health**
   - `bakin doctor` runs all checks; antfly + openclaw checks come
     from adapter packages.

   **models**
   - Open the models UI; the model list reflects the runtime config.

   **projects**
   - Create a project; verify it lands at `~/.bakin/projects/`.
   - Edit the project markdown; SSE updates the UI.

6. **Run the architecture fitness test:**
   ```bash
   bun test tests/architecture/adapter-boundary.test.ts --isolate
   ```
   Should pass: no direct openclaw-client / antfly imports outside
   the adapter packages. The boundary is real now.
7. **Confirm OK to proceed** before opening PR 4.

### Rollback

Per-plugin commits are granular. Whole-PR revert restores plugins to
their pre-migration state; adapters keep their work from PR 2; system
works as of PR 2.

### What's NOT in this PR

- Old `src/core/openclaw-client.ts` etc. are still re-export shims
  (kept for backward-compat during migration). PR 4 deletes them.

---

## PR 4 — Cleanup (deletions)

**Branch:** `chore/adapter-cleanup` (stacked on PR 3)

### Scope

Delete the old re-export shims and any other now-orphaned code.
Tighten lint rules to their final form.

### Files deleted

- `src/core/openclaw-client.ts` (re-export shim)
- `src/core/openclaw-home.ts` (now in adapter package; original in
  `packages/core/` should also be migrated — verify)
- `packages/core/src/openclaw-home.ts` — moved fully to adapter
- `packages/core/src/openclaw-config.ts` — moved fully to adapter
- `src/core/antfly.ts`, `src/core/antfly-server.ts` (re-export shims)
- `src/core/discord-gateway.ts` (moved to adapter)
- `scripts/lib/post-discord.ts` (moved to adapter)
- `scripts/bin/post-discord.ts` — verify still needed; if just a
  CLI wrapper, route through adapter

### Files modified

- `eslint.config.mjs` — final form (no allowlist exceptions for
  pre-migration paths; the boundary is hard now)
- `tests/architecture/adapter-boundary.test.ts` — final assertions
- `tsconfig.json` — clean up any path aliases that pointed at deleted
  files

### Order of commits (5)

1. `chore: delete openclaw-client shim (now in adapter-openclaw)`
2. `chore: delete antfly shim (now in adapter-antfly)`
3. `chore: delete discord-gateway shim (now in adapter-openclaw)`
4. `chore: delete plugin-side openclaw-adapter shims`
5. `chore(eslint+arch): tighten boundary to final form`

### Verification

```bash
bunx tsc --noEmit -p tsconfig.app.json
bun run lint
bun test --isolate
bun run lint:home-bypasses

# Specific check that nothing references the deleted files:
grep -rn "openclaw-client\|antfly\.ts\|discord-gateway" src/ plugins/ packages/host/ cli/ --include="*.ts" --include="*.tsx"
# Should return ZERO matches outside packages/adapter-*/
```

### Manual confirmation steps

1. Pull this branch.
2. `bun install`
3. Full test + lint sweep — all green.
4. `bakin start` — boots cleanly.
5. **Run the boundary check skill:**
   ```bash
   # Skill exists from PR 5, but the grep version works in PR 4:
   grep -rn "openclaw-client\|src/core/antfly\|discord-gateway" \
     src/ plugins/ packages/host/ cli/ \
     --include="*.ts" --include="*.tsx"
   ```
   Expect zero matches.
6. **Run all the per-plugin smokes from PR 3 again.** Behavior should
   be identical to PR 3.
7. `bakin doctor` — passes.
8. **Confirm OK to proceed** before opening PR 5.

### Rollback

Reverting deletes is mechanical. The architecture is otherwise
unchanged from PR 3.

### What's NOT in this PR

- Documentation updates. Those land in PR 5.

---

## PR 5 — Documentation + skills

**Branch:** `docs/adapter-architecture` (stacked on PR 4)

### Scope

The `.claude/knowledge/` updates, CLAUDE.md update, the `check-adapter-
boundary` skill, plugin authoring docs.

### Files added

- `.claude/knowledge/adapter-architecture.md` (~400 lines, canonical
  reference)
- `.claude/skills/check-adapter-boundary.md` (invocable audit skill)

### Files modified

- `CLAUDE.md`
- `.claude/knowledge/plugin-system.md`
- `.claude/knowledge/repo-architecture.md`
- `.claude/knowledge/search-system.md`
- `.claude/knowledge/dispatch.md`
- `.claude/knowledge/doctor-and-health-checks.md`
- `docs-old/plugin-authoring.md`

### Order of commits (4)

1. `docs(arch): adapter-architecture canonical knowledge`
2. `docs(arch): update plugin-system + repo-architecture + search-system + dispatch + doctor knowledge`
3. `docs(plugins): update plugin-authoring with ctx.runtime / ctx.search sections`
4. `chore(skills): check-adapter-boundary invocable skill`

### Verification

```bash
bun run docs:check                              # Astro builds
bun run lint                                    # docs files have no lint
bun test --isolate                              # full suite still green
```

### Manual confirmation steps

1. Pull this branch.
2. `bun run docs:check` — docs build succeeds.
3. `cat .claude/knowledge/adapter-architecture.md` — review for
   accuracy + completeness.
4. **Invoke the skill:**
   - In a Claude Code session: `/check-adapter-boundary` (or
     "run the adapter boundary audit")
   - Expect: walks src/, cli/, plugins/, packages/host/,
     packages/core/ for forbidden imports; reports clean.
5. `cat CLAUDE.md` — verify the new "External Service Boundaries"
   section is present and accurate.
6. `bakin start` — final smoke; everything works as of PR 4.
7. **Confirm done.**

### Rollback

Doc-only PR; revert is trivial.

---

## What done looks like

After all six PRs merge:

- [x] Two-adapter architecture in production (OpenClaw + Antfly).
- [x] Bakin core has zero direct imports of openclaw-client / antfly /
      discord-gateway.
- [x] Plugins consume `ctx.runtime.*` and `ctx.search.*` exclusively.
- [x] `~/.bakin/tasks/` is the live task metadata store.
- [x] Lint + fitness test enforce the boundary at PR time.
- [x] Knowledge docs + skill make the architecture discoverable for
      future contributors (and future Claude sessions).
- [x] Mock adapter harness simplifies plugin testing.
- [x] System is ready for Phase 4-5 (extracting messaging + projects)
      because they now consume the stable `ctx.runtime.*` surface.

## Sequencing into the broader plugin-architecture-v2 work

```
NOW
├─ adapter layer work (this plan, 6 PRs)
└─ Phase 6+7 PR (#183) — independent of adapter work, can land in parallel

THEN
├─ Phase 4: extract messaging into bakin-bits-official
│     (now trivial: messaging consumes ctx.runtime + ctx.search;
│      port the plugin's source verbatim)
├─ Phase 5: extract projects (same shape)
└─ RECOMMENDED_PLUGINS array gets populated with the extracted plugins

LATER (6+ months)
├─ Hermes adapter implementation
├─ Other channel adapters (Telegram, Slack)
└─ Third-party adapter authoring docs
```

## Risks across the series

| Risk | Mitigation |
|---|---|
| PR 2 reveals an interface design flaw | PR 1 already proved boot + types; the surface is locked. PR 2 implements; design changes are constrained to "add new method" not "redesign existing." |
| Plugin migration uncovers a needed ctx surface | Add to interface; bump @bakin/core minor; backfill the adapter. Doesn't block PR 3. |
| Fitness test catches more violations than expected | Adapter package's allowlist expands. Each addition is a deliberate decision, lint-comment'd with rationale. |
| Manual smokes uncover a regression | Halt the chain; fix in the current PR before opening the next. Smoke checklist for each PR is the gate. |
| Hot reload coordinator (Phase 2) breaks during adapter migration | Adapter init is restart-required and lives outside the hot-reload pipeline. Verify in PR 1's manual confirmation. |
| Discord interactions stop working mid-migration | The discord-gateway WS connection lives in the adapter from PR 2 onwards. PR 2's manual smoke includes a Discord button click. |

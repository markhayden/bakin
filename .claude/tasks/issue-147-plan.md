# Plan — Issue #147: Bun Migration + Binary Distribution

**Spec:** `.claude/specs/bun-migration.md`
**Issue:** https://github.com/markhayden/bakin/issues/147
**Branch:** `issue-147-bun-migration` (off `main`)
**Related:** #141 (plugin loader — partially shipped on #145), #142 (permissions), #146 (Vite hybrid escape hatch)

## Goal

Migrate Bakin off Next.js to Bun + binary distribution. Single-file executables for Mac arm64 + Linux x64/arm64. User plugins install from source (`bakin plugins install github:foo/bar`) and compile in-binary via `Bun.build()` — no toolchain on the user's machine. Preserve the post-#145 plugin contract (`@bakin/sdk/*`, slots, hooks, `BakinPlugin` activate) unchanged.

## Operating principles (binding)

1. Single-user machine. No backcompat, no shims, no dual-mode gates.
2. Aggressive deletion. Obsolete file = deleted file. Git history is the backcompat layer.
3. Single long-lived branch. Bakin is broken mid-migration by design.
4. Tech-debt reduction is a first-class outcome — every phase doubles as cleanup.
5. ~70 commits is a feature, not noise — it's the rollback granularity.

## Dependency graph

```
T0 scaffold (branch, archive, plan + todo)
  │
  ▼
Phase A — Runtime swap (~3d, 6 tasks) ───────────────── CHECKPOINT
  │        Bun replaces Node + pnpm. Next.js still runs the app.
  ▼
Phase B — Server migration (~3d, 7 tasks + per-route) ─ CHECKPOINT
  │        Bun.serve() replaces Next.js API routes. Client still on Next.js.
  ▼
Phase C — Client migration (~4d, 7 tasks + per-route) ─ CHECKPOINT
  │        packages/host + TanStack Router replace src/app/. Shell rebuilt.
  ▼
Phase D — Import map + externals (~2d, 5 tasks) ─────── CHECKPOINT
  │        React + SDK externalized. Shared-instance assertion in place.
  ▼
Phase E — Plugin compilation (~3d, 6 tasks + per-plugin) ─ CHECKPOINT
  │        Each plugin builds independently. plugin-manifest.ts deleted.
  ▼
Phase F — Runtime plugin loader (~3d, 6 tasks) ──────── CHECKPOINT
  │        /api/plugins/manifest + PluginHost + registerPlugin live.
  ▼
Phase G — Binary compile + distribution (~3d, 6 tasks) ─ CHECKPOINT
  │        bun build --compile for 3 platforms. Release workflow, bakin update.
  ▼
Phase H — SDK npm publish (~2d, 4 tasks) ───────────── CHECKPOINT
  │        @bakin/sdk live on npm, scaffold command ready.
  ▼
Phase I — Cleanup + docs (~2d, 9 tasks) ────────────── FINAL GATE
           Delete Next.js remnants. Rewrite CLAUDE.md + 18 knowledge files.
           POINT OF NO RETURN — git history is the only rollback after this.
```

Solo sequential. **~70 commits total.** Every phase boundary requires `bun x tsc --noEmit && bun x vitest run && bun run build` green before proceeding.

---

## T0 — chore(issue-147): branch + plan scaffold

**Already done (prior session):**
- Spec at `.claude/specs/bun-migration.md` (640 lines, approved)
- Issue #147 filed
- Issue #146 filed (Vite hybrid escape hatch)
- Blog draft at `docs/drafts/plugin-system-journey.md`

**Still to do (this task):**
- Branch `issue-147-bun-migration` from `main`
- Archive prior #137 tasks → `.claude/tasks/issue-137-{plan,todo}.md` (done; staged)
- Write `tasks/plan.md` + `tasks/todo.md` (this file + companion)
- Commit: `chore(issue-147): branch + plan scaffold`

**Acceptance:**
- [ ] On branch `issue-147-bun-migration`
- [ ] `tasks/plan.md` + `tasks/todo.md` present, scoped to #147
- [ ] `.claude/tasks/issue-137-{plan,todo}.md` reflects prior state
- [ ] Commit lands

**Verification:** `git branch --show-current` prints `issue-147-bun-migration`; `ls tasks/` shows both files.

**Rollback:** `git checkout main && git branch -d issue-147-bun-migration`.

---

# PHASE A — Runtime swap (~3 days)

**Goal:** Bakin runs on Bun instead of Node. Next.js is still the framework; we swap only the runtime + package manager.

**Rollback for entire phase:** revert A1–A6 commits; `pnpm install` restores Node toolchain. No destructive changes.

### TA1 — chore(env): install Bun, pin version

- Install Bun >= 1.2.0 on dev machine (brew install oven-sh/bun/bun or official installer)
- Add `.bun-version` file at repo root pinning minimum version
- Document in `CONTRIBUTING.md` (or create it): required Bun version + install command
- No code changes yet

**Acceptance:**
- [ ] `bun --version` ≥ 1.2.0
- [ ] `.bun-version` file committed

**Verification:** `bun --version` outputs version meeting pin.

**Rollback:** Delete `.bun-version`. Bun installation can stay (harmless).

**Commit:** `chore(env): install Bun runtime + pin .bun-version`

### TA2 — chore(deps): pnpm → bun install + bun.lockb

- Delete `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- Add `workspaces` field to root `package.json` pointing at `packages/*` and `plugins/*`
- Run `bun install` — generates `bun.lockb`
- Commit both

**Acceptance:**
- [ ] `bun.lockb` present; `pnpm-lock.yaml` + `pnpm-workspace.yaml` gone
- [ ] `bun install --frozen-lockfile` completes cleanly
- [ ] All workspaces (core, sdk, plugins/*) resolve

**Verification:** `bun install --frozen-lockfile` exit 0; `bun x tsc --noEmit` still passes.

**Rollback:** Restore `pnpm-lock.yaml` + `pnpm-workspace.yaml` from prior commit; `pnpm install`.

**Commit:** `chore(deps): migrate pnpm → bun install`

### TA3 — chore(scripts): package.json scripts on Bun

- Update `package.json` scripts:
  - `dev` → `bun run next-dev-wrapper` (keep Next.js wrapper for now; runtime is Bun)
  - `build` → `bun run build-wrapper`
  - `lint` → `bun x eslint`
  - `typecheck` → `bun x tsc --noEmit`
  - `test` → `bun x vitest run`
- Adjust any npm scripts that assumed pnpm behavior

**Acceptance:**
- [ ] All scripts runnable with `bun run <name>`
- [ ] `bun run typecheck` passes
- [ ] `bun run test` runs full suite

**Verification:** `bun run typecheck && bun run test` both exit 0.

**Rollback:** Revert `package.json` script changes.

**Commit:** `chore(scripts): migrate npm scripts to Bun`

### TA4 — feat(server): Bun-native globals in server.ts

- Update `server.ts`:
  - Swap any Node-specific APIs for Bun equivalents where cleaner (`Bun.file()`, `Bun.spawn` vs. `fs.readFileSync`, `child_process.spawn`)
  - Leave Next.js handling intact — this phase is runtime swap only
- Verify server still starts, serves existing pages

**Acceptance:**
- [ ] `bun run dev` starts the server
- [ ] `curl localhost:3737/` returns the existing home page
- [ ] No regressions in existing feature smoke test (manual pass: load tasks, team, workflows)

**Verification:** Manual dev-server smoke test.

**Rollback:** Revert server.ts changes.

**Commit:** `feat(server): use Bun-native APIs in server.ts`

### TA5 — docs(CLAUDE): update Architecture line for Bun runtime

- Update CLAUDE.md:
  - Architecture section "Server" line: Node.js → Bun
  - Leave deeper rewrites for Phase I
- Minimal surgical edit — not a full CLAUDE.md rewrite

**Acceptance:**
- [ ] CLAUDE.md reflects Bun runtime in Architecture section
- [ ] No stale `pnpm` references in any script-mention in CLAUDE.md (replace with `bun`)

**Verification:** `grep -n "pnpm" CLAUDE.md` returns zero hits.

**Rollback:** Trivial.

**Commit:** `docs(CLAUDE): reflect Bun runtime in architecture section`

### TA6 — test: categorize Vitest suite for Bun compatibility

- Run `bun x vitest run` — full suite on Bun
- Triage any failures into:
  - Category 2 (adjust mocks): files mocking `next/server`, `next/navigation`, `next/image`
  - Category 3 (rewrite): tests exercising Next.js route-module behavior
  - Category 4 (add new): binary smoke tests (deferred to Phase G)
- Record categorization in `.claude/tasks/issue-147-test-triage.md` (temporary tracking file)

**Acceptance:**
- [ ] Test suite runs on Bun (some may fail — expected)
- [ ] `.claude/tasks/issue-147-test-triage.md` lists every failing file + category

**Verification:** File exists, matches actual failures.

**Rollback:** Delete the triage file.

**Commit:** `test: categorize Vitest suite for Bun migration`

---

### CHECKPOINT — Phase A boundary

- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` — green (no regressions from A's scope; Category 2/3 failures deferred to phases that own them)
- [ ] `bun run build` — Next.js production build still succeeds on Bun runtime
- [ ] Manual dev-server smoke: all 10 core pages load

---

# PHASE B — Server migration (~3 days)

**Goal:** Replace Next.js API routes with Bun.serve() handlers. Next.js still serves the client during this phase.

**Rollback:** Per-route commits allow per-route rollback. Phase B end is the last "easy revert" point before client work.

### TB1 — feat(server): stand up Bun.serve() alongside Next.js

- Add Bun.serve() listening on :3737; Next.js handlers still dispatched through it on unmatched paths
- Create `packages/host/src/server.ts` skeleton + a simple router (pattern-match on URL)
- Core routing precedence: Bun handlers win, Next.js fallback for what Bun hasn't absorbed

**Acceptance:**
- [ ] `bun run dev` boots Bun.serve() as the primary entry
- [ ] All existing routes continue to respond (via Next.js fallback)

**Verification:** `curl localhost:3737/api/activity` returns the same JSON as before.

**Rollback:** Revert TB1; server.ts goes back to pure Next.js wrap.

**Commit:** `feat(server): Bun.serve() as primary HTTP entry, Next.js as fallback`

### TB2 through TB17 — feat(server): per-route migration (16 routes)

Each route gets its own commit. One file migrated per commit.

Route list (from `src/app/api/**/route.ts`):
1. `activity/route.ts`
2. `agents/avatar/route.ts`
3. `agents/health/route.ts`
4. `agents/settings/route.ts`
5. `agents/[action]/route.ts`
6. `memory/log/route.ts`
7. `plugin-settings/[pluginId]/route.ts`
8. `plugin-settings/schemas/route.ts`
9. `plugins/install/route.ts`
10. `plugins/remove/route.ts`
11. `plugins/memory/audit/route.ts`
12. `plugins/memory/gateway/route.ts`
13. `plugins/memory/workspace/route.ts`
14. `plugins/[pluginId]/[[...path]]/route.ts` (plugin catch-all — the biggest)
15. `state/route.ts`
16. `assets/[...path]/route.ts` (already migrated to use hook via #145 but still uses NextRequest)

Per-route procedure:
- Move `src/app/api/<path>/route.ts` → `packages/host/src/api/<path>.ts`
- Rewrite exports: `export async function GET(req: NextRequest)` → `export async function get(req: Request): Promise<Response>`
- Rewrite types: `NextResponse.json(x, { status })` → `Response.json(x, { status })`
- Register the handler in Bun.serve()'s router
- Delete the old `src/app/api/<path>/route.ts` file
- Update any Category 3 test file targeting this route
- Commit

**Per-route acceptance:**
- [ ] Handler responds with identical body + status + headers as before
- [ ] Test for this route (if any) passes
- [ ] Old file gone

**Verification per route:** `curl` the endpoint + diff response; `bun x vitest run tests/api/<relevant>` green.

**Rollback per route:** Revert that specific commit.

**Commit pattern (16 commits):** `feat(server): migrate /api/<path> to Bun.serve`

### TB18 — feat(server): plugin dispatcher via PluginRegistry

- Refactor `packages/host/src/api/plugin-dispatcher.ts` — dispatches `/api/plugins/:pluginId/*` to the plugin's registered route handlers via `PluginRegistry.getRoute(pluginId, method, subpath)`
- Handles parameterized route matching (`:projectId`) identically to the existing catch-all
- Delete the Next.js catch-all `src/app/api/plugins/[pluginId]/[[...path]]/route.ts` (was TB14 but worth calling out)

**Acceptance:**
- [ ] Every plugin route (tasks, workflows, etc.) responds correctly
- [ ] Parameterized paths work

**Verification:** Hit `/api/plugins/tasks/` (list), `/api/plugins/projects/abc-123` (detail), `/api/plugins/workflows/definitions/foo` etc.

**Rollback:** Revert; restore old catch-all.

**Commit:** `feat(server): plugin API dispatcher via PluginRegistry`

### TB19 — test: rewrite Next.js-coupled route tests (Category 3)

- For every Category 3 file from TA6's triage:
  - Rewrite from "call the route module" to "call the Bun handler function directly"
  - Replace `NextRequest` mocks with `new Request(...)`
  - Replace `NextResponse` assertions with plain `Response` assertions

**Acceptance:**
- [ ] All Category 3 tests pass
- [ ] Zero `NextRequest` / `NextResponse` imports in `tests/`

**Verification:** `bun x vitest run` green; `grep -rn "NextRequest\|NextResponse" tests/` returns zero.

**Rollback:** Revert.

**Commit:** `test: rewrite API route tests for Bun handlers`

### TB20 — test: adjust Category 2 mocks where phase B surfaces them

- Tests mocking `next/server` in the API-route layer — update to stub Web Request/Response patterns
- Tests mocking `next/navigation` for client side are deferred to Phase C

**Acceptance:**
- [ ] All API-layer Category 2 tests pass on Bun

**Verification:** `bun x vitest run tests/api/ tests/core/` green.

**Commit:** `test: adjust Category 2 mocks for Bun server layer`

---

### CHECKPOINT — Phase B boundary

- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` — green (all API tests passing; client-coupled ones still fine under Next.js)
- [ ] `bun run build` — Next.js build still succeeds (client path)
- [ ] Every `src/app/api/**/route.ts` file deleted; moved to `packages/host/src/api/`
- [ ] `grep -rn "NextRequest\|NextResponse" src/` returns zero

---

# PHASE C — Client migration (~4 days)

**Goal:** Replace Next.js App Router + Turbopack with `Bun.build()` + TanStack Router. The heaviest phase.

**Rollback:** Revert C1–C7. Next.js client still exists through this phase (deleted in Phase I), so re-pointing server.ts back is possible.

### TC1 — feat(host): stand up packages/host client build

- Create `packages/host/src/main.tsx` — React root mount
- `packages/host/src/App.tsx` — shell layout (placeholder, filled in TC2)
- `packages/host/public/index.html` — HTML template with `<div id="root">` + import map placeholder
- `packages/host/build.ts` — runs `Bun.build({ entrypoints: ['src/main.tsx'], outdir: 'dist', target: 'browser', format: 'esm' })`
- Bun.serve() in TB1 serves `packages/host/dist/*` for client assets + `index.html` for root paths

**Acceptance:**
- [ ] `bun run packages/host/build.ts` produces `packages/host/dist/main.mjs`
- [ ] Navigating to `localhost:3737/` renders a basic "it works" page from packages/host (not Next.js)
- [ ] Next.js pages still accessible at their paths (Next.js fallback routing)

**Verification:** Browser shows packages/host page; `curl localhost:3737/tasks` still hits Next.js.

**Rollback:** Revert.

**Commit:** `feat(host): scaffold packages/host client build with Bun.build()`

### TC2 — feat(host): port app shell layout

- Move `src/app/layout.tsx` content → `packages/host/src/components/Shell.tsx`
- Port layout components: `src/components/layout/*` (header, sidebar, toaster, connection-dot) → `packages/host/src/components/layout/`
- Providers: `src/components/providers.tsx` + `agent-theme-provider.tsx` → `packages/host/src/providers/`
- Update imports — shell components use `@bakin/sdk/*` as usual

**Acceptance:**
- [ ] Shell renders with sidebar + header + toaster
- [ ] `<AgentThemeProvider>` wraps children correctly
- [ ] SSE connection dot shows

**Verification:** Visual inspection in browser.

**Rollback:** Revert.

**Commit:** `feat(host): port app shell layout to packages/host`

### TC3 — feat(host): install + scaffold TanStack Router

- `bun add @tanstack/react-router @tanstack/router-devtools`
- Create `packages/host/src/router.ts` — root router instance
- `packages/host/src/routes/__root.tsx` — root route definition rendering the Shell
- Wire `<RouterProvider>` into `main.tsx`

**Acceptance:**
- [ ] Root route renders Shell
- [ ] Devtools toggle in dev builds

**Verification:** Browser DevTools shows TanStack Router internals.

**Rollback:** Revert; remove dep.

**Commit:** `feat(host): install TanStack Router + scaffold root route`

### TC4 through TC18 — feat(host): port per-route (15 routes)

Each route gets its own commit.

Route list (from `src/app/**/page.tsx`):
1. `/` (home)
2. `/tasks`
3. `/team`
4. `/team/[id]`
5. `/projects`
6. `/projects/new`
7. `/projects/[id]`
8. `/projects/[id]/edit`
9. `/workflows`
10. `/workflows/new`
11. `/workflows/[id]`
12. `/workflows/[id]/edit`
13. `/assets`
14. `/health`
15. `/memory`
16. `/messaging` (redirect → /messaging/calendar)
17. `/messaging/calendar`
18. `/messaging/brainstorm`
19. `/models`
20. `/schedule`
21. `/settings`

(21 routes total — adjust count upward from 15.)

Per-route procedure:
- Create `packages/host/src/routes/<route-path>.tsx` — TanStack route module
- The route component renders `<Slot name="page:/<route>" {...router-derived props} />`
- Parameterized routes use TanStack's `$id` syntax; `useParams()` pulls `id`; `useNavigate()` replaces Next.js's `router.push`
- Delete the old `src/app/<route>/page.tsx`
- Commit per route

**Per-route acceptance:**
- [ ] Route visible at expected path
- [ ] Slot renders the registered component from plugins (still via static plugin-manifest.ts until Phase F)
- [ ] Router callbacks work (onBack, onSaved, etc.)
- [ ] Old `src/app/<route>/page.tsx` deleted

**Verification:** Navigate to each route; interact with parameterized routes' flows (edit a project, create a workflow).

**Rollback per route:** Revert that commit; Next.js fallback resumes for that path.

**Commit pattern (21 commits):** `feat(host): port /<route> to TanStack Router`

### TC19 — refactor(sdk): swap next/navigation re-exports for TanStack equivalents

- `@bakin/sdk/hooks`: replace `useRouter`, `useParams`, `usePathname` re-exports
  - `useRouter` → wrapper around TanStack's `useNavigate` + `useLocation`
  - `useParams` → TanStack's `useParams` (shapes differ slightly; bridge if needed)
  - `usePathname` → `useLocation().pathname`
- Plugin components consuming these through SDK get the swap transparently

**Acceptance:**
- [ ] All plugin components that called these hooks still work
- [ ] `grep -rn "from 'next/navigation'" plugins/` returns zero

**Verification:** Full plugin smoke test in browser.

**Rollback:** Revert.

**Commit:** `refactor(sdk): route next/navigation hook re-exports to TanStack Router`

### TC20 — feat(server): serve packages/host as the default; drop Next.js client

- Update Bun.serve() routing: static asset requests → `packages/host/dist/` + `packages/host/public/`
- Requests for unmigrated paths (there shouldn't be any by this point) → 404
- Remove Next.js from the request pipeline for pages (API routes already migrated in Phase B)

**Acceptance:**
- [ ] Every page route rendered by TanStack Router
- [ ] No request ever flows through Next.js at runtime

**Verification:** `curl -I localhost:3737/tasks` returns HTML from packages/host; devtools network tab shows no Next.js markers.

**Rollback:** Revert the routing swap.

**Commit:** `feat(server): serve packages/host as primary; retire Next.js client routing`

### TC21 — test: adjust Category 2 client-side mocks

- Test files mocking `next/navigation` — update to TanStack Router test utilities or directly mock the `@bakin/sdk/hooks` re-exports
- Estimated ~6 test files touched

**Acceptance:**
- [ ] All client-component tests pass

**Verification:** `bun x vitest run` green.

**Commit:** `test: adjust client-route mocks for TanStack Router`

---

### CHECKPOINT — Phase C boundary

- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` — all 2984+ tests green
- [ ] `bun run build` produces both Next.js build (still there, unused) + packages/host build
- [ ] All 21 pages render identically to pre-migration (visual smoke: screenshots vs. pre-migration baseline)
- [ ] Zero `from 'next/navigation'` imports in `plugins/` or `packages/host/`

---

# PHASE D — Import map + externals (~2 days)

**Goal:** Shell externalizes React + SDK. Import map resolves at runtime. Plugins will share React (landed in Phase F).

**Rollback:** Revert D1–D5 cleanly. Shell goes back to bundling React inline.

### TD1 — feat(host): externalize React + SDK from shell build

- Update `packages/host/build.ts`:
  ```ts
  external: ['react', 'react-dom', 'react/jsx-runtime', '@bakin/sdk', '@bakin/sdk/*']
  ```
- Shell now errors at runtime (externals unresolved) — TD2 fixes

**Acceptance:**
- [ ] `packages/host/dist/main.mjs` has unresolved `import` statements for React + SDK

**Verification:** `grep "import.*'react'" packages/host/dist/main.mjs` shows unresolved imports (expected).

**Rollback:** Remove `external` option.

**Commit:** `feat(host): externalize React + @bakin/sdk from shell build`

### TD2 — feat(host): build vendor bundles

- `scripts/build-vendors.ts`:
  ```ts
  await Bun.build({ entrypoints: ['react'], outdir: 'packages/host/public/vendor', naming: 'react.mjs', format: 'esm', target: 'browser' })
  // same for react-dom, react/jsx-runtime, react/jsx-dev-runtime
  // and for @bakin/sdk, @bakin/sdk/ui, @bakin/sdk/hooks, @bakin/sdk/components, @bakin/sdk/slots, @bakin/sdk/types, @bakin/sdk/utils
  ```
- Wire into main build: `bun run build` calls this first, then shell, then plugins

**Acceptance:**
- [ ] All vendor bundles exist in `packages/host/public/vendor/`
- [ ] Each is importable standalone (try `curl localhost:3737/vendor/react.mjs | bun run -`)

**Verification:** `ls packages/host/public/vendor/` shows all expected files; import each in a scratch test.

**Rollback:** Delete the script + vendor output dir.

**Commit:** `feat(host): build standalone vendor bundles for React + SDK`

### TD3 — feat(host): emit import map in root HTML

- Update `packages/host/public/index.html`:
  ```html
  <script type="importmap">
  { "imports": { "react": "/vendor/react.mjs", ... } }
  </script>
  ```
- Template the vendor URLs from a build-time constant (versioned if needed)

**Acceptance:**
- [ ] HTML response includes import map
- [ ] Browser resolves React from `/vendor/react.mjs`

**Verification:** `curl localhost:3737/ | grep importmap` shows the script tag; DevTools Network tab shows React loaded from `/vendor/react.mjs`.

**Rollback:** Revert HTML template.

**Commit:** `feat(host): emit browser import map for React + SDK externals`

### TD4 — test: React-instance identity assertion

- Add `packages/host/src/lib/react-identity.ts` — boot-time check that `globalThis.React` (shell's) references the same exports as the import-map-loaded React
- Throws on mismatch; logs OK on match
- Smoke test: `tests/host/react-identity.test.ts` — spins up the shell in jsdom, loads a fixture plugin, verifies shared React

**Acceptance:**
- [ ] Smoke test asserts React reference equality
- [ ] Boot check runs in dev; no-op in production after initial verification

**Verification:** Test passes; manual browser console: `window.__bakinReactIdentityOk === true`.

**Rollback:** Revert test + check.

**Commit:** `test(host): assert React instance shared between shell and externals`

### TD5 — chore(build): rationalize the build pipeline order

- Update `bun run build` to this order:
  1. `scripts/build-vendors.ts` → `/vendor/*.mjs`
  2. `packages/host/build.ts` → `packages/host/dist/main.mjs`
  3. (Phase E will add) per-plugin builds → `plugins/<id>/dist/*`
  4. (Phase G will add) `bun build --compile` → binary
- Document the order in `CONTRIBUTING.md`

**Acceptance:**
- [ ] Order is deterministic and documented
- [ ] `bun run build` from clean produces all artifacts

**Verification:** `rm -rf packages/host/dist packages/host/public/vendor && bun run build` completes; all outputs present.

**Rollback:** Revert script.

**Commit:** `chore(build): formalize multi-stage build pipeline`

---

### CHECKPOINT — Phase D boundary

- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green
- [ ] `bun run build` clean
- [ ] Shell loads in browser, DevTools Network shows React from `/vendor/react.mjs`
- [ ] React-identity smoke test passes

---

# PHASE E — Plugin compilation (~3 days)

**Goal:** Each plugin builds independently. `plugin-manifest.ts` deleted. Core plugins embedded in binary (actual embedding lands in Phase G; Phase E sets up the per-plugin builds).

**Rollback:** Phase E is where the framework split becomes real. Reverting means restoring `plugin-manifest.ts` from Phase D's commit; bigger blast radius than prior phases.

### TE1 — feat(plugins): delete src/lib/plugin-manifest.ts

- Delete the static-imports aggregation file
- Remove all callers; temporarily comment out nav aggregation (restored in Phase F via `/api/plugins/manifest`)
- Shell temporarily has no plugin UI — expected; Phase F fixes

**Acceptance:**
- [ ] `src/lib/plugin-manifest.ts` gone
- [ ] Codebase compiles without it (callers stubbed or removed)

**Verification:** `bun x tsc --noEmit` clean.

**Rollback:** Restore file from git.

**Commit:** `refactor(plugins): delete static plugin-manifest.ts`

### TE2 through TE11 — feat(plugins): per-plugin package.json + vite... I mean Bun build config (10 plugins)

Per plugin (10 total: tasks, team, workflows, projects, assets, schedule, memory, messaging, models, health):

- Create `plugins/<id>/package.json`:
  ```json
  {
    "name": "@bakin-core/<id>",
    "version": "0.0.0",
    "private": true,
    "peerDependencies": { "react": "^19.0.0", "@bakin/sdk": "workspace:*" }
  }
  ```
- Create/confirm `plugins/<id>/bakin-plugin.json` present (already exists for most)
- Rename entries if needed so each plugin has `src/index.ts` + `src/client.tsx` shapes

**Per-plugin acceptance:**
- [ ] `plugins/<id>/package.json` present
- [ ] Source entry points exist at `src/index.ts` and `src/client.tsx`

**Verification per plugin:** `cat plugins/<id>/package.json | jq .` parses; file tree matches.

**Commit pattern (10 commits):** `chore(plugins/<id>): per-plugin package.json + entry shape`

### TE12 — feat(build): core plugin builder

- `build.ts` at repo root: iterates `plugins/*`, runs `Bun.build()` per plugin:
  ```ts
  await Bun.build({
    entrypoints: ['plugins/tasks/src/index.ts', 'plugins/tasks/src/client.tsx'],
    outdir: 'plugins/tasks/dist',
    target: 'browser' /* or 'bun' for server entry */,
    format: 'esm',
    external: ['react', 'react-dom', 'react/jsx-runtime', '@bakin/sdk', '@bakin/sdk/*']
  })
  ```
- Separate builds for server entry (target: bun) vs. client entry (target: browser)
- Outputs land in `plugins/<id>/dist/{index.js, client.mjs}`
- Add to `.gitignore`: `plugins/*/dist/`

**Acceptance:**
- [ ] `bun run build:plugins` produces `dist/` for all 10 core plugins
- [ ] Each plugin's output has unresolved externals for `react` + `@bakin/sdk`

**Verification:** `ls plugins/tasks/dist/` shows both files; `grep "from 'react'" plugins/tasks/dist/client.mjs` shows unresolved import.

**Rollback:** Remove build script.

**Commit:** `feat(build): per-plugin Bun.build() pipeline`

### TE13 — feat(core): in-binary Bun.build() for user plugins

- `packages/host/src/plugin-host/user-plugin-builder.ts`:
  ```ts
  export async function buildUserPlugin(pluginDir: string): Promise<void> {
    // If package.json has deps beyond externals: run `bun install` in pluginDir
    // Run Bun.build() on src/index.ts + src/client.tsx
    // Write dist/ next to src/
  }
  ```
- Called from `/api/plugins/install` (already exists but currently no-op client-side)
- Also called from the plugin registry's startup scan if `dist/` is missing or stale (mtime check)

**Acceptance:**
- [ ] Fixture user plugin (source only, no dist) at `tests/fixtures/sample-user-plugin/` builds successfully via this path
- [ ] Stale detection: modify `src/` and the next server start rebuilds dist

**Verification:** Install fixture plugin via test harness; confirm `dist/` appears; touch `src/index.ts` and re-scan to see rebuild.

**Rollback:** Revert.

**Commit:** `feat(core): Bun.build() pipeline for user plugins (in-binary)`

### TE14 — test: build-on-install fixture test

- New test `tests/api/plugins-build.test.ts`:
  - Create source-only plugin fixture in temp dir
  - Call install endpoint with `type: 'local'`
  - Assert `dist/client.mjs` and `dist/index.js` appear
  - Assert manifest reports the plugin
  - Cleanup

**Acceptance:**
- [ ] Test passes on Bun

**Verification:** `bun x vitest run tests/api/plugins-build.test.ts` green.

**Commit:** `test: build-on-install smoke test for user plugins`

---

### CHECKPOINT — Phase E boundary

- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green
- [ ] `bun run build` produces all core plugin dist/ outputs
- [ ] Sample user plugin builds end-to-end from source
- [ ] `plugin-manifest.ts` deleted; no regressions (except nav items temporarily missing from sidebar — expected until Phase F)

---

# PHASE F — Runtime plugin loader (~3 days)

**Goal:** Browser dynamic-imports plugin bundles via manifest + import map. Core plugins' `registerPlugin` calls run at load. Nav + pages + slots restored.

**Rollback:** Revert F1–F6; shell goes back to "no plugin UI" state from Phase E.

### TF1 — feat(server): /api/plugins/manifest endpoint

- Bun handler at `packages/host/src/api/plugins-manifest.ts`:
  ```ts
  GET /api/plugins/manifest → {
    plugins: [
      { id, clientEntry: '/api/plugins/<id>/assets/client.mjs', pages: [...], navItems: [...], slots: [...] }
    ],
    importMap: { imports: { react: '/vendor/react.mjs', ... } }
  }
  ```
- Pulls from `PluginRegistry.listActive()` + known externals list

**Acceptance:**
- [ ] `curl localhost:3737/api/plugins/manifest` returns valid JSON
- [ ] All 10 core plugins listed
- [ ] Import map structure matches what shell needs

**Verification:** Manual curl + jq inspection.

**Rollback:** Revert.

**Commit:** `feat(server): /api/plugins/manifest endpoint`

### TF2 — feat(server): serve plugin client.mjs assets

- Bun handler at `packages/host/src/api/plugin-assets.ts`:
  ```ts
  GET /api/plugins/:pluginId/assets/:path*
  ```
- For core plugins: serves from `plugins/<id>/dist/` (will be embedded in binary at Phase G; for dev, reads from disk)
- For user plugins: serves from `~/.bakin/plugins/<id>/dist/`
- Sets correct MIME type, cache headers

**Acceptance:**
- [ ] `curl localhost:3737/api/plugins/tasks/assets/client.mjs` returns the built bundle
- [ ] 404 for unknown plugin
- [ ] Path traversal blocked (`..` in path)

**Verification:** `curl` + status code check.

**Commit:** `feat(server): plugin asset-serving endpoint`

### TF3 — feat(sdk): registerPlugin helper

- Add to `@bakin/sdk/slots` (or new submodule `@bakin/sdk/register`):
  ```ts
  export interface PluginRegistration {
    id: string
    pages?: Record<string, ComponentType<any>>
    navItems?: NavItem[]
    slots?: Record<string, ComponentType<any>>
  }
  export function registerPlugin(reg: PluginRegistration): void
  ```
- Internally writes to a browser-side global map (namespaced `__bakinPluginRegistry`)
- Re-export from `@bakin/sdk` main entry so plugins can `import { registerPlugin } from '@bakin/sdk'`

**Acceptance:**
- [ ] Type-safe `registerPlugin` export
- [ ] Plugin-side call populates the browser registry
- [ ] Existing `registerSlot` calls continue to work (additive, not replacement)

**Verification:** Unit test at `tests/sdk/register-plugin.test.tsx`.

**Rollback:** Revert.

**Commit:** `feat(sdk): registerPlugin helper for runtime plugin host`

### TF4 — feat(host): PluginHost component

- `packages/host/src/plugin-host/PluginHost.tsx`:
  - On mount: fetch `/api/plugins/manifest`
  - Inject `<script type="importmap">` from the manifest's `importMap` field (document.head)
  - Dynamic-import each plugin's `clientEntry` (browser-native `import()`)
  - Await all imports; each plugin's module runs `registerPlugin({...})` as a side effect
  - After all imports resolve: force a re-render so Shell pulls fresh nav + pages from the registry
- Mounted in `App.tsx` above the Shell

**Acceptance:**
- [ ] Manifest fetched on boot
- [ ] Import map injected
- [ ] All core plugins' client.mjs dynamic-imported
- [ ] Sidebar nav populated from registry

**Verification:** DevTools: Network tab shows dynamic import of plugin bundles; sidebar matches pre-migration content.

**Rollback:** Revert.

**Commit:** `feat(host): PluginHost bootstraps plugins at runtime`

### TF5 — refactor(plugins): convert client.tsx to registerPlugin

For each of the 10 core plugins:
- Replace `export const navItems = [...]` with `registerPlugin({ navItems: [...], pages: {...}, slots: {...} })`
- Remove lingering individual `registerSlot` calls where they can be consolidated into `registerPlugin`'s `slots` field

**Per-plugin acceptance:**
- [ ] `plugins/<id>/src/client.tsx` calls `registerPlugin` once
- [ ] Export shape stripped — the module is pure side-effect

**Verification per plugin:** Nav item appears; page renders; slots still work.

**Commit pattern (10 commits):** `refactor(plugins/<id>): consolidate registration via registerPlugin`

### TF6 — test: end-to-end user plugin flow

- Fixture user plugin source in `tests/fixtures/sample-user-plugin/`:
  - `bakin-plugin.json`: minimal manifest
  - `src/index.ts`: server `activate()` registering a route
  - `src/client.tsx`: `registerPlugin({ navItems, pages, slots })`
- Test at `tests/api/user-plugin-lifecycle.test.ts`:
  1. Install from local path via `/api/plugins/install`
  2. Assert plugin builds successfully (dist/ appears)
  3. Re-fetch manifest → new plugin present
  4. Simulate browser dynamic import of its client.mjs
  5. Assert its nav + page + slot registered in browser state
  6. Remove via `/api/plugins/remove`
  7. Re-fetch manifest → plugin gone

**Acceptance:**
- [ ] Full lifecycle test passes on Bun

**Verification:** `bun x vitest run tests/api/user-plugin-lifecycle.test.ts` green.

**Commit:** `test: end-to-end user plugin install + load + remove`

---

### CHECKPOINT — Phase F boundary

- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green — all 2984+ tests
- [ ] `bun run build` clean
- [ ] Browser: all 10 core plugins render identically to pre-migration (via runtime load, not static imports)
- [ ] Sample user plugin installs + contributes nav + page + slot without restart

---

# PHASE G — Binary compilation + distribution (~3 days)

**Goal:** Cross-platform binaries exist and can self-update. No Bakin changes; just packaging + release pipeline.

**Rollback:** No-op — don't ship the release. The binary is always re-buildable from source.

### TG1 — feat(build): bun build --compile pipeline

- Update `build.ts`:
  ```ts
  for (const target of ['bun-darwin-arm64', 'bun-linux-x64', 'bun-linux-arm64']) {
    await Bun.spawn(['bun', 'build', '--compile', `--target=${target}`, '--outfile', `dist/bakin-${target}`, 'server.ts']).exited
  }
  ```
- Binary embeds: server code, `packages/host/dist/*`, `packages/host/public/*`, `plugins/*/dist/*` (core plugins)
- Output: `dist/bakin-bun-darwin-arm64`, `dist/bakin-bun-linux-x64`, `dist/bakin-bun-linux-arm64`

**Acceptance:**
- [ ] All 3 binaries produced
- [ ] Each binary < 120MB
- [ ] Mac arm64 binary runs locally: `./dist/bakin-bun-darwin-arm64 start`

**Verification:** `file dist/bakin-bun-darwin-arm64` shows Mach-O arm64; `./dist/bakin-bun-darwin-arm64 version` prints version.

**Rollback:** Revert build script; remove artifacts.

**Commit:** `feat(build): bun build --compile for 3 platforms`

### TG2 — feat(cli): consolidate CLI commands in binary

- Move `cli/bakin.ts` commands into `server.ts` CLI entry:
  - `bakin start`, `stop`, `status`, `version`, `update`
  - `bakin plugins list`, `install`, `remove`, `dev`, `scaffold`, `reindex`, `types`
- Argument parsing via `minimist` or Bun's built-in (check)
- Exit codes per spec

**Acceptance:**
- [ ] Every command from spec's Commands section implemented
- [ ] Exit codes match spec
- [ ] `bakin --help` lists all commands

**Verification:** Run each command on the compiled binary.

**Commit:** `feat(cli): unify CLI commands into compiled binary`

### TG3 — chore(ci): GitHub Actions release workflow

- `.github/workflows/release.yml`:
  - Trigger: `push: tags: ['v*']`
  - Job 1: checkout, install Bun, `bun install`, `bun run build`, upload `dist/bakin-*` as artifacts
  - Job 2: compute SHA256 checksums, upload `checksums.txt`
  - Job 3: create GitHub release with artifacts + checksums attached

**Acceptance:**
- [ ] Workflow validates (yamllint + actionlint)
- [ ] Dry-run on a tag-preview branch shows all 3 binaries uploaded

**Verification:** GitHub Actions run on test tag.

**Commit:** `ci(release): binary release workflow for 3 platforms`

### TG4 — feat(cli): bakin update self-replace

- Implement `bakin update`:
  1. GET latest release from GitHub API
  2. Download binary for current platform
  3. Verify SHA256 against `checksums.txt`
  4. Write to `bakin.new` adjacent to current binary
  5. Atomic rename `bakin.new` → current location
  6. Exit with message "restart to use new version"

**Acceptance:**
- [ ] Command completes successfully
- [ ] Checksum mismatch → refuse swap, non-zero exit
- [ ] Network failure → non-zero exit, old binary intact

**Verification:** Manual: point at a test release, run `bakin update`.

**Commit:** `feat(cli): bakin update self-replacement with checksum verify`

### TG5 — chore(install): curl-able install script

- `install.sh` hosted at `bakin.dev/install.sh` (or similar):
  - Detects OS + arch
  - Downloads correct binary from latest release
  - Places in `/usr/local/bin/bakin`
  - Chmod +x
  - Verifies checksum

**Acceptance:**
- [ ] `curl -sSL https://bakin.dev/install.sh | bash` works on Mac + Linux
- [ ] Handles all 3 platforms

**Verification:** Manual on test VM.

**Commit:** `chore(install): curl-able install script`

### TG6 — chore(install): Homebrew formula

- Create `markhayden/homebrew-tap` repo with `Formula/bakin.rb`
- Formula downloads the Mac release, verifies SHA, installs to `/usr/local/bin`

**Acceptance:**
- [ ] `brew install markhayden/tap/bakin` works
- [ ] `brew upgrade bakin` pulls the latest

**Verification:** Manual install on Mac.

**Commit:** `chore(install): Homebrew formula for Mac`

---

### CHECKPOINT — Phase G boundary

- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green
- [ ] `bun run build` produces all 3 binaries under 120MB each
- [ ] Mac arm64 binary runs end-to-end: `bakin start` → open browser → core plugins work
- [ ] Release workflow passes dry-run

---

# PHASE H — SDK npm publish (~2 days)

**Goal:** `@bakin/sdk` on public npm. Version-matched to Bakin binary releases.

**Rollback:** `npm unpublish @bakin/sdk@<version>` within 72h; or supersede with a patched version.

### TH1 — chore(sdk): prep packages/sdk for npm publish

- Update `packages/sdk/package.json`:
  - Remove `"private": true`
  - Add `"description"`, `"repository"`, `"homepage"`, `"license"`, `"author"`
  - Add `"files"`: `["src", "README.md"]`
  - Ensure `"exports"` is complete (main + all sub-paths)
  - Add `"publishConfig": { "access": "public" }`
- Add `packages/sdk/README.md` — quickstart for plugin authors

**Acceptance:**
- [ ] `npm pack` in `packages/sdk/` produces a valid tarball
- [ ] `npm publish --dry-run` passes

**Verification:** `cd packages/sdk && npm pack && tar tf bakin-sdk-*.tgz`.

**Commit:** `chore(sdk): prep for npm publish`

### TH2 — chore(release): publish-sdk script + NPM_TOKEN integration

- `scripts/publish-sdk.ts`:
  - Read version from root `package.json` (or git tag)
  - Set version on `packages/sdk/package.json`
  - `npm publish` with `--access public`
- Requires `NPM_TOKEN` in GitHub Actions secrets

**Acceptance:**
- [ ] Script runs locally with `--dry-run` successfully
- [ ] Reads version from git tag / env

**Verification:** Manual dry-run.

**Commit:** `chore(release): publish-sdk script`

### TH3 — ci(release): wire sdk publish into release workflow

- Extend `.github/workflows/release.yml`:
  - After binary upload, if `NPM_TOKEN` present, run `scripts/publish-sdk.ts`
  - Idempotent: if version already on npm, skip without failing

**Acceptance:**
- [ ] Workflow publishes on tag push
- [ ] Idempotent re-runs don't fail

**Verification:** GitHub Actions run on test tag; verify `npm view @bakin/sdk@<version>` shows the package.

**Commit:** `ci(release): publish @bakin/sdk to npm on release`

### TH4 — feat(cli): bakin plugins scaffold

- Implement `bakin plugins scaffold <name>`:
  - Creates `./<name>/` with:
    - `bakin-plugin.json` — minimal manifest
    - `package.json` — `devDependencies: { "@bakin/sdk": "^<current-bakin-version>" }`
    - `src/index.ts` — stub server entry
    - `src/client.tsx` — stub `registerPlugin({ navItems: [] })`
    - `.gitignore` — ignore `dist/`, `node_modules/`
    - `README.md` — how to dev + install
- Post-scaffold hint: `cd <name> && bun install && bakin plugins dev .`

**Acceptance:**
- [ ] Command writes full template
- [ ] Template compiles with `Bun.build()` out of the box
- [ ] Scaffolded plugin installs via `bakin plugins install ./<name>`

**Verification:** `bakin plugins scaffold test-plugin && cd test-plugin && bakin plugins install .`

**Commit:** `feat(cli): bakin plugins scaffold command`

---

### CHECKPOINT — Phase H boundary

- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green
- [ ] `bun run build` clean
- [ ] Test release tag publishes to npm successfully
- [ ] Scaffold → install → load → UI appears — full plugin author loop works

---

# PHASE I — Cleanup + docs (~2 days)

**Goal:** Delete all Next.js remnants. Rewrite docs. No backcompat cruft. **Point of no return.**

**Rollback:** Git history only. Prior phases' commits are the sole recovery path.

### TI1 — chore(cleanup): delete src/app/ tree

- `rm -rf src/app/`
- Remove any lingering Next.js route files
- Verify no code imports from `src/app/` anywhere

**Acceptance:**
- [ ] `src/app/` gone
- [ ] `grep -rn "src/app/" --exclude-dir=node_modules` returns zero

**Verification:** `bun x tsc --noEmit` clean.

**Commit:** `chore(cleanup): delete src/app/ (Next.js App Router tree)`

### TI2 — chore(cleanup): remove Next.js deps from package.json

- Remove from `dependencies`: `next`, `@types/next`
- Remove from `devDependencies`: `eslint-config-next`
- Run `bun install` to regenerate lockfile
- Update any scripts that referenced `next`

**Acceptance:**
- [ ] `package.json` has zero `next`-prefixed packages
- [ ] `bun.lockb` regenerated
- [ ] `bun x tsc --noEmit` + `bun x vitest run` still clean

**Verification:** `grep -n "next" package.json` returns zero.

**Commit:** `chore(cleanup): remove Next.js dependencies`

### TI3 — chore(tsconfig): remove @/* alias, drop Next plugin, jsx: react-jsx

- `tsconfig.json`:
  - Remove `@/*` path alias
  - Remove `"plugins": [{ "name": "next" }]`
  - `"jsx": "react-jsx"` instead of `"preserve"`
  - Verify `"moduleResolution": "bundler"` fits Bun
- `vitest.config.ts`: remove `@/*` alias match too

**Acceptance:**
- [ ] `@/*` alias gone from both configs
- [ ] `grep -rn "'@/" src/ packages/ plugins/ tests/` returns zero (plugins already migrated; host + core should be clean)

**Verification:** `bun x tsc --noEmit` + `bun x vitest run` clean.

**Commit:** `chore(tsconfig): drop Next.js-specific tsconfig paths + plugin`

### TI4 — chore(eslint): update ESLint config for post-Next.js tree

- `eslint.config.mjs`:
  - Remove `eslint-config-next` extends
  - Keep `no-restricted-imports` rule for `plugins/**` (from #145)
  - Update blocked patterns: drop `@/*`, add `@bakin/host/*` to blocked list
- Run `bun run lint` — triage any new violations

**Acceptance:**
- [ ] ESLint passes (allow pre-existing warnings to continue per operating principle)
- [ ] Cross-plugin violation still caught by rule (verify with deliberate bad import)

**Verification:** `bun run lint` completes; drop-a-bad-import test triggers the rule.

**Commit:** `chore(eslint): update config for Bun + post-Next.js tree`

### TI5 — docs(CLAUDE): rewrite Architecture + Directory Map + Plugin System + Testing sections

Full rewrite of CLAUDE.md sections:
- **Architecture:** Bun runtime, binary distribution, `packages/host` + `plugins/*` structure
- **Directory Map:** new `packages/{core,sdk,host}/` layout; remove references to `src/app/`, `src/components/`
- **Plugin System:** runtime load flow (`/api/plugins/manifest` → dynamic import → `registerPlugin`); core plugins compiled into binary; user plugins built on install
- **Testing Rules:** `bun x vitest run` as canonical command; preserve existing mock-`content-dir` requirement

Also update:
- "Server" line → Bun
- Any `pnpm` → `bun`
- Remove Next.js mentions throughout

**Acceptance:**
- [ ] CLAUDE.md fully reflects post-migration state
- [ ] Zero Next.js / pnpm references

**Verification:** Read-through + `grep -in "next\|pnpm\|webpack\|turbopack" CLAUDE.md` returns zero.

**Commit:** `docs(CLAUDE): rewrite for Bun + binary architecture`

### TI6 — docs(authoring): rewrite docs/plugin-authoring.md

Major rewrite. Current guide assumes pre-built `dist/` shipping; new guide:
- Source-only shipping ("no dist/ in your repo")
- `bakin plugins scaffold` as the starting point
- Build-on-install story ("Bakin compiles your source in-binary")
- `bakin plugins dev <path>` for the dev loop
- `@bakin/sdk` as the only import path (unchanged)
- Available slot names + `registerPlugin` pattern

**Acceptance:**
- [ ] Guide reflects source-only shipping
- [ ] `bakin plugins scaffold` + `dev` + `install` commands documented
- [ ] No references to maintaining a `dist/` directory

**Verification:** Read-through; every command in guide actually exists.

**Commit:** `docs(authoring): rewrite for source-only + build-on-install`

### TI7 — docs(knowledge): high-impact rewrites

Per spec's Doc update plan — high-impact files:
- `.claude/knowledge/plugin-system.md` — rewrite for Bun + runtime load + `registerPlugin`
- `.claude/knowledge/repo-architecture.md` — rewrite for new package structure

**Acceptance:**
- [ ] Both files reflect post-migration reality
- [ ] No Next.js / App Router / webpack references

**Verification:** `grep -in "next\|pnpm\|webpack" .claude/knowledge/plugin-system.md .claude/knowledge/repo-architecture.md` returns zero.

**Commit:** `docs(knowledge): rewrite plugin-system.md + repo-architecture.md`

### TI8 — docs(knowledge): medium-impact edits

Per spec's Doc update plan — medium-impact files:
- `storage-model.md` — note SQLite-for-operational-state as follow-up
- `search-system.md` — remove Next.js references; Antfly integration unchanged
- `shared-ui-patterns.md` — confirm SDK surface; update import examples
- `url-state-deep-linking.md` — TanStack Router underneath (implementation note)
- `workflows-plugin.md`, `tasks-plugin.md`, `messaging-plugin.md`, `memory-plugin.md`, `assets-plugin.md`, `team-plugin.md`, `health-plugin.md` — remove Next.js API-route mentions; confirm server-side contract

**Acceptance:**
- [ ] All 11 files reflect post-migration reality
- [ ] No stale framework references

**Verification:** Read-through + grep per file.

**Commit:** `docs(knowledge): medium-impact edits across 11 files`

### TI9 — final grep + test sanity

- Grep sanity checks (all must return zero in `src/ packages/ plugins/` excluding `dist/` and `node_modules/`):
  - `from 'next/`
  - `from '@/` (alias gone)
  - `pnpm`
  - `App Router`
  - `webpack|turbopack`
- Full suite: `bun x tsc --noEmit && bun x vitest run && bun run build`
- Fix any long-tail issues uncovered

**Acceptance:**
- [ ] All greps return zero
- [ ] Full test suite green
- [ ] Binary builds successfully

**Verification:** As above.

**Commit:** `chore(cleanup): final sanity sweep`

---

### FINAL GATE — Phase I boundary

- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green — all 2984+ tests
- [ ] `bun run build` produces all 3 binaries under 120MB
- [ ] All 10 core plugins render identically to pre-migration
- [ ] Sample user plugin installs + loads + appears in UI without restart
- [ ] All performance targets in spec met (binary cold-start, hydration TTFI, plugin install time)
- [ ] All acceptance criteria (13 items) in spec met
- [ ] CLAUDE.md + docs/plugin-authoring.md + 13 knowledge files rewritten
- [ ] Zero Next.js / pnpm / webpack / @/* references in codebase

---

## Ship

When the final gate is green:

1. Squash or merge-commit the branch into main (decision deferred — probably merge-commit given the phased history is valuable)
2. Tag as `v2.0.0` (major bump — framework change)
3. Push tag → GitHub Actions runs the release workflow
4. Binaries + checksums uploaded to GitHub release
5. `@bakin/sdk@2.0.0` published to npm
6. Update README with new install instructions
7. Close #147, link back to this plan

## Risk notes

- **Chokidar quality on Bun.** Might surface edge cases. If flaky, swap for native `fs.watch` in a targeted commit.
- **TanStack Router learning curve.** Budget half a day extra in Phase C for adjustment if unfamiliar.
- **Binary size creep.** If bundled core plugins balloon the binary over 120MB, investigate per-plugin tree-shaking before merging. Don't compromise on the limit.
- **npm publish conflict.** If a test tag accidentally publishes to the real npm, `npm unpublish` within 72h. Use `--dry-run` heavily.
- **The vendor bundles (D2) must be exact React internals.** Any `.mjs` mismatch between shell and plugin Reacts = hook errors. The D4 identity assertion catches this at boot.

## Dependencies between tasks

Critical path (non-parallelizable):
- T0 blocks everything
- Phase A → Phase B → Phase C → Phase D (linear)
- Phase D blocks Phase E (externals must exist before plugins build against them)
- Phase E blocks Phase F (plugins must build before loader can load them)
- Phase F blocks Phase G (runtime load must work before binary compile embeds the output)
- Phase G + H can be interleaved; H has no runtime dependencies on G
- Phase I blocks nothing but everything blocks it — it's the point of no return

Within a phase, per-route / per-plugin commits (TB2–TB17, TC4–TC18, TE2–TE11, TF5) are independent and technically parallelizable, but solo-developer sequential is fine.

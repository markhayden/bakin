# TODO: Issue #147 — Bun Migration + Binary Distribution

**Spec:** `.claude/specs/bun-migration.md`
**Plan:** `tasks/plan.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/147
**Branch:** `issue-147-bun-migration` (off `main`)

Daily tracking. Phases labeled A–I; ~70 commits total. Phase boundaries gate progression.

---

## T0 — chore(issue-147): branch + plan scaffold

- [ ] `git checkout -b issue-147-bun-migration`
- [ ] Archive prior #137 tasks to `.claude/tasks/issue-137-{plan,todo}.md` (done; staged)
- [ ] Write `tasks/plan.md` (done)
- [ ] Write `tasks/todo.md` (this file)
- [ ] Commit: `chore(issue-147): branch + plan scaffold`

---

## PHASE A — Runtime swap (~3d, 6 commits)

### TA1 — chore(env): install Bun, pin version
- [ ] Install Bun >= 1.2.0
- [ ] Commit `.bun-version` + `CONTRIBUTING.md` note
- [ ] Commit: `chore(env): install Bun runtime + pin .bun-version`

### TA2 — chore(deps): pnpm → bun install + bun.lockb
- [ ] Delete `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- [ ] Add `workspaces` to root `package.json`
- [ ] `bun install` → `bun.lockb`
- [ ] Verify `bun install --frozen-lockfile` clean
- [ ] Commit: `chore(deps): migrate pnpm → bun install`

### TA3 — chore(scripts): package.json scripts on Bun
- [ ] Update all scripts (`dev`, `build`, `lint`, `typecheck`, `test`) to use Bun
- [ ] `bun run typecheck && bun run test` green
- [ ] Commit: `chore(scripts): migrate npm scripts to Bun`

### TA4 — feat(server): Bun-native globals in server.ts
- [ ] Swap Node APIs for Bun equivalents where cleaner
- [ ] Next.js wrap intact; manual smoke test passes
- [ ] Commit: `feat(server): use Bun-native APIs in server.ts`

### TA5 — docs(CLAUDE): Architecture line for Bun
- [ ] CLAUDE.md Server line → Bun
- [ ] `grep "pnpm" CLAUDE.md` → zero
- [ ] Commit: `docs(CLAUDE): reflect Bun runtime in architecture section`

### TA6 — test: categorize Vitest suite for Bun
- [ ] Run full suite on Bun
- [ ] Triage failures → `.claude/tasks/issue-147-test-triage.md`
- [ ] Commit: `test: categorize Vitest suite for Bun migration`

### CHECKPOINT — Phase A boundary
- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green (or expected-failures documented)
- [ ] `bun run build` succeeds
- [ ] Manual dev-server smoke: all 10 core pages load

---

## PHASE B — Server migration (~3d, 16+4 commits)

### TB1 — feat(server): Bun.serve() alongside Next.js
- [ ] Bun.serve() as primary; Next.js as fallback
- [ ] All routes still respond
- [ ] Commit: `feat(server): Bun.serve() as primary HTTP entry, Next.js as fallback`

### TB2–TB17 — per-route migration (16 routes)

For each route:
- [ ] `activity` — Commit: `feat(server): migrate /api/activity to Bun.serve`
- [ ] `agents/avatar` — Commit: `feat(server): migrate /api/agents/avatar to Bun.serve`
- [ ] `agents/health` — Commit: `feat(server): migrate /api/agents/health to Bun.serve`
- [ ] `agents/settings` — Commit: `feat(server): migrate /api/agents/settings to Bun.serve`
- [ ] `agents/[action]` — Commit: `feat(server): migrate /api/agents/[action] to Bun.serve`
- [ ] `memory/log` — Commit: `feat(server): migrate /api/memory/log to Bun.serve`
- [ ] `plugin-settings/[pluginId]` — Commit: `feat(server): migrate /api/plugin-settings/[pluginId] to Bun.serve`
- [ ] `plugin-settings/schemas` — Commit: `feat(server): migrate /api/plugin-settings/schemas to Bun.serve`
- [ ] `plugins/install` — Commit: `feat(server): migrate /api/plugins/install to Bun.serve`
- [ ] `plugins/remove` — Commit: `feat(server): migrate /api/plugins/remove to Bun.serve`
- [ ] `plugins/memory/audit` — Commit: `feat(server): migrate /api/plugins/memory/audit to Bun.serve`
- [ ] `plugins/memory/gateway` — Commit: `feat(server): migrate /api/plugins/memory/gateway to Bun.serve`
- [ ] `plugins/memory/workspace` — Commit: `feat(server): migrate /api/plugins/memory/workspace to Bun.serve`
- [ ] `state` — Commit: `feat(server): migrate /api/state to Bun.serve`
- [ ] `assets/[...path]` — Commit: `feat(server): migrate /api/assets/[...path] to Bun.serve`
- [ ] (keep `plugins/[pluginId]/[[...path]]` for TB18)

### TB18 — feat(server): plugin dispatcher via PluginRegistry
- [ ] `packages/host/src/api/plugin-dispatcher.ts` with route match + dispatch
- [ ] Old Next.js catch-all deleted
- [ ] All plugin routes respond correctly
- [ ] Commit: `feat(server): plugin API dispatcher via PluginRegistry`

### TB19 — test: rewrite Category 3 tests
- [ ] Rewrite API-route tests from "call route module" to "call handler function directly"
- [ ] Replace `NextRequest` mocks with `new Request(...)`
- [ ] `grep -rn "NextRequest\|NextResponse" tests/` → zero
- [ ] Commit: `test: rewrite API route tests for Bun handlers`

### TB20 — test: adjust Category 2 API-layer mocks
- [ ] Update mocks in API tests
- [ ] `bun x vitest run tests/api/ tests/core/` green
- [ ] Commit: `test: adjust Category 2 mocks for Bun server layer`

### CHECKPOINT — Phase B boundary
- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green
- [ ] `bun run build` succeeds (Next.js client still there)
- [ ] `src/app/api/**/route.ts` → all deleted
- [ ] `grep -rn "NextRequest\|NextResponse" src/` → zero

---

## PHASE C — Client migration (~4d, 27 commits)

### TC1 — feat(host): scaffold packages/host client build
- [ ] `packages/host/src/main.tsx`, `App.tsx`, `public/index.html`, `build.ts`
- [ ] `bun run packages/host/build.ts` produces `dist/main.mjs`
- [ ] Basic page renders at `localhost:3737/`
- [ ] Commit: `feat(host): scaffold packages/host client build with Bun.build()`

### TC2 — feat(host): port app shell layout
- [ ] Move `src/app/layout.tsx` → `packages/host/src/components/Shell.tsx`
- [ ] Port layout components (header, sidebar, toaster, connection-dot)
- [ ] Port providers (AgentThemeProvider, Providers)
- [ ] Shell renders with full chrome
- [ ] Commit: `feat(host): port app shell layout to packages/host`

### TC3 — feat(host): install + scaffold TanStack Router
- [ ] `bun add @tanstack/react-router @tanstack/router-devtools`
- [ ] `packages/host/src/router.ts` + `routes/__root.tsx`
- [ ] RouterProvider in `main.tsx`
- [ ] Root renders Shell
- [ ] Commit: `feat(host): install TanStack Router + scaffold root route`

### TC4–TC24 — port per-route (21 routes)

For each route:
- [ ] `/` — Commit: `feat(host): port / to TanStack Router`
- [ ] `/tasks` — Commit: `feat(host): port /tasks to TanStack Router`
- [ ] `/team` — Commit: `feat(host): port /team to TanStack Router`
- [ ] `/team/[id]` — Commit: `feat(host): port /team/[id] to TanStack Router`
- [ ] `/projects` — Commit: `feat(host): port /projects to TanStack Router`
- [ ] `/projects/new` — Commit: `feat(host): port /projects/new to TanStack Router`
- [ ] `/projects/[id]` — Commit: `feat(host): port /projects/[id] to TanStack Router`
- [ ] `/projects/[id]/edit` — Commit: `feat(host): port /projects/[id]/edit to TanStack Router`
- [ ] `/workflows` — Commit: `feat(host): port /workflows to TanStack Router`
- [ ] `/workflows/new` — Commit: `feat(host): port /workflows/new to TanStack Router`
- [ ] `/workflows/[id]` — Commit: `feat(host): port /workflows/[id] to TanStack Router`
- [ ] `/workflows/[id]/edit` — Commit: `feat(host): port /workflows/[id]/edit to TanStack Router`
- [ ] `/assets` — Commit: `feat(host): port /assets to TanStack Router`
- [ ] `/health` — Commit: `feat(host): port /health to TanStack Router`
- [ ] `/memory` — Commit: `feat(host): port /memory to TanStack Router`
- [ ] `/messaging` (redirect) — Commit: `feat(host): port /messaging redirect to TanStack Router`
- [ ] `/messaging/calendar` — Commit: `feat(host): port /messaging/calendar to TanStack Router`
- [ ] `/messaging/brainstorm` — Commit: `feat(host): port /messaging/brainstorm to TanStack Router`
- [ ] `/models` — Commit: `feat(host): port /models to TanStack Router`
- [ ] `/schedule` — Commit: `feat(host): port /schedule to TanStack Router`
- [ ] `/settings` — Commit: `feat(host): port /settings to TanStack Router`

### TC25 — refactor(sdk): route next/navigation re-exports to TanStack
- [ ] `@bakin/sdk/hooks` wraps TanStack Router hooks
- [ ] `grep -rn "from 'next/navigation'" plugins/` → zero
- [ ] Commit: `refactor(sdk): route next/navigation hook re-exports to TanStack Router`

### TC26 — feat(server): serve packages/host as default; retire Next.js client
- [ ] Bun.serve() routes static assets → packages/host
- [ ] No traffic goes through Next.js
- [ ] Commit: `feat(server): serve packages/host as primary; retire Next.js client routing`

### TC27 — test: adjust Category 2 client mocks
- [ ] Update test files mocking `next/navigation`
- [ ] All client-component tests pass
- [ ] Commit: `test: adjust client-route mocks for TanStack Router`

### CHECKPOINT — Phase C boundary
- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` — all green
- [ ] `bun run build` succeeds
- [ ] All 21 pages render identically to pre-migration (visual smoke)
- [ ] Zero `from 'next/navigation'` imports anywhere

---

## PHASE D — Import map + externals (~2d, 5 commits)

### TD1 — feat(host): externalize React + SDK
- [ ] `external: ['react', 'react-dom', 'react/jsx-runtime', '@bakin/sdk', '@bakin/sdk/*']`
- [ ] Shell bundle has unresolved external imports
- [ ] Commit: `feat(host): externalize React + @bakin/sdk from shell build`

### TD2 — feat(host): vendor bundles
- [ ] `scripts/build-vendors.ts` produces `public/vendor/{react,react-dom,jsx-runtime,sdk/*}.mjs`
- [ ] Wire into `bun run build`
- [ ] Commit: `feat(host): build standalone vendor bundles for React + SDK`

### TD3 — feat(host): emit import map
- [ ] HTML template injects `<script type="importmap">`
- [ ] Browser loads React from `/vendor/react.mjs`
- [ ] Commit: `feat(host): emit browser import map for React + SDK externals`

### TD4 — test: React-instance identity assertion
- [ ] Boot-time check + smoke test
- [ ] Fails loudly on mismatch
- [ ] Commit: `test(host): assert React instance shared between shell and externals`

### TD5 — chore(build): formalize pipeline order
- [ ] `bun run build` runs vendors → host → plugins (→ binary in G)
- [ ] Document in CONTRIBUTING.md
- [ ] Commit: `chore(build): formalize multi-stage build pipeline`

### CHECKPOINT — Phase D boundary
- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green
- [ ] `bun run build` clean
- [ ] Browser DevTools: React loaded from `/vendor/react.mjs`
- [ ] React-identity smoke test passes

---

## PHASE E — Plugin compilation (~3d, 13 commits)

### TE1 — refactor(plugins): delete src/lib/plugin-manifest.ts
- [ ] File gone
- [ ] Callers stubbed or removed
- [ ] `bun x tsc --noEmit` clean
- [ ] Commit: `refactor(plugins): delete static plugin-manifest.ts`

### TE2–TE11 — per-plugin package.json (10 plugins)
- [ ] tasks — Commit: `chore(plugins/tasks): per-plugin package.json + entry shape`
- [ ] team — Commit: `chore(plugins/team): per-plugin package.json + entry shape`
- [ ] workflows — Commit: `chore(plugins/workflows): per-plugin package.json + entry shape`
- [ ] projects — Commit: `chore(plugins/projects): per-plugin package.json + entry shape`
- [ ] assets — Commit: `chore(plugins/assets): per-plugin package.json + entry shape`
- [ ] schedule — Commit: `chore(plugins/schedule): per-plugin package.json + entry shape`
- [ ] memory — Commit: `chore(plugins/memory): per-plugin package.json + entry shape`
- [ ] messaging — Commit: `chore(plugins/messaging): per-plugin package.json + entry shape`
- [ ] models — Commit: `chore(plugins/models): per-plugin package.json + entry shape`
- [ ] health — Commit: `chore(plugins/health): per-plugin package.json + entry shape`

### TE12 — feat(build): core plugin builder
- [ ] `build.ts` iterates plugins; `Bun.build()` per plugin with externals
- [ ] `plugins/<id>/dist/{index.js, client.mjs}` per plugin
- [ ] Add `plugins/*/dist/` to `.gitignore`
- [ ] Commit: `feat(build): per-plugin Bun.build() pipeline`

### TE13 — feat(core): in-binary user-plugin builder
- [ ] `packages/host/src/plugin-host/user-plugin-builder.ts`
- [ ] Called from install endpoint + startup scan
- [ ] Stale detection via mtime
- [ ] Commit: `feat(core): Bun.build() pipeline for user plugins (in-binary)`

### TE14 — test: build-on-install smoke
- [ ] Fixture plugin at `tests/fixtures/sample-user-plugin/`
- [ ] New test `tests/api/plugins-build.test.ts`
- [ ] Commit: `test: build-on-install smoke test for user plugins`

### CHECKPOINT — Phase E boundary
- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green
- [ ] `bun run build` produces all core plugin `dist/`
- [ ] Sample user plugin builds end-to-end from source
- [ ] `plugin-manifest.ts` deleted

---

## PHASE F — Runtime plugin loader (~3d, 16 commits)

### TF1 — feat(server): /api/plugins/manifest endpoint
- [ ] Returns `{ plugins: [...], importMap: {...} }`
- [ ] All 10 core plugins listed
- [ ] Commit: `feat(server): /api/plugins/manifest endpoint`

### TF2 — feat(server): plugin asset-serving endpoint
- [ ] `/api/plugins/:pluginId/assets/:path*` serves from dist
- [ ] Path traversal blocked
- [ ] Commit: `feat(server): plugin asset-serving endpoint`

### TF3 — feat(sdk): registerPlugin helper
- [ ] `@bakin/sdk/slots` exports `registerPlugin(reg)`
- [ ] Browser-side registry populated
- [ ] Unit tests at `tests/sdk/register-plugin.test.tsx`
- [ ] Commit: `feat(sdk): registerPlugin helper for runtime plugin host`

### TF4 — feat(host): PluginHost component
- [ ] Fetches manifest, injects import map, dynamic-imports plugins
- [ ] Mounted above Shell
- [ ] Sidebar populated from runtime registry
- [ ] Commit: `feat(host): PluginHost bootstraps plugins at runtime`

### TF5 — refactor(plugins): consolidate to registerPlugin (10 plugins)
- [ ] tasks — Commit: `refactor(plugins/tasks): consolidate registration via registerPlugin`
- [ ] team — Commit: `refactor(plugins/team): consolidate registration via registerPlugin`
- [ ] workflows — Commit: `refactor(plugins/workflows): consolidate registration via registerPlugin`
- [ ] projects — Commit: `refactor(plugins/projects): consolidate registration via registerPlugin`
- [ ] assets — Commit: `refactor(plugins/assets): consolidate registration via registerPlugin`
- [ ] schedule — Commit: `refactor(plugins/schedule): consolidate registration via registerPlugin`
- [ ] memory — Commit: `refactor(plugins/memory): consolidate registration via registerPlugin`
- [ ] messaging — Commit: `refactor(plugins/messaging): consolidate registration via registerPlugin`
- [ ] models — Commit: `refactor(plugins/models): consolidate registration via registerPlugin`
- [ ] health — Commit: `refactor(plugins/health): consolidate registration via registerPlugin`

### TF6 — test: end-to-end user plugin lifecycle
- [ ] Full lifecycle test (install → load → remove)
- [ ] Fixture plugin at `tests/fixtures/sample-user-plugin/`
- [ ] Commit: `test: end-to-end user plugin install + load + remove`

### CHECKPOINT — Phase F boundary
- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` — all 2984+ tests green
- [ ] `bun run build` clean
- [ ] All 10 core plugins render identically (via runtime load)
- [ ] Sample user plugin installs + contributes UI without restart

---

## PHASE G — Binary compile + distribution (~3d, 6 commits)

### TG1 — feat(build): bun build --compile for 3 platforms
- [ ] Binaries for `bun-darwin-arm64`, `bun-linux-x64`, `bun-linux-arm64`
- [ ] Each <120MB
- [ ] Mac binary runs: `./dist/bakin-bun-darwin-arm64 start`
- [ ] Commit: `feat(build): bun build --compile for 3 platforms`

### TG2 — feat(cli): CLI commands in binary
- [ ] All spec commands implemented + exit codes match
- [ ] `bakin --help` complete
- [ ] Commit: `feat(cli): unify CLI commands into compiled binary`

### TG3 — ci(release): GitHub Actions release workflow
- [ ] `.github/workflows/release.yml` on `v*` tags
- [ ] Builds all 3 + SHA256 + uploads to GH release
- [ ] Commit: `ci(release): binary release workflow for 3 platforms`

### TG4 — feat(cli): bakin update self-replace
- [ ] Fetches latest release, verifies SHA256, atomic rename
- [ ] Refuses on mismatch
- [ ] Commit: `feat(cli): bakin update self-replacement with checksum verify`

### TG5 — chore(install): curl install script
- [ ] `install.sh` detects platform + installs
- [ ] Tested on Mac + Linux
- [ ] Commit: `chore(install): curl-able install script`

### TG6 — chore(install): Homebrew formula
- [ ] `madeinwyo/homebrew-tap` + `bakin.rb`
- [ ] `brew install madeinwyo/tap/bakin` works
- [ ] Commit: `chore(install): Homebrew formula for Mac`

### CHECKPOINT — Phase G boundary
- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green
- [ ] All 3 binaries under 120MB
- [ ] Mac arm64 binary: full end-to-end flow works
- [ ] Release workflow passes dry-run

---

## PHASE H — SDK npm publish (~2d, 4 commits)

### TH1 — chore(sdk): prep for npm publish
- [ ] `private: false`; fill metadata; complete `exports`
- [ ] `packages/sdk/README.md`
- [ ] `npm publish --dry-run` passes
- [ ] Commit: `chore(sdk): prep for npm publish`

### TH2 — chore(release): publish-sdk script
- [ ] `scripts/publish-sdk.ts` reads version, publishes with `--access public`
- [ ] Commit: `chore(release): publish-sdk script`

### TH3 — ci(release): wire SDK publish into workflow
- [ ] Release workflow publishes after binary upload
- [ ] Idempotent
- [ ] Commit: `ci(release): publish @bakin/sdk to npm on release`

### TH4 — feat(cli): bakin plugins scaffold
- [ ] Writes template with `@bakin/sdk` in devDependencies
- [ ] Scaffolded plugin installs + loads
- [ ] Commit: `feat(cli): bakin plugins scaffold command`

### CHECKPOINT — Phase H boundary
- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` green
- [ ] Test release tag publishes to npm
- [ ] Full author loop: scaffold → install → load → UI

---

## PHASE I — Cleanup + docs (~2d, 9 commits) — **POINT OF NO RETURN**

### TI1 — chore(cleanup): delete src/app/
- [ ] `rm -rf src/app/`
- [ ] `grep -rn "src/app/" --exclude-dir=node_modules` → zero
- [ ] Commit: `chore(cleanup): delete src/app/ (Next.js App Router tree)`

### TI2 — chore(cleanup): remove Next.js deps
- [ ] Remove `next`, `@types/next`, `eslint-config-next`
- [ ] `grep -n "next" package.json` → zero (outside test fixtures)
- [ ] Commit: `chore(cleanup): remove Next.js dependencies`

### TI3 — chore(tsconfig): drop Next.js config bits
- [ ] Remove `@/*` alias, Next plugin, `jsx: preserve`
- [ ] `grep -rn "'@/" src/ packages/ plugins/ tests/` → zero
- [ ] Commit: `chore(tsconfig): drop Next.js-specific tsconfig paths + plugin`

### TI4 — chore(eslint): update config for post-Next.js
- [ ] Drop `eslint-config-next` extends
- [ ] Update `no-restricted-imports` patterns
- [ ] Deliberate bad import triggers rule
- [ ] Commit: `chore(eslint): update config for Bun + post-Next.js tree`

### TI5 — docs(CLAUDE): rewrite sections
- [ ] Architecture, Directory Map, Plugin System, Testing Rules rewritten
- [ ] Zero Next.js/pnpm/webpack references
- [ ] Commit: `docs(CLAUDE): rewrite for Bun + binary architecture`

### TI6 — docs(authoring): rewrite plugin-authoring.md
- [ ] Source-only shipping + scaffold + dev + install commands
- [ ] Zero `dist/` maintenance burden on authors
- [ ] Commit: `docs(authoring): rewrite for source-only + build-on-install`

### TI7 — docs(knowledge): high-impact rewrites
- [ ] `.claude/knowledge/plugin-system.md`
- [ ] `.claude/knowledge/repo-architecture.md`
- [ ] Commit: `docs(knowledge): rewrite plugin-system.md + repo-architecture.md`

### TI8 — docs(knowledge): medium-impact edits (11 files)
- [ ] `storage-model.md`, `search-system.md`, `shared-ui-patterns.md`, `url-state-deep-linking.md`
- [ ] `workflows-plugin.md`, `tasks-plugin.md`, `messaging-plugin.md`, `memory-plugin.md`, `assets-plugin.md`, `team-plugin.md`, `health-plugin.md`
- [ ] All updated; zero stale framework refs
- [ ] Commit: `docs(knowledge): medium-impact edits across 11 files`

### TI9 — chore(cleanup): final sanity sweep
- [ ] Greps return zero: `from 'next/`, `from '@/`, `pnpm`, `webpack|turbopack`, `App Router`
- [ ] `bun x tsc --noEmit && bun x vitest run && bun run build` all clean
- [ ] Commit: `chore(cleanup): final sanity sweep`

### FINAL GATE — Phase I boundary
- [ ] `bun x tsc --noEmit` clean
- [ ] `bun x vitest run` — all 2984+ tests green
- [ ] `bun run build` produces all 3 binaries < 120MB
- [ ] All 10 core plugins render identically to pre-migration
- [ ] Sample user plugin installs + loads without restart
- [ ] All performance targets met (binary cold-start, TTFI, install time)
- [ ] All 13 spec acceptance criteria met
- [ ] CLAUDE.md + `docs/plugin-authoring.md` + 13 knowledge files rewritten
- [ ] Zero Next.js / pnpm / webpack / `@/*` references anywhere in src/packages/plugins

---

## Ship

- [ ] Merge branch into main (probably merge-commit; phased history is valuable)
- [ ] Tag as `v2.0.0` — push tag
- [ ] GitHub Actions runs release workflow
- [ ] Verify binaries on release page
- [ ] Verify `@bakin/sdk@2.0.0` on npm
- [ ] Update README with new install instructions
- [ ] Close #147

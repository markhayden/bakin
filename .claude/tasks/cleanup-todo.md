# Bakin Tech-Debt Cleanup — Checklist

**Spec:** `/SPEC.md` • **Plan:** `.claude/tasks/cleanup-plan.md` • **Branch:** `chore/tech-debt-cleanup`

Tick each box as the corresponding commit or action lands.

---

## Phase 0 — Branch setup

- [ ] `git checkout -b chore/tech-debt-cleanup`

## Phase 1 — Code cleanup (vitest still in place)

- [ ] **Commit 1** — `fix(doctor): drop Node fallback in openDoctorDb` (P-1)
  - stage the existing working-tree edit to `src/core/doctor.ts`
  - verify `bun x tsc --noEmit` exit 0
- [ ] **Commit 2** — `chore(antfly): remove beacon_* legacy table cleanup` (B-1, B-2)
  - edit `src/core/antfly.ts` (remove `LEGACY_TABLES`, `wipeLegacyTables()`, call site)
  - edit `tests/core/antfly.test.ts` (remove beacon-tables test)
  - verify: `grep -in beacon src/core/antfly.ts tests/core/antfly.test.ts` empty
- [ ] **Commit 3** — `test: rename beacon_legacy fixture to external_legacy` (B-3)
  - edit `tests/core/search-migration.test.ts` line 127
- [ ] **Commit 4** — `chore(tasks): delete 2.1.0 position→order migration + confirmed fallback` (S-1, S-2, S-3, D-8, D-10)
  - `rm plugins/tasks/migrations/2.1.0.ts`
  - `rmdir plugins/tasks/migrations/`
  - edit `plugins/tasks/index.ts` (remove migration runner wiring — investigate)
  - `rm tests/plugins/tasks/migration.test.ts`
  - edit `plugins/tasks/lib/flow-store.ts` (drop `confirmed` field + fallback)
- [ ] **Commit 5** — `chore(dev): port imitation-crab seed to bun:sqlite` (S-4, S-5)
  - edit `dev/imitation-crab/seed.ts` (bun:sqlite import, drop try/catch)
  - edit `scripts/build-plugins.ts` comment
  - verify: `bun run mock:seed --force` runs clean
- [ ] **Commit 6** — `refactor(core): drop MCPlugin/MCConfig deprecated aliases` (D-1, D-2, D-3, D-4)
  - edit 4 files (plugin-types + 3 re-export barrels)
- [ ] **Commit 7** — `refactor(settings): drop legacy antfly.embedder field` (D-5, D-6)
  - edit `packages/core/src/settings.ts` (type field + getSettings migration block)
- [ ] **Commit 8** — `refactor(dispatch): drop legacy numeric FailureRecord format` (D-11, D-12)
  - **shell first:** `rm ~/.bakin/.dispatch-state.json`
  - edit `src/core/dispatch.ts` (narrow type + simplify getFailureRecord)
- [ ] **Commit 9** — `refactor(taskboard): drop src/lib/taskboard.ts re-export shim` (D-14)
  - edit `src/core/agents.ts` (static import)
  - edit `src/core/dispatch.ts` (3 dynamic imports: lines 142, 316, 872)
  - edit `src/core/continuation.ts` (1 dynamic import)
  - `rm src/lib/taskboard.ts`

## Phase 2 — Test runner migration (strict order)

- [ ] `bun add -d @happy-dom/globalregistrator` (lockfile change bundled into commit 13)
- [ ] **Commit 10** — `chore(test): introduce bunfig.toml + happy-dom setup` (T-1, T-2, T-3)
  - new `bunfig.toml` at repo root
  - rewrite `tests/setup.ts` to bun:test + happy-dom
- [ ] **Dry-run 3 representative files before scripting commit 11:**
  - [ ] `tests/core/main-agent.test.ts` (vi.unmock, vi.resetModules, vi.hoisted)
  - [ ] `tests/components/kanban-dnd.test.tsx` (vi.stubGlobal, vi.importActual)
  - [ ] `tests/core/dispatch.test.ts` (vi.useFakeTimers, vi.advanceTimersByTime)
- [ ] **Commit 11** — `chore(test): migrate all test files from vi.* to bun:test` (T-4, T-5, T-6, T-7, T-8)
  - run `scripts/migrate-vi-to-bun.ts` (one-shot)
  - manual pass on fake-timer files (8), stubGlobal files (11), resetModules files (21)
  - verify: `grep -rn "\bvi\." tests/` empty; `bun test` green
  - delete the one-shot script (keep out of commit)
- [ ] **Commit 12** — `chore(test): drop vitest + bun:sqlite shim + switch scripts to bun test` (T-9, T-10 decision, T-11, T-12, T-16)
  - `rm tests/shims/bun-sqlite.ts`
  - `rm vitest.config.ts`
  - edit `package.json` scripts (`"test": "bun test"`, etc.)
  - edit `.github/workflows/ci-pr.yml` line 41
  - edit `.github/workflows/ci-main.yml` line 38
  - **T-10 decision:** run `bun test tests/components/kanban-dnd.test.tsx` — if green without tanstack shim, `rm tests/shims/tanstack-router.ts`
- [ ] **Commit 13** — `chore(deps): remove vitest + better-sqlite3 + trustedDependencies` (T-13, T-14, T-15)
  - edit `package.json` (remove 4 deps; remove trustedDependencies array)
  - `bun install` (regenerates bun.lock)
- [ ] **Commit 14** (conditional) — `chore(lint): update config for bun:test ruleset` (T-17)
  - only if `bun run lint` fails after commit 13

## Phase 3 — Docs + archival cleanup

- [ ] **Commit 15** — `docs(knowledge): refresh active docs for removed concepts` (K-1…K-13)
  - 13 files; parallelizable (§3 of plan)
  - check K-7 pre-flight: does `CONTENT_DIR` still work in content-dir.ts?
- [ ] **Commit 16** — `chore(docs): delete merged-issue plan/todo pairs` (A-1…A-17)
  - `rm` 17 files in `.claude/tasks/`
- [ ] **Commit 17** — `chore(docs): delete specs/done/ archive` (A-18…A-26)
  - `rm -rf .claude/specs/done/`
- [ ] **Commit 18** — `chore(docs): delete top-level specs for shipped features` (A-27…A-43)
  - `rm` ~40 files in `.claude/specs/`
  - `rmdir .claude/specs/` if empty
- [ ] **Commit 19** — `docs: update README/CLAUDE/CONTRIBUTING for bun test runner` (T-18)
  - edit 3 top-level docs (replace `bunx vitest *` with `bun test *`)

## Phase 4 — Runtime + memory (non-repo)

- [ ] **R-1 + R-2** — runtime beacon cleanup (no commit)
  - `rm -f ~/.bakin/docs/BEACON-MCP-MIGRATION-PLAN.md`
  - `find ~/.openclaw -iname beacon -exec rm -rf {} +`
- [ ] **M-1…M-6** — user-memory scrub (no commit)
  - `rm ~/.claude/projects/-Users-main-operator-go-src-github-com-markhayden-bakin/memory/project_beacon_skill_rename.md`
  - edit `project_content_migration.md` (`~/.beacon/` → `~/.bakin/`)
  - edit `project_assets_plugin.md` (same)
  - edit `project_scripts_architecture.md` (`beacon_exec_` → `bakin_exec_`)
  - edit `feedback_globalthis_sse.md` (Next.js webpack → Bun HMR rationale)
  - edit `MEMORY.md` index (drop beacon entry, fix descriptions)

## Phase 5 — Verification (no commit)

Run the §9 suite from the plan. Paste results into the PR body.

- [ ] §4-1: beacon grep empty
- [ ] §4-2: better-sqlite3 grep empty
- [ ] §4-3: @deprecated grep empty (in scoped paths)
- [ ] §4-5: `vi.` grep empty in tests/
- [ ] §4-6: `from 'vitest'` grep empty
- [ ] §4-7: `bun x tsc --noEmit` exit 0
- [ ] §4-8: `bun run lint` exit 0
- [ ] §4-9: `bun test` green
- [ ] §4-10: `bun test --coverage` emits artifacts
- [ ] §4-11: `bun run build` + server smoke test
- [ ] §4-12: `~/.bakin/` + `~/.openclaw/` beacon-free
- [ ] §4-13: user-memory beacon-free
- [ ] §4-14: `.claude/specs/done/` gone
- [ ] §4-15: `.claude/tasks/issue-*` gone

## Phase 6 — PR

- [ ] `git push -u origin chore/tech-debt-cleanup`
- [ ] `gh pr create --title "chore: tech-debt cleanup pass" --body "<verification log>"`
- [ ] Self-merge after CI green (`bun test` + `bun run lint` + `bun x tsc --noEmit`)

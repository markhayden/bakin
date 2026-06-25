---
title: Layered Context Blocks & Agent Sync — Implementation Plan
spec: ./layered-context-and-agent-sync.md
issues: [401]
status: ready-for-review
---

# Plan: Layered Context Blocks & Agent Sync

Companion to `.claude/specs/layered-context-and-agent-sync.md`. Three PRs in
bakin (mechanism → UI → none; docs fold into each), then content PRs in
bakin-bits-official / -private / in-repo `agents/`, then the one-time live
migration on this machine.

## Commit strategy & rollback checkpoints

Every commit below is independently green (`bun run test` passes, server
boots) and is a rollback point. Commits are ordered so that **new code lands
before old code is deleted**, and deletions are isolated in their own commits
(C7, C8) so a revert restores the old mechanism without touching the new one.
The live `~/.bakin` is never migrated until Phase E — every prior phase is
exercised only against temp-dir tests, so `git revert` is always sufficient
rollback (no data rollback needed until E, which is explicitly confirmed and
preceded by a tarball backup of the affected workspace files + lockfile).

```
PR 1 (mechanism)                          PR 2 (UI)              Content repos
C1 composer (pure)                        C10 health repair UI   P1 bits-official
 └─ C2 lockfile v2 + state collapse       C11 team pages + ──────┤ P2 bits-private
     └─ C3 layered context + hook              agent detail      │ P3 in-repo agents/
         └─ C4 expected-state/drift core  C12 graph badges       └─ Phase E: live
             └─ C5 sync engine + projector rewrite                  migration run
                 └─ C6 migration module
                     └─ C7 doctor check swap + delete agent-rules
                         └─ C8 CLI swap (sync verbs, deletions)
                             └─ C9 REST + live reload + docs
```

Conventional-commit scopes: `feat(agent-packages)`, `feat(team)`,
`feat(health)`, `refactor(core)`, `docs(knowledge)`.

---

## PR 1 — mechanism: composition, sync, doctor, CLI, API

### C1 — `feat(agent-packages): pure managed-block composer`

New `packages/core/src/agent-packages/composer.ts`. Pure, deterministic;
no I/O. Builds the single `bakin:managed` block per file from resolved layer
inputs.

- **T1.1** `composeManagedBlock(file, inputs)` — recipes per spec: AGENTS.md =
  global + team + package; SOUL.md = package + lesson catalog + enabled lesson
  bodies; IDENTITY/TOOLS = package. Omits absent layers. Emits provenance
  comment + `<!-- bakin-section: ... -->` separators. Stable ordering and
  formatting (same inputs → identical bytes).
- **T1.2** `composeFileContent(existing, block)` — inject/replace the block in
  a file body via existing `managed-blocks.ts` primitives; preserve all
  content outside markers.
- **T1.3** Unit tests `tests/agent-packages/composer.test.ts`: determinism
  (sha equality), each recipe, unmanaged recipe (global+team only), empty
  layers, replacement preserves outside content, lesson toggle recomposition.
- **Acceptance:** new module has zero imports from `src/` (core package
  purity); all recipes byte-stable. **Verify:** `bun test
  tests/agent-packages/composer.test.ts --isolate`; full suite green.

### C2 — `refactor(agent-packages): lockfile v2 + managed-only agent state`

- **T2.1** Lockfile schema: workspace-file `ProjectionEntry` gains
  `composedSha` + `inputs` ({packageSha, globalSha?, teamSha?, lessonsSha?});
  drop `templateOnly` and `lesson-marker` projection kinds from the schema
  (writer side; reader tolerates old shape until migration rewrites it).
- **T2.2** `agent-state.ts`: `AgentState = 'absent' | 'unmanaged' | 'managed'`;
  `PackageEntry.state` collapses (type + all consumers: list API, team UI
  badge enum, CLI list output). `--adopt` remains an install-time flag only.
- **T2.3** Update `lockfile.test.ts`, `agent-state` tests; sweep for `adopted`
  string literals (`grep -rn "'adopted'"`).
- **Acceptance:** type-checks across repo; no consumer references `adopted` as
  a persisted state. **Verify:** full suite + `bun run build` type pass.

### C3 — `feat(core): layered team context files + membership hook`

New `src/core/team-context.ts` (app-side; file I/O under `~/.bakin/team/context/`).

- **T3.1** Paths + readers: `global.md`, `<teamId>.md`; absent file → empty
  layer. Effective-content reader returns full file text (user area + inner
  managed block).
- **T3.2** Default-rules module: relocate `ORCHESTRATOR_RULES_CONTENT` →
  `src/core/team-context-defaults.ts` with a content version; `seedGlobalContext()`
  (create-if-missing) and `refreshGlobalManagedBlock()` (rewrite inner
  `bakin:managed` block only, never user area).
- **T3.3** Team membership via HookRegistry (per plugin-communication rule):
  team plugin registers `team.membership` (agentId → teamId|null) in
  `activate()`; core invokes with graceful empty fallback.
- **T3.4** Tests: seeding, refresh-preserves-user-area, membership hook
  fallback. Standard content-dir/OpenClaw mocks.
- **Acceptance:** `src/core/agent-rules/` untouched (still alive — deletion is
  C7); global.md round-trips user edits. **Verify:** new tests + full suite.

### C4 — `feat(agent-packages): expected-state derivation + drift scanner core`

New scanner producing the spec's finding model; pure given resolved inputs.

- **T4.1** `deriveExpectedBlock(agentId, file)` — resolve inputs (installed
  source template, lockfile `lessonsEnabled`, global/team content, membership
  hook) → composed expected content + per-input shas.
- **T4.2** `scanAgentSync()` — per agent+file block findings (missing-block /
  stale with input attribution), skills/assets (missing / drifted /
  userEdited / broken-marker), global.md inner block vs shipped defaults,
  missing source dirs, pre-migration detection ("no managed block + legacy
  lockfile shape" → `migration-needed`).
- **T4.3** Tests: each finding type on temp fixtures; attribution correctness
  (edit global.md → only `global` input flagged).
- **Acceptance:** scanner is read-only (no writes in any code path).
  **Verify:** new tests + full suite.

### C5 — `feat(agent-packages): sync engine, receipts, projector rewrite`

The core slice. New `src/core/agent-packages/sync.ts` + receipts; projector
loses all template carve-outs.

- **T5.1** Projector rewrite: one composition path — workspace files always
  get the composed block via `runtime.writeWorkspaceFile()` (replace block in
  existing content; create file if absent). Delete fresh/adopt/update
  workspace carve-outs, `refreshTemplate` option, per-lesson block injection,
  workspace `.userEdited` checks (sentinels remain for skills/assets only).
- **T5.2** `syncAgent(agentId, {check, reclaim})` per spec sequence: fetch
  (managed only) → update installed source (reuse updater fetch/compare) →
  recompose all blocks (managed: 4 files; unmanaged: AGENTS.md only) →
  re-project skills/assets honoring sentinels → verify via C4 scanner →
  receipt + audit. `--check` = fetch + scan only, zero writes.
- **T5.3** Receipts: schema per spec; write
  `~/.bakin/packages/receipts/<agentId>.json` (latest only); add path to
  `getBakinPaths()`.
- **T5.4** `lesson-toggle.ts` rewrite: update `lessonsEnabled` in lockfile →
  recompose SOUL.md block. Delete block-surgery code.
- **T5.5** Reclaim: clear sentinel(s) for given paths (or all), then
  re-project those files; receipt records reclaimed entries.
- **T5.6** Update installer to project via the new path (fresh install =
  compose + write); update uninstaller (block removal via `removeBlock`,
  drop lesson-marker unprojection).
- **T5.7** Tests: rewrite `projector.test.ts`; new `sync.test.ts`
  (full sequence on temp fixture incl. unmanaged agent, `--check` no-mutation
  guarantee, sentinel skip + reclaim, receipt shape); update
  `installer.test.ts`, lesson tests.
- **Acceptance:** spec criteria 5 + 6 hold in tests; updater's
  `refreshTemplate` no longer referenced. **Verify:** full suite; manual
  smoke against dockerized rig or `dev:mock` (install fixture agent → sync →
  inspect files/receipt).

### C6 — `feat(agent-packages): one-time migration module`

- **T6.1** `migrateToManagedBlocks()`: seed global.md (C3) → per runtime
  agent: managed = full-overwrite 4 workspace files with composed content;
  unmanaged = inject/replace AGENTS.md block only (also: remove legacy
  `managed-context` block + orphaned `bakin:lesson:*` / `lesson-catalog`
  blocks when writing the new one) → rewrite lockfile (state collapse,
  projection shape v2, drop lesson-marker entries) → remove workspace
  `.userEdited` sentinels → audit + migration receipts.
- **T6.2** Pre-migration tarball backup of affected workspace files +
  lockfile to `~/.bakin/.backups/` (reuse plugin-teardown backup pattern).
- **T6.3** Gate: exposed as confirmed action only (doctor repair item with
  `requiresConfirmation`, CLI prompt on first `sync` when `migration-needed`,
  `--yes` for non-interactive).
- **T6.4** Tests on fixture workspaces: managed, unmanaged-with-legacy-rules-
  block, legacy adopted entry; idempotency (second run = no-op).
- **Acceptance:** migration never runs implicitly; idempotent. **Verify:**
  new tests + full suite.

### C7 — `refactor(core): team.agent-sync doctor check; delete agent-rules`

Swap commit — new check in, three old checks + old module out.

- **T7.1** `plugins/team/lib/health-checks.ts`: `team.agent-sync` check over
  C4 scanner; repair handler — `safe` items: recompose stale blocks +
  re-project non-sentineled files + refresh global.md inner block;
  `requiresConfirmation` items: migration, reclaims. Severities per spec.
- **T7.2** Delete `team.agent-assets`, `health.orchestrator-rules`,
  `health.managed-blocks` registrations + their check code.
- **T7.3** Delete `src/core/agent-rules/` entirely (content already relocated
  in C3). Sweep imports (`grep -rn "agent-rules"`).
- **T7.4** Onboarding component rename `agent-assets` → `agent-sync`
  (component name, `COMPONENT_ORDER`, scan rewrite over C4 scanner; `install()`
  = safe repair).
- **T7.5** Tests: health-check tests via `tests/plugins/test-helpers.ts`;
  repair plan/apply round-trip; doctor run includes new check.
- **Acceptance:** doctor cycle does zero network I/O (scanner audit);
  no references to deleted modules. **Verify:** full suite +
  `bakin doctor --full` against dev rig shows `team.agent-sync`.

### C8 — `feat(cli): agents/packages sync verbs; delete legacy commands`

- **T8.1** `bakin agents sync [id] [--check] [--reclaim <path>|--reclaim-all]
  [--yes]` → POST `/api/agent-packages/{id}/sync` (C9 lands the route in the
  same PR; wire CLI to the core engine through the existing HTTP-client
  pattern). No id = all agents (managed + unmanaged AGENTS.md maintenance).
  Receipt rendered human-readable; `--json` for raw.
- **T8.2** Delete `bakin agents update`, `cmdAgentPackagesUpdate`,
  `bakin agent-rules` (case + help text). Rename `bakin packages update` →
  `sync` (same engine, packs scope).
- **T8.3** `bakin check agent-sync` / `bakin install agent-sync` dispatch +
  help text updated (lines ~4471–4487 region).
- **T8.4** Update CLI help/docs strings; sweep `grep -rn "agents update\|agent-rules\|refresh-template"`.
- **Acceptance:** old verbs exit with unknown-command (no aliases).
  **Verify:** CLI integration tests; `bakin --help` reflects new surface.

### C9 — `feat(api): sync/receipt/team-context routes + live reload + PR1 docs`

- **T9.1** Routes: `POST /api/agent-packages/{agentId}/sync` (replaces
  `/update` — delete it), `GET /api/agent-packages/{agentId}/receipt`; team
  plugin: `GET/PUT /api/plugins/team/context/{global|teamId}` (PUT writes
  user area only; managed block rejected), `POST
  /api/plugins/team/teams/{teamId}/sync`.
- **T9.2** Live reload after any sync/migration: re-run
  `loadAgentPackageSources()`, export + call `clearSkillCache()`
  (`plugins/workflows/lib/skill-loader.ts:33`), SSE broadcast so open UIs
  refresh. Receipt notes reload result (spec criterion 7).
- **T9.3** Route tests via test-helpers; reload test (sync → registry
  reflects new skill without rebuild).
- **T9.4** Docs for the mechanism: rewrite `.claude/knowledge/agent-packages.md`
  (projection/update/states), add layered-context coverage (new
  `.claude/knowledge/layered-context.md`), update
  `.claude/knowledge/doctor-and-health-checks.md`,
  `docs/agent-packages-authoring.md`, `CLAUDE.md` (Agent Packages section, CLI
  list, Key Patterns agent-rules entry), README sweep
  (`grep -n "agents update\|agent-rules" README.md`).
- **Acceptance / checkpoint (end of PR 1):** full suite green; dev-rig smoke:
  install → edit global.md → doctor flags → `bakin agents sync` → doctor
  clean → receipt accurate; no restart needed for skill changes.

---

## PR 2 — UI: health repair, team pages, graph

### C10 — `feat(health): generic repair flow in Health UI`

- **T10.1** Repair button on repairable failing checks → modal (Dialog from
  `@makinbakin/sdk/ui`): renders plan items (title, reason, safety, changes)
  from `GET /doctor/repair/plan`; `requiresConfirmation` items individually
  checkbox-confirmed; apply via `POST /doctor/repair/apply`; results view.
- **T10.2** Component tests where practical; manual verification via
  dev rig + Playwright MCP (browser-testing skill) on a seeded failing check.
- **Acceptance:** spec criterion 2; destructive items cannot be applied
  without explicit per-item confirmation.

### C11 — `feat(team): team detail pages, global pseudo-team, agent sync UI`

- **T11.1** New slot `page:/team/teams/[teamId]` (+ nav from drawer/graph):
  header, members with sync badges, shared-context editor (user area
  editable; managed block read-only with provenance), "Sync team" → combined
  receipt view.
- **T11.2** Global pseudo-team entry (same component, `global.md`, members =
  all agents) pinned above team list.
- **T11.3** Agent detail (`agent-detail.tsx`): sync status badge (doctor
  cache + on-demand check), "Check for updates" / "Sync" actions, "Last
  synced — view receipt" panel. Remove `adopted` badge handling.
- **T11.4** URL-state rules respected (`useQueryState`, Suspense); all data
  via plugin routes from C9.
- **Acceptance:** spec criteria 3 + 8 demonstrable from the UI alone (no CLI).
  **Verify:** Playwright walkthrough: edit team context → member shows stale
  → Sync team → receipts → clean.

### C12 — `feat(team): graph context/staleness indicators`

- **T12.1** `build-graph.ts`: team nodes get context indicator (icon + stale
  member count); agent nodes get stale-sync dot; click-through to detail
  pages.
- **T12.2** Checkpoint (end of PR 2): full suite + visual verification;
  docs touch-ups for UI surfaces (knowledge team/health pages sections).

---

## Content repos (after PR 1+2 merge)

### P1 — bakin-bits-official: restructure + content diet

- **TP1.1** Per kit (jessica, pixel, patch, rolo): strip global/team-class
  rules from `workspace/AGENTS.md` (they now arrive via layers); dedupe
  across SOUL/IDENTITY/TOOLS; trim to imperative bullets; big reference
  content → lessons (opt-in defaults reviewed). Templates stay plain
  markdown (no markers).
- **TP1.2** Bump kit versions; CONTRIBUTING/authoring notes for the slimmed
  shape.
- **Verify:** install each kit into the dev rig → sync → composed AGENTS.md
  contains layer content exactly once; composed sizes reported in receipts
  compared before/after (expect significant reduction).

### P2 — bakin-bits-official-private: same pass for its kits.

### P3 — bakin (in-repo `agents/` reference packages): same pass
(basil, jessica-fetcher, nemo, patch, pixel, rolo, scout, zen) + fixture
updates if tests reference template shapes.

Draft global.md / team context starter content (what got stripped from kits,
de-duplicated) is produced during P1 and committed as authoring-doc examples —
the live files are user-owned and seeded at migration.

---

## Phase E — live migration (this machine, explicitly confirmed)

1. `bakin update` to the built binary; restart.
2. Confirm backup: tarball written by migration (T6.2) — verify before
   proceeding past prompt.
3. Run migration via `bakin agents sync --yes` prompt path; then full
   `bakin agents sync`.
4. Populate global/team context: move the user's actual shared rules into
   `global.md` / team files (using P1 starter content as the base), assign
   teams in UI, sync again.
5. `bakin doctor --full` clean; spot-check pixel + main workspace files;
   verify graph/team pages.

Rollback for E: restore tarball + lockfile backup, revert binary via brew.

---

## Risks & mitigations

- **Projector rewrite blast radius (C5):** largest commit; mitigated by C1–C4
  landing pure logic + tests first, and by keeping C5 mechanical (delete
  carve-outs, call composer). Old behavior recoverable by reverting C5–C9.
- **Hook-based membership in core (C3):** if HookRegistry ordering at boot is
  an issue (sync before team plugin activates), fallback = empty membership →
  team layer omitted; doctor would flag stale blocks next cycle, self-healing.
- **Unmanaged-agent writes:** all writes go through
  `runtime.writeWorkspaceFile()` (adapter boundary intact); main agent's
  AGENTS.md outside-block content is preserved by block replacement — covered
  by dedicated tests (T6.4).
- **Test-suite churn:** ~6 existing test files rewritten; budgeted inside C5/C7.

## User stories (approved 2026-06-10 — verification targets for PR 2 / E)

1. **"Did my update take?"** Agent detail → Check for updates shows a
   pre-apply preview of what changed (diff fetched source vs current inputs)
   → Sync → receipt ends with verification line ("all projections match
   expected ✓ · changes live, no restart needed"). Receipt persists.
2. **Team rules edit:** Team detail → edit user area (managed block visibly
   read-only) → members show stale + graph amber dot → explicit "Sync team"
   (NO auto-sync on save) → combined receipt → doctor green.
3. **Passive safety net:** botched/stale state → doctor flags within a cycle
   → Health page Repair… modal (plan items, safety labels) → apply → green.
   Repair and sync share one engine; receipts identical from both doors.
4. **Oopsy/sentinel:** sync receipt lists user-edited skips with preserved-
   work message + exact reclaim command/button; reclaim asks one explicit
   confirm, then re-projects.
5. **Post-upgrade migration:** doctor flags migration-needed per agent;
   confirm (UI or first `sync` prompt) → backup → migration receipts →
   global.md seeded → doctor green.

## Verification matrix (gates every commit)

- `bun run test` (full, with path-ignore) green.
- `bun run build` type/build pass.
- Architecture tests pass (no deleted-module imports; adapter boundary).
- New tests follow CLAUDE.md testing rules (content-dir + OpenClaw mocks,
  cleanup, logger/watcher mocks).
- End-of-PR checkpoints: dev-rig smoke (PR 1), Playwright walkthrough (PR 2),
  per-kit install verification (P1–P3), doctor-clean (E).

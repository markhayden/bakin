# Plan: Audit Follow-Up — close the gaps the 2026-06 refactor left

**Date:** 2026-07-01 · **Re-verified:** 2026-07-03 against post-#457 main (the antfly-zig search
migration, 139 commits) — every item re-checked; deltas folded in below. · **Predecessors:**
`SPEC.md` (root), `.claude/specs/audit-2026-06/REPORT.md`, `tasks/plan.md` (WS5/6/7 status),
`tasks/plan-ws{1..4}-*.md`, `tasks/plan-fix-security.md`.
**Method:** 7 parallel verification agents re-audited every workstream's claims against current main
(post PR #580 / rc.20). Every claim below was verified in code with file:line evidence, not from
the plan docs' checkmarks.

**#457 impact summary:** the search migration created no new god-files (largest new module 427
lines) and no new test-size violations; it deleted `search-reconcile.ts` and
`scripts/backfill-manifests.ts` (shrinking two FW6 items), grew `cli/bakin.ts` (4,278 → 4,413),
`plugins/health/components/health-page.tsx` (1,012 → 1,137), and `plugins/assets/index.ts`
(744 → 913, now over the SPEC threshold — added to FW5), added a 4th duplicate sharp loader,
obsoleted the re-deferred search-registry micro-cleanups, and its T24/F5 doc sweeps fixed the
search-side doc staleness while leaving the registry/dispatch staleness intact (FW8 revised).

## Verification scoreboard — what actually landed

| Workstream | Verdict |
|---|---|
| fix/security (6 items) | ✅ ALL DONE (4 small hardening residuals below) |
| WS1 contract-types | ✅ DONE per the revised (approved) two-tier design; 2 residuals |
| WS2 core-extractions | ◧ PARTIAL by design — the **boundary work never landed** (item 2 + guards) |
| WS3 sdk-gaps | ◧ Primitives all exist + tested; **adoption partial** (8 fetch effects, 1 formatter dup, 1 modal) |
| WS4 cli | ❌ **STALLED at Part 3** — cli/bakin.ts still 4,278 lines; B5.3/B6/B7/docs never done |
| WS5 core-splits | ✅ DONE except **upgrade.ts split never happened** (still 895 lines, one file) |
| WS6 plugin-splits | ◧ DONE for tracked files, but **task-detail-dialog (1,033) + node-config-drawer (976) were silently dropped** from plan.md; health-page section split deferred (1,012); team split created a new 1,047-line god-routes-module |
| WS7 tooling | ◧ docs-generate + CORE_PLUGINS/externals done; dir-walker, orphan scripts, embedded-assets escaping, imitation-crab prod gate all open |
| Phase 4 (tests + docs sweep) | ❌ **NEVER RAN** — no doc touched since 2026-06-17 while refactors landed through 06-24; all 4 test god-files intact |
| 7 incidental correctness bugs | ✅ ALL FIXED (verified individually) |
| 28 P2 findings | 10 fixed · 1 obsolete · 6 partial · **11 still open** |

**SPEC success criteria still unmet (re-confirmed 2026-07-03):** (1) two-CLI consolidation;
(2) "no test file over ~1,200 lines" — five violate (1,954 / 1,606 / 1,443 / 1,374 / 1,212,
unchanged by #457); (3) "no source file over ~800 lines without recorded justification" — ~9
unjustified (cli/bakin 4,413 · health-page 1,137 · team-routes 1,047 · task-detail-dialog 1,033 ·
node-config-drawer 976 · assets/index 913 · models/index 896 · upgrade 895 · install 788-adjacent);
(4) "docs accurate" — repo-architecture.md, plugin-system.md, and dispatch.md still contain
concretely wrong paths/descriptions (the #457 doc sweeps fixed only the search/asset docs).

**Barrel hygiene held** (dispatch, search-registry, asset-service, workflows/runtime all still pure
re-export barrels) and the four security-invariant P2s are structurally fixed. The foundation is
good; what's left is the stalled tail plus items that fell off tracking.

---

## Workstreams

Dependency-ordered. Same rules as before (SPEC §7): branch + PR per workstream, one revertable
commit per finding/file, every commit green on `bun run test` + `bun run typecheck`, binary-graph
changes get `bun run build`, behavior changes get the dockerized rig. **New rule enforced this
round (SPEC §8 was violated last round): docs ride in the same PR as the change they describe.**

### FW1 `fix/guards-and-correctness` — small, high-value, land first

Verified correctness/hardening gaps. One commit each.

1. **Tasks MCP guard gap.** REST routes guard every mutation via `taskEditGuard`
   (`plugins/tasks/lib/routes.ts:170,279,327,352`); the exec tools guard ONLY `update`
   (`plugins/tasks/lib/exec-tools.ts` — one call). Agents can move/complete/block/delete/assign
   past the guard. Apply the guard uniformly + tests.
2. **Tasks identifier-fallback divergence.** `routes.ts:166` falls back to `body.originalTitle`,
   `:204` to `body.title`. Unify into one resolver in `lib/edit-guard.ts` (or sibling) + test.
3. **submit_step error-message classification.** `plugins/workflows/lib/exec-tools.ts:240,277`
   classifies by `msg.includes('near-duplicate')` and `stepId.includes('gate')` — the exact
   pattern CLAUDE.md bans for dispatch. Replace with a typed result/discriminant from the engine.
4. **Workflow instance-store durability.** `plugins/workflows/lib/instance-store.ts:40,90` uses
   plain `writeFileSync` for engine state (crash = corrupt instance). Move to
   `atomicWriteJson`; convert the `require('fs')` at `:54` (+ `lib/skill-loader.ts:143`) while there.
5. **Settings strip-on-write.** `updateSettings` (`packages/core/src/settings.ts:464`, deepMerge
   at :402) deep-merges arbitrary keys — a POST can re-admit `search.settings.auth.password`,
   served unredacted until next boot re-runs the migration. Strip/deny secret-bearing paths on
   write + test.
6. **Images idempotency allowlist.** `plugins/images/lib/idempotency.ts:147-153` strips a
   denylist (`prompt`, `providerText`); a future content field leaks silently. Convert
   `coordinationOnly()` to an allowlist (assetId/version/dims/provider/model/promptHash/op/ok) + test.
7. **Cloned-dist freshness race.** `user-plugin-builder.ts:215-223` uses `oldestDist >= newestSource`;
   a same-ms tie after `cpSync` can execute attacker-shipped dist bytes on a github install.
   `rmSync` the cloned `dist/` before non-artifact builds (or strict `>`).
8. **Missing mandated test mock.** `tests/plugins/tasks/routes.test.ts:29` mocks only
   `src/core/content-dir` — the `packages/core/src/content-dir` mock (CLAUDE.md-mandated, flagged
   by the original audit) is still absent. Add it; sweep tests/ for other single-mock files.
9. **Type re-drift guard.** `plugins/tasks/types.ts:12` `Task` is an unannotated near-copy of the
   storage shape that already drifted (missing `version`). Annotate-or-rederive it, then add a
   `tests/architecture/` scanner pinning the two-tier type names (PluginContext, BakinPlugin,
   ExecToolDefinition, Task, WorkflowInstance, HealthCheckResult…) to their sanctioned
   declaration files so forks fail CI.
10. **Tiny dedups adjacent to the above:** `plugins/workflows/lib/health-checks.ts:49` raw
    frontmatter regex → `parseFrontmatter`; mcporter's hand-rolled `fixed()` → `healthFixed`;
    delete schedule's dead settings keys (`maxConcurrentJobs`/`failureCooldownMs`,
    `plugins/schedule/index.ts:56-57`) and the unreachable `f === 'name'` ternary
    (`lib/exec-tools.ts:129`).

**FW1 STATUS — ☑ DONE (2026-07-03, branch `fix/guards-and-correctness`, 10 commits, one per item).**
All ten items landed as specified, with these verification-driven refinements:
(1) took the true REST-parity shape — assign + set_dependency gained the guard, update gained
`expectedVersion`; move/complete/block/delete exemptions are deliberate and now documented in the
exec-tools header. (3) the near-duplicate text-match turned out to be dead code (completeStep
returns, never throws) — replaced with a typed `code: 'rejection_repeat'` on CompleteStepResult;
check_gates now classifies by definition step type. (5) settings writes RELOCATE the password to
the secret store (migration parity), not just strip. (7) took both belts: strict `>` in the
freshness check AND rm of the copied dist on source installs; regression test plants attacker
bytes behind an mtime tie. (8) the sweep found the mock gap in **42** files, not 1 — all fixed,
full suite green. (9) re-derived via type-only re-exports (client bundle verified clean of the
server module) + `tests/architecture/type-single-home.test.ts` pins 11 contract types to their
sanctioned homes. Gates: full suite 5,301-0, typecheck, binary build (stamps reverted).
Note: `bun run lint` currently fails on PRE-EXISTING #457 files (adapter-antfly/translate,
search-outbox, memory, assets/search-doc unused vars) — not touched by this branch; fix belongs
to the search-migration follow-up.

### FW2 `refactor/cli-part3` — finish WS4 (the stalled biggest win)

Resume `tasks/plan-ws4-cli.md` at B5.3. cli/bakin.ts is 4,413 lines — and growing: the search
migration added to it, which is the cost of every deferral month. B1–B5.2 landed (#503+), the
fragile remainder did not. Scope:

- **B5.3** — per-scope command modules under `src/cli/commands/` (or `src/core/cli/commands/`),
  lifecycle module, move the top-of-file static server-core imports into command modules,
  slim `cli/bakin.ts` to a router. Keep the load-bearing contracts (plan-ws4 §"Load-bearing"):
  `main()` export + `import.meta.main`, `process.exit` semantics, lazy heavy deps, dynamic
  bakin.ts ↔ src/core/cli.ts edge.
- **emit() dispatcher** — collapse the ~95 inline isTTY/plain/json branches.
- **Help-registry-driven dispatch** — fixes the still-open P2 #7: `src/core/cli/registry.ts:150-151`
  advertises `agent-assets` while dispatch accepts `agent-sync` (`cli/bakin.ts:4183`), and
  plugin-contributed commands are invisible in help.
- **B6** — wire or retire the zero-caller framework (`src/core/cli/{runner,parser,options,result}.ts`).
- **B7** — extract the ×10 copy-pasted TTY harness into `tests/cli/helpers/tty-cli-harness.ts`;
  split `readonly-commands.test.ts` (1,443) along source seams.
- **Docs in-PR:** CLAUDE.md CLI section + repo-architecture.md.
- **Gate:** dockerized-rig E2E on the binary + npm-bin surfaces (exit codes, help, delegation).

**FW2 STATUS — ☑ DONE (2026-07-04, branch `refactor/cli-part3`, 26 commits).**
The stalled WS4 remainder is finished:
- **B5.3:** cli/bakin.ts **4,413 → 209 lines** — 17 gated commits extracting `src/cli/help.ts` +
  17 per-scope modules under `src/cli/commands/` (largest: lifecycle 907, plugins 690, doctor 547).
  All four load-bearing contracts verified (main()/import.meta.main, process.exit semantics, lazy
  heavy deps, dynamic bakin↔core-cli edge). Binary rebuilt + smoked: help/version exit 0, unknown
  command + unreachable-server exit 1, delegation works.
- **Help-registry drift (P2 #7):** registry now advertises `agent-sync` (dispatch parity); the same
  stale hint fixed in team's package-card; plugin-contributed `cliCommands` now appear in TTY help
  and non-TTY usage (degrading silently when the server is down), with tests.
- **B6:** framework RETIRED — runner/parser/options + tests deleted (zero production callers; a
  209-line router doesn't need a parser layer). The live pieces (result.ts, render.tsx — plugin-CLI
  output) stay. Registry-driven *dispatch* consciously NOT taken: the drift surface the audit
  targeted was the god-file, which no longer exists.
- **B7:** `tests/cli/helpers/tty-cli-harness.ts` (options for the real per-file variations);
  11 files migrated; readonly-commands.test.ts (1,443) split into 7 domain files (119-342 lines),
  original deleted. tests/cli 246-0; full suite 5,298-0.
- **Docs:** CLAUDE.md CLI section + repo-architecture.md entry points updated in-PR.
Emit()/isTTY-dispatcher consolidation NOT taken (output-risk; the branching now lives in small
per-domain modules where it reads fine) — noted as an optional follow-up.

### FW3 `refactor/boundary` — the WS2 work that never landed

The core→plugin boundary violation is live and unguarded; nothing stops it multiplying.

1. **Workflow registries → `packages/core/src/workflows/`.** `source-registry.ts`,
   `node-type-registry.ts`, `notification-channel-registry.ts` — plus the post-migration
   `node-renderer-registry.ts`, so the cluster is growing — still live in
   `plugins/workflows/lib/`; core imports the plugin's tree from 5 places
   (`src/core/plugin-registry.ts:27-33`, `agent-packages/load-sources.ts:44-49`,
   `plugin-host/reload-pipeline.ts:42-43`, `package-integrity.ts:7`, `post-sync-reload.ts:13`).
2. **images→assets via hooks.** `plugins/images/lib/tools.ts:6-8` still direct-imports
   `../../assets/lib/*`. Extend assets' hooks (the REPORT's sanctioned mechanism).
3. **Cross-plugin import architecture rule** — the guard promised in WS2, absent from
   `tests/architecture/`. Land it in the same PR that removes the last violation.
4. **Config-surface governance.** `config.get<T>()`/`update()` remain reason-less and unaudited;
   live whole-config read-modify-`replace` at `src/core/openclaw-integration.ts:41,79`,
   `plugins/models/index.ts:86,90`, `plugins/team/lib/runtime-agents.ts:71`. Promote to typed
   adapter methods; extend the adapter-boundary test to gate `get`/`update`/`replace` like `.raw`.
5. **Cycle gate.** madge shows 15 cycles today (new dispatch-module cluster, engine↔node-dispatch,
   SDK-components/brainstorm). Add a CI check with an explicit allowlist so drift stops being silent.
6. **scripts/ out of the production graph** (P2 #24 residue): `src/core/mcp-server.ts:44-48`
   statically imports 5 tool peers from `scripts/lib/` — move the peers to
   `src/core/exec-tools/tools/`; fix `scripts/bin/post-channel.ts`'s `npx tsx` shebang.
7. **Decide the SDK→plugin re-exports** (P2 #5): `packages/sdk/src/hooks/index.ts` reaches into
   `@bakin/team`, `@bakin/workflows`, `@bakin/models`. Either move those hooks to the SDK home
   with the implementations, or record the cohesion justification. (The larger SDK↔app cycle
   stays deferred — see Re-deferred.)

### FW4 `refactor/ui-godfiles` — the dropped WS6 files

All four have audited seams; pure decomposition, one PR each or stacked.

1. **`plugins/tasks/components/task-detail-dialog.tsx` (1,033 → ~7).** Silently dropped from
   plan.md; audit verdict intact: one component from line 186 → EOF with 26 hooks. Split
   create/edit/detail modes per APPENDIX-cohesion. Fold in the WS3 straggler while the file is
   open: it locally extends SDK types and raw-fetches the workflows API.
2. **`plugins/workflows/components/node-config-drawer.tsx` (976 → 4).** Zero commits since the
   audit. Seams already visible: field/coercion helpers + label tables (61–256), drawer proper
   (258–610), `DrawerHeader` (611), `ParallelChildrenEditor` (638–976). Assess the
   `let cancelled` effect at `:310` for `useJsonFetch` during the split.
3. **`plugins/health/components/health-page.tsx` (1,137 → sections).** Grew again with the
   migration's blue/green search panel (was 1,012). The deferred React work: per-section
   components (usage/plugins/search/agent-usage), per-section fetching instead of the
   all-or-nothing `Promise.all`, promote `SearchHealthData`.
4. **`plugins/team/lib/team-routes.ts` (1,047).** The refactor relocated `populateTeamRoutes`
   (one function, 32 routes) instead of decomposing it. Follow the in-repo template from the same
   effort (`workflows/lib/routes/*`, `schedule/lib/routes/jobs.ts`): split to
   `lib/routes/{agents,teams,context}.ts`, same single `indexAgentStatic` dep.

### FW5 `refactor/server-godfiles` — audit misses + the un-split WS5 file

1. **`plugins/models/index.ts` (896, actively growing).** The clearest audit miss — only the
   models *page* was WS6 scope, and the index has since grown routing/spend/budget features.
   Mirror the tasks-plugin split: `lib/{config-io,models-cache-fetch,aliases,schemas}.ts` +
   `lib/routes/models.ts` + `lib/exec-tools.ts`; `lib/` already exists.
2. **`packages/host/src/api/plugins/install.ts` (788).** `post()` runs ~508 lines with
   security-sensitive logic (consent-token manifestSha binding ~:608, core-id squatting :545)
   buried mid-function and untestable in isolation. 4-way seam: dev-install/link branch, source
   resolution, manifest+permission validation, commit. This is supply-chain code — splitting it
   is a security testability win, not just hygiene.
3. **`src/core/plugins/upgrade.ts` (895 → 6).** The one WS5 file never decomposed. Includes the
   deliberately-deferred **hasher consolidation** (`computeSourceTreeSha` upgrade.ts:144 vs
   `hashSourceTree` whiskit/source-hash.ts:25 — different skip-sets and formulas): pick a
   canonical hasher + one-time stored-sha reset/migration, exactly as plan.md prescribed.
   Update the two stale whiskit spec docs that still describe `trustExistingDist` in present tense.
4. **`plugins/assets/index.ts` (913).** New threshold crossing: grew 744 → 913 with the #457
   enrichment work (engine wiring, import routes, enrichment exec tools). Mirror the tasks/models
   split pattern — `lib/routes/` + `lib/exec-tools.ts`; `plugins/assets/lib/` already has the
   enrichment modules, so this is index-orchestration extraction, not new design.

### FW6 `refactor/dedup-remainder` — kill the surviving copy-paste

Mechanical; batch into one PR with per-item commits.

- **WS3 stragglers:** `plugins/tasks/components/task-log-table.tsx:153-175` local
  formatDuration/date formatter → core `formatDuration`/`formatDateTime` (the one true
  unaccounted duplicate); `plugins/assets/components/versioned/VersionedAssetDetail.tsx:265-292`
  hand-rolled delete-scope modal → SDK `ConfirmDialog` (rich `description`); optional:
  `STATUS_BADGE_STYLES` + `formatRelativeDate` → SDK equivalents.
- **atomicWriteJson stragglers** (named in the WS2 plan, unconverted):
  `packages/core/src/tasks/store.ts:274-278` `writeTask`, `src/core/doctor-repair-store.ts:44-49`,
  `src/core/dispatch-state.ts:97-100`.
- **deepMerge dedup:** `packages/core/src/settings.ts:388` vs
  `packages/adapter-openclaw/src/runtime-utils.ts:68`.
- **sharp loader dedup — grew to 4 sites with #457:** `plugins/images/lib/tools.ts:21-76`,
  `plugins/assets/lib/asset-media.ts`, `plugins/assets/lib/asset-mutations.ts`,
  `plugins/assets/lib/enrichment/downscale.ts` (each caches its own sharp module) — one lazy
  loader in assets, images consumes via the FW3.2 hooks.
- **Shared dir-walker** (WS7 remaining; 7 ad-hoc sites after #457 deleted search-reconcile:
  upgrade, markdown-adapter, agent-packages/markers, generate-embedded-assets,
  assert-production-assets, docs/source-scan, assets/health-checks).
- **Host API body-parse helper + param-injection single-run** (P2 #15/#16, re-scoped post-#457):
  `parseJsonBody` already exists exported in `src/core/middleware.ts` — adopt it in
  `packages/host/src/api/{packages,agent-packages}/dynamic.ts` (both still hand-roll) and
  replace their `/still required by/i` regex status-mapping (`packages/dynamic.ts:82`,
  `agent-packages/dynamic.ts:148`) with typed errors. The catch-all still rebuilds the Request
  to inject params (`[[...path]].ts:137`); the second injection site the audit cited
  (`_lib/dispatcher.ts`) no longer exists — re-locate before assuming the double-run persists.
- **Tooling hardening** (P2 #25/#26/#27): gate the imitation-crab usage-seed out of production
  (`src/core/server/startup-recovery.ts:70-73` — env flag alone still dynamic-imports `dev/` in
  the binary); `JSON.stringify` the interpolations in `scripts/generate-embedded-assets.ts` (~:200-210);
  delete/wire orphan scripts (`migration/validate-package.ts`, `release.ts` dead `main()` —
  `backfill-manifests.ts` was already deleted by #457) — **ask-first per SPEC §8 three-mode
  verification**.
- **Schedule route/exec dedup** (the deliberate follow-up): extract
  `createScheduleJob/applyPauseAction/updateScheduleJob/projectJobDetail` into `lib/job-service.ts`.
  The behavioral drift is already fixed, so this is now pure dedup — rig E2E on pause/update.

### FW7 `refactor/test-godfiles` — the SPEC's unmet test ceiling

Split along source seams with shared harnesses (readonly-commands is FW2's B7):
- `tests/plugins/schedule/routes.test.ts` (1,954) — seams now obvious post-split: routes/jobs,
  fire-engine, scheduler-loop, job-service, exec-tools.
- `tests/plugins/tasks/routes.test.ts` (1,606) — routes vs exec-tools vs maintenance; carries the
  FW1.8 mock fix.
- `tests/plugins/workflows/runtime.test.ts` (1,374) — mirror the 6 runtime seam modules.
- `tests/core/plugin-registry.test.ts` (1,212) — at threshold; split if touched, else record
  justification.
- Extract shared harnesses; every split file gets the CLAUDE.md dual content-dir mocks.

### FW8 `chore/docs-sweep` — run the Phase 4 that never ran

Backlog sweep now; the in-PR rule prevents recurrence. **Re-scoped after #457's T24/F5 doc
sweeps** (which fixed the search/asset docs but only those):
- **`.claude/knowledge/repo-architecture.md`** — search content now current (F5), but still wrong
  on: `src/lib/plugin-registry.ts` (:437; moved to src/core in #572); adapter tree vs the actual
  post-split module set; dispatch described as one module (now a barrel over ~10); missing
  `src/core/server/request-handler.ts`.
- **`.claude/knowledge/plugin-system.md`** — T24-touched but :1512 still cites
  `src/lib/plugin-registry.ts`.
- **`dispatch.md`** — untouched since 2026-06-13; :29 and :305 still describe the pre-split
  monolith; add a module map.
- **`dev-loop.md`** — untouched since 2026-06-11; missing the `core-plugin-ids.ts` consolidation.
- ~~search-system.md~~ / ~~adapter-architecture.md~~ — RESOLVED by T24/F5 (2026-07-02/03);
  verify only the OpenClaw runtime-module inventory paragraph while in adapter-architecture.md.
- **CLAUDE.md** — search section now current (#457); directory-map + CLI section update rides FW2.
- **README.md** (untouched since 2026-05-27) + rerun `docs:generate` and commit.
- `/agent-skills:test` coverage pass over FW1's behavior changes and any FW3–FW6 redesigns.

---

## Re-deferred (explicitly NOT taken, again — with reasons)

- **SDK↔app circular dependency** (implementations in `src/components`/`src/hooks`): works,
  release-smoke-covered, large blast radius; defer until it bites. Document in repo-architecture.md.
- **Tier-3 capability-subclass refactor** of the OpenClaw facade; **settings/binary resolver
  extraction** — runtime.ts (1,560) is the documented irreducible facade.
- **server.ts declarative route table** — behavior-touching; request-handler header already
  records the deferral.
- **Workflows redesigns:** decideGate 6-block collapse, gate-settings dual-source-of-truth,
  discriminated `getCurrentStep` union, stdJsonResponses. (submit_step classification IS taken — FW1.3.)
- **Models-page redesigns:** 3-way sentinel cleanup, batch saveAll, RuntimeRestartBanner/
  TableSkeleton SDK extraction; **use-workflow-copy-form cross-file dedup + slugify** — take
  opportunistically if FW4 opens those files.
- **search-registry micro-cleanups** — OBSOLETED by #457: the $inc/$push transform and
  pendingReconciles code no longer exist (outbox/blue-green rewrite); crossTableSearch was
  restructured (`crossTableSearchInner`). Nothing left to take.
- **Docs hook/slot regex scraping → declarative** — build-time only.
- **Remaining triaged WS3 non-fits** (8 `let cancelled` sites with written rationale).
- **Historical data:** pre-existing prompt-bearing ledger rows; pre-migration settings backups.

## Suggested execution order

```
FW1 fix/guards-and-correctness   — small, independent, land first
FW2 refactor/cli-part3           — the stalled biggest win; unblocks its own docs/tests
FW3 refactor/boundary            — before FW4/FW5 so splits land on sanctioned surfaces
FW4 refactor/ui-godfiles     ──┐
FW5 refactor/server-godfiles ──┼— independent of each other; can interleave
FW6 refactor/dedup-remainder ──┘  (FW6.4 sharp-dedup needs FW3.2 hooks)
FW7 refactor/test-godfiles       — after the source splits settle the seams
FW8 chore/docs-sweep             — final PR + the recurring in-PR rule
```

FW1 is a day-scale batch. FW2 is the largest single effort (the WS4 plan's own "fragile,
wants E2E" warning stands). FW3–FW6 are mostly mechanical with known seams. FW7/FW8 close out
the SPEC's unmet success criteria.

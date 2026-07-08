# Plan — Brands plugin (#419) implementation

**Spec:** `.claude/specs/brands-plugin.md` (DRAFT v2, story-reviewed). This plan breaks it into dependency-ordered, individually-verifiable tasks with a commit strategy whose phase checkpoints are rollback points.
**Branches:** `feat/419-brands-plugin` in `bakin` (one PR); `feat/brands-integration` in `bakin-bits-official` (one PR, lands after core merges).
**Status:** DRAFT — pending approval; execution via /agent-skills:build task-by-task, closing coverage via /agent-skills:test.

---

## 0. Planning deltas (resolved against real code)

Decisions made during planning that refine the spec; the spec has been amended for the first:

1. **Hard-block mechanism = budget-defer pattern, not the `blocked` column.** The team-failure precedent (`blockTask` → `blocked` column) never auto-retries — `dispatch-cycle.ts` only scans `todo`. Spec acceptance #4 requires auto-resume, so brand-unavailable tasks **defer in todo pre-claim** (mirror `deferForBudget`, `dispatch-cycle.ts:216`), with a derived board badge, first-skip audit + notification. Spec §5.3 amended.
2. **`brand.injected` in task detail is a net-new panel.** No per-task audit timeline exists (audit flows to the global activity feed only). T2.4 builds a small Brand panel on task detail (effective brand + provenance + recent injection records) rather than extending a nonexistent timeline.
3. **Brand section must be conditional** in the prompt builders (present only when a brand resolves) — the fixture suite asserts every listed section is non-empty, and the static-boilerplate budget test (unbranded synthetic task) must stay ≤ current caps. Brand bytes are governed by the dynamic cap only.
4. **External repo needs no SDK publish.** `bakin-bits-official` types come from its local `types/sdk-ambient.d.ts` (+ `test-sdk` stub) — Phase 9 edits that file directly; the real SDK types still ship from `bakin` in T1.1.
5. **Import auth = ambient git credentials.** `materializeCachedGithubSource` shells to `git clone`; private repos work via the operator's credential helper/SSH. No token machinery — documented, not built.

## 1. Dependency graph

```
P0 store+skeleton ──► P1 task linking ──► P2 dispatch injection ──► P3 lessons
        │                    │                     │                    │
        │                    │                     ├──► P4 images       │
        │                    │                     │                    │
        ├──────────────────────────────────────────┴──► P5 import/CLI  │
        │                                                               │
        └──► P6 full UI + builder (needs P0–P3; builder needs P2 dispatch)
                                   │
P7 doctor+E2E hardening (needs all core phases)
P8 docs (needs P7 — documents as-built)
P9 external repo (needs P1 SDK types + P2 hook contract; lands after core PR merges)
```

Within a phase, tasks are strictly ordered. Phases P3/P4/P5 are independent of each other (any order; planned order optimizes for proving the canonical scenario early).

---

## Phase 0 — Foundations: paths, store, plugin skeleton

### T0.1 `brands` path + context budget setting
**Scope:** `packages/core/src/content-dir.ts` (`getBakinPaths().brands`), `initBakinHome()` dir creation; `dispatch.maxBrandContextBytes` in `packages/core/src/settings.ts` (type ~:119, defaults ~:309; default 12288) + clamp helper `resolveBrandContextBudget` (floor 1024, invalid→default) homed in `src/core/dispatch-context-blocks.ts` (or a shared util — NOT `dispatch-workflow.ts`; the brand budget is consumed by context-report and context-blocks); editable field added to the System & Alerts field list (precedent: `dispatch.maxWorkflowContextBytes` entry in the system-settings field list).
**AC:** paths resolve under `BAKIN_HOME`; clamp matches spec §5.2 semantics; existing `getBakinPaths` consumers unaffected.
**Verify:** new unit tests (paths + clamp table); `bun test tests/core/ --isolate` green; grep confirms no `getBakinPaths` mock in tests/ now missing the key that this task's tests touch.
**Commit:** `feat(core): brands content dir + dispatch.maxBrandContextBytes`

### T0.2 Brand store, schemas, fingerprint, scaffolding (pure lib)
**Scope:** `plugins/brands/lib/{schemas.ts,store.ts,fingerprint.ts,scaffold.ts,templates/*.md}` — `brandManifestSchema` (incl. `rules`, `draft`, `terminology`, `cardDocs`, `defaultImageReferences`, `source` provenance), `portableBrandSchema`, slug validation, CRUD engine (atomic temp+rename, per-brand async mutex, `safeParse` reads with honest corrupt-brand errors), doc/lesson file IO + frontmatter `description` parsing, sha256 fingerprint (canonical serialization), scaffold templates (voice.md / style-guide.md authoring hints).
**AC:** spec §3.1–§3.3 exactly; fingerprint stable across key order, changes on any file edit; corrupt manifest read returns a typed error, never silently skipped.
**Verify:** dedicated unit test file (temp-dir mocked per house rules); round-trip create→read→update→delete; concurrent-mutation serialization test.
**Commit:** `feat(brands): brand store, schemas, fingerprint, scaffolding`

### T0.3 13th core plugin skeleton: CRUD REST, base hooks, page shell
**Scope:** `plugins/brands/{bakin-plugin.json,package.json,index.ts,client.tsx,types.ts}`; register in `src/lib/core-plugin-ids.ts`, `src/lib/plugin-static-imports.ts` (import blocks + `CORE_PLUGIN_IMPORTS` entry), `bakin.config.ts`; host route `packages/host/src/routes/brands.tsx` + `router.ts` child (page:/brands slot — required or 404); nav item. REST routes (`defineRoute`): brand CRUD (create runs scaffold), guideline/lesson doc CRUD, manifest PUT; hooks `brands.get` / `brands.list` (drafts excluded from list); SSE `brand.changed` on mutations; audit `brand.created|updated|deleted`; minimal client page (list brands, create dialog, raw detail).
**AC:** plugin activates; routes callable via test-helpers; page renders via slot; architecture lockstep test (`core-plugin-ids.test.ts`) green; `isCorePlugin('brands')` true (automatic).
**Verify:** `tests/plugins/brands/` route+tool tests via `activatePlugin`/`callRoute`; `bun run test` full suite; `bun run dev:mock` manual smoke: /brands renders, create brand → scaffolded files on disk (temp home).
**Commit:** `feat(brands): core plugin skeleton — CRUD, hooks, page shell`

**⛳ CHECKPOINT A** — brands exist and are manageable; nothing else touched. Rollback: revert to pre-branch; no schema ripples yet.

---

## Phase 1 — Task linking

### T1.1 `brandId` across the task stack + SDK
**Scope:** `plugins/tasks/lib/task-schemas.ts` (create/update bodies), `packages/core/src/tasks/store.ts` (`BakinTask`, `CreateBakinTaskInput`, `BakinTaskPatch` allowlist, `TaskListOpts.brandId` filter, `createEmptyBakinTask`), `src/core/task-store.ts` facade, `dispatch-types.ts` `DispatchTask.brandId`, SDK task types (`packages/sdk`), tasks exec tools + REST pass-through, tasks search content type `brand_id` keyword facet.
**AC:** brandId persists через create/update/list-filter; mirrors `projectId` exactly; no FK validation.
**Verify:** store + facade + schema tests; **planned mock sweep** — adding the field near task-service historically breaks partial task-store mocks across `tests/` (memory), so run `bun run test` in full and fix all partial mocks in one sweep, not incrementally.
**Commit:** `feat(tasks,core,sdk): brandId on tasks — schemas, store, facade, search facet`

### T1.2 Tasks UI: picker, badge, facet
**Scope:** `plugins/tasks/components/task-detail-modes.tsx` (net-new brand select fed by brands REST list — no projectId picker precedent exists), `task-card.tsx` badge, `task-filters.tsx` new `FacetFilter` (brand values + explicit 'no brand'), URL-backed `useQueryArrayState`; brands plugin `settingsSchema` `warnUnbranded` (default off) → subtle unbranded badge when on — **read path: the brands list REST response carries the effective `warnUnbranded` flag** (the tasks UI already fetches that list for the picker; no new cross-plugin coupling, no plugin-settings fetch from tasks).
**AC:** pick/clear brand on create+edit; board filters incl. 'no brand'; deep-linkable; default-off warn badge.
**Verify:** component tests where house style has them; dev:mock manual pass; URL param omitted at default (house rule).
**Commit:** `feat(tasks): brand picker, board badge, brand facet filter`

**⛳ CHECKPOINT B** — brands linkable to tasks end-to-end; dispatch untouched. Rollback: revert P1 commits; P0 stands alone.

---

## Phase 2 — Dispatch injection (the spine)

### T2.1 Card builder + `brands.getContext` hook
**Scope:** `plugins/brands/lib/card.ts` — pure builder: tiered sections per spec §5.1 (header + anti-bleed, rules/palette/terminology, doc listing with descriptions + asset groups with usage notes + image-tool instruction, inline `cardDocs`, lessons slot), whole-unit byte retention against passed `maxBytes`, visible omission markers, injection-record `meta` (cardBytes, sectionsIncluded, omitted+why), warnings for dangling assetIds (asset existence via `ctx.assets`); register `brands.getContext` hook returning `{ card, meta, warnings } | { notFound: true }` (draft ⇒ notFound). **Plus the basic exec tools the card points agents at:** `bakin_exec_brands_{list,get,read_doc}` (no caption join yet — that's T6.1's S7 enhancement). The card must never reference a tool that doesn't ship in the same checkpoint.
**AC:** spec §5.1/§5.2/§5.5 meta; rules always survive retention; empty/skeletal brand yields a small honest card; deterministic output (fixture-friendly).
**Verify:** exhaustive unit tests: priority retention table, marker presence, description rendering, draft/missing sentinel, meta correctness.
**Commit:** `feat(brands): brand card builder + brands.getContext hook`

### T2.2 Core resolution + prompt wiring + fixtures
**Scope:** `src/core/dispatch-context-blocks.ts` — `resolveEffectiveBrandId(task)` (own → cycle-safe `parentId` ancestry walk → `projects.getBrand` via registry-`has` guard) + `buildDispatchBrandBlock` invoking `brands.getContext` with structural-mirror types (no plugin import); conditional `brand` section between `project` and `lessons` in `buildDispatchSections` AND `buildWorkflowDispatchSections` — full card in the subagent + main branches, **one-line brand mention in the triage branch** (walkthrough decision); wire at `dispatch-prepare.ts` + `dispatch-workflow.ts` — **including the `brand.injected` audit write, which lives here** (post-claim, after block build, where `runId` exists; T2.3 does NOT own this write); `configuredDynamicCaps()` entry `{ source:'brand', setting:'dispatch.maxBrandContextBytes', appliesTo:'both' }`; fixtures: **new branded synthetic case** in `tests/fixtures/dispatch-prompts/inputs.ts` + `generate.ts` + the test's `cases`, asserting the `brand` label **within the new case only** — the existing required-label lists and canonical unbranded cases are NOT touched, so no committed fixture changes; regenerate to add the new fixture (`bun tests/fixtures/dispatch-prompts/generate.ts`).
**AC:** branded task prompt carries the card in both builders; ALL existing fixtures byte-identical (unbranded behavior provably unchanged); `brand.injected` audit lands per branded dispatch with runId; cap measured by `bakin agents context` / context-report.
**Verify:** `tests/core/dispatch-prompts.test.ts` green — new branded fixture added, zero diffs on existing fixtures; static-boilerplate budget assertions unchanged; context-report test covers the new cap; audit-write test.
**Commit:** `feat(core): brand context injection in dispatch prompts + injection records`

### T2.3 Failure semantics: defer + notify
**Scope:** pre-claim brand-defer in `dispatch-cycle.ts` (+ the equivalent site in `dispatch-single.ts` — both verified to exist for budget: `dispatch-cycle.ts:214-216`, `dispatch-single.ts:177`) mirroring `deferForBudget` — effective brand resolves to notFound ⇒ skip without claiming; first-skip-per-(taskId,brandId) audit `brand.dispatch_blocked` + `broadcast({type:'plugin-event', event:'brand.dispatch_blocked', …})` — notify-once via an **in-memory set** (re-notifies after server restart; acceptable — durable option if ever needed is a ledger UNIQUE like budget incidents); `src/hooks/use-sse.ts` branch → `sendBrowserNotification('Brand unavailable', …, '/tasks?brand=<id>')` — click lands on the board pre-filtered to the affected brand (walkthrough decision) + activity event; `src/lib/map-audit-message.ts` cases; derived brand-blocked badge on task cards **mirroring the budget-hold plumbing exactly** (`plugins/tasks/hooks/use-budget-status.ts` → `kanban-board.tsx` holds prop → column → card; never task metadata). Lessons-down degrade marker + `brand.lessons_unavailable` stub (full path in P3). Soft-failure `brand.asset_missing` audit.
**AC:** spec §5.3 amended semantics exactly; deleting a brand then restoring it requires zero manual task surgery; notification fires once per incident, not per cycle.
**Verify:** dispatch-cycle unit tests (defer, resume, no-claim-on-skip, notify-once); use-sse handler test; audit fixtures.
**Commit:** `feat(core,brands): brand-unavailable defer + notifications`

### T2.4 Observability UI: task Brand panel + debug card viewer
**Scope:** `GET /api/plugins/brands/:id/card-preview[?taskId=…]` (same pure builder); task detail Brand panel (effective brand + inherited-from provenance, recent `brand.injected` records — existing `queryAuditEvents` (`src/core/audit.ts:28`) suffices but has no taskId filter: query by kind with `sinceMs`/`limit` bounds and post-filter by payload `taskId`, never unbounded full-file reads; brand-blocked state); debug-mode rendered-card viewer.
**AC:** spec §5.5 — "what injected then" (audit) vs "what would inject now" (preview) both visible; panel absent for unbranded tasks.
**Verify:** route test (preview parity with T2.1 builder output); component smoke in dev:mock.
**Commit:** `feat(brands,tasks): injection observability — brand panel + card preview`

**⛳ CHECKPOINT C** — canonical scenario (minus lessons/images) works: branded task dispatches with card, unbranded unaffected, failure day is loud. Suite + fixtures green. This is the highest-risk phase; everything after is additive.

---

## Phase 3 — Lessons

### T3.1 Content types + retrieval into the card
**Scope:** register `brand-lessons` (file-backed, glob over brands dir lessons, facet `brand_id`, schemaVersion 1) AND `brands` (manifest + guidelines searchable) content types in `activate`; dispatch-side retrieval (top-N by task title/description, faceted) feeding the card's lessons tier through its budget share; own cache `(brandId, query)` TTL 5min cap 200; engine-down ⇒ visible marker + `brand.lessons_unavailable` audit (completing the T2.3 stub).
**AC:** spec §6; agent-lesson cache untouched; retrieval failure never blocks dispatch.
**Verify:** retrieval tests with mocked search service; cache-key isolation test (two brands, same query ⇒ distinct entries); marker test.
**Commit:** `feat(brands): brand lessons — content types + dispatch retrieval`

### T3.2 Lesson authoring loop
**Scope:** `bakin_exec_brands_add_lesson` exec tool (append-only, audited `brand.lesson_added`); lesson editor in brand detail with the "always-rule?" nudge; **quick-add from task review** — "Save as brand lesson" on branded task detail, pre-filled, POSTs to lessons endpoint.
**AC:** spec §6 incl. quick-add; add_lesson works on published brands (the one live write).
**Verify:** tool test via `callTool`; route test; manual dev:mock pass.
**Commit:** `feat(brands,tasks): lesson authoring — exec tool, editor, quick-add from task`

**⛳ CHECKPOINT D** — correction loop closed.

---

## Phase 4 — Images

### T4.1 Brand-conditioned generation
**Scope:** `plugins/images/index.ts` generate/edit shapes + `brandId`; resolution via `ctx.hooks.invoke('brands.get')` (unknown/draft ⇒ typed hard error); palette + visual notes into prompt packet; `defaultImageReferences` fill when agent passed none (agent refs win; ≤4); idempotency key + `brandId`+`brandFingerprint`; `version.generation.{brandId,brandFingerprint}`; create-image SKILL.md line.
**AC:** spec §8; unbranded generate calls byte-identical behavior to today.
**Verify:** images plugin tests (merge, fill precedence, typed errors, idempotency sensitivity, provenance); existing images suite green.
**Commit:** `feat(images): brand-conditioned generation via brands.get`

**⛳ CHECKPOINT E.**

---

## Phase 5 — Import/export + CLI

### T5.1 Portable format: export + local import
**Scope:** `plugins/brands/lib/portable.ts` — installed↔portable conversion (assetIds ↔ relative paths, asset file copy-out on export, `ctx.assets.createAsset` ingestion on import), provenance stamping; `GET /:id/export`; `POST /import` (local path source first); collision handling (existing id ⇒ confirm/update semantics per spec D9).
**AC:** `import(export(brand)) ≡ brand` (fingerprint-equal modulo provenance); import never writes on validation failure.
**Verify:** round-trip test; corrupt-portable rejection tests.
**Commit:** `feat(brands): portable brand format — export + local import`

### T5.2 GitHub source + preview + drift check
**Scope:** wire `parseGithubSource` + `materializeCachedGithubSource` (subpath form `github:user/repo/path` via `#subpath` parse) into the importer; `POST /import/preview` (validated summary, zero writes); `GET /import/check` (provenance commit vs upstream); UI import flow (source → preview card → confirm); provenance panel + drift-check action on brand detail.
**AC:** spec §7.3/S6; private repos documented as ambient-git-auth (no new machinery).
**Verify:** importer tests behind a mocked materializer; preview-writes-nothing test; manual real-repo smoke.
**Commit:** `feat(brands): github import — preview, install, drift check`

### T5.3 CLI surface
**Scope:** `src/cli/commands/brands.ts` (`run(args)`; `list/get <id>/import <source>/check <id>/export <id>/remove <id>` — `check` takes an installed brand id, matching the REST drift-check contract; spec §7.4 amended); `cli/bakin.ts` case; `src/core/cli/registry.ts` `cli({...})` entries (new `Brands` group); consent: `confirmPrompt` + `--yes` gates on import/remove; remove shows linked-task count guard.
**AC:** `bakin brands --help` renders; exit codes via direct `process.exit` (house rule); consent flow matches plugins/assets precedent.
**Verify:** CLI command tests (mock HTTP); help-registry test if one exists.
**Commit:** `feat(cli): bakin brands command group`

**⛳ CHECKPOINT F** — ecosystem story real: round-trip + GitHub + CLI.

---

## Phase 6 — Full UI + builder flow

### T6.1a Brand detail: manifest + doc editors, list-page completion
**Scope:** palette editor (name/hex/usage rows), rules + terminology editors, `cardDocs` selector, guideline markdown editing (SDK `MarkdownEditor`), completeness hints (S1); **list page brought to spec §9** (palette swatch strip, doc/lesson/asset counts, draft badges, integrity warnings on cards).
**AC:** every editor round-trips through the manifest PUT; list page spec-complete.
**Verify:** route tests for manifest edits; dev:mock walkthrough of S1.
**Commit:** `feat(brands): brand editors + list page`

### T6.1b Asset pickers, caption join, integrity surface, guards
**Scope:** logo/asset-group pickers (existing-asset browser; group members show enrichment captions); **caption join added to `brands.get` hook + exec `get`** (S7 — the T2.1 tools gain captions here); shared `plugins/brands/lib/integrity.ts` (dangling-ref scan — single implementation consumed by both `GET /:id/integrity` here and the T7.1 doctor check); integrity warnings inline on detail; live card-size preview via card-preview endpoint (S9); deletion guard with linked-task count (`TaskListOpts.brandId`) (S10).
**AC:** spec §9 detail bullet-complete; S7/S9/S10 stories pass.
**Verify:** tool tests for caption join; integrity-report tests against seeded broken refs; dev:mock walkthrough of S7/S9/S10.
**Commit:** `feat(brands): asset pickers, caption join, integrity + deletion guards`

### T6.2 Builder flow (draft lifecycle)
**Scope:** draft-gated `bakin_exec_brands_{write_doc,update_manifest}` (typed error on published); questionnaire form UI; `POST /builder` (create `draft:true` + `guidelines/_intake.md` + dispatch normal drafting task); `POST /:id/publish` (audit `brand.draft_published`); draft badges; drafts excluded from `brands.list`/pickers/resolution (verify T2 sentinel path covers drafts).
**AC:** spec §9.1 — bounded: one flag, two gated tools, one endpoint, one form; a draft can never brand real work.
**Verify:** gate tests (draft-only writes), builder endpoint test (intake written, task created with correct description), publish test; E2E draft→publish in dev:mock.
**Commit:** `feat(brands): builder flow — draft lifecycle, gated write tools, questionnaire`

### T6.3 ⌘K + hit renderers
**Scope:** `registerPlugin({ search: { hitRenderers } })` for `brands` + `brand-lessons` types → navigate to brand page.
**AC:** ⌘K finds brands by guideline content and lessons; engine-down honest state.
**Verify:** renderer registration test pattern used by other plugins; manual ⌘K pass.
**Commit:** `feat(brands): search hit renderers`

**⛳ CHECKPOINT G** — full consumability surface shipped.

---

## Phase 7 — Doctor + hardening

### T7.1 `brands.integrity` health check
**Scope:** `plugins/brands/lib/health-checks.ts` via `ctx.registerHealthCheck`, consuming the shared `lib/integrity.ts` scan from T6.1b (single implementation): dangling assetIds (logos/groups/defaultImageReferences), tasks pointing at ghost/draft brands, invalid manifests, stale drafts (>7d, info), currently-deferring brand-blocked tasks (warn → nav attention badge); structured `data`, no message parsing.
**AC:** spec §10; findings attach data; badge count reflects warn.
**Verify:** check tests with seeded broken states.
**Commit:** `feat(brands): brands.integrity doctor check`

### T7.2 End-to-end verification + residuals
**Scope:** /verify skill run — isolated boot: create brand (scaffold present) → link task → dispatch with mock runtime asserts card present + `brand.injected` audit → delete brand ⇒ defer + notification event → restore ⇒ resume → image generate with brandId → import/export round-trip → builder draft→publish → card-preview parity. Fix whatever it shakes out. Full gates bare (no pipes): `bun run test`, `bun run check:cycles` (add tolerated alias cycle only if the known local-only SDK↔app alias phantom appears — memory), typecheck, `bun run build` smoke (then discard the build stamp — never `git add -A`).
**AC:** all spec §16 criteria 1–10 + 12 demonstrably pass.
**Verify:** the /verify transcript is the evidence; suite green.
**Commit:** `test(brands): e2e verification + residual fixes` (multiple small fix commits allowed, each scoped)

**⛳ CHECKPOINT H** — core repo feature-complete and verified.

---

## Phase 8 — Docs

### T8.1 Knowledge + docs sweep
**Scope:** new `.claude/knowledge/brands-plugin.md`; `CLAUDE.md` (13 plugins, Key Patterns entry, `~/.bakin/brands/` dir map, `getBakinPaths` testing note); update `.claude/knowledge/{dispatch,startup-context,assets-versioning,doctor-and-health-checks,repo-architecture,messaging-plugin}.md`; docs site page under `docs/src/content/docs/` (creating brands, builder, inheritance, injection records, portable-format contract); README only if it enumerates plugins (check); grep for stale "12 core plugins"/plugin enumerations anywhere.
**AC:** spec §13 complete; every behavioral surface added in P0–P7 is findable in knowledge docs.
**Verify:** docs build if applicable; knowledge cross-references resolve.
**Commit:** `docs(brands,knowledge): brands plugin documentation sweep`

→ **Open PR** `feat/419-brands-plugin` → main. Body links spec + plan; closes #419 (core half).

---

## Phase 9 — bakin-bits-official (`feat/brands-integration`)

### T9.1 SDK ambient types + projects integration
**Scope:** `types/sdk-ambient.d.ts` — `brandId?` on Task/TaskCreateInput/list filter (mirrors bakin T1.1). Projects: `ProjectFrontmatter.brandId` + parse/serialize (`lib/parser.ts`), create/update service + REST/exec surfaces, register `projects.getBrand` waterfall hook in `activate` (reads `readProject(projectId)?.brandId`), brand picker in `project-detail.tsx` + `new-project-dialog.tsx` (brands REST via ctx-relative fetch).
**AC:** spec §11 projects bullet-complete; hook returns undefined gracefully for unbranded projects.
**Verify:** projects plugin tests (`createTestContext` with hook overrides — defaults are `has:false/invoke:undefined`); `bun run test` + `typecheck` in that repo.
**Commit:** `feat(projects): brandId on projects + projects.getBrand hook`

### T9.2 Messaging integration
**Scope:** `Plan`/`PlanSchema.brandId` + `CreatePlanInput` + `/plans` POST/PUT; stamp onto `ctx.tasks.create` at plan activation (`lib/plan-activation.ts:172-189`) and repair (`lib/deliverable-lifecycle.ts:130-146`) — top-level field; brand picker in `plan-workspace.tsx`; mock task store `brandId` create/list (`plugins/test-helpers.ts`).
**AC:** spec §11 messaging + acceptance #11: activated plan ⇒ every spawned task carries the brand.
**Verify:** messaging suite + `package-contract.test.ts` green.
**Commit:** `feat(messaging): brandId on plans, stamped onto spawned tasks`

→ **PR** after core merges. End-to-end acceptance #11 validated via the dockerized rig in isolated mode (`bun run instance` with `--mode isolated` — never native mode, which uses the real `~/.bakin`; memory) with the branch-built messaging/projects plugins installed.

---

## Commit strategy (rollback contract)

- **One branch per repo, one PR per repo** (approved). `feat/419-brands-plugin` off current `main`.
- **One conventional commit per task** (messages specified above), each leaving the tree **green**: targeted tests for the task + typecheck minimum; **full `bun run test` + `check:cycles` at every ⛳ checkpoint** — run gates bare, never piped (memory: `A | tail && B` gates on tail).
- **Checkpoints A–H are the rollback points.** Phases are ordered so reverting a phase never strands an earlier one: `git revert <phase-commit-range>` restores the previous checkpoint's behavior (schema additions are additive; T1.1 is the only ripple-y commit — its mock sweep is contained in the same commit).
- **Generated files:** dispatch-prompt fixture regeneration diffs belong to T2.2's commit (they ARE the reviewable record). Never `git add -A` after a local `bun run build` — the version build stamp (`_embedded-assets-static.ts`) must not enter commits (memory); if a build ran, restore the stamp and regenerate vendors before running from source.
- **No mid-phase pushes required;** push at checkpoints so CI history matches rollback points.
- **External repo lands strictly after core merges** (hook/type contract must be on main first).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| T1.1 partial task-store mock breakage across `tests/` | Known failure mode (memory) — planned one-sweep fix inside T1.1, budgeted for it |
| Fixture churn in T2.2 masks accidental prompt changes | New branded case only — existing fixtures and required-label lists untouched; a zero-diff on committed fixtures is the guard that unbranded behavior didn't move |
| Mock-checker hook false positive on new BAKIN_HOME-pattern tests | Verify and move on; never restructure tests to appease it (memory) |
| `check:cycles` phantom SDK↔app alias cycle locally | Compare against CI; `TOLERATED_CYCLES` only for alias-reached cycles (memory) |
| New plugin page 404 | Host route + router entry included in T0.3 (memory) |
| Dispatch defer path double-claims or claims-on-skip | T2.3 tests assert no ledger claim on brand-defer; pre-claim ordering mirrors budget gate position |
| Draft brands leaking into resolution/pickers | Single sentinel path (getContext notFound + list exclusion) tested in T2.1/T6.2 |
| Server code not hot-reloaded in dev | Manual restarts; use dev:mock + isolated rig for dispatch testing; /verify for E2E |
| Notification spam per cycle | Notify-once-per-incident set tested in T2.3 |

## Estimate of shape (for pacing, not promises)

P0–P2 are ~60% of the risk and ~40% of the code; P6 is the largest UI surface; P3/P4/P5 are well-precedented middleweights; P7–P9 are closers. 27 commits ± fix commits across ~10 phases, 8 checkpoints.

## Review record

This plan passed an adversarial review (coverage matrix vs spec, dependency-order attacks, factual verification against code, task-size realism). 14 findings, all applied: basic exec tools moved into Phase 2 (the card must never point at tools that don't exist yet); fixture strategy changed to new-case-only (zero diffs on existing fixtures); `brand.injected` write site pinned to T2.2 post-claim; System & Alerts settings field, `warnUnbranded` read path, list-page completion, shared integrity lib, CLI `check <id>` rename (spec amended), audit-query bounds, notify-once semantics, clamp-helper home, badge plumbing precedent, T6.1 split, and the rig-isolated AC#11 vehicle all made explicit. Verified true: budget-defer is genuinely pre-claim in both dispatch paths; `queryAuditEvents` exists (needs post-filter, no new infra).

# Implementation Plan: Workflows Hardening Batch

**Spec:** `.claude/specs/workflows-hardening.md` (approved 2026-07-03)
**Shape:** 3 sequential PRs; every commit green (`bun run test` + `bun run typecheck` + `bun run lint`); each commit is a rollback checkpoint.

## Architecture Decisions (from spec interview)

- **#374 via demotion, not settle pass** — load-time keeps structural/self-ref checks fatal, defers nested-ref *existence* to the (already strict, recursive) start-time validator plus a health-check warning. Covers boot order, hot reload, and user-plugin install timing with less machinery.
- **Delete, don't deprecate** — workflow-step `dependsOn` and gate `on_approve` are removed outright. No shims (single-user machine, spec boundary).
- **Fan-out is design-only** — ordered-list engine + one `map_workflow` node, join-waits-all, per-child retry. No implementation this batch.

## Plan-phase findings (resolved spec open questions)

1. **Node-type schemas were `.passthrough()` everywhere** — unknown YAML keys silently ignored. **Decided at plan review (user call): flip builtin schemas to `.strict()` in PR 2.** Rationale: all plugins are managed in this repo + bakin-bits; plugin-contributed node types validate against their own registered schemas via the registry-dispatch branch (`node-type-registry.ts:356-400`), so builtin strictness has no third-party blast radius — and no plugin even registers a node type today. The zod schemas gate only the CRUD/save boundary (`plugins/workflows/lib/routes/definitions.ts:168,214`); the disk-load path uses the manual semantic validator and stays lenient, so a health-check warning covers stray keys in on-disk definitions.
2. **No `on_approve`/`dependsOn` references** under `agents/`, `README.md`, or `docs/*.md`. Test files referencing them: 8 under `tests/plugins/workflows/` (the `tests/core/` hits are task-domain `dependsOn` — untouched).
3. **Health check folds in**: `checkWorkflowDefinitions` (`plugins/workflows/lib/health-checks.ts:175`) already walks every definition's steps for skill refs; add a `workflow`-type branch resolving `workflow_id` via the same user-disk + registry tiers. Same check id (`workflow-definitions`).

---

## PR 1 — `fix(workflows): order-independent cross-plugin nested refs (#374)`
Branch: `fix/workflow-cross-plugin-refs`

### Task 1: Defer nested-ref existence at default load; collapse two-pass
**Description:** `loadDefaultWorkflows` passes `validateNestedWorkflowRefs: false` to `validateDefinition`; with the known-set no longer consulted at load, collapse the parse→known-set→validate two-pass into a single parse+validate pass. `validateDefinition` keeps `knownWorkflowIds` (start-validation uses it). CRUD/save and start paths unchanged (stay strict).
**Acceptance:**
- [ ] A parent workflow registering a nested ref to a not-yet-activated plugin's workflow registers successfully (both activation orders).
- [ ] Structural errors and self-references still skip the definition at load with a warn log.
- [ ] Starting a workflow whose nested child is truly absent still hard-fails via `createValidatedInstance`.
**Verify:** `bun test tests/plugins/workflows/load-defaults.test.ts tests/plugins/workflows/start-validation.test.ts --isolate` (add cross-plugin both-orders regression — image-social-post↔image-generation shaped, per #374 acceptance); `bun run typecheck`.
**Files:** `packages/core/src/workflows/load-defaults.ts`, `tests/plugins/workflows/load-defaults.test.ts` (+ start-validation test if not already covering absent-child). **Scope: S**
**Commit:** `fix(workflows): defer nested-ref existence to start validation; single-pass default loading (#374)`

### Task 2: Health-check warning for missing nested workflow refs
**Description:** Extend `checkWorkflowDefinitions` to warn `Workflow "X" step "S" references nested workflow "Y" which does not exist`, resolving Y against user disk + source registry (mirror `loadDefinition` tiers). Evaluated live, so it is order-independent and current under hot reload.
**Acceptance:**
- [ ] Warning appears for a definition referencing a missing child; clears once the child is registered.
- [ ] Existing skill-ref warnings unchanged; `ok` result still emitted when clean.
**Verify:** `bun test tests/plugins/workflows/health-checks.test.ts --isolate`.
**Files:** `plugins/workflows/lib/health-checks.ts`, `tests/plugins/workflows/health-checks.test.ts`. **Scope: S**
**Commit:** `feat(workflows): health-check warning for missing nested workflow refs`

### Task 3: Knowledge doc — three-tier validation model
**Description:** Update `.claude/knowledge/workflows-plugin.md`: document load (structural, fatal) / start (strict recursive existence + cycles, fatal) / health (advisory refs) tiers; remove the now-stale two-pass known-set description; note cross-plugin refs are order-independent.
**Acceptance:** doc matches shipped behavior; no stale two-pass reference remains.
**Verify:** `bun run docs:generate && bun run docs:validate`.
**Files:** `.claude/knowledge/workflows-plugin.md`. **Scope: XS**
**Commit:** `docs(knowledge): document the three-tier workflow validation model`

### Checkpoint 1 (gate to PR 2)
- [ ] Full `bun run test` + `bun run typecheck` + `bun run lint` + docs validation green.
- [ ] Open PR 1; user reviews.

---

## PR 2 — `refactor(workflows)!: delete dead YAML surface`
Branch: `refactor/workflow-yaml-honesty` (off `main`; independent of PR 1 — rebase-free)

### Task 4: Delete workflow-step `dependsOn`
**Description:** One vertical deletion (type → validator → node registry → UI → tests must land together to stay green): remove `dependsOn` from step interfaces; delete `validateDependsOn` + parallel-child `dependsOn` rejection; remove `dependsOnSchema` + field descriptor; remove `node-config-fields.ts` filter, canvas "dependsOn preserved" badge, drawer metadata note, `DependsOnSection`.
**Acceptance:**
- [ ] `grep -rn "dependsOn" packages/core/src/workflows plugins/workflows` → 0 hits.
- [ ] Canvas, node-config drawer, step-detail drawer render without the removed affordances.
**Verify:** `bun test tests/plugins/workflows/ --isolate`; `bun run typecheck`.
**Files (~10, mechanical single concern):** `packages/core/src/workflows/{definition-types,validate-definition,node-type-registry}.ts`, `plugins/workflows/lib/node-config-fields.ts`, `plugins/workflows/components/{workflow-canvas-editor,node-config-drawer,step-detail-drawer}.tsx`, affected tests. **Scope: L-mechanical**
**Commit:** `refactor(workflows)!: delete workflow-step dependsOn`

### Task 5: Delete gate `on_approve`; approval advances by position
**Description:** Remove `on_approve` from `GateStep`, the validator's expected-next check, the node-registry gate schema + descriptor, `canvas-editor-state.ts` default gate object, `node-config-fields.ts` labels/help/examples, the `routes/gates.ts:333` echo, and all 7 shipped YAMLs (`plugins/workflows/defaults/workflows/*.yaml`, `plugins/images/defaults/workflows/image-generation.yaml`). Runtime behavior is already position-based — no engine change.
**Acceptance:**
- [ ] Repo grep for `on_approve` → 0 hits outside git history.
- [ ] New/updated test: mid-workflow gate approval advances to the next step; final-gate approval completes the workflow.
- [ ] All 7 shipped YAMLs load and validate.
**Verify:** `bun test tests/plugins/workflows/ --isolate` (gate-hooks, parser, exec-tools, runtime, yaml-roundtrip, canvas/drawer suites).
**Files (~14, mechanical):** the above + tests. **Scope: L-mechanical**
**Commit:** `refactor(workflows)!: delete gate on_approve; approval advances by position`

### Task 6: Align `ParallelStep` children type with validator
**Description:** `ParallelStep.steps: AgentStep[]` (validator already rejects non-agent children); fix any type-level fallout (audit found casts in health-checks/engine that may simplify).
**Acceptance:** type matches validator; no behavior change.
**Verify:** `bun run typecheck`; `bun test tests/plugins/workflows/ --isolate`.
**Files:** `packages/core/src/workflows/definition-types.ts` + fallout. **Scope: XS**
**Commit:** `refactor(workflows): align ParallelStep children type with validator`

### Task 7: Strict builtin schemas + unknown-key health warning
**Description:** Flip the six builtin step schemas and their sub-schemas (`stepOutputSchema`, `notifyChannelSchema`, `on_reject` object, `taskSourceSchema`, `workflowInputSchema`, `nodePositionSchema`, `workflowLayoutSchema`, `workflowDefinitionSchema`) from `.passthrough()` to `.strict()`. Extend the `workflow-definitions` health check to warn on unknown keys in on-disk definitions (zod-parse each; report per-definition). Must land AFTER Tasks 4–5 in commit order (else shipped YAMLs' `on_approve` would strict-fail mid-branch).
**Acceptance:**
- [ ] Saving a definition with an unknown key (e.g. leftover `on_approve`) via PUT/POST is rejected with an error that names the key and step — NOT the generic "Invalid builtin step" union-fallthrough message.
- [ ] All 7 shipped YAMLs strict-parse clean.
- [ ] Health check warns on a fixture definition carrying a stray key; clean otherwise.
**Verify:** `bun test tests/plugins/workflows/node-type-registry.test.ts tests/plugins/workflows/routes.test.ts tests/plugins/workflows/health-checks.test.ts --isolate` (+ new unknown-key rejection tests).
**Files:** `packages/core/src/workflows/node-type-registry.ts`, `plugins/workflows/lib/health-checks.ts`, tests. **Scope: M**
**Commit:** `feat(workflows)!: strict builtin step schemas; unknown keys reject on save, warn in health`

### Task 8: Docs sweep for PR 2
**Description:** Update `.claude/knowledge/workflows-plugin.md` Runtime Execution Contract (drop `dependsOn`-as-metadata and `on_approve` rules; state gate-advance-by-position); re-grep `docs/`, `README.md`, `agents/` for stragglers (plan-phase grep was clean — confirm post-change).
**Verify:** `bun run docs:generate && bun run docs:validate && bun run docs:validate:routes`.
**Files:** `.claude/knowledge/workflows-plugin.md`. **Scope: XS**
**Commit:** `docs(knowledge): workflows YAML surface after dependsOn/on_approve removal`

### Checkpoint 2 (gate to PR 3)
- [ ] Full suite + typecheck + lint + docs validation green.
- [ ] Manual: load the workflows UI against dev/mock (`bun run dev:mock`), open a shipped workflow in the canvas, confirm gate nodes render and the config drawer shows no ghost fields.
- [ ] Open PR 2; user reviews.

---

## PR 3 — `docs(workflows): map_workflow fan-out design (#203)`
Branch: `docs/workflow-map-fanout-design`

### Task 9: Write the fan-out design doc
**Description:** `.claude/specs/workflow-map-fanout-design.md` — the buildable design for #203's core requirement. Must cover: motivation (video pipeline); `map_workflow` node semantics (`source` = prior-step output array path; one child instance per item via existing nested-workflow machinery; item injected as parent context); join-waits-all with stable source-order output aggregation; failure model (parent stays in_progress, per-child retry/cancel, no fail-fast, no policy knob); source-step `output_schema` contract; concurrency (children flow through existing dispatch caps — no new surface); UI (canvas node with child-status rollup; children appear as tasks like nested workflows today); validation rules; explicit non-goals (DAG, branching, forward jumps); implementation sketch + test plan for the future build.
**Acceptance:** doc answers every "Broader refactor questions" bullet in #203 that the interview scoped in, and names the rest as non-goals.
**Verify:** `bun run docs:validate`; user review of the doc is the real gate.
**Files:** `.claude/specs/workflow-map-fanout-design.md` (new). **Scope: M (one file, dense)**
**Commit:** `docs(workflows): map_workflow fan-out design (#203)`

### Task 10: Rewrite #203 (post-merge)
**Description:** `gh issue edit 203` — new body: current-engine summary (post-PR-1/2), link to the design doc, scope narrowed to "implement map_workflow per the design doc." Not a repo change; do after PR 3 merges.
**Verify:** issue body renders correctly; old context preserved via a comment noting the rewrite.

### Checkpoint 3 (batch complete)
- [ ] Spec success criteria 1–5 all check out (grep proofs, regression tests, docs).
- [ ] Update `.claude/specs/workflows-hardening.md` status → shipped; note in plan doc.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Deletion sweeps miss a consumer (runtime cast, test fixture) | Med | Success-criteria greps are part of Task 4/5 acceptance; typecheck catches typed consumers; `--isolate` full suite per commit |
| `.passthrough()` keeps stale keys inert (silently ignored) rather than rejected | Low | Deliberate: keep existing posture (see open question); stale keys are dead weight, not behavior |
| Known order-dependent full-suite flake (`header-update-banner`) | Low | Re-run the failing file individually before diagnosing (established pattern) |
| `bun run build` rewrites the tracked build stamp in the worktree | Med | Don't run `build` in this batch; if ever run, never `git add -A` (memory: generated-version build-stamp trap) |
| PR 2 UI edits conflict with concurrent canvas work on the machine | Low | Worktree isolates us; PRs are small and short-lived |

## Parallelization

PR 1 and PR 2 touch disjoint code (load path vs YAML surface) and can be built in parallel; land sequentially for review sanity. PR 3 is independent prose.

## Open Questions

None — all resolved (strictness decided at plan review; see finding 1 and Task 7).

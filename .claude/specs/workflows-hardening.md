# Spec: Workflows Hardening Batch

**Status:** Shipped 2026-07-04 — PRs #595 (cross-plugin refs, #374), #600 (YAML-surface deletions + strict schemas), #598 (map_workflow design doc). #203 re-scoped to implementation-only.
**Date:** 2026-07-03
**Issues:** #374 (implement), #203 (design doc + issue rewrite)
**Closed by the audit preceding this spec:** #386 (resolved by skill-registry redesign + #407), #98 (not planned — speculative, architecturally stale), #38 (obsolete premise, contradicts adapter-boundary doctrine)

## Objective

Reduce workflow-engine tech debt by making the YAML surface honest (no fields the engine ignores, no load-order landmines) and settle the dynamic fan-out design on paper so #203 becomes a buildable ticket instead of an umbrella.

Success looks like:
- A workflow in plugin A that nests a workflow shipped by plugin B loads identically regardless of plugin activation order.
- Every field a workflow author can write is a field the runtime actually reads.
- `.claude/specs/workflow-map-fanout-design.md` exists and settles the map-node semantics; #203's body points at it.

This machine is the only user. **No backwards compatibility, no shims, no deprecation windows** — dead surface is deleted outright.

## Context (verified against code, 2026-07-03)

- Execution is a strict ordered-list engine: top-level index advance, static `parallel` groups (validator restricts children to agent steps), recursive nested `workflow` steps, plugin node kinds. (`plugins/workflows/lib/engine.ts`, `packages/core/src/workflows/validate-definition.ts`)
- Start-time validation is already strict and recursive with cycle detection on **every** start path (REST, hooks, exec tools) via `createValidatedInstance` (`plugins/workflows/lib/start-validation.ts`).
- Load-time nested-ref validation is the only order-sensitive piece: `loadDefaultWorkflows` validates during each plugin's `activate()` with a known-set limited to that plugin's own batch, falling back to the live registry — so cross-plugin refs depend on activation order, and a miss **silently skips the parent workflow** (`packages/core/src/workflows/load-defaults.ts:57-68`).
- Workflow-step `dependsOn` is parsed, validated, and displayed — never read by the engine. No shipped YAML uses it. (Task-level `dependsOn` is a different, live system — out of scope.)
- Gate `on_approve` is required, has exactly one legal value (next top-level step id, or `done` when last — `validate-definition.ts:184-193`), and the runtime never branches on it. All 7 shipped YAMLs carry it; reordering steps forces manual re-sync.
- `ParallelStep` type admits `AgentStep | GateStep` children (`definition-types.ts:67-70`) but the validator rejects non-agent children (`validate-definition.ts:222-224`) — type/validator mismatch.
- `validateDefinition` already accepts `validateNestedWorkflowRefs?: boolean` (default `true`); no caller passes `false` (`validate-definition.ts:22,82,196`).

## Scope — three workstreams

### WS1 — #374: order-independent cross-plugin nested refs (PR 1)

**Decision (interview):** demote the load-time nested-ref existence check rather than add a boot settle pass. A settle pass would still miss hot-reload and user-plugin install timing; the health check + strict start validation cover all timings with less machinery.

1. `loadDefaultWorkflows` passes `validateNestedWorkflowRefs: false`. Structural validation, self-reference, and every other check stay **fatal** at load; only cross-workflow existence is deferred.
2. Collapse the now-unneeded two-pass parse in `load-defaults.ts` to a single pass (`knownWorkflowIds` no longer needed at load; `validateDefinition` keeps the param for start-validation use).
3. Extend the existing `workflow-definitions` health check (`plugins/workflows/lib/health-checks.ts` — already warns on missing skill refs) to also warn per definition: `workflow "X" references missing nested workflow "Y"`, evaluated against the live registry + user disk. Order-independent by construction, current under hot reload.
4. CRUD/save paths keep the existence check fatal (server is fully activated at save time, so the registry is complete — rejecting a bad save is correct there).
5. Start-time validation: unchanged (already the strict gate).

### WS2 — YAML-surface honesty (PR 2)

**Delete workflow-step `dependsOn`** (interview decision):
- Type family: remove from all step interfaces (`packages/core/src/workflows/definition-types.ts`).
- Validator: remove `validateDependsOn` and the parallel-child `dependsOn` rejection (`validate-definition.ts:148-165,225-227`).
- Node-type registry: remove `dependsOnSchema` and its 5 usages + the field descriptor (`node-type-registry.ts:137,161,181,194,204,230,251`).
- UI: remove the canvas "dependsOn preserved" badge (`workflow-canvas-editor.tsx:855-1035` region), the drawer note (`node-config-drawer.tsx:357-359`), `DependsOnSection` (`step-detail-drawer.tsx`), and the `node-config-fields.ts:31` filter.

**Delete gate `on_approve`** (interview decision):
- Approval always advances to the next top-level step, or completes the workflow at the last step — this is already the only runtime behavior (`gates.ts` advances via `advanceWorkflow`; `on_approve` is only echoed at `routes/gates.ts:333`).
- Remove from: `GateStep` type, validator check (`validate-definition.ts:184-193`), node-type gate schema (`node-type-registry.ts:173,258`), default gate object (`canvas-editor-state.ts:78`), labels/help/examples (`node-config-fields.ts:137,158,177`), route echo (`routes/gates.ts:333`), and all 7 shipped YAMLs (`plugins/workflows/defaults/workflows/*.yaml`, `plugins/images/defaults/workflows/image-generation.yaml`).
- `on_reject` (rewind via `goto`, `rejection_repeat` handling) is real and **stays untouched**.

**Align `ParallelStep`:** children typed `AgentStep[]` to match the validator.

**Flip builtin node-type schemas to `.strict()`** (decided at plan review): all plugins are managed in this repo + bakin-bits, and plugin-contributed node types validate against their own registered schemas (registry-dispatch branch), so strictness on the builtin schemas has no third-party blast radius. Unknown keys reject at the CRUD/save boundary (`routes/definitions.ts`); a health-check warning surfaces stray keys in already-on-disk definitions (the disk-load path uses the manual semantic validator and stays lenient). Unknown-key rejection errors must stay readable — a strict-failed builtin step falls through the zod union to the plugin-dispatch branch, which must not mask the real issue.

### WS3 — fan-out design doc + #203 rewrite (PR 3)

Write `.claude/specs/workflow-map-fanout-design.md`. Decisions already made in interview, to be elaborated:
- **Engine model:** ordered-list executor stays; add ONE step type — `map_workflow` (`source`: path to a prior step's output array; one child per item; child receives its item as parent context). No DAG, no scheduler rewrite.
- **Children reuse nested-workflow machinery** — instances, gates-inside-children, cycle detection, task-board visibility all come for free.
- **Join:** parent step stays `in_progress` until every child terminal-succeeds; outputs aggregated in stable source order.
- **Failure model:** join waits; failed children are individually retryable/cancellable; no fail-fast, no per-node policy knob.
- Doc must also cover: output-schema contract on the source step, concurrency (children flow through the existing dispatch caps — no new surface), UI representation (canvas rollup + children as tasks), and explicit non-goals (branching, forward jumps, arbitrary graphs).
- Rewrite #203's body: current-state summary, link to the design doc, scope narrowed to "implement map_workflow per the design doc."

## Non-goals

- Implementing `map_workflow` (design only).
- Touching task-level `dependsOn`, dispatch, or the recovery ladder.
- Instance-persistence changes (atomic JSON store stays; #38 closed).
- Notification formatting (#98 closed).

## Tech Stack

Existing: Bun ≥1.2, TypeScript strict, Zod at boundaries, React 19 (canvas UI), `bun:test`.

## Commands

```
Test (full):    bun run test
Test (single):  bun test tests/plugins/workflows/<file>.test.ts --isolate
Typecheck:      bun run typecheck
Lint:           bun run lint
Docs:           bun run docs:generate && bun run docs:validate && bun run docs:validate:routes
```

## Project Structure (touched surface)

```
packages/core/src/workflows/
  definition-types.ts       WS2: remove dependsOn, on_approve; align ParallelStep
  validate-definition.ts    WS1: (no change — flag exists) / WS2: remove dead checks
  load-defaults.ts          WS1: pass flag, collapse two-pass
  node-type-registry.ts     WS2: schema + field-descriptor removals
plugins/workflows/
  lib/health-checks.ts      WS1: nested-ref warnings in workflow-definitions check
  lib/routes/gates.ts       WS2: drop on_approve echo
  lib/canvas-editor-state.ts / lib/node-config-fields.ts   WS2
  components/{workflow-canvas-editor,node-config-drawer,step-detail-drawer}.tsx  WS2
  defaults/workflows/*.yaml WS2: strip on_approve
plugins/images/defaults/workflows/image-generation.yaml    WS2
tests/plugins/workflows/    all WSs: see Testing Strategy
.claude/knowledge/workflows-plugin.md    WS1+WS2: update Runtime Execution Contract,
                            document load-vs-start-vs-health validation tiers
.claude/specs/workflow-map-fanout-design.md   WS3 (new)
```

`README.md`: check for workflow YAML examples mentioning removed fields; update if present.

## Code Style

Repo conventions per `CLAUDE.md` (strict TS, kebab-case files, `createLogger`, import order). Deletions must be complete — no commented-out remnants, no `@deprecated` markers, no compat aliases.

## Testing Strategy

`bun:test`, files under `tests/plugins/workflows/`, mandatory content-dir + OpenClaw-home mocks per CLAUDE.md testing rules. Green at **every commit**, not just per PR.

- **WS1:** extend `load-defaults.test.ts` — parent in plugin A referencing child in plugin B, asserted in **both activation orders** (the #374 acceptance regression, image-social-post↔image-generation shaped); parent registers when child is absent; start-time still fails when child truly missing. Extend `health-checks.test.ts` — missing-nested-ref warning appears/clears.
- **WS2:** update `schema-validator.test.ts`, validator tests, `yaml-roundtrip.test.ts`, canvas/drawer component tests for removed fields; add a test that gate approval advances correctly with no `on_approve` present (last-gate → workflow completes).
- **WS3:** no code; docs validation commands only.

## Commit & Rollback Strategy

Three sequential PRs off `main`, each independently revertable; every commit conventional-format and green (`test` + `typecheck` + `lint`).

**PR 1 — `fix(workflows): order-independent cross-plugin nested refs (#374)`**
1. `fix(workflows): defer nested-ref existence to start validation; single-pass default loading` (+ tests)
2. `feat(workflows): health-check warning for missing nested workflow refs` (+ tests)
3. `docs(knowledge): document the three-tier validation model in workflows-plugin.md`

**PR 2 — `refactor(workflows)!: delete dead YAML surface (dependsOn, on_approve)`**
1. `refactor(workflows)!: delete workflow-step dependsOn` (types → validator → registry → UI → tests)
2. `refactor(workflows)!: delete gate on_approve; approval advances by position` (+ 7 YAMLs, tests)
3. `refactor(workflows): align ParallelStep children type with validator`
4. `docs: update workflows knowledge doc + any README examples`

**PR 3 — `docs(workflows): map_workflow fan-out design (#203)`**
1. Design doc + #203 issue-body rewrite (issue edit happens at merge time).

Rollback = revert the offending commit or PR; no cross-PR coupling. PR 2 depends on nothing in PR 1 (parallel-safe, but land sequentially for clean review).

## Boundaries

- **Always:** work only in this worktree (`.claude/worktrees/workflows-hardening`); full test suite + typecheck + lint green per commit; mock content-dir/OpenClaw-home in every test; update `.claude/knowledge/workflows-plugin.md` in the same PR as the behavior it documents.
- **Ask first:** any schema/type change beyond the three agreed deletions; anything touching dispatch, task-store, or task-level `dependsOn`; adding new YAML surface; changing gate `on_reject` semantics.
- **Never:** compat shims or deprecation aliases; edits in the main checkout; touching `~/.bakin/`; implementing fan-out in this batch; force-push to shared branches.

## Success Criteria

1. Regression test proves plugin-A→plugin-B nested refs load in both activation orders; missing children surface as health warnings and hard start-time errors — never silent skips.
2. `grep -r "dependsOn" packages/core/src/workflows plugins/workflows` returns zero hits (task-domain hits untouched); same for `on_approve` repo-wide outside git history.
3. All 7 shipped YAMLs load and their gates approve/advance/complete correctly.
4. Full suite green; docs validation green; knowledge doc matches the shipped behavior.
5. `.claude/specs/workflow-map-fanout-design.md` merged; #203 body rewritten to reference it with narrowed scope.

## Open Questions — resolved in plan phase

1. **Strictness:** flip builtin schemas to `.strict()` in PR 2 (see WS2) — decided with user at plan review; passthrough was the mechanism this batch exists to kill, and the ratchet only gets harder.
2. **`agents/` sweep:** clean — no `on_approve`/`dependsOn` in shipped agent content, README, or docs/.
3. **Health check placement:** fold into the existing `workflow-definitions` check id (it already walks all definitions' steps).

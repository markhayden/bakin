# Plan: `map_workflow` + Multi-Image Select (4 PRs)

**Status:** Approved 2026-07-05
**Spec:** `.claude/specs/map-workflow-and-multi-image-select.md`
**Engine semantics:** `.claude/specs/workflow-map-fanout-design.md`

## Context

Issue #203: ship the approved `map_workflow` dynamic fan-out/fan-in design, then prove
it end-to-end with the shipped Multi-Image Select workflow (one brief → 3 concurrent
image variants → agent vision-selects the winner → variants consolidate as versions of
one asset → human approves via Discord), validated live on the dockerized rig
(isolated mode) with cheap image models. All integration points below were verified
against source, not the design doc's stale paths.

## Verified integration points

- `packages/core/src/workflows/definition-types.ts` — `WorkflowStep` union :118; add `MapWorkflowStep`.
- `packages/core/src/workflows/node-type-registry.ts` — three coupling points: `BUILTIN_KINDS` :332, `builtinStepSchema` discriminated union :334-341, registration block :287-328. The plugin-reparse branch (:363-382) keys off `BUILTIN_KINDS` — adding to the set suffices.
- `packages/core/src/workflows/validate-definition.ts` — `workflow`-step three-tier existence validator :169-188 (reuse verbatim); positional checks mirror gate `on_reject.goto` validator :154-162 (`getTopLevelStepIndex`).
- `plugins/workflows/lib/engine.ts` — `advanceWorkflow` step-type chain :369-459 (map branch beside `'workflow'` :379); `createInstance` first-step case :113-132; `propagateChildCompletion` :260-318 (fork at the :269 guard); `cancelInstance` child loop :478-486; `CompleteStepResult.code` precedent :139-150.
- `plugins/workflows/types.ts` — `StepState` :105-120 (additive `children[]`, `code`, `error`).
- `plugins/workflows/lib/step-context.ts` — `getCurrentStep` nested delegate :116-122; `getActiveAgents` :324-333 (consumed by `src/core/dispatch-workflow.ts:52` via the `workflows.getActiveAgents` hook — this is how map children get dispatched).
- `plugins/workflows/lib/node-dispatch.ts` — `dispatchReopenedStep` single-`childTaskId` branch :189-197.
- `plugins/workflows/lib/gates.ts` — `reopenFromStep` :343-388 rejects only `cancelled` (a `failed` instance IS reopenable — `map_source_invalid` recovery needs zero reopen changes); `resetWorkflowFromStep` :296-341 resets downstream steps to `{status:'pending'}`, naturally clearing `children[]`/`code`.
- `plugins/workflows/lib/start-validation.ts` — `collectNestedWorkflowIds` :32-38; all start surfaces funnel through `createValidatedInstance` :98-112. One change point.
- `src/core/dispatch-workflow.ts` — byte budget fully wired (`resolveWorkflowContextBudget` :175-178, omission markers :231/:239). Map aggregate rides `stepStates[mapId].output` → `buildStepContext.stepOutputs` (`step-context.ts:195-210`) → budgeted renderer. **No new wiring — test only.**
- `plugins/assets/lib/asset-mutations.ts` — `addVersion` :65-102 (per-asset lock, `AssetVersionInput` :54-62), `promoteVersion` :195-208; `asset-trash.ts` `deleteAsset` :23 (soft trash); `manifest.ts` `GenerationSchema` :21, `AssetVersionSchema.generation` :60.
- UI: renderers register in `plugins/workflows/client.tsx:60-65` via `lib/node-renderer-registry.ts`; `components/nodes/workflow-node.tsx` is the sibling template; `components/step-detail-drawer.tsx`; config drawer is registry-metadata-driven.
- Board titles: `task-bridge.ts` `createBoardTaskForChild` :135-165 (title at :148) — map-child titling lands in PR1 with fan-out.
- Tests: `tests/plugins/workflows/helpers/runtime-harness.ts` (`seedWorkflowFixtures` :280-296 — add `map-flow.yaml` + `map-child.yaml` fixtures), nested patterns `runtime-engine.test.ts:386-505`, budget tests `tests/core/dispatch-workflow-context.test.ts`.
- E2E precedent: `scripts/validate-gates.ts`, `docs/validation/gate-discord-runbook.md`.
- HTTP auth: none exists on the API (verified) — agents can GET asset bytes directly; re-verify from inside the rig container in pre-flight.

## Dependency graph

```
PR1 (engine+types+validation)
 ├── T1.1 types+schema+registry ──┬── T1.2 validation rules      (T1.2 ∥ T1.3)
 │                                └── T1.3 fan-out
 ├── T1.4 fan-in (needs T1.3)
 ├── T1.5 single-childTaskId sweep + board titles (needs T1.3; ∥ T1.4)
 └── T1.6 budget test (needs T1.4)

PR2 (recovery+join) — blocked by PR1
 ├── T2.1 join-blocking semantics → T2.2 per-child retry/cancel
 ├── T2.3 cancel-parent sweep (∥ T2.2)
 └── T2.4 surfaces: hooks/routes/exec-tools (needs T2.2, T2.3)

PR3 (UI) — T3.1 map node+rollup (needs PR1) ∥ T3.2 drawer child list (needs PR2) ∥ T3.3 config-drawer check

PR4 — T4.1 consolidate service ∥ T4.3 workflow YAMLs; T4.2 exec tool (needs T4.1);
      T4.4 harness+runbook (needs T4.2, T4.3); T4.5 live validation + docs + closeout
```

PR order strict 1→2→3→4; marked tasks parallelize within PRs.

## Settled design details

### (a) Carrier for `map_source_invalid`

`advanceWorkflow` returns `boolean`, so **StepState is the carrier**:

1. `StepState` gains `code?: 'map_source_invalid'` + `error?: string` (additive).
2. Invalid source (missing key / non-array / > `max_children`): fan-out helper sets
   `stepStates[mapId] = { status:'failed', startedAt, code:'map_source_invalid', error }`,
   pushes history, sets `instance.status = 'failed'`. No partial spawn.
3. Surfacing: `getCurrentStep` gains a `'failed'` variant (parallel to the `'cancelled'`
   variant at step-context.ts:94) → flows through `CompleteStepResult.nextStep` (the
   source-step submitter sees it synchronously), `bakin_exec_workflows_get_step`,
   `GET /steps/:taskId`. UI reads `stepState.code`, never message text.
4. Recovery: `reopenFromStep(taskId, { stepId: sourceStepId })` works unchanged.

### (b) Map-step StepState lifecycle

- `pending` at init. Fan-out helper `fanOutMapStep(instance, step, def, contentDir, now)`
  called from the `advanceWorkflow` chain after `currentStepId = mapId`; sets
  `in_progress` + `children[]`. `getTopLevelIndex` unchanged (fan-in marks the step
  complete before calling `advanceWorkflow`).
- First-step map is statically illegal (source must name an earlier step); `createInstance`
  gets a defensive branch that fails typed if a non-validating path slips through.
- Empty array → `{ status:'complete', output:{ outputs: [] } }` + recursive
  `advanceWorkflow` in the same tick.
- Children: `childTaskId = ${taskId}--${stepId}--${i}`;
  `parentContext = { ...sourceStepOutput, [item_key ?? 'item']: item, mapIndex: i, mapTotal: N }`;
  `createInstance` + linkage + board task, identical machinery to the nested branch.
- `getCurrentStep` on the parent returns `null` mid-map (no single honest delegate);
  `getActiveAgents` returns the **union** of in-progress children's agents with
  `effectiveTaskId` so parent-task dispatch fans correctly.

### (c) Aggregated output → byte budget

Confirmed zero new wiring: fan-in writes `stepStates[mapId].output = { outputs: [...] }`
(index order; per-child value = the child's `finalOutput` per the existing promotion rule
at :274-285). T1.6 proves trimming + omission markers with a fat aggregate.

### (d) Consolidate idempotency

- `AssetVersionSchema` gains optional `consolidatedFrom: { assetId, version }`;
  `AssetVersionInput` passes it through `addVersion`.
- `consolidateAssets({ winnerAssetId, loserAssetIds, taskId })` in new
  `plugins/assets/lib/asset-consolidate.ts`:
  1. If no winner version carries `consolidatedFrom` → `promoteTarget = winner.currentVersion`
     (first run). If some do (re-run) → never promote (don't clobber manual re-promotes).
  2. Per loser in input order: already absorbed (`consolidatedFrom.assetId === loserId`)
     → skip addVersion, still ensure trashed. Else `addVersion(winner, { sourceFilePath,
     op:'import', tool:'consolidate', description, generation: loserCurrent.generation,
     consolidatedFrom })`.
  3. Loser missing and not absorbed → typed per-loser failure
     (`{ failed: [{assetId, code:'loser_not_found'}] }`), not a throw.
  4. Promote (first run only), then soft-trash still-live losers.
- Mutations take the per-asset lock internally; orchestration is check-then-act made
  safe by `consolidatedFrom` detection (first-write-wins ethos, single-operator box).
- Absorbed versions enrich once each (accepted, spec §9).

### (e) Workflow YAMLs (PR4)

`plugins/images/defaults/workflows/image-variant.yaml` — child, gate-free, one agent step
`generate-variant` (`$preferred(pixel,$assigned)`): reads `stepOutputs.__parentContext`
(prompt packet + `variant` directive + `mapIndex`/`mapTotal`), applies the directive
without changing subject/required-text/brand constraints, calls
`bakin_exec_images_generate` with the parent route (mcporter `--timeout 600000`), submits
`{ assetId, version, provider, model, promptHash }` per output_schema.

`plugins/images/defaults/workflows/image-multi-select.yaml` — parent:
1. `develop-prompt` — mirrors image-generation.yaml's packet framework +
   `bakin_exec_images_recommend` (quality draft, small surface) **plus** exactly 3
   variant directives; output_schema adds `variants` (array).
2. `prompt-gate` — `approval_required`, `on_reject: { goto: develop-prompt, note_to_agent: true }`.
3. `generate-variants` — `type: map_workflow`, `source: develop-prompt.variants`,
   `workflow_id: image-variant`, `item_key: variant`, `max_children: 3`.
4. `select-best` — fetch each `outputs[].assetId` over HTTP from
   `{BAKIN_URL}/api/assets/<assetId>`, view with vision, pick with written rationale,
   call `bakin_exec_assets_consolidate`, DELETE downloaded workspace copies, submit
   `{ assetId, selectedVersion, rationale }`.
5. `selection-gate` — `on_reject: { goto: select-best }` (re-select = re-promote a
   different version; no regeneration).
6. `output` — deliver final assetId (output steps require an agent owner,
   validate-definition.ts:109-111).

### (f) E2E harness scenarios (`scripts/validate-map-select.ts`)

Modeled on validate-gates.ts (scenario runner, Check records, operator y/n, `--report`):

- **happy**: start via REST → prompt-gate `pending_approval` [operator approves in
  Discord] → map `in_progress`, exactly 3 children `${taskId}--generate-variants--{0,1,2}`,
  board titles `{parent} — Generate Variants {i+1}/3`, each child has
  `parentContext.variant`/`mapIndex`/`mapTotal:3` → join: `output.outputs.length === 3`
  in source order regardless of completion order → post-select: winner manifest 3
  versions (2 with `consolidatedFrom`), `currentVersion` = winner's original, losers
  trashed → selection-gate approval `source: 'channel'` → instance complete.
- **reject-prompt**: reject at prompt-gate → rewind to develop-prompt, **zero children
  spawned** (spend guard) → approve second pass.
- **retry-child**: cancel one child via PR2 route → join blocked (siblings complete,
  entry `cancelled`) → retry → same `childTaskId` reused → join completes ordered.
- **cancel-parent**: mid-fan-out cancel → every live child cancelled, board tasks done.
- Pre-flight (all): image-route check (Codex-served first; `OPENAI_API_KEY` fallback),
  asset-bytes GET from inside the container, rig `--mode isolated`.

### (g) Gaps settled beyond the design doc

- **Re-fan-out after source reopen**: reopen resets the map step to `pending`; on
  re-fan-out the helper checks `loadInstance(childTaskId)` per would-be id, cancels any
  live prior child before `createInstance` overwrites, and revives the board task
  (`createBoardTaskForChild` duplicate-skip + move back to inProgress). PR1 test.
- **Out-of-band child cancellation**: parent entry stays `in_progress`, join blocks
  (by design). PR2's `GET .../map/:stepId/children` reports **live** child statuses
  (loads each child), so the drawer shows truth and offers retry/cancel.

## PR1 — engine + types + validation (`feat(workflows)`)

- **T1.1 Types + schema + registry** — definition-types.ts (`MapWorkflowStep`), 
  node-type-registry.ts (strict schema, form fields [source req, workflow_id req,
  item_key, max_children], `registerNodeType` with `edgeRules: { maxOutbound: 1 }`,
  `BUILTIN_KINDS`, discriminated union), types.ts (`children?/code?/error?`).
  TDD via node-type-registry/edge-rules/yaml-roundtrip tests.
  Verify: `bun test tests/plugins/workflows/node-type-registry.test.ts --isolate && bun test tests/plugins/workflows/yaml-roundtrip.test.ts --isolate`
- **T1.2 Validation + cycles** — validate-definition.ts (source `<stepId>.<key>` format;
  exists/top-level/strictly-earlier; workflow_id three-tier reuse incl. self-ref fatal;
  explicit not-inside-parallel error; nested-map **warning** via a new additive
  `collectDefinitionWarnings(def)` export — the `string[]` error contract stays
  untouched), start-validation.ts (`collectNestedWorkflowIds` walks map refs).
  Verify: `bun test tests/plugins/workflows/parser.test.ts --isolate && bun test tests/plugins/workflows/load-defaults.test.ts --isolate`
- **T1.3 Fan-out** — engine.ts `fanOutMapStep` + advanceWorkflow branch + defensive
  createInstance branch; task-bridge.ts map-child titling (optional param). Semantics
  per (b); stale-child sweep per (g). New `runtime-map.test.ts` (preferred over growing
  runtime-engine) + harness fixtures: N children ids/linkage/context; board titles;
  typed failure ×3 shapes (assert code, zero children, instance failed); empty-array
  advance; reopen-source re-fan-out; crash-restart (reload instance mid-fan-out).
  Verify: `bun test tests/plugins/workflows/runtime-map.test.ts --isolate`
- **T1.4 Fan-in** — propagateChildCompletion map branch: update entry by childTaskId
  with the child's finalOutput; all complete → aggregate ordered, mark complete +
  history, board-task-done per child, advanceWorkflow + existing completion tail.
  Tests: out-of-order stable aggregation; partial leaves in_progress; map-as-last-step
  completes parent; nested recursion (map inside a child of another parent).
  Verify: `bun test tests/plugins/workflows/runtime-map.test.ts --isolate && bun test tests/plugins/workflows/runtime-engine.test.ts --isolate`
- **T1.5 Single-childTaskId sweep** — cancelInstance iterates `children[]`;
  getCurrentStep (`'failed'` variant / null mid-map); getActiveAgents union;
  node-dispatch reopened-step revive per child.
  Verify: `bun test tests/plugins/workflows/runtime-step-context.test.ts --isolate`
- **T1.6 Budget proof** — tests/core/dispatch-workflow-context.test.ts only: fat
  `{outputs:[…]}` trims with the :231 marker, newest kept, under-budget byte-identical.
  Verify: `bun test tests/core/dispatch-workflow-context.test.ts --isolate`

**Commits:**
1. `feat(workflows): add map_workflow step type, strict schema, and registry entry`
2. `feat(workflows): validate map_workflow source, workflow_id, and nesting cycles`
3. `feat(workflows): fan out map_workflow children with typed map_source_invalid failure`
4. `feat(workflows): join map_workflow children with stable-order aggregation`
5. `feat(workflows): teach child-aware surfaces about map children`
6. `test(core): prove map aggregates ride the workflow context byte budget`

Each commit leaves `bun run test` + `bun run check` green; any suffix reverts to a
coherent smaller feature.

**Risks:** mutual recursion (createInstance↔advanceWorkflow↔propagateChildCompletion) —
map branch as a leaf helper, never restructure; existing nested/parallel tests stay
green untouched. StepState union ripple — `bun run check` per commit, variant additive.
Fire-and-forget board tasks — assert via harness hooks as nested tests do.

## PR2 — recovery + join semantics (`feat(workflows)`)

- **T2.1 Join-blocking** (tests-first): failed/cancelled child never cascades; join
  fires only when ALL entries complete.
- **T2.2 Per-child retry/cancel** — new `plugins/workflows/lib/map-children.ts`:
  `retryMapChild(parentTaskId, stepId, index)` — live child → `reopenFromStep`;
  terminally dead → recompute item from the parent's source-step output, sweep old
  instance, re-create with same childTaskId + rebuilt context + board revive; entry →
  `in_progress`. `cancelMapChild` — cancelInstance + entry `cancelled` + board done.
  `listMapChildren` — entries hydrated with live child statuses per (g).
  Tests incl. child-gate-inside-map approval flows to join.
- **T2.3 Cancel-parent semantics tests** (mechanical sweep landed in T1.5): mixed child
  states → only live children cancelled.
- **T2.4 Surfaces** — register-hooks.ts (`workflows.{retryMapChild,cancelMapChild,listMapChildren}`),
  routes/instances.ts (`GET /instances/:taskId/map/:stepId/children`,
  `POST .../children/:index/retry`, `POST .../cancel`), exec-tools.ts
  (`bakin_exec_workflows_retry_map_child`, `bakin_exec_workflows_cancel_map_child`;
  audit + indexInstance + triggerDispatch on retry). Tests via `callRoute`/`callTool`.

**Commits:**
1. `test(workflows): pin map join-blocking semantics`
2. `feat(workflows): per-child retry and cancel for map_workflow steps`
3. `test(workflows): cancel-parent sweeps live map children`
4. `feat(workflows): expose map-child recovery via hooks, routes, and exec tools`

**Risks:** dead-child re-create uses the instance's current source output (single source
of truth; pinned by test). Retry racing an in-flight turn — same exposure as any reopen;
ledger claims cover; noted in PR description.

**Checkpoint → PR3:** full suite + check green; PR1+PR2 merged; mock-mode smoke
(`bun run dev:mock`: start a map fixture, watch children on the board).

## PR3 — UI (`feat(workflows)`)

- **T3.1 Canvas node + rollup** — new `components/nodes/map-workflow-node.tsx`
  (template: workflow-node.tsx; badge `5/8 complete, 1 failed` from
  `stepStates[id].children[]`; children never canvas nodes); register in client.tsx.
  Reuse workflow-detail's existing instance-state-on-canvas wiring (SSE) — no new
  polling path.
- **T3.2 Drawer child list** — step-detail-drawer.tsx: per-child list from the PR2 GET
  route (live statuses), retry/cancel buttons → PR2 POSTs; `map_source_invalid` banner
  from typed code + "Re-run source step" affordance via existing reopen surface.
- **T3.3 Config drawer registry check** — likely test-only (registry-driven); fix any
  hardcoded kind switches found.

**Commits:**
1. `feat(workflows): map_workflow canvas node with live child rollup`
2. `feat(workflows): map-step drawer child list with retry and cancel actions`
3. `test(workflows): map_workflow config drawer renders from registry metadata`

**Checkpoint → PR4:** full suite + check; visual smoke in dev:mock.

## PR4 — consolidate + workflows + E2E (`feat(assets)`, `feat(images)`)

- **T4.1 Consolidate service** — manifest.ts `consolidatedFrom`, asset-mutations.ts
  passthrough, new asset-consolidate.ts per (d), barrel export. TDD:
  `tests/plugins/assets/asset-consolidate.test.ts` (full CLAUDE.md mock block): happy
  path (3→1 asset/3 versions/current=winner/losers trashed/provenance + copied
  generation); full re-run no-op; partial re-run absorbs only missing, never
  re-promotes; loser-not-found typed failure; input-order numbering.
- **T4.2 Exec tool** — `bakin_exec_assets_consolidate` (zod: winnerAssetId,
  loserAssetIds min 1, taskId), audit event, description states end state + re-call
  safety. No REST route (drawer doesn't need it).
- **T4.3 Workflow YAMLs** — per (e); load-defaults parse+validate tests + a scripted
  end-to-end runtime test of the parent shape (3 variants → children → ordered
  aggregate → select-best context has `outputs[]`).
- **T4.4 Harness + runbook** — validate-map-select.ts per (f);
  docs/validation/map-select-runbook.md (isolated rig bring-up,
  `channelAliases.approvals: "discord:channel:<id>"` explicit-prefix gotcha, image
  pre-flight, Codex-first + secrets.op.env fallback, container→host BAKIN_URL, asset
  bytes check, known gaps).
- **T4.5 Live validation + docs + closeout** — run all 4 scenarios on the rig, record
  results in the spec (#385 precedent). Docs sweep: `.claude/knowledge/workflows-plugin.md`
  (map semantics, StepState.children, recovery, typed code),
  `.claude/knowledge/assets-versioning.md` (consolidate + consolidatedFrom),
  `.claude/knowledge/dockerized-openclaw-rig.md` (only if validation teaches something),
  `docs/src/content/docs/` workflow-authoring map step, CLAUDE.md one-liner only if
  warranted. Close #203 with a summary comment.

**Commits:**
1. `feat(assets): consolidateAssets service with consolidatedFrom provenance`
2. `feat(assets): bakin_exec_assets_consolidate exec tool`
3. `feat(images): image-variant and image-multi-select default workflows`
4. `feat(images): map-select e2e validation harness and runbook`
5. `docs: map_workflow and asset-consolidation knowledge + user docs; record validation results`

**Risks:** asset-fetch auth (none exists, but re-verify from inside the container in
pre-flight; fallback decided then, not pre-built). Codex-served images (confirmed
working on the main instance; pre-flight anyway). select-best agent compliance is
instruction-driven (harness machine-checks end state; selection-gate is the human
backstop). Consolidate races (single operator + provenance detection + per-asset lock;
documented, not over-engineered). Double-enrichment cost accepted per spec §9.

## Checkpoints

| Gate | Must be green |
|---|---|
| PR1 → PR2 | full `bun run test` + `bun run check`; runtime-map + budget tests pass; zero changes to existing nested/parallel expectations |
| PR2 → PR3 | full suite + check; retry/cancel proven at route + exec-tool level; mock-mode board smoke |
| PR3 → PR4 | full suite + check; visual smoke (badge, drawer actions) in dev:mock |
| PR4 done | full suite + check; all 4 rig scenarios recorded in the spec; #203 closed |

Global rules on every commit: conventional commits with scope; tests mock BOTH
content-dir resolvers + OpenClaw home, `--isolate` per file; typed codes only; gates run
bare (never piped); never write real `~/.bakin`/`~/.openclaw` from tests or the rig.

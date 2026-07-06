# Spec: `map_workflow` Implementation + Multi-Image Select Workflow

**Status:** Approved 2026-07-05 (interview completed; user sign-off)
**Issue:** #203
**Design doc (authoritative for engine semantics):** `.claude/specs/workflow-map-fanout-design.md`
**Builds on:** workflows-hardening (#595/#598/#600), gate/Discord validation harness (#607)

## 1. Objective

Ship the `map_workflow` step type exactly per the approved design doc, then prove it
end-to-end with a real, shipped workflow: **Multi-Image Select** — one prompt, three
concurrently-generated image variants (map fan-out), an agent picks the best with
vision, variants are consolidated as versions of a single winning asset, and a human
approves via Discord. Validation runs live on the dockerized rig (isolated mode)
using cheap image models instead of the video pipeline.

Users: this machine's single operator. No backwards-compat concerns; no shims.

## 2. Decisions settled in the spec interview

| Question | Decision |
|---|---|
| Engine semantics | Exactly per design doc. No deviations. |
| `maxWorkflowContextBytes` | Already wired (`src/core/dispatch-workflow.ts` budgets prior-step outputs with omission markers; recon initially missed it). In scope: a test proving map-aggregated `{ outputs: [...] }` flows through the budgeted path and trims with markers. No new wiring. |
| Context compaction | Existing pattern is the answer: truncate visibly + `bakin_exec_workflows_get_instance` retrieval. No summarization mechanism. |
| E2E test workflow | NOT the collage/fantasy-creature idea (a collage is one good prompt — doesn't exercise fan-out). Instead **Multi-Image Select**: generate 3 unique variants of one brief, agent selects the best. Genuinely useful for social posts. |
| Workflow disposition | Ships as a **plugin default** in `plugins/images/defaults/workflows/` (alongside `image-generation.yaml`). May be culled later; kept for testability. |
| Gates | Both: prompt gate before fan-out (guards 3× spend) + selection gate after the pick. Children are gate-free. |
| Agent judges images by | HTTP fetch from the Bakin asset API + vision (works in prod and rig). Step instructions require deleting downloaded workspace copies after judging. |
| Variant asset disposition | All three become **versions of one asset**: children create 3 standalone assets (concurrency forbids shared `versionOf`); a new `bakin_exec_assets_consolidate` tool absorbs losers as versions of the winner, promotes the winning version, trashes the loser assets. End state: one asset, 3 versions, current = winner. |
| Rig credentials | Try Codex-served OpenAI first; documented fallback = uncomment `OPENAI_API_KEY` op:// ref in `dev/docker/secrets.op.env`. Pre-flight route check before any billed run. |
| Rig mode | `--mode isolated` (never native for tests — native touches real `~/.bakin`). |
| PR strategy | 4 PRs (below), each independently green + revertable, atomic conventional commits as rollback checkpoints. |
| Variant count | Fixed at 3 by prompt instruction in v1 (array is still runtime-produced — dynamic path exercised). |
| Spec/plan location | `.claude/specs/` (repo convention; no root SPEC.md). |

## 3. Scope

### PR1 — engine + types + validation (`feat(workflows)`)

Per design doc §Implementation sketch item 1, with **corrected paths** (the doc predates
the FW7 refactor):

- `MapWorkflowStep` in `packages/core/src/workflows/definition-types.ts` (union at :118).
- Strict zod schema + form fields + `registerNodeType` in
  `packages/core/src/workflows/node-type-registry.ts` — update all three coupling
  points together: `BUILTIN_KINDS`, `builtinStepSchema` discriminated union,
  registration block.
- Validation in `packages/core/src/workflows/validate-definition.ts`:
  - `source: <stepId>.<key>` — earlier top-level step (mirror the deleted `dependsOn`
    validator shape from commit `f93d3f8b`: exists / top-level / earlier).
  - `workflow_id` — reuse the three-tier existence model verbatim (:169-188).
  - Explicit "not inside parallel children" message (structurally already rejected).
  - Nested-map (map child containing a map) → validation **warning**, per doc non-goals.
- Cycle detection: `collectNestedWorkflowIds` in
  `plugins/workflows/lib/start-validation.ts` also walks `map_workflow.workflow_id`.
- Fan-out in `plugins/workflows/lib/engine.ts`:
  - New branch in `advanceWorkflow` (:371-462) AND the first-step case in
    `createInstance` (:114-132).
  - `childTaskId = ${taskId}--${stepId}--${i}`; parentContext = prior step output +
    `{ [item_key ?? 'item']: item, mapIndex: i, mapTotal: N }`;
    `createBoardTaskForChild` per child.
  - Source contract enforcement at fan-out time (independent of `output_schema`):
    missing key / non-array / length > `max_children` (default 32) →
    step `status: 'failed'` with typed `code: 'map_source_invalid'` on `StepState`
    (extends the `rejection_repeat` code-discriminant precedent; never message-text
    matching). Recoverable via `reopenFromStep` on the source step. Empty array →
    step completes immediately with `output: { outputs: [] }`.
- Fan-in: map-aware branch in `propagateChildCompletion` (:260-318) — update the
  child's entry in `StepState.children[]`; all terminal-successful → aggregate
  `{ outputs: [...] }` in index order, complete step, advance parent.
- `StepState` gains `children?: { index: number; childTaskId: string; status: ... }[]`
  (`plugins/workflows/types.ts:105-120`, additive).
- Sweep the single-`childTaskId` assumptions: `cancelInstance` recursion
  (engine.ts:478), `getCurrentStep` + `getActiveAgents`
  (`step-context.ts:115-122, :327-330`), `node-dispatch.ts:191`.

Tests (extend `tests/plugins/workflows/helpers/runtime-harness.ts` fixtures +
`runtime-engine.test.ts` patterns): fan-out N children with correct ids/linkage/context;
stable-order aggregation regardless of completion order; empty-array advance;
`map_source_invalid` on missing key / non-array / over-max; crash-restart (reload
instance mid-fanout); map aggregation subject to `maxWorkflowContextBytes` with
omission markers (extends `tests/core/dispatch-workflow-context.test.ts`).

### PR2 — recovery + join semantics (`feat(workflows)`)

Per design doc item 2:

- Per-child retry (`reopenFromStep` on the child; full re-create with same
  `childTaskId` + item context if terminally dead) and per-child cancel
  (`cancelInstance` on the child → entry `cancelled`).
- Join-blocking: failed/cancelled child blocks the join, never cascades; parent map
  step stays `in_progress`.
- Cancel-parent recursion sweeps `children[]`.
- Surfaces: hooks in `plugins/workflows/lib/register-hooks.ts` + REST routes +
  exec tools, mirroring existing `reopenFromStep`/`cancelInstance` registration.

Tests: single-child failure blocks join; retry unblocks and join completes; cancel-parent
sweeps live children; child gate approval flows to join (child workflows with gates).

### PR3 — UI (`feat(workflows)`)

Per design doc item 3:

- Canvas: `map_workflow` node renderer (alongside nested-workflow node) with live
  rollup badge (`5/8 complete, 1 failed`). Children never appear as canvas nodes.
- Step drawer: per-child list (status, link to child board task, retry/cancel actions
  wired to PR2 surfaces).
- Board task titles: `{parent title} — {label} {i+1}/{N}`.
- Node config drawer: form fields from registry metadata only (no special-casing).

Component tests per existing canvas/drawer suites.

### PR4 — consolidate tool + Multi-Image Select + E2E harness (`feat(images)`, `feat(assets)`)

**`bakin_exec_assets_consolidate`** (assets plugin — service logic in
`asset-mutations.ts` territory, tool in `exec-tools.ts`):

- Input: `{ winnerAssetId, loserAssetIds: string[], taskId }`.
- Behavior: for each loser (input order), `addVersion(winnerAssetId)` from the loser's
  current-version file with provenance metadata (source assetId, generation record);
  promote the winner's original version as `currentVersion`; soft-delete (trash) the
  loser assets. Serialized under the existing per-asset manifest lock; idempotent on
  retry (re-consolidating already-absorbed losers is a no-op, not an error — follows
  the ledger first-write-wins ethos).
- Runs server-side (host filesystem) — immune to the container-path rig gap.

**Workflows** in `plugins/images/defaults/workflows/`:

`image-variant.yaml` (child, minimal):
- One agent step: read `stepOutputs.__parentContext` (prompt packet + `variant`
  uniqueness directive + `mapIndex`/`mapTotal`), call `bakin_exec_images_generate`
  (taskId, packet, provider/model/surface/quality from parent route), submit
  `{ assetId, version, provider, model, promptHash }` per output_schema. No gates.

`image-multi-select.yaml` (parent; display name "Multi-Image Select", final naming
at build time):
1. `develop-prompt` — agent `$preferred(pixel,$assigned)`, mirrors
   `image-generation.yaml`'s prompt-packet framework + `bakin_exec_images_recommend`
   routing; output_schema adds `variants` — exactly 3 entries, each a short
   uniqueness directive (composition/style/mood divergence).
2. `prompt-gate` — gate, `approval_required`, `on_reject: goto develop-prompt`.
3. `generate-variants` — `type: map_workflow`, `source: develop-prompt.variants`,
   `workflow_id: image-variant`, `item_key: variant`, `max_children: 3`.
4. `select-best` — agent: fetch each variant image over HTTP from the Bakin asset API
   (`{BAKIN_URL}/api/assets/<assetId>`), view with vision, pick a winner with written
   rationale, call `bakin_exec_assets_consolidate`, **delete downloaded workspace
   copies**, submit `{ assetId, selectedVersion, rationale }`.
5. `selection-gate` — gate, `on_reject: goto select-best` (all versions live on the
   one asset; a re-select just re-promotes a different version — no regeneration).
6. `output` — selected assetId.

Quality/cost defaults: budget-tier model (`gpt-image-1-mini` or whatever
`bakin_exec_images_recommend` returns at `quality: draft`), small surface.

**E2E validation** (gate-discord precedent):
- `scripts/validate-map-select.ts` — machine-checked harness (start instance via REST,
  poll instance/step states, assert: 3 children spawned with correct ids, join
  aggregation order, consolidate end-state one-asset-three-versions-winner-current,
  gate approval records with `source: 'channel'`), operator prompts for the Discord
  button clicks + visual confirmations. Scenarios: happy path; reject-at-prompt-gate;
  child-failure → per-child retry → join completes; cancel-parent sweep.
- `docs/validation/map-select-runbook.md` — rig setup (isolated mode), Discord
  notification config (`channelAliases.approvals: "discord:channel:<id>"` — explicit
  `channel:` prefix required), image-route pre-flight, Codex-served-first credential
  plan + `OPENAI_API_KEY` fallback, known rig gaps and their workarounds.
- Results recorded back into this spec (validation section), per #385 precedent.

**Docs sweep (same PR):**
- `.claude/knowledge/workflows-plugin.md` — map_workflow semantics, StepState.children,
  recovery, typed error.
- `.claude/knowledge/assets-versioning.md` — consolidate semantics.
- `.claude/knowledge/dockerized-openclaw-rig.md` — image-credential note if we learn
  anything new in validation.
- `CLAUDE.md` — only if a one-liner in the workflows bullet is warranted.
- `docs/src/content/docs/` (Astro user docs) — workflow authoring: the map step type.
- Close out #203 with a summary comment.

## 4. Commands

- `bun run test` (full suite), `bun test tests/plugins/workflows/<file> --isolate` (single file)
- `bun run check` / typecheck + lint gates as wired in package.json — run bare, never piped
- `bun run instance up --mode isolated` / `bun run instance dev --mode isolated` (rig)
- `bun scripts/validate-map-select.ts --scenario <happy|reject-prompt|retry-child|cancel-parent>`

## 5. Project structure (touch surface)

```
packages/core/src/workflows/{definition-types,node-type-registry,validate-definition}.ts
plugins/workflows/lib/{engine,step-context,node-dispatch,start-validation,register-hooks,exec-tools,routes/*}.ts
plugins/workflows/types.ts
plugins/workflows/components/*            (PR3)
plugins/assets/lib/{asset-mutations,asset-service,exec-tools}.ts   (PR4)
plugins/images/defaults/workflows/{image-multi-select,image-variant}.yaml
scripts/validate-map-select.ts
docs/validation/map-select-runbook.md
tests/plugins/workflows/*, tests/core/dispatch-workflow-context.test.ts, tests/plugins/assets/*
.claude/knowledge/{workflows-plugin,assets-versioning}.md
```

## 6. Code style

Repo conventions per CLAUDE.md: strict TS, zod at boundaries, functional preference,
`createLogger`, kebab-case files, conventional commits with scope. Typed error codes
only — never error-message-text branching (architecture-test enforced).

## 7. Testing strategy

- All unit/integration tests mock BOTH content-dir resolvers + OpenClaw home per
  CLAUDE.md testing rules; workflow tests build on `runtime-harness.ts`.
- Source-step outputs are scripted by passing arrays to `completeStep` — no live
  runtime in CI.
- E2E (billed, operator-present) is rig-only via the harness + runbook; never in CI.
- TDD per task: failing test first for every engine behavior.

## 8. Boundaries

**Always:** follow the design doc's decision table for any engine question; keep
children ordinary nested-workflow instances; typed codes for failures; atomic
manifest writes via existing asset lock.

**Ask first:** any deviation from the design doc's semantics; any new settings key;
promoting the harness workflow beyond the images plugin defaults.

**Never:** DAG/readiness semantics, `on_child_failure` policy knobs, nested-map
support (warn only), cross-child communication, silent skip of a failed child
(join waits — explicit user action or cancel-parent only), backwards-compat shims,
writes to real `~/.bakin`/`~/.openclaw` from tests or the rig.

## 9a. Implementation status (2026-07-05)

All four PRs built and unit/integration tested (5800+ tests green per commit):
PR1 #617 (engine), PR2 #620 (recovery), PR3 #621 (UI), PR4 (consolidate +
workflows + harness). Two build-time deviations, both improvements:
- The canvas rollup moved to the task detail panel (`MapChildrenPanel`) — the
  canvas is definition-only by design; a new `POST /instances/:taskId/reopen`
  route backs the failed-state recovery affordance.
- Consolidate restores the PRE-CALL pointer on every run (not just first),
  so re-runs never clobber a manual re-promote.

**Live rig validation: PENDING** — run per `docs/validation/map-select-runbook.md`
(operator-present, billed) and record results below.

## 9b. Live validation results

_To be recorded after the rig session (scenarios: happy, reject-prompt,
retry-child, cancel-parent)._

## 9. Risks / open items tracked into the plan

- Codex-served image generation is confirmed working on the user's main Bakin
  instance (Codex auth only, no API key) — expected to work on the rig; keep the
  pre-flight route check + `OPENAI_API_KEY` fallback as cheap insurance.
- `select-best` needs the rig container to reach the host Bakin URL — same
  requirement gate-discord validated; confirm in pre-flight.
- Asset HTTP fetch by the agent assumes the asset route serves bytes without
  browser-session auth from the agent's context — verify early in PR4; if blocked,
  mint a short-lived token or serve via existing export mechanism (decide then).
- Enrichment runs per consolidated version — confirm no double-billing (enrichment
  skip guard is `done+forVersion`; absorbing a file as a new version will enrich the
  new version once — acceptable, it's a vision-LLM call, not an image generation).

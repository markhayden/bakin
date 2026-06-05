# Implementation Plan: Workflow Cleanup and Refactor

Companion spec: `.claude/specs/workflow-cleanup-and-refactor.md`.

## Status (2026-06-05)

- **PR 1 shipped** — editor stabilization (#355).
- **PR 2 shipped** — image workflow filename contract (#341 closed).
- **PR 3 shipped** — workflow skill drift detection + repair (#342 closed).
- **PR 4 not done** — the shipped-workflow audit doc
  (`.claude/specs/workflow-defaults-audit.md`) was never written.
- **PR 5 shipped** — default workflow availability controls
  (`plugins/workflows/lib/availability.ts`, `disabled` flag,
  `~/.bakin/workflows/disabled-defaults.json`).
- **PR 6 + PR 7A–E not started** — no `map_workflow` anywhere in the repo;
  dynamic video fanout remains the open core of #203.

## Overview

Ship workflow cleanup as a sequence of release-note-friendly PRs. The first PR restores a usable, runtime-honest editor. The next PRs clean known workflow contracts and drift surfaces. Only after the baseline is healthy do we add dynamic fanout for video.

## Architecture Decisions

- React Flow remains the editor foundation.
- The editor reflects current ordered-step runtime semantics.
- Connectors are derived from ordered steps, not user-authored scheduling edges.
- Ordering controls start canvas-first, with side/list controls deferred unless testing shows they are needed.
- No in-app YAML/source editor.
- Plugin-owned workflows are read-only in place and support Save as new.
- Drift visibility goes through doctor/health checks.
- Safe repair requires provenance and explicit confirmation.
- Installed workflow skill provenance uses `.installedBy` / `.userEdited` sidecars next to the markdown file, not markdown frontmatter.
- Disabled default workflow state lives as workflow-owned content at `~/.bakin/workflows/disabled-defaults.json`.
- Disabled defaults are unavailable for future matching, selection, and normal explicit starts unless a caller uses a deliberate override. Existing active instances continue unaffected.
- Dynamic fanout uses explicit control-flow nodes, starting with video.
- The new dynamic video fanout workflow ships enabled by default because Bakin is still pre-production; hardening can happen through test runs and follow-up PRs.
- Video workflow outputs use canonical asset filename fields, not raw filesystem paths: `video_filename`, optional `thumbnail_filename`, optional `audio_filename`, and publish via `bakin_exec_post_channel(videoFilename=...)`.
- PR 2 is a narrow exception to audit-before-rewrite because #341 is already confirmed in YAML contracts.
- Existing `dependsOn` fields are preserved and warned about in PR 1; they are not shown as execution edges.
- Full arbitrary DAG scheduling is not part of this program unless a later decision supersedes this plan.

## PR Sequence

Commit strategy entries are rollback checkpoints. When implemented, use
conventional-commit-shaped subjects for each checkpoint, for example
`test(workflows): characterize editor round trip` or
`fix(workflows): preserve metadata-only dependsOn fields`.

### PR 1: Workflow Editor Stabilization

Release note headline:

> Workflows: restore the visual editor and align it with runtime-supported step ordering.

Scope:

- Fix `/workflows/:id/edit` so existing workflows render reliably.
- Keep React Flow, but disable user-authored freeform edges as execution state.
- Make clear that existing user-drawn edges were already visual-only and not persisted.
- Derive connectors from ordered `definition.steps`.
- Add canvas-first order controls.
- Make node add/edit/delete/save work for top-level supported node types.
- Preserve layout positions as visual hints.
- Preserve fields not owned by the editor, including `dependsOn`, definition-level `triggers`/`metadata`, gate notification/preview config, output metadata, createTask config, plugin-node opaque config, node-level `output_schema`, and unknown extension fields.
- Preserve or read-only render unsupported legacy shapes instead of dropping them.
- Show a warning for `dependsOn` because runtime validates it but still executes by order.
- Keep plugin-owned workflows read-only in place with Save as new.
- Label user-owned same-id shadows of plugin workflows.
- Add simple static parallel child agent editing.
- Add browser-backed verification for the real editor path.
- Choose the PR 1 browser/route verification harness before implementing the editor fix. This is a PR 1 entry decision, not a later deferred decision.

Non-scope:

- No YAML editor.
- No dynamic fanout.
- No default disabling.
- No workflow runtime scheduling rewrite.

Likely files:

- `plugins/workflows/components/workflow-canvas-editor.tsx`
- `plugins/workflows/components/workflow-canvas.tsx`
- `plugins/workflows/components/node-config-drawer.tsx`
- `plugins/workflows/components/node-type-palette.tsx`
- `plugins/workflows/lib/dagre-layout.ts`
- `plugins/workflows/lib/edge-rules.ts`
- workflow YAML serializer/round-trip helper if needed
- `packages/host/src/routes/workflows.$id.edit.tsx`
- `packages/host/src/routes/workflows.new.tsx`
- `tests/plugins/workflows/workflow-canvas-editor.test.tsx`
- `tests/plugins/workflows/yaml-roundtrip.test.ts`
- new browser/integration coverage under `tests/plugins/workflows/`
- `.claude/knowledge/workflows-plugin.md`

Acceptance criteria:

- Opening an existing workflow in edit mode shows its current nodes.
- User can select a node and edit supported fields.
- User can add a supported node.
- User can reorder top-level steps through direct canvas controls.
- User can add, remove, reorder, and edit static parallel child agent steps through a simple list/form.
- User cannot draw/save arbitrary runtime edges.
- Existing `dependsOn` fields are preserved and shown as metadata-only warnings, not execution edges.
- Unsupported or invalid legacy YAML is inspectable and cannot be silently normalized into data loss.
- Save persists ordered steps and layout hints.
- Layout hints are stored as `definition.layout.positions[stepId] = { x, y }`; parallel child positions are optional but preserved when present.
- Saving an unchanged user workflow is byte-stable.
- Editing one supported field changes only the expected YAML region plus layout positions.
- Reloading the workflow shows the saved design.
- Plugin-owned workflows show read-only/customize messaging and use Save as new.
- Same-id user shadows of plugin workflows are labeled as shadows and remain editable as user-owned files.
- Tests cover the real broken path, not only React Flow stubs.
- PR 1 explicitly decides the browser verification tool: add Playwright or define an equivalent host-route integration harness using the existing Bun + DOM stack.

Verification:

```bash
bun test --isolate tests/plugins/workflows/workflow-canvas-editor.test.tsx tests/plugins/workflows/node-type-palette.test.tsx tests/plugins/workflows/node-config-drawer.test.tsx
bun test --isolate tests/plugins/workflows
bun run typecheck
bun run lint
# plus the selected PR 1 browser/route harness, for example:
# bunx playwright test tests/plugins/workflows/workflow-editor.spec.ts
# or
# bun test --isolate tests/plugins/workflows/workflow-editor-host-route.test.tsx
```

Manual/browser verification:

```bash
bun run dev:mock
```

Then verify:

- `/workflows`
- `/workflows/image-social-post`
- `/workflows/image-social-post/edit`
- add/edit/reorder/save/reload

Commit strategy:

1. Failing characterization test for current editor behavior.
2. Editor state model cleanup: derived connectors and canvas-first ordering.
3. Node edit/add/delete/save fixes.
4. Parallel child editor support.
5. Browser/integration verification and docs update.

Rollback boundary:

- Revert this PR to return to the prior editor without touching runtime or workflow defaults.

### PR 2: Image Workflow Filename Contract Cleanup

Release note headline:

> Workflows: image defaults now pass canonical asset filenames between steps.

Scope:

- Update repo-shipped image workflow YAML to use `image_filename`.
- Remove path-based generated image output requirements.
- Update image social post publish handoff to consume filename-based outputs.
- Add regression tests to prevent defaults from drifting back to path contracts.

Non-scope:

- No installed local content repair.
- No plugin extraction.
- No broad workflow rewrite.

Likely files:

- `plugins/workflows/defaults/workflows/image-generation.yaml`
- `plugins/workflows/defaults/workflows/image-social-post.yaml`
- `tests/plugins/workflows/yaml-roundtrip.test.ts`
- new default-contract tests under `tests/plugins/workflows/`
- `.claude/knowledge/workflows-plugin.md`

Acceptance criteria:

- Default image workflows no longer require agents to emit generated image paths.
- Default image workflows use canonical asset filenames as stable identity.
- `generate-image.md` remains unchanged unless a future audit finds a real skill-level issue; it already tells the agent to emit the save tool's returned filename.
- Tests catch `imagePath`, `image_path`, and raw path-based image outputs in shipped YAML defaults.

Verification:

```bash
bun test --isolate tests/plugins/workflows/yaml-roundtrip.test.ts
bun test --isolate tests/plugins/workflows
bun run typecheck
bun run lint
```

Commit strategy:

1. Add failing default-contract test.
2. Update image-generation workflow/schema/instructions.
3. Update image-social-post handoff/publish instructions.
4. Update docs.

Rollback boundary:

- Revert this PR to restore old image defaults only.

### PR 3: Installed Workflow Skill Drift Detection and Repair

Release note headline:

> Health: workflow skill drift is now visible and safely repairable.

Scope:

- Add managed provenance for plugin and agent-package workflow skills.
- Detect local user workflow skill files that shadow those managed sources. Do not proactively materialize every managed workflow skill to disk.
- Store workflow skill provenance in sidecars next to the markdown file:
  - `<skill>.md.installedBy`
  - `<skill>.md.userEdited`
- Replace `~/.bakin/workflows/skills/{name}.md` only through explicit repair when safe:
  - target has matching managed provenance
  - target exactly matches a known old repo-shipped skill hash and user confirms adopt-and-replace
- Detect stale installed workflow skill patterns:
  - `beacon_exec_`
  - `image_path`
  - `imagePath`
  - `video_path`
  - `videoPath`
  - `audio_path`
  - `audioPath`
  - path-based generated image outputs
  - path-based generated media outputs
  - manual-save instructions that conflict with managed asset generation
- Surface results through Health/doctor and contextual Workflows UI.
- Add repair planning for managed, unedited stale skills.
- Repair by full-file replacement only when provenance proves the current file is managed and unedited.
- Offer adopt-and-replace for unmarked files only when the current hash exactly matches a known old repo-shipped workflow skill hash from a repo-shipped manifest.
- Keep customized/user-edited content advisory only.
- Document seeding, shadowing, provenance, and repair behavior.

Non-scope:

- No silent overwrite of user edits.
- No repair without explicit doctor repair flow.
- No phrase-level patching of customized or unknown workflow skill files.
- No repo default contract cleanup, already handled in PR 2.
- No proactive boot-time materialization of all managed workflow skills.

Likely files:

- `plugins/workflows/lib/health-checks.ts`
- `plugins/workflows/lib/skill-loader.ts`
- `plugins/workflows/lib/agent-package-skill-registry.ts`
- `plugins/workflows/lib/workflow-skill-drift.ts`
- `plugins/workflows/defaults/workflow-skill-legacy-hashes.json`
- `plugins/workflows/index.ts`
- `tests/plugins/workflows/health-checks.test.ts`
- `tests/plugins/workflows/workflow-skill-drift.test.ts`
- `tests/plugins/workflows/routes.test.ts`
- `tests/plugins/workflows/workflow-canvas.test.tsx`
- `tests/plugins/workflows/workflow-detail.test.tsx`
- `.claude/knowledge/workflows-plugin.md`

Acceptance criteria:

- Doctor flags the stale local `generate-image.md` patterns described by #342.
- Doctor also flags stale path-style media output patterns such as `videoPath`, `video_path`, `audioPath`, and `audio_path`.
- Plugin and agent-package workflow skill loaders preserve source-file provenance.
- Existing unmarked customized local workflow skills are not overwritten by repair.
- The exact-old-hash adoption list is repo-shipped and deterministic, not network-fetched.
- The legacy-hash manifest is manually maintained in the same PR as any
  workflow-skill change that needs adopt-and-replace repair. Each entry records
  a reason and introducing change. The manifest is bounded to known
  pre-production upgrade paths and should be pruned before the first production
  release.
- Installed workflow skill repair state is stored in sidecars, not markdown frontmatter.
- Skill frontmatter remains reserved for behavior metadata such as `name` and `output_schema`.
- Managed, unedited stale workflow skills have a safe repair plan.
- Safe repair replaces the entire stale managed file from current source, rather than applying brittle text substitutions.
- Unmarked files can be adopted and replaced only when they exactly match a known old repo-shipped skill hash and the user confirms.
- Customized workflow skills are not auto-repaired.
- Files marked `.userEdited`, files with missing provenance, and files whose current hash differs from the recorded installed hash are advisory-only unless they satisfy the exact old-hash adoption path.
- UI and CLI can show the drift through Health surfaces, and the Workflows UI can show contextual warnings for affected workflows/steps.
- Tests cover detection and at least one safe repair path.

Verification:

```bash
bun test --isolate tests/plugins/workflows/health-checks.test.ts
bun test --isolate tests/cli/doctor-repair.test.ts tests/core/doctor-repair.test.ts
bun test --isolate
bun run typecheck
bun run lint
```

Commit strategy:

1. Add stale-pattern detection tests.
2. Add provenance model for installed workflow skills.
3. Add workflow-skill materializer with sidecars.
4. Add full-file replacement repair for proven managed unedited skills.
5. Add exact-old-hash adopt-and-replace path.
6. Wire health registration and docs.

Rollback boundary:

- Revert this PR to remove drift detection/repair while preserving repo defaults from PR 2.

### PR 4: Shipped Workflow Audit

Release note headline:

> Workflows: add a health audit for shipped default workflows.

Scope:

- Audit repo-shipped workflow definitions and workflow skills one by one.
- Document happy path, contract health, known gaps, and recommended future action.
- Split follow-up implementation tasks by workflow.
- Do not rewrite every workflow in this PR.

Defaults to audit:

- `text-social-post`
- `image-generation`
- `image-social-post`
- `video-script`
- `clip-creation`
- `assemble-video`
- `video-social-post`

Default workflow skills to audit:

- `generate-image`
- `generate-video`
- `publish`
- `write-copy`

Likely files:

- `.claude/specs/workflow-defaults-audit.md` or equivalent
- `.claude/knowledge/workflows-plugin.md`
- GitHub issues or checklist follow-ups if desired

Acceptance criteria:

- Every repo-shipped workflow has an audit entry.
- Every repo-shipped workflow skill has an audit entry.
- Each entry has a recommended path: keep, small cleanup, major redesign, or disable-by-default candidate.
- Video workflows explicitly point to dynamic fanout work.
- Image workflows reflect PR 2 filename contract.

Verification:

```bash
bun test --isolate tests/plugins/workflows/yaml-roundtrip.test.ts
bun run docs:validate
bun run lint
```

Commit strategy:

1. Add audit document skeleton.
2. Audit simple text/image defaults.
3. Audit video defaults and identify redesign needs.
4. Update workflow knowledge docs.

Rollback boundary:

- Documentation-only revert.

### PR 5: Default Workflow Availability Controls

Release note headline:

> Workflows: default workflows can be disabled when they should not be selected automatically.

Scope:

- Add workflow-owned storage for disabled default/core workflow ids at `~/.bakin/workflows/disabled-defaults.json`.
- Ensure listing UI surfaces disabled status.
- Ensure matcher/task creation does not pick disabled defaults by accident.
- Ensure explicit starts by id reject disabled defaults unless an override is provided.
- Define override surfaces:
  - CLI: `--allow-disabled-workflow`
  - HTTP/API bodies: `allowDisabledWorkflow: true`
  - definition list endpoints: `includeDisabled=true`
  - plugin hooks: `allowDisabledWorkflow: true`
- Keep existing active and historical workflow instances readable/runnable.
- Add diagnostics for disabled workflow references if needed.
- Keep user-created workflows unaffected unless explicitly disabled by the same model.
- Any tasks-plugin UI change must consume workflow availability through a
  workflows-owned API route or registered hook. The tasks plugin must not import
  workflow internals directly.

Non-scope:

- No dynamic fanout.
- No workflow content rewrite unless audit identifies a tiny necessary fixture.

Likely files:

- `plugins/workflows/lib/availability.ts`
- `plugins/workflows/lib/source-registry.ts`
- `plugins/workflows/lib/matcher.ts`
- `plugins/workflows/components/workflows-page.tsx`
- `plugins/workflows/components/workflow-card.tsx`
- `plugins/tasks/components/new-task-dialog.tsx`
- `plugins/workflows/index.ts`
- `src/core/task-service.ts`
- `src/core/cli/registry.ts`
- `tests/plugins/workflows/availability.test.ts`
- `tests/plugins/workflows/matcher.test.ts`
- `tests/plugins/workflows/workflows-page.test.tsx`
- `tests/cli/workflows.test.ts` if CLI behavior changes
- `tests/core/task-service.test.ts` for explicit start/create behavior and override audit assertions
- `.claude/knowledge/workflows-plugin.md`

Acceptance criteria:

- User can disable a shipped default workflow.
- Disabled defaults remain inspectable in management/status surfaces but are not matched or selected accidentally.
- Auto-match ignores disabled defaults.
- Task creation workflow selectors omit disabled defaults unless explicitly showing management/status.
- Normal workflow definition consumer lists omit or mark disabled defaults clearly.
- CLI workflow lists omit disabled defaults by default or expose them only with an explicit include flag.
- Explicit starts by id reject disabled default workflows with a clear error unless an override is provided.
- Override use is visible in audit/log output.
- Existing active and historical workflow instances continue to load and run.
- Disabled status is visible in the UI.
- CLI/health can surface suspicious disabled references if relevant.

Verification:

```bash
bun test --isolate tests/plugins/workflows
bun test --isolate tests/core/task-service.test.ts tests/cli/workflows.test.ts
bun test --isolate
bun run typecheck
bun run lint
```

Commit strategy:

1. Add storage/model tests.
2. Add matcher behavior.
3. Add UI controls/status.
4. Add docs.

Rollback boundary:

- Revert this PR to restore all defaults as available.

### PR 6: Dynamic Video Fanout Design Spec

Release note headline:

> Workflows: define dynamic video fanout semantics before implementation.

Scope:

- Write a focused spec for `map_workflow` or equivalent.
- Define restricted source path syntax: `<prior-step-id>.<field>[.<field>...]`, with no wildcards, array indexes, filters, or arbitrary JSONPath in v1.
- Define empty-array behavior: source must resolve to a non-empty array unless `allow_empty: true`.
- Define `allow_empty: true` output: complete immediately with `source.count: 0`, `results: []`, and `finalOutputs: []`.
- Define dot-containing step id policy for `map_workflow` sources: source paths can only reference step ids without `.`.
- Define required children as every child created from the resolved source array; optional children and partial joins are out of scope for v1.
- Define stable child ids after script edit/retry.
- Define fanout concurrency limit, child agent assignment, SSE/progress volume, and dispatch cost preview policy.
- Define parent/child instance state.
- Define visible child task behavior.
- Define aggregation output shape:
  - `source.path`
  - `source.count`
  - `childWorkflowId`
  - ordered `results[]`
  - convenience `finalOutputs[]`
- Define retry/reopen behavior for one child without resetting successful siblings.
- Define editor visualization expectations.
- Define video-specific workflow shape.

Non-scope:

- No runtime implementation yet unless this PR is intentionally split.

Likely files:

- `.claude/specs/workflow-dynamic-fanout.md`
- `.claude/specs/workflow-dynamic-fanout-plan.md`
- `.claude/knowledge/workflows-plugin.md`

Acceptance criteria:

- Runtime semantics are unambiguous enough for tests.
- Video is the reference use case.
- Audio/quality decisions are resolved or explicitly listed as PR 7A-E open items with owners.
- The future video fanout workflow is planned as enabled by default, not hidden behind disabled-default availability.
- Fanout contracts for source path, empty source, required children, stable child ids, child assignment, concurrency, progress events, and cost preview are resolved.

Verification:

```bash
bun test --isolate tests/plugins/workflows
bun run docs:validate
bun run lint
```

Commit strategy:

1. Draft fanout contract.
2. Add video reference workflow design.
3. Add implementation task breakdown.

Rollback boundary:

- Documentation-only revert.

### PR 7A: `map_workflow` Parser and Runtime State

Release note headline:

> Workflows: add the runtime state model for mapped child workflows.

Scope:

- Add `map_workflow` type definitions.
- Add parser and validator support for restricted source paths.
- Add instance state for mapped child records without dispatching children yet.
- Add source resolution tests, including missing source and empty-array behavior.
- Keep `map_workflow` non-executable until PR 7B. If runtime encounters it in
  PR 7A, the step fails fast with a clear `map_workflow_not_implemented`
  error; it must not hang the parent or silently skip.
- Do not expose `map_workflow` as an editor-palette option until executable
  child dispatch exists.

Likely files:

- `plugins/workflows/types.ts`
- `plugins/workflows/lib/node-type-registry.ts`
- `plugins/workflows/lib/parser.ts`
- `plugins/workflows/lib/runtime.ts`
- `tests/plugins/workflows/runtime.test.ts`
- `tests/plugins/workflows/parser.test.ts`
- `.claude/knowledge/workflows-plugin.md`

Acceptance criteria:

- Parser accepts valid `map_workflow` nodes and rejects unsupported source syntax.
- Runtime can resolve a source array from prior step outputs.
- Empty array behavior follows the PR 6 contract.
- Mapped child state is serializable and stable across reload.
- Runtime fails fast with an explicit not-implemented error if a workflow reaches
  `map_workflow` before PR 7B lands.
- The editor cannot add `map_workflow` nodes until PR 7C.

Verification:

```bash
bun test --isolate tests/plugins/workflows/parser.test.ts tests/plugins/workflows/runtime.test.ts
bun run typecheck
bun run lint
```

Rollback boundary:

- Revert parser/state support without touching child task creation or defaults.

### PR 7B: Mapped Child Task Creation and Join

Release note headline:

> Workflows: mapped workflows create visible child tasks and rejoin in order.

Scope:

- Create one visible child Bakin task per source item.
- Start the configured child workflow for each task.
- Aggregate completed child outputs into ordered `results[]` and `finalOutputs[]`.
- Keep parent step in progress until all required children complete.
- Enforce fanout concurrency policy from PR 6.

Likely files:

- `plugins/workflows/lib/runtime.ts`
- `plugins/workflows/types.ts`
- `plugins/workflows/index.ts`
- `src/core/task-store.ts`
- `src/core/task-service.ts` if task creation needs service-level effects/audit
- `src/core/sse.ts` or workflow notification files if progress events change
- `tests/plugins/workflows/runtime.test.ts`
- `tests/core/task-service.test.ts` if service-level task creation changes
- `.claude/knowledge/workflows-plugin.md`

Acceptance criteria:

- Parent maps `segments[]` into visible child tasks.
- Each child runs the configured child workflow.
- Parent joins only after all required children complete.
- Parent output preserves child outputs in source order.
- Parent output includes child task id, child instance id, source input, status, final output, and per-step outputs.

Verification:

```bash
bun test --isolate tests/plugins/workflows/runtime.test.ts
bun run typecheck
bun run lint
```

Rollback boundary:

- Revert child task creation/join while keeping parser/state support if useful.

### PR 7C: Fanout Retry, Status UI, and Editor Node

Release note headline:

> Workflows: mapped child workflow status and retries are visible.

Scope:

- Show dynamic child task status on parent workflow detail/edit surfaces.
- Add editor support for the `map_workflow` node without pretending dynamic children are static YAML nodes.
- Render a positive `map_workflow` UI: source path, child workflow id, configured
  concurrency, child count/status badge when an instance is running, and links
  or drill-in controls for child task detail.
- Support retry/reopen for one failed or rejected child without regenerating successful siblings.
- Re-join automatically after the retried child completes.

Likely files:

- `plugins/workflows/components/workflow-detail.tsx`
- `plugins/workflows/components/workflow-canvas-editor.tsx`
- `plugins/workflows/components/node-config-drawer.tsx`
- `plugins/workflows/components/workflow-canvas.tsx`
- `plugins/workflows/lib/node-type-registry.ts`
- `plugins/workflows/lib/runtime.ts`
- `tests/plugins/workflows/workflow-canvas-editor.test.tsx`
- `tests/plugins/workflows/runtime.test.ts`
- new route/component coverage under `tests/plugins/workflows/`
- `.claude/knowledge/workflows-plugin.md`

Acceptance criteria:

- Failed/rejected child can be inspected without losing the whole parent.
- Failed children can be retried from the failed step or from the beginning of the child workflow.
- Reopening/retrying one child does not regenerate completed sibling segments.
- Parent assembly starts only after every required child is complete.
- Editor shows the static `map_workflow` node and its config.
- Running workflow detail shows child count/status and drill-in links to child tasks.
- UI does not show runtime-created children as saved static YAML nodes.

Verification:

```bash
bun test --isolate tests/plugins/workflows
bun run typecheck
bun run lint
bun run dev:mock
```

Rollback boundary:

- Revert retry/UI/editor support while preserving runtime primitives.

### PR 7D: Video Fanout Workflow Defaults

Release note headline:

> Workflows: video production fans out segment creation into child tasks.

Scope:

- Add or update `video-social-post` to use `map_workflow`.
- Add `video-segment-creation` child workflow.
- Update video script/assembly contracts to use ordered `finalOutputs[]`.
- Keep the new video fanout workflow enabled by default.
- Standardize media outputs on filenames, not paths.

Likely files:

- `plugins/workflows/defaults/workflows/video-social-post.yaml`
- `plugins/workflows/defaults/workflows/video-script.yaml`
- `plugins/workflows/defaults/workflows/video-segment-creation.yaml`
- `plugins/workflows/defaults/workflows/assemble-video.yaml`
- `plugins/workflows/defaults/workflow-skills/generate-video.md`
- `plugins/workflows/defaults/workflow-skills/publish.md`
- `tests/plugins/workflows/yaml-roundtrip.test.ts`
- default-contract tests under `tests/plugins/workflows/`
- `.claude/knowledge/workflows-plugin.md`

Acceptance criteria:

- Video workflow uses the primitive as the first shipped proof and is enabled by default.
- If pre-production testing hits the spec's disablement threshold, the workflow
  is disabled through `disabled-defaults.json` until a follow-up fixes the workflow.
- Segment workflow outputs use `video_filename` as the required asset identity.
- Assembly workflow outputs use final `video_filename` as the required asset identity.
- Generated media is saved through `bakin_exec_assets_save(type=video|audio|images)`.
- Generated media outputs do not use `videoPath`, `audioPath`, or raw filesystem paths.

Verification:

```bash
bun test --isolate tests/plugins/workflows
bun run typecheck
bun run lint
bun run dev:mock
```

Rollback boundary:

- Revert video defaults without removing the underlying fanout runtime.

### PR 7E: Video Fanout End-to-End Hardening

Release note headline:

> Workflows: video fanout has end-to-end mock-runtime coverage.

Scope:

- Run a full parent video workflow through script, segment fanout, child completion, join, assembly, and publish handoff in the mock runtime.
- Add regression coverage for stable child ids, retry after script edits, and publish filename handoff.
- Document known quality gaps found during real test runs.

Likely files:

- `tests/plugins/workflows/runtime.test.ts`
- `tests/plugins/workflows/video-fanout.e2e.test.ts` or equivalent
- `dev/imitation-crab/` fixtures if mock runtime needs seeded media responses
- `plugins/workflows/defaults/workflows/*video*.yaml`
- `.claude/specs/workflow-defaults-audit.md`
- `.claude/knowledge/workflows-plugin.md`

Acceptance criteria:

- A 30-second-style video workflow can run end-to-end in the mock runtime.
- Stable child id behavior is covered.
- Retry does not duplicate completed child tasks.
- Publish handoff uses `videoFilename`.
- If two consecutive full video-fanout runs fail to produce a usable final asset
  for workflow-design reasons after one segment retry, use PR 5 availability to
  disable the default until fixed.
- Follow-up quality issues are captured if real media generation still needs tuning.

Verification:

```bash
bun test --isolate tests/plugins/workflows
bun run typecheck
bun run lint
bun run dev:mock
```

Rollback boundary:

- Revert hardening/tests/docs without removing shipped runtime behavior.

## Dependency Graph

```text
Editor stabilization
  -> workflow audit can be inspected visually

Image repo contract cleanup
  -> installed stale-skill detection can repair toward the new contract

Installed drift detection/provenance
  -> safe UI/CLI repair path

Shipped workflow audit
  -> default workflow availability decisions
  -> per-workflow cleanup PRs
  -> dynamic fanout video spec

Dynamic fanout spec
  -> PR 7A parser/runtime state
  -> PR 7B child task creation/join
  -> PR 7C retry/status UI/editor node
  -> PR 7D video workflow defaults
  -> PR 7E end-to-end hardening

Healthy image/video workflows
  -> later official plugin extraction
```

## Cross-Cutting Verification

Before each PR:

```bash
git status --short
```

Before each PR is ready:

```bash
bun test --isolate tests/plugins/workflows
bun run typecheck
```

When UI changes:

```bash
bun run dev:mock
```

When docs or public surfaces change:

```bash
bun run docs:validate
```

Before larger merge points:

```bash
bun run lint
bun test --isolate
```

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Editor still passes unit tests while broken in browser | High | Add real browser/integration verification in PR 1 |
| Canvas implies DAG scheduling that runtime does not support | High | Derived connectors only; explicit order controls |
| User custom workflow skills get overwritten | High | Provenance plus explicit repair plan; advisory only for customized files |
| Local shadows hide improved defaults | Medium | Keep Save as new in UI; add drift/availability visibility later |
| Dynamic fanout becomes too abstract | Medium | Use video as the first target and acceptance test |
| Video quality depends on media choices not yet proven | Medium | Keep audio placement provisional and validate through actual workflow runs |
| Default disabling breaks matching unexpectedly | Medium | Ship as separate PR with matcher-focused tests |
| Workflow-skill provenance has no files to mark | High | PR 3 adds an explicit materializer/installer before relying on sidecars |
| Fanout runtime overloads local task/dispatch surfaces | Medium | PR 6 defines concurrency, event volume, and cost-preview policy before implementation |
| Many concurrent child tasks clutter the UI | Medium | PR 6 defines concurrency and PR 7C adds grouped child status/drill-in instead of only flat task noise |
| Drift detection false positives become nagging warnings | Medium | Keep repair advisory-only for unknown/custom files and add exact stale-pattern tests before surfacing warnings |
| Legacy hash manifest grows without bounds | Low | Maintain it manually with reason metadata and prune obsolete pre-production entries before production release |

## Release Note Outline

- PR 1: Visual workflow editor restored and aligned with runtime step ordering.
- PR 2: Image workflows now pass canonical asset filenames between steps.
- PR 3: Workflow skill drift is visible in Health/doctor and safely repairable.
- PR 4: Shipped workflow defaults now have an explicit health audit.
- PR 5: Default workflows can be disabled to avoid accidental selection.
- PR 6: Dynamic fanout design for video workflows is documented.
- PR 7A: `map_workflow` parser and runtime state are available.
- PR 7B: Mapped workflows create visible child tasks and join in source order.
- PR 7C: Mapped child status and retry controls are visible.
- PR 7D: Video workflows can fan out segment production into visible child tasks.
- PR 7E: Video fanout has end-to-end mock-runtime coverage.

## Deferred Decisions

These are not blockers for PR 1, but each must be resolved before its owning PR starts:

- PR 3: exact workflow-skill materializer command/API surface and whether it runs on boot, doctor repair, explicit install, or a combination.
- PR 6: source path syntax edge cases beyond the restricted dot path, fanout concurrency limit, progress event/SSE volume, child agent assignment policy, dispatch cost preview, and stable child ids after script edits followed by retry.
- PR 7D: exact media provider/tool choices for video generation, voiceover, and assembly.

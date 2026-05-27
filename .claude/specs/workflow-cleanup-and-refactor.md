# Spec: Workflow Cleanup and Refactor

## Status

Draft kickoff spec for the workflow cleanup program.

Related issues:

- #203: Workflow plugin cleanup and refactor: graph semantics, dynamic fanout, and richer production flows
- #341: Audit image workflow filename contract
- #342: Detect and repair stale installed workflow skills

Companion plan: `.claude/specs/workflow-cleanup-and-refactor-plan.md`.

## Assumptions

1. This work should land as meaningful PRs with release-note-friendly boundaries.
2. PR 1 is editor-only stabilization.
3. PR 2 is repo-shipped image workflow filename contract cleanup.
4. PR 3 is installed workflow skill drift detection and repair.
5. The shipped-default workflow audit is a documentation/spec PR before per-workflow rewrites.
6. The first audit covers repo-shipped defaults only. Local installed content is handled through diagnostics and repair.
7. React Flow remains the workflow editor foundation.
8. The editor must reflect the current ordered-step runtime. It must not imply arbitrary graph scheduling.
9. No in-app YAML editor is needed. Advanced users can edit workflow YAML directly in their IDE.
10. Plugin-owned workflows are read-only in the editor and can be saved as new user workflows. Same-id local shadowing is supported through direct YAML/PUT user overrides but is not the primary editor copy path.
11. Default/core workflow disabling is included in the editor stabilization surface as a managed-workflow availability override.
12. Dynamic fanout/fanin should be implemented through explicit control-flow nodes, not a full arbitrary DAG runtime.
13. Video production is the first real target for dynamic fanout.
14. Dynamic video fanout should create visible child Bakin tasks, each running a segment workflow.
15. Audio/voiceover belongs in parent assembly by default, but this remains provisional until real output-quality testing.
16. PR 1 ordering controls should start canvas-first. Users should be able to interact with nodes directly; a side/list reorder affordance can be added later if real usage shows it is needed.
17. Disabled default workflow state should live as workflow-owned content under `~/.bakin/workflows/`, not in generic plugin settings.
18. Disabled default workflows are unavailable for future matching, selection, and normal explicit starts unless a caller uses a deliberate override. Existing active instances continue unaffected.
19. Installed workflow skill provenance uses sidecar files next to the markdown skill file, not extra markdown frontmatter.
20. The new video fanout workflow should ship enabled by default. Bakin is not production released yet, so we can test and harden this default workflow in place.
21. PR 2 is a narrow exception to the audit-before-rewrite rule because #341 is already confirmed and contract-level, not a broad workflow redesign.
22. This is a single-user, single-machine system. Do not add compatibility layers or staged migrations unless a later decision explicitly needs them.

## Objective

Make Bakin workflows trustworthy again by fixing the authoring experience, correcting stale workflow contracts, surfacing drift safely, auditing shipped defaults, and then adding the dynamic fanout model needed for production-grade video workflows.

Success means:

- Users can open, understand, edit, and save workflows through a working React Flow editor.
- The editor presents only runtime-supported behavior.
- Shipped image workflows use canonical asset filenames, not filesystem paths, as the step contract.
- Installed workflow skills that drift from repo defaults are visible in UI/CLI diagnostics and repairable only when safe.
- Shipped workflows have a written health audit before larger rewrites.
- Video workflows have a clear path toward script segmentation, fanout child tasks, segment generation, join, assembly, review, and publish.

## Non-Goals

- No full arbitrary DAG runtime in the initial cleanup.
- No in-app YAML/source editor.
- No silent overwrite or auto-revert of customized user content.
- No image/video plugin extraction until workflows are healthy.
- No dynamic video fanout in PR 1, PR 2, or PR 3.
- No broad runtime scheduling rewrite before current editor/defaults/drift surfaces are stable.

## Current Findings

### Editor

The current editor is intended to be the sole create/edit surface:

- `plugins/workflows/components/workflow-canvas-editor.tsx`
- `plugins/workflows/components/node-type-palette.tsx`
- `plugins/workflows/components/node-config-drawer.tsx`
- `plugins/workflows/lib/node-type-registry.ts`

Existing tests pass, but they stub React Flow and do not prove the real browser flow:

```bash
bun test --isolate tests/plugins/workflows/workflow-canvas-editor.test.tsx tests/plugins/workflows/node-type-palette.test.tsx tests/plugins/workflows/node-config-drawer.test.tsx tests/plugins/workflows/parser.test.ts tests/plugins/workflows/yaml-roundtrip.test.ts
```

The first editor PR must add browser-backed or equivalent integration verification that actually opens a workflow, renders nodes, edits a node, adds a node, changes step order, saves, and reloads.

### Runtime Model

Current runtime support is intentionally conservative:

- Ordered top-level step list.
- Static `parallel` groups whose children are agent steps.
- Nested `workflow` steps.
- Human `gate` steps.
- `output` steps.
- `createTask` system steps.
- Plugin-owned node kinds through explicit registered handlers.

`dependsOn` is metadata and validation only. Freeform canvas edges are not scheduler truth today.
The current editor already does not persist drawn canvas edges; it persists
`definition.layout.positions` only. PR 1 therefore removes a misleading visual
affordance rather than changing runtime scheduling behavior.

### Image Workflow Contract

Issue #341 is confirmed:

- `plugins/workflows/defaults/workflows/image-generation.yaml` still asks for `imagePath` and `thumbnailPath`.
- `plugins/workflows/defaults/workflows/image-social-post.yaml` still reads `stepOutputs['generate-image'].finalOutput.imagePath`.
- `plugins/workflows/defaults/workflow-skills/generate-image.md` already uses `image_filename` and tells the agent to emit the save tool's returned filename.

Repo-shipped image workflows should use canonical asset filenames such as `image_filename` as the step contract.

### Installed Workflow Skill Drift

Current workflow health checks only inspect frontmatter and `output_schema`:

- `plugins/workflows/lib/health-checks.ts::checkWorkflowSkills`

They do not detect:

- `beacon_exec_` legacy tool names
- `image_path`
- `imagePath`
- stale manual save instructions for already managed generated assets
- path-based generated image output contracts

Installed workflow skill drift needs provenance so doctor can distinguish safely repairable managed content from customized local content.

## Desired Workflow Editor Contract

### Runtime-Honest Canvas

The editor remains React Flow based, but it must reflect current runtime behavior.

Required behavior:

- Show workflow steps as a visual ordered path.
- Show connectors derived from step order, not user-authored execution edges.
- Disable drawing freeform edges as execution state.
- Provide canvas-first controls to reorder, insert, duplicate, delete, and auto-arrange steps.
- Save ordered `definition.steps`.
- Persist visual layout hints under `definition.layout.positions`.
- Preserve YAML-backed fields that the editor does not own.

`layout.positions` shape:

```json
{
  "positions": {
    "step-id": { "x": 120, "y": 80 }
  }
}
```

Keys are step ids. Top-level step positions are required for canvas layout when
present. Parallel child positions are optional; if present they must be
preserved, but PR 1 may render children in the parallel node's list/form rather
than as independent canvas nodes.

`dependsOn` behavior in PR 1:

- Preserve existing `dependsOn` values on save.
- Do not visualize `dependsOn` as execution edges.
- Show a non-blocking warning when a step contains `dependsOn`: it is validated metadata only and the current runtime still executes by top-level order.
- Do not add new `dependsOn` authoring controls in the runtime-honest editor.

Fields the editor must preserve:

- Definition-level: `id`, `name`, `description`, `version`, `inputs`, `layout`, and any unknown top-level extension fields.
- Definition-level extension examples include `triggers`, `metadata`, and any future plugin-owned blocks.
- Agent steps: `id`, `type`, `label`, `agent`, `task`, `skill`, `description`, `outputs`, `dependsOn`, `deny_tools`, and unknown extension fields.
- Gate steps: `approval_required`, `notify`, `preview`, `on_approve`, `on_reject`, `dependsOn`, and unknown extension fields.
- Parallel steps: parent fields plus child agent fields. Unsupported child shapes must be preserved or made read-only; they must not be silently dropped.
- Output steps: `agent`, `skill`, `description`, `channels`, `content`, `schedule`, `dependsOn`, `deny_tools`, and unknown extension fields.
- Nested workflow steps: `workflow_id`, `description`, `dependsOn`, future input mapping fields, future `output_schema`, and unknown extension fields.
- `createTask` steps: task creation fields, `source`, `skipWorkflowReason`, `dependsOn`, and unknown extension fields.
- Plugin-owned node kinds: preserve the opaque node config unless the registered node editor owns a specific field, including any node-level `output_schema`.

Round-trip safety:

- Opening and saving an unchanged user workflow should be byte-stable.
- Editing one supported field should only change the expected YAML area plus layout positions.
- Unsupported or invalid legacy YAML should render inspectably with save disabled for unsafe edits rather than being normalized into data loss.

Plugin-owned workflow behavior:

- Plugin defaults are read-only in place.
- Editor offers Save as new.
- Same-id shadowing remains possible by direct file/API usage but is not promoted in PR 1.
- If a user-owned workflow shadows a plugin-owned id, the editor treats the user file as editable and clearly labels that it shadows a shipped default.

YAML/source behavior:

- No in-app YAML editor.
- Raw edits remain a filesystem/IDE workflow.
- Later drift/diff work can show source/diff readouts if needed, but not as PR 1 scope.

### Static Parallel Groups

The editor should support the runtime's existing static parallel model.

Supported in PR 1:

- Open a `parallel` node.
- Add/remove/reorder child agent steps.
- Edit child agent fields.
- Save children under `parallel.steps`.

Not supported inside static parallel groups:

- Gate children.
- Nested workflow children.
- Nested parallel children.
- Per-child dependency edges.
- Sequential child execution ordering. Reordering child rows is allowed only as
  serialization/display order; children still run as a static parallel group.
  The user benefit is stable render/log/review order, not execution priority.
- Dynamic one-child-per-array fanout.

## Drift and Repair Contract

Drift-prone workflow content must surface through the existing doctor/health system so both UI and CLI can show it consistently.

Rules:

- Managed, unedited content can be flagged and repaired after explicit confirmation.
- Known stale patterns in user content are flagged, but not silently rewritten.
- Customized or user-edited content is never auto-reverted.
- Repair actions must present a deterministic plan before mutation.
- Repair should use health-check repair handlers where possible.
- UI and CLI should both show the drift.
- PR 3 repairs stale workflow skills by full-file replacement only when
  provenance proves the installed file is managed and unedited.
- Files without provenance, files marked `.userEdited`, and files whose current
  hash differs from `.installedBy.sha256` are advisory-only.
- An unmarked file may be offered for explicit adopt-and-replace only when its
  current hash exactly matches a known old repo-shipped workflow skill hash.
- PR 3 must add a workflow-skill materializer/installer. Plugin and
  agent-package workflow skills are currently registered in memory, so no
  sidecar exists until the skill is projected to
  `~/.bakin/workflows/skills/{name}.md`.
- Materialization must not overwrite an existing unmarked local file unless it
  satisfies the exact old-hash adoption path.
- Known old hashes should live in a repo-shipped, versioned manifest such as
  `plugins/workflows/defaults/workflow-skill-legacy-hashes.json`. They are not
  fetched from the network at doctor time.
- The legacy-hash manifest is manually maintained in the same PR as any
  repo-shipped workflow skill change that needs adopt-and-replace repair. Each
  entry should include a reason and introducing change, and obsolete
  pre-production entries should be pruned before the first production release.

Installed workflow skills should gain managed provenance, similar in spirit to `.installedBy` and `.userEdited` used by runtime skills and agent-package projections.

Workflow skill provenance lives beside the markdown file:

```text
~/.bakin/workflows/skills/generate-image.md
~/.bakin/workflows/skills/generate-image.md.installedBy
~/.bakin/workflows/skills/generate-image.md.userEdited
```

The marker should record enough to compare the installed file to the current source without changing the markdown content itself:

```json
{
  "sourceKind": "plugin",
  "sourceId": "workflows",
  "sourcePath": "defaults/workflow-skills/generate-image.md",
  "sha256": "<installed markdown file sha>",
  "installedAt": "<iso timestamp>"
}
```

Agent-package workflow skills should use the same sidecar shape with `sourceKind:
"agent-package"` and the package id as `sourceId`.

The user-edited sentinel is an empty file. When present, doctor and repair must
treat the skill as local user-owned content and must not mutate it.

Sidecars are preferred over markdown frontmatter because provenance is Bakin
install/repair state, not authored skill metadata. Frontmatter remains reserved
for skill behavior such as `name` and `output_schema`. If a markdown file is
copied without its sidecars, doctor should become conservative and warn instead
of auto-repairing.

## Default Workflow Availability

Default/core workflows need an availability control so a shipped workflow can be disabled and not accidentally matched or selected.

Disabled state should be stored as workflow-owned content at
`~/.bakin/workflows/disabled-defaults.json`. This keeps availability close to definitions,
instances, and matcher behavior instead of treating it as generic plugin UI
configuration.

Disabled defaults are treated as unavailable for future use, not deleted.

Required behavior:

- Auto-match ignores disabled default workflows.
- Task creation workflow selectors omit disabled defaults unless the surface is explicitly a management/status view.
- Normal workflow definition consumer lists omit or clearly mark disabled defaults. Management views may request disabled entries with an explicit include flag.
- CLI workflow lists omit disabled defaults by default or show them only with an explicit flag.
- Error messages that list available workflows do not suggest disabled defaults as normal choices.
- Explicit starts by id reject disabled default workflows with a clear disabled-workflow error unless the caller provides a deliberate override.
- Override surfaces are explicit: CLI commands use `--allow-disabled-workflow`,
  HTTP/API calls use `allowDisabledWorkflow: true`, list endpoints use
  `includeDisabled=true`, and plugin hooks use `allowDisabledWorkflow: true`.
- Existing active, completed, or historical workflow instances keep loading and running. Disabling affects future selection and starts only.

The editor stabilization slice includes the managed-workflow availability override and core list/matcher filtering. Broader caller-specific override controls remain later work because they touch:

- source resolution
- listing/filtering
- matcher behavior
- task creation surfaces
- diagnostics for disabled references

The shipped-default audit should help decide which defaults should ship enabled.

## Dynamic Fanout/Fanin Direction

The future #203 work should prefer explicit control-flow nodes over a full arbitrary DAG.

Initial target node:

```yaml
- id: produce-segments
  type: map_workflow
  source: segment-script.segments
  workflow_id: video-segment-creation
```

Expected semantics:

- `source` points at a prior step output array using a restricted dot path:
  `<prior-step-id>.<field>[.<field>...]`.
- The first path segment must be a completed earlier top-level step id. The
  remaining path segments address object fields only. Wildcards, filters, array
  indexing, and arbitrary JSONPath are out of scope for v1.
- Source paths can only reference step ids that do not contain `.`. If a
  workflow needs `map_workflow`, validation rejects `source` paths whose first
  segment cannot unambiguously identify a prior step id.
- The resolved value must be a non-empty array unless the node explicitly sets
  `allow_empty: true`.
- With `allow_empty: true`, the parent step completes immediately with
  `source.count: 0`, `results: []`, and `finalOutputs: []`, and downstream
  steps run with that empty aggregate. Without it, an empty source is a clear
  step failure.
- Runtime creates one visible Bakin child task per source item.
- Each child task runs the configured child workflow.
- Each child receives the item plus parent context.
- Parent step remains in progress until every child resolves.
- Parent output contains child outputs in stable source order.
- Individual child failures/rejections are visible and recoverable.
- Parent can join after all children complete.
- "Required children" means all children created from the source array. Optional
  children and partial joins are not part of v1.
- V1 must support retrying or reopening one child task/segment without resetting
  successful siblings or the whole parent fanout.
- The parent `map_workflow` step remains in progress until every required child
  has completed successfully.
- Parent assembly does not run partially in v1. It starts only after all
  required child outputs are complete.

Completed `map_workflow` steps should output a stable ordered shape:

```json
{
  "source": {
    "path": "segment-script.segments",
    "count": 3
  },
  "childWorkflowId": "video-segment-creation",
  "results": [
    {
      "index": 0,
      "taskId": "parent-task--produce-segments-0",
      "instanceId": "wf_child_...",
      "input": {
        "segment_number": 1,
        "script": "..."
      },
      "status": "complete",
      "finalOutput": {
        "video_filename": "20260521-segment-1.mp4"
      },
      "outputs": {
        "plan-segment": {},
        "create-video": {
          "video_filename": "20260521-segment-1.mp4"
        }
      }
    }
  ],
  "finalOutputs": [
    {
      "video_filename": "20260521-segment-1.mp4"
    }
  ]
}
```

`results` is the source-of-truth aggregate for debugging, UI, retry, and
assembly. `finalOutputs` is a convenience array for downstream workflow steps
that only need one ordered output per child.

Child retry/reopen behavior:

- Reopen a child workflow from its current failed, rejected, or pending gate state
  using existing child task/workflow controls where possible.
- Retry a failed child from the failed step or from the beginning of the child
  workflow.
- Do not regenerate successful sibling children during a child retry.
- Re-join the parent automatically once the retried child completes.

This does not require a full DAG. It does require new runtime instance state for mapped children and a clear UI representation of dynamic runtime-created children.

## Reference Video Workflow

The first real fanout implementation should target video.

Desired flow:

1. Parent task starts `video-social-post`.
2. Primary assigned agent writes full script and creative direction.
3. Human approves script.
4. Agent breaks the script into `segments[]`, sized for the target video.
5. `map_workflow` creates one visible child task per segment.
6. Each child task runs `video-segment-creation`.
7. Segment workflow creates/chooses prompt and video model.
8. Human approves segment prompt or generation plan.
9. Segment workflow creates the clip and captures asset filename/metadata.
10. Parent joins all child outputs in source order.
11. Parent assembly workflow generates or attaches audio/voiceover, stitches clips, and prepares final output.
12. Human reviews final assembled video.
13. Parent publishes.

Audio placement note:

- Audio/voiceover starts in parent assembly by default, but real workflow testing may prove per-segment audio, no generated audio, or another pattern is better.

Enablement decision:

- The dynamic video fanout workflow should be enabled by default when it ships.
- The initial quality bar is a runnable, inspectable end-to-end workflow that can
  be tested and hardened in place.
- This pre-production default can still be improved through follow-up workflow
  audit and hardening PRs after real runs expose quality gaps.
- This deliberately chooses fast pre-production feedback over the later
  disabled-by-default mechanism. If real runs show the default is harmful or too
  noisy, PR 5's availability controls are the escape hatch.
- During pre-production, if two consecutive full video-fanout runs fail to
  produce a usable final asset for workflow-design reasons after one segment
  retry, disable the default with PR 5 availability until the workflow is fixed.
- If media generation cost/noise becomes the blocker rather than workflow
  correctness, keep the workflow enabled only when its configured provider/tools
  can run inside the current local test budget.
- It must still maintain the agreed workflow contracts: segment child tasks,
  stable asset filename outputs, ordered parent aggregation, and child retry
  without regenerating successful siblings.

Media asset contract:

- `video-segment-creation` requires `video_filename`.
- `video-segment-creation` may also emit `thumbnail_filename`,
  `duration_seconds`, `prompt`, `model`, and `aspect_ratio`.
- Parent assembly requires final `video_filename`.
- Parent assembly may also emit `audio_filename`, `clip_filenames`, and
  `duration_seconds`.
- Agents save media through `bakin_exec_assets_save` with `type=video`,
  `type=audio`, or `type=images`.
- Publishing uses `bakin_exec_post_channel(videoFilename=...)`.
- Workflow outputs must not use `videoPath`, `audioPath`, or raw filesystem
  paths for generated media.

## Project Structure

Primary implementation areas:

```text
plugins/workflows/
  components/                  React Flow editor, detail view, node drawer, palette
  defaults/workflows/           shipped workflow YAML
  defaults/workflow-skills/     shipped workflow step skills
  lib/                          parser, runtime, health checks, registries
  types.ts                      workflow definition and instance types

tests/plugins/workflows/        parser/runtime/editor/health/default coverage
.claude/knowledge/              durable architecture notes
.claude/specs/                  this spec and companion plan
docs/src/content/docs/using/    user-facing docs when behavior changes
README.md                       only if top-level architecture/user docs are impacted
```

## Commands

Baseline and focused workflow tests:

```bash
bun test --isolate tests/plugins/workflows/workflow-canvas-editor.test.tsx tests/plugins/workflows/node-type-palette.test.tsx tests/plugins/workflows/node-config-drawer.test.tsx tests/plugins/workflows/parser.test.ts tests/plugins/workflows/yaml-roundtrip.test.ts
```

Workflow plugin tests:

```bash
bun test --isolate tests/plugins/workflows
```

Broader verification:

```bash
bun run typecheck
bun run lint
bun test --isolate
```

Dev server:

```bash
bun run dev
```

Mock runtime dev server:

```bash
bun run dev:mock
```

## Testing Strategy

PR 1 must add runtime-visible UI verification, not just React unit smoke tests.

Recommended coverage:

- Component/integration tests for editor state transitions.
- API route tests for save behavior and plugin-owned read-only/customization paths.
- Browser-backed verification for `/workflows/:id/edit` with a real workflow definition.
- Regression tests that verify connectors are derived from order and user-authored edges are not saved as runtime semantics.
- Tests for static parallel child editing.

PR 2 coverage:

- Shipped workflow audit test rejecting `imagePath`, `image_path`, and raw generated image paths in YAML defaults.
- Tests for image-generation output schema using `image_filename`.
- Tests for publish handoff reading the filename contract.

PR 3 coverage:

- Health check detects known stale installed workflow skill patterns.
- Provenance distinguishes managed stale from customized local content.
- Repair plan updates safe managed stale content only.
- Customized content is advisory/manual only.
- CLI/Health UI can surface the warning through existing health routes.

Fanout coverage:

- Runtime creates stable child tasks from an array output.
- Parent remains in progress until all child tasks complete.
- Parent aggregates outputs in stable order.
- A failed/rejected child does not require rewinding the entire parent.
- UI displays dynamic child task status without pretending children are static YAML nodes.

## Boundaries

Always:

- Keep workflow runtime behavior honest in the editor.
- Add tests before behavior changes.
- Update `.claude/knowledge` when workflow architecture changes.
- Use doctor/health for drift visibility.
- Preserve user-authored content unless an explicit repair plan is confirmed.

Ask first:

- Changing workflow runtime scheduling semantics.
- Adding new node types.
- Adding new dependencies.
- Changing task matching/selection behavior.
- Moving image or video workflows into official plugins.

Never:

- Silently overwrite customized workflow files.
- Represent freeform canvas edges as runtime behavior before the runtime supports them.
- Let repo defaults depend on local literal agent ids.
- Add compatibility shims for obsolete workflow contracts unless explicitly requested.

## Success Criteria

- PR-sized milestones are defined and independently shippable.
- Each milestone has release-note language and rollback boundaries.
- PR 1 makes the current workflow editor usable and runtime-honest.
- PR 2 resolves repo-shipped image filename contract drift.
- PR 3 surfaces and safely repairs managed installed workflow skill drift.
- The shipped-default audit records the health and intended path for every repo default workflow.
- Later dynamic fanout work is grounded in the video workflow and not an abstract unused primitive.

## Deferred Decisions

These are not blockers for PR 1, but they must be resolved before the named PR
that owns them starts:

- PR 3: exact workflow-skill materializer command/API surface and whether it
  runs on boot, doctor repair, explicit install, or some combination.
- PR 6: fanout concurrency limit, progress event/SSE volume, child agent
  assignment policy, dispatch cost preview, and stable child id behavior after
  script edits followed by retry.
- PR 7D: exact media provider/tool choices for video generation, voiceover, and
  assembly.

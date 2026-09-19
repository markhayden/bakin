# PLAN — Workflows plugin URL state (Phase 2, PR 3 of `.claude/specs/settings-url-state.md`)

Branch `feat/workflows-url-state` from `main` AFTER #839 (tasks) merges — both PRs edit
`url-state-deep-linking.md` and the spec, so stacking would conflict. Same shape as the earlier plans.

## Overview

`/workflows/$id` opens a step detail drawer when a canvas node is clicked; the selected step and the
drawer's open flag live in `useState` (`workflow-detail.tsx:111-112`, `:164-174`, `:563-570`). A step cannot be
linked, refreshed into, or closed with Back. Move it to `?step=<stepId>` under the Phase 2 rules (drawer ⇒ push
to open, replace to close; stale noun param ⇒ default without rewrite).

| Surface | Today | After |
|---|---|---|
| Step detail drawer on `/workflows/$id` | `selectedStep` + `drawerOpen` local | `?step=<stepId>`: node click **pushes** it (Back closes), `onOpenChange(false)` **replaces** it away, refresh reopens |
| Stale `?step=` (step removed from the definition) | n/a | drawer closed, URL left alone (rule 4). No alert: unlike `taskId`, nothing produces step links yet |
| Canvas editor (`/workflows/$id/edit`) node selection | local, dirty-guarded | unchanged (audit: editor selection is transient) |

## Architecture decisions

- **Derived, not snapshotted.** `selectedStep = stepParam ? findStepByNodeId(definition, stepParam, subWorkflows) : null`
  (the existing resolver handles nested `parent__child` node ids). The drawer is read-mostly; its three local
  states are skill-repair UI, and `onSkillRepaired` refetches the definition — deriving means the drawer shows the
  repaired step instead of today's stale snapshot. `drawerOpen` becomes `selectedStep !== null`.
- **The URL value is the node id the canvas reports** (what `handleNodeClick` receives), so nested steps round-trip
  through the same resolver the click path uses. Selection writes `pushStep(nodeId)`; close writes `setStepParam('')`.
- **`useQueryState` imported from `@makinbakin/sdk/navigation`** (focused entrypoint). The existing
  `workflow-detail.test.tsx` mocks `@makinbakin/sdk/hooks` with only `useRouter`, so adding a hooks-path import would
  break it; the navigation import runs over the global router shim there (no navigations asserted) and stays green.
- **Tests:** NEW `tests/plugins/workflows/workflow-detail-url-state.test.tsx` cloning the detail test's mock block
  (content-dir, task-store, canvas + drawer stubs capturing props) but NOT the hooks mock; router shim + stable spy
  navigate + `setURL`. Drive selection through the captured `WorkflowCanvas.onNodeClick`, close through the captured
  `StepDetailDrawer.onOpenChange`.
- **No UI change** — Drawer/canvas contracts untouched; `ui:conformance --quick` only.

## Task list

### Task 1: `?step=` is the step drawer's open state (commit 1)

**Acceptance criteria:**
- [ ] `/workflows/video-script?step=write` cold-loads with `StepDetailDrawer` `open: true` and `step.id === 'write'` after the definition fetch; zero navigations.
- [ ] `onNodeClick('write')` emits ONE push navigation with `step=write` (no `replace`); `onOpenChange(false)` emits ONE replace navigation without `step`.
- [ ] `?step=nope` → drawer `open: false`, no navigation, no toast/alert; trigger node ids (`__trigger`) are ignored exactly as today.
- [ ] Existing `workflow-detail.test.tsx` and `map-step-ui.test.tsx` unchanged and green.

**Verification:** `bun test tests/plugins/workflows/workflow-detail-url-state.test.tsx tests/plugins/workflows/workflow-detail.test.tsx tests/plugins/workflows/map-step-ui.test.tsx --isolate`; lint, typecheck, `ui:conformance --quick`; full `bun run test`.

**Files:** `plugins/workflows/components/workflow-detail.tsx`, `tests/plugins/workflows/workflow-detail-url-state.test.tsx` (NEW). **Scope:** S/M.

**Commit:** `feat(workflows): step drawer rides ?step= (push to open, Back closes)`

### Task 2: docs + spec (commit 2)

- [ ] `.claude/knowledge/workflows-plugin.md`: URL-state note (`/workflows/$id?step=`, push/replace, stale ⇒ closed).
- [ ] `.claude/knowledge/url-state-deep-linking.md`: Workflows row (`q` on list; `step` drawer on detail); `step` param row.
- [ ] Spec: status line (PR 2 shipped #839 once merged; PR 3 on this branch); row 5 implemented.
- [ ] `bun run docs:validate`.

**Commit:** `docs(workflows): ?step= drawer semantics`

## Checkpoints

- **A (after T1):** focused + full suite, lint, typecheck, `ui:conformance --quick`; commit 1.
- **C (merge-ready):** `check:cycles`, `ui:conformance --full` (Docker → CI), clean tree, `gh pr create`; NOT merged.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Nested node ids (`parent__child`) don't resolve from the URL | Med | Reuse `findStepByNodeId` (same resolver as the click path); test a nested id if the fixture has one, else pin the direct case + the resolver's existing unit coverage |
| Drawer skill-repair state resets when the definition refetches (step identity changes) | Low — that is the refreshed-data behavior we want | Documented |
| Definition fetch failure with `?step=` set | Low | `selectedStep` is null while `definition` is null; no navigation |

## Open questions

None. Follow-up recorded: no producer links to a step yet (⌘K workflow hits open `/workflows/$id`); adding `?step=` to
step-level search hits is a search-index change outside this scope.

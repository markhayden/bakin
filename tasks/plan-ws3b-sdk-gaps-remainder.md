# Plan: WS3b — feat/sdk-gaps-remainder

Spec: `SPEC.md` + `.claude/specs/audit-2026-06/REPORT.md` (triage-approved 2026-06-11).
Branch: `feat/sdk-gaps-remainder` off `main`. Follow-up to WS3 (PR #501, A1 only — SSE
consolidation). The WS3 plan is archived at `tasks/plan-ws3-sdk-gaps.md`; the A2–A8 specs there
are the source for this backlog.
One revertable commit per finding; every commit green on `bun run test` + `bun run typecheck`.
PR gate: `bun run build` + lint + **dockerized-rig E2E + browser page sweep** + docs. No shims.
Respect the WS1 two-tier type contract (`.claude/knowledge/repo-architecture.md` § two-tier).

## Goal

Add the remaining client-side SDK primitives core plugins keep reinventing, then migrate the
duplicated consumers. Extraction bar: 2+ real consumers with congruent behavior. CLIENT/BROWSER
work — payoff is consistent fetch lifecycle, one confirm dialog, shared formatters/badges — so
verification is `bun test` for the pure utils + dockerized-rig E2E / Playwright page sweep for the
UI behavior.

## Tasks (independent; distinct files; order = lowest-risk-first)

A2–A8 carried verbatim from the WS3 plan (`tasks/plan-ws3-sdk-gaps.md`). Recon re-verified on
branch start (post #500/#501). One commit per task.

### A4 — formatDuration + formatDateTime  ⟵ start here (pure utils, test-covered)
Add `formatDuration(ms)` and `formatDateTime(ts)` to `packages/core/src/format.ts` (re-exported via
`@makinbakin/sdk/utils` next to `formatAge`); use the task-run-history calendar variant (Today/
Yesterday + short-date + year disambiguation) as the strictly-better source. Migrate the 7 reimpls;
delete the health plugin's byte-identical local `formatAge`.
- **Accept:** typecheck + suite green; format tests for the new fns; the 7 sites render identically.
- Commit: `refactor(sdk): formatDuration/formatDateTime in core/format; migrate 7 reimplementations`

### A8 — toneBadge
Add `toneBadgeClass(tone: 'success'|'pending'|'error'|'muted'|'info')` (or a `StatusBadge` component)
to the SDK for the `bg-X-500/10 text-X-400 border-X-500/20` idiom; migrate the 4 plugins that
hand-roll it (task-run-history, schedule run-history, health-page, models-page status maps).
- **Accept:** typecheck + suite green; badges render with identical colors in the E2E.
- Commit: `feat(sdk): toneBadgeClass for status badges; migrate 4 plugins`

### A5 — EmptyState consolidation
Port team's larger icon-chip + `fillHeight` variant into the SDK `src/components/empty-state.tsx`
(keep it backward compatible for the existing SDK consumers), repoint team's local importers to
`@makinbakin/sdk/components`, delete `plugins/team/components/empty-state.tsx`.
- **Accept:** typecheck + suite green; team's empty states render with the ported variant in the E2E;
  the SDK EmptyState's prior consumers unchanged.
- Commit: `refactor(sdk): fold team's EmptyState variant into the SDK; delete the fork`

### A3 — ConfirmDialog
`ConfirmDialog` in `src/components/confirm-dialog.tsx`, re-exported from `@makinbakin/sdk/components`.
Props `{ open|target, title, description, confirmLabel, busy, error, onConfirm, onCancel }`. Migrate
all 6 sites (schedule/delete-schedule-dialog, tasks/delete-task-dialog, workflows/workflow-delete-action,
assets/versioned/TagFolderGrid, team/team-manager, team/agent-detail).
- **Accept:** typecheck + suite green; each delete flow still confirms + shows busy/error in the E2E.
- Commit: `feat(sdk): ConfirmDialog component; migrate 6 hand-rolled delete dialogs`

### A2 — useJsonFetch (cancellable JSON fetch lifecycle)
`useJsonFetch<T>(url, opts?)` → `{ data, loading, error, refresh }`, AbortController-based, in
`src/hooks/use-json-fetch.ts`, re-exported from `@makinbakin/sdk/hooks`. Migrate the team plugin's
sites (densest: heartbeat-tab, overview-tab, active-context-tab, lesson-toggle-list, team-grid);
migrate the rest of the 11 opportunistically (note any left).
- **Accept:** typecheck + suite green; migrated tabs load/error/refresh correctly in the E2E; no
  setState-after-unmount warnings in the console sweep.
- Commit: `feat(sdk): useJsonFetch hook; migrate the team plugin's fetch boilerplate`

### A6 — useAvailableModels
`useAvailableModels()` in `plugins/models/hooks/use-available-models.ts`, re-exported from
`@makinbakin/sdk/hooks` (mirrors the `useAgentStore`/`useNotificationChannels` re-export precedent).
Returns the `/api/plugins/models/available` payload typed as `AvailableModel[]` (WS1 single-homed the
type). Migrate the 3 call sites (team agent-form, team agent-detail, models models-page).
- **Accept:** typecheck + suite green; the model pickers populate in the E2E.
- Commit: `feat(sdk): useAvailableModels hook; migrate 3 hand-fetch call sites`

### A7 — tasks-plugin workflow types (WS1 A8 deferral)
Migrate `plugins/tasks/components/task-detail-dialog.tsx`'s hand-rolled `Workflow`/`WorkflowInstance`/
`WorkflowDefinition` interfaces to the SDK types (WS1 fixed the SDK `WorkflowInstance` wire shape →
`instanceId`). The two raw `/api/plugins/workflows/instances/:taskId` fetches can adopt `useJsonFetch`
(A2) rather than a bespoke hook unless a `useWorkflowInstance` proves cleaner.
- **Accept:** typecheck + suite green; the task drawer's workflow/gate panel works in the E2E.
- Commit: `refactor(tasks): use SDK workflow types + useJsonFetch in the task drawer`

### PR gate
- `bun run test` + `typecheck` + `lint` green; `bun run build` (3 binaries; build-stamp trap —
  revert `generated-version.ts` + `_embedded-assets-static.ts`).
- **Dockerized-rig E2E (isolated):** all plugins activate; Playwright sweep of all 10 pages = 0
  console/page/network errors; a delete-confirm flow, a model picker, and a team tab exercised.
- Docs: `.claude/knowledge/{plugin-system,url-state-deep-linking}.md` + `docs/plugin-authoring.md`
  (new SDK hooks/components); CLAUDE.md SDK surface table if it enumerates hooks.
- Open PR `feat/sdk-gaps-remainder`; Mark reviews/merges.

## Risks & mitigations
- **Two-tier contract** — new hooks/components are client primitives (correct for the SDK); they
  must not pull server-only modules into the SDK client bundle.
- **Vendor-bundle weight** (#422) — new SDK hooks/components are small; they live in the existing
  hooks/components/utils sub-paths (no new import-map entries).
- **Behavioral parity** — formatters/dialogs/badges must render identically post-migration. Pure
  utils get unit tests; UI parity is the E2E page-sweep gate.

## Rollback
Each commit is independent (suite + typecheck green) and touches distinct files; revert any single
finding cleanly.

## Status
- A4 — ☑ formatDuration/formatDateTime in core/format; migrated task-run-history + deleted
  health's dup. Stale "7 reimpls" reconciled: 3 assets sites already on formatAge; 2 relative-age
  variants (models/team) left (distinct behavior). Supplemental: schedule run-history formatTime.
- A8 — ☑ toneBadgeClass in SDK utils; migrated task-run-history + schedule run-history maps.
  health/models badge maps left (border-less, off-palette idiom).
- A5 — ☑ team's EmptyState variant folded into SDK behind variant='panel'; fork deleted.
  Dead fillHeight prop dropped rather than promoted to the SDK surface.
- A3 — ☑ ConfirmDialog in SDK; all 6 delete dialogs migrated. New unit test + rewired
  delete-schedule-dialog test.
- A2 — ☑ useJsonFetch hook + unit test; migrated 3 clean-fit sites (memory tier-overview-cards,
  team heartbeat-tab + active-context-tab). Non-fits noted (team-grid, lesson-toggle-list,
  overview-tab Promise.all, node-type-palette, AssetPreview, PluginHost, use-notification-channels).
- A6 — ☑ useAvailableModels (module-cached, mirrors useNotificationChannels); migrated agent-form
  + agent-detail pickers. models-page left (owns the live /refresh mutation flow).
- A7 — ☑ task-detail-dialog WorkflowInstance/WorkflowDefinition re-based on SDK types via extension.
  Local Workflow summary + imperative instance fetches left (no SDK equiv / optional per plan).

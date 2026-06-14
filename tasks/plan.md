# Plan: WS3 — feat/sdk-gaps

Spec: `SPEC.md` + `.claude/specs/audit-2026-06/REPORT.md` (triage-approved 2026-06-11).
Branch: `feat/sdk-gaps` off `main`. (Independent of the still-open WS2 #499 — client-side
SDK + plugin code; minimal overlap. Merge order: WS2 then WS3 ideally; the one shared file,
`packages/sdk/src/utils`, takes non-conflicting additions.)
One revertable commit per finding; every commit green on `bun run test` + `bun run typecheck`.
PR gate: `bun run build` + lint + **dockerized-rig E2E + browser page sweep** + docs. No shims.
Respect the WS1 two-tier type contract (`.claude/knowledge/repo-architecture.md` § two-tier).

## Goal

Add the client-side SDK primitives core plugins keep reinventing, then migrate the duplicated
consumers. Extraction bar: 2+ real consumers with congruent behavior. This is CLIENT/BROWSER work —
the payoff is runtime UI behavior (one SSE connection instead of N, consistent fetch lifecycle,
one confirm dialog), so verification is the dockerized-rig E2E + a Playwright page sweep, not just
`bun test`.

## Confirmed state (recon, 2026-06-13)

- The shell owns ONE EventSource (`src/hooks/use-sse.ts`), but it only routes events into the
  content store — it has **no subscriber fan-out**, and it drops `{type:'plugin-event', event, …}`
  payloads entirely. That's exactly why the assets plugin opens its own connections.
- Assets opens **3 raw `new EventSource('/api/events')`** (no reconnect): `task-assets.tsx`
  (asset.changed/removed + workflow.step_complete), `versioned/VersionedAssetGrid.tsx`
  (asset.changed/removed), `versioned/VersionedAssetDetail.tsx` (asset.changed/removed for one
  assetId). All filter on `data.type === 'plugin-event'` + `data.event`.
- SDK re-export precedent for shell/plugin hooks is established: `export { useSSE } from '@/hooks/use-sse'`,
  `export { useAgentStore } from '@bakin/team/hooks/...'` (`packages/sdk/src/hooks/index.ts`).
- `let cancelled = false` fetch boilerplate: **11** component files. Relative-time/format reimpls:
  **7** files. ConfirmDialog shape: **6** sites / 5 plugins. EmptyState fork in team. AvailableModel
  hand-fetch: 3 sites.

## Decisions to resolve before building (see questions)

1. **usePluginEvent home + the existing hardcoded routing — RESOLVED (Mark, 2026-06-13).** The hook's
   impl lives in the shell (`src/hooks/use-plugin-event.ts`, SDK-re-exported like `useSSE`) since it
   hangs off the shell's singleton connection. **Decision: ALSO refactor the existing
   taskboard/doctor/reindex routing onto the new fan-out** (not just the assets EventSources) —
   removing the per-plugin bump counters from the content store. Bigger blast radius (touches the
   tasks/health/reindex live-update paths), so A1's E2E acceptance must exercise all of them.
2. **PR shape.** All findings are independent (different files). **Recommendation:** one PR,
   commit-per-finding.
3. **A8-deferred tasks workflow work + P2 tone-badge** — include or defer (see tasks A7/A8 below).

## Dependency graph & sequencing

All tasks are independent (distinct files); order is lowest-risk-first. A1 is the only one that
touches the shell SSE pathway.

```
A1 usePluginEvent      — shell fan-out + migrate 3 assets EventSources   (load-bearing; browser runtime)
A2 useJsonFetch        — hook + migrate team's cluster                   (11 sites; migrate densest, rest opportunistic)
A3 ConfirmDialog       — SDK component + migrate 6 sites
A4 formatDuration/DateTime — core/format + SDK utils + migrate 7 sites + delete health's dup
A5 EmptyState          — fold team's variant into SDK, delete the fork
A6 useAvailableModels  — hook + migrate 3 ModelSelect call sites
A7 tasks workflow types — migrate hand-rolled types to SDK (A8 deferral from WS1)
A8 toneBadge (P2)      — flag; likely defer
```

## Tasks

### A1 — usePluginEvent (multiplex the singleton SSE)
Add a tiny browser-global subscriber emitter; the shell `useSSE.onmessage` publishes `plugin-event`
payloads into it. `usePluginEvent(eventName, handler)` (in `src/hooks/use-plugin-event.ts`,
re-exported from `@makinbakin/sdk/hooks`) registers/unregisters a handler for an event name. Migrate
the 3 assets EventSources to it (asset.changed / asset.removed / workflow.step_complete), keeping
their assetId filtering. No new connections; reconnect handled once by the shell.
- **Accept:** typecheck + suite green; grep shows zero `new EventSource` in plugins/assets; E2E shows
  asset pages still live-update (a generate/edit reflects without reload) over the single connection;
  exactly one `/api/events` connection in the browser network panel.
- Commit: `feat(sdk): usePluginEvent hook multiplexing the shell SSE; migrate assets off raw EventSource`

### A2 — useJsonFetch (cancellable JSON fetch lifecycle)
`useJsonFetch<T>(url, opts?)` → `{ data, loading, error, refresh }`, AbortController-based, in
`src/hooks/use-json-fetch.ts`, re-exported from `@makinbakin/sdk/hooks`. Migrate the team plugin's
sites (densest: heartbeat-tab, overview-tab, active-context-tab, lesson-toggle-list, team-grid);
migrate the rest of the 11 opportunistically (note any left).
- **Accept:** typecheck + suite green; migrated tabs load/error/refresh correctly in the E2E; no
  setState-after-unmount warnings in the console sweep.
- Commit: `feat(sdk): useJsonFetch hook; migrate the team plugin's fetch boilerplate`

### A3 — ConfirmDialog
`ConfirmDialog` in `src/components/confirm-dialog.tsx`, re-exported from `@makinbakin/sdk/components`.
Props `{ open|target, title, description, confirmLabel, busy, error, onConfirm, onCancel }`. Migrate
all 6 sites (schedule/delete-schedule-dialog, tasks/delete-task-dialog, workflows/workflow-delete-action,
assets/versioned/TagFolderGrid, team/team-manager, team/agent-detail).
- **Accept:** typecheck + suite green; each delete flow still confirms + shows busy/error in the E2E.
- Commit: `feat(sdk): ConfirmDialog component; migrate 6 hand-rolled delete dialogs`

### A4 — formatDuration + formatDateTime
Add `formatDuration(ms)` and `formatDateTime(ts)` to `packages/core/src/format.ts` (re-exported via
`@makinbakin/sdk/utils` next to `formatAge`); use the task-run-history calendar variant (Today/
Yesterday + short-date + year disambiguation) as the strictly-better source. Migrate the 7 reimpls;
delete the health plugin's byte-identical local `formatAge`.
- **Accept:** typecheck + suite green; format tests for the new fns; the 7 sites render identically.
- Commit: `refactor(sdk): formatDuration/formatDateTime in core/format; migrate 7 reimplementations`

### A5 — EmptyState consolidation
Port team's larger icon-chip + `fillHeight` variant into the SDK `src/components/empty-state.tsx`
(keep it backward compatible for the 6 existing SDK consumers), repoint team's 3 local importers to
`@makinbakin/sdk/components`, delete `plugins/team/components/empty-state.tsx`.
- **Accept:** typecheck + suite green; team's empty states render with the ported variant in the E2E;
  the SDK EmptyState's 6 prior consumers unchanged.
- Commit: `refactor(sdk): fold team's EmptyState variant into the SDK; delete the fork`

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

### A8 — toneBadge (INCLUDED per Mark)
Add `toneBadgeClass(tone: 'success'|'pending'|'error'|'muted'|'info')` (or a `StatusBadge` component)
to the SDK for the `bg-X-500/10 text-X-400 border-X-500/20` idiom; migrate the 4 plugins that
hand-roll it (task-run-history, schedule run-history, health-page, models-page status maps).
- **Accept:** typecheck + suite green; badges render with identical colors in the E2E.
- Commit: `feat(sdk): toneBadgeClass for status badges; migrate 4 plugins`

### PR gate
- `bun run test` + `typecheck` + `lint` green; `bun run build` (3 binaries; build-stamp trap —
  revert `generated-version.ts` + `_embedded-assets-static.ts`).
- **Dockerized-rig E2E (isolated):** all plugins activate; Playwright sweep of all 10 pages = 0
  console/page/network errors; **one** `/api/events` connection; asset live-update, a delete-confirm
  flow, a model picker, and a team tab exercised.
- Docs: `.claude/knowledge/{plugin-system,url-state-deep-linking}.md` + `docs/plugin-authoring.md`
  (new SDK hooks/components); CLAUDE.md SDK surface table if it enumerates hooks.
- Open PR `feat/sdk-gaps`; Mark reviews/merges.

## Risks & mitigations
- **A1 SSE fan-out** — a bug here breaks live updates app-wide. Mitigation: the shell keeps its
  existing routing untouched; the emitter is additive (publish-only); E2E verifies single connection
  + live update. Revert is clean (assets fall back to... nothing — so verify before merge).
- **Vendor-bundle weight** (#422) — new SDK hooks/components add to the bundle. Mitigation: they're
  small; they live in the existing hooks/components sub-paths (no new import-map entries).
- **Browser-only behavior** — `bun test` can't catch SSE/fetch-lifecycle/dialog regressions.
  Mitigation: the E2E + page sweep is a hard PR-gate item, not optional.
- **Two-tier contract** — new hooks/components are client primitives (correct for the SDK); they
  must not pull server-only modules into the SDK client bundle.

## Rollback
Each commit is independent (suite + typecheck green) and touches distinct files; revert any single
finding cleanly. A1 is the only one that must be E2E-verified before merge (no test-only safety net
for SSE behavior).

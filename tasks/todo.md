# TODO — WS3 feat/sdk-gaps

Branch `feat/sdk-gaps` off `main`. One commit per finding; each green on
`bun run test` + `bun run typecheck`. Detail + decisions: `tasks/plan.md`.

Client/browser work — PR gate REQUIRES the dockerized-rig E2E + Playwright page sweep
(not just bun test). Respect the WS1 two-tier type contract.

## Primitives + migrations (independent; lowest-risk-first)
- [x] A1 — usePluginEvent: shell SSE fan-out + 3 assets EventSources migrated + taskboard/doctor/reindex counters refactored ✅ (2 commits)
- [ ] A2 — useJsonFetch: hook + migrate the team plugin's `let cancelled` cluster (11 sites total)
- [ ] A3 — ConfirmDialog: SDK component + migrate 6 hand-rolled delete dialogs
- [ ] A4 — formatDuration/formatDateTime in core/format + SDK utils; migrate 7 reimpls; delete health's dup
- [ ] A5 — EmptyState: fold team's variant into the SDK, repoint 3 importers, delete the fork
- [ ] A6 — useAvailableModels hook + migrate 3 ModelSelect call sites
- [ ] A7 — tasks drawer: migrate hand-rolled workflow types → SDK types (WS1 A8 deferral)
- [ ] A8 — toneBadgeClass + migrate 4 badge-idiom plugins

## PR gate
- [ ] test + typecheck + lint + build + dockerized-rig E2E (1 SSE conn, 0 page errors) + docs → open PR

## Not in WS3 (deferred elsewhere)
- WS2 #499 (awaiting merge); its K5-boundary/K6 → WS6; finding-8 config-gating → own PR

# TODO — Settings URL state (Phase 1)

Branch: `feat/settings-url-state` (MAIN checkout). Plan: `tasks/settings-url-state/plan.md`. Spec: `.claude/specs/settings-url-state.md`.

## Task 1 — `?tab=` category (commit `feat(settings): category rides ?tab= with system/integrations ids`) — DONE 2026-09-18
- [x] Rename `SYSTEM_SETTINGS_TAB_ID` → `'system'`, `PROVIDER_KEYS_TAB_ID` → `'integrations'`
- [x] `settings.tsx`: `useQueryState('tab', SYSTEM_SETTINGS_TAB_ID)`, `useQueryState('field', '')`, `usePathname()`
- [x] `activePlugin` derived from `tabParam` (known id, else `system`; `''` until schemas load)
- [x] Normalize effect: only on `/settings`, only after `plugins.length > 0`, replace-mode
- [x] `selectPlugin`: no-op on same id; `setTab(id)`; `setField('')`
- [x] `savedValues` → `{ url, values } | null`, used only while `url === valuesUrl`
- [x] Collision guard in `plugins` memo (drop + warn for `system` / `integrations` plugin ids)
- [x] NEW `tests/components/settings-route-url-state.test.tsx` (9 cases incl. savedValues tag + non-settings pathname no-op)
- [x] `tests/components/settings-sort.test.ts` green with renamed constant; `settings-route-save.test.tsx` mounts at `?tab=demo`
- [x] Focused tests, `bun run test` (9312/0), lint (0 errors), typecheck, `ui:conformance --quick`
- [x] Headless Playwright against an isolated 3799 boot: 14/14 (cold boot, refresh, clean default, replace-not-push, normalize, integrations id, field cleared on switch)
- [ ] 3737 manual by Mark (live checklist in the PR body)
- [x] **Checkpoint A** → commit 1

## Task 2 — `?field=` → kit `highlightKey` (commit `feat(sdk): highlightKey on PluginSettingsRenderer`) — DONE 2026-09-18
- [x] Kit prop `highlightKey?: string`; `data-highlighted` + callback ref on the matching `Field`/`Fieldset`
- [x] Scroll-once effect keyed on `highlightKey`, re-armed on clear; `scrollIntoView?.()` optional
- [x] Highlight tint: canonical selected treatment (`data-highlighted:` variants — tint, rounded, -mx/px/py bakin-2 so no layout shift); tokens verified in `styles.css`
- [x] Story `HighlightedField` + play assertion (one target, not focused); `bakinCoverage` += `deep-link`; no new visual baseline needed (spec references the file by one existing story id)
- [x] Host adapter passes `highlightKey`; route passes `fieldParam || undefined`
- [x] Kit tests (4) in `plugin-settings-renderer.test.tsx`; route tests (2) in `settings-route-url-state.test.tsx`
- [x] `bun run build:css` → `packages/sdk/styles.css` staged with the kit change
- [x] `ui:story-compliance:check`, `ui:kit-coverage:check`, lint (0 errors), typecheck, `ui:conformance --quick`; `ui:test:stories` (see log)
- [x] Headless Playwright on rebuilt 3799: 9/9 (one target, correct field, scrolled into a 500px viewport, tint applied, no focus stolen, DOM-click edit does not re-scroll, inert on integrations, switch drops field + highlight) + screenshot reviewed
- [ ] 3737 manual by Mark
- [x] commit 2

## Task 3 — producers (commit `fix(health,runtime): deep-link settings resolutions to their category and field`)
- [ ] `delivery-discord.ts` ×4 hrefs (integrations / guildIds / approvers / inbound.allowFrom)
- [ ] `channel-aliases.ts` → `/settings?tab=system`
- [ ] `capabilities-tab.tsx` → `/settings?tab=integrations`
- [ ] `delivery-discord-check.test.ts` asserts the four hrefs; `system-checks.test.ts` asserts channel-aliases href (add case if absent)
- [ ] grep: no bare `/settings` hrefs outside sidebar + route-shadow
- [ ] Focused tests, lint, typecheck; server restart → Health incident lands on tinted field
- [ ] **Checkpoint B** (full `bun run test`) → commit 3

## Task 4 — docs (commit `docs(settings): URL state, field deep links, knowledge + docs-site sweep`)
- [ ] `url-state-deep-linking.md`: Settings status row; `field` param row; `tab` value note
- [ ] `docs/src/content/docs/using/settings.md`: "Deep links" paragraph
- [ ] Confirm `delivery-bridge.md`, `doctor-and-health-checks.md`, README need nothing
- [ ] Spec status → Phase 1 SHIPPED (PR #)
- [ ] commit 4

## Checkpoint C — merge-ready
- [ ] `bun run ui:conformance --full`, `bun run check:cycles`, full `bun run test`, lint, typecheck
- [ ] No stamp files staged (`generated-version.ts`, `_embedded-assets-static.ts`)
- [ ] `gh pr create` with the live checklist in the body; do NOT merge
- [ ] Hand off with the UI-conformance evidence block

## Phase 2 (after PR 1 is in good shape) — one PR per plugin, planned separately against the spec's rules
- [ ] team (skill / file / activity_window / mode)
- [ ] tasks (push taskId on open)
- [ ] workflows (step)
- [ ] assets (version)
- [ ] brands (mode)
- [ ] health (agents_metric)
- [ ] chat (q)

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

## Task 2 — `?field=` → kit `highlightKey` (commit `feat(sdk): highlightKey on PluginSettingsRenderer`)
- [ ] Kit prop `highlightKey?: string`; `data-highlighted` + ref on the matching `Field`/`Fieldset`
- [ ] Scroll-once effect keyed on `highlightKey`, re-armed on clear; `scrollIntoView?.()` optional
- [ ] Highlight tint: canonical selected treatment (`bg-bakin-action-primary-background/10`, rounded, breathing room) — verify tokens exist in `styles.css` first
- [ ] Story `HighlightedField` + play assertion; `bakinCoverage` += `deep-link`
- [ ] Host adapter `src/components/plugin-settings-renderer.tsx` passes `highlightKey`
- [ ] Route passes `fieldParam || undefined` (never on `integrations`)
- [ ] Kit test in `tests/components/plugin-settings-renderer.test.tsx` (one highlighted element; scroll once; re-arm)
- [ ] Route tests 5–6 in `settings-route-url-state.test.tsx`
- [ ] `bun run build:css` → stage `packages/sdk/styles.css`
- [ ] `ui:test:stories`, `ui:story-compliance:check`, `ui:kit-coverage:check`, lint, typecheck, `ui:conformance --quick`
- [ ] `build:vendors` + hard refresh → 3737 manual: field tinted + scrolled; category switch drops `field`
- [ ] commit 2

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

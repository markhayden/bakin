# PLAN — Settings URL state (Phase 1 of `.claude/specs/settings-url-state.md`)

Companion to the spec. Tasks are vertical slices; every task has acceptance criteria and a
verification step. Commit boundaries ARE the rollback checkpoints. Branch: `feat/settings-url-state`
from `main` in the MAIN checkout (3737 serves it).

## Overview

Move the `/settings` category from `useState` to `?tab=` (ids `system` / `integrations` / `<pluginId>`),
add `?field=<key>` → a kit `highlightKey` prop that scrolls-once + marks the field, retarget the six
existing `/settings` producers, and sweep docs. Four commits, each green and revertable alone.

## Architecture decisions (from the spec, restated where they shape code)

- `useQueryState('tab', 'system')` + `useQueryState('field', '')` from `@makinbakin/sdk/navigation`;
  replace-mode setters (no history per click). `usePathname()` guards the normalize effect.
- **`savedValues` invariant survives history navigation.** Today `savedValues` is cleared only in
  `selectPlugin`. Once the URL drives the category, Back/Forward changes `activePlugin` without going
  through `selectPlugin`, and the old shape would show category A's just-saved values on category B.
  Fix by tagging: `savedValues: { url: string; values } | null` and
  `values = savedValues?.url === valuesUrl ? savedValues.values : loadedValues`. Same invariant
  ("saved values stand in exactly while `valuesUrl` is unchanged"), no effect, no clear-on-select.
- **Collision guard** lives in the `plugins` memo (not `groupAndSortSchemas`): schema entries whose id
  equals a built-in id are dropped with a warning through the same mechanism `route-shadow.ts` uses.
  `groupAndSortSchemas` stays a pure ordering function; its test only needs the renamed constant.
- **Kit prop `highlightKey?: string`** on `PluginSettingsRenderer` (`packages/sdk/src/patterns/`):
  the matching `Field`/`Fieldset` gets `data-highlighted="true"` + a ref; one `useEffect` keyed on
  `highlightKey` calls `scrollIntoView({ block: 'center' })` once per key and re-arms when the key
  clears (lessons precedent, `plugins/team/components/lesson-toggle-list.tsx:40-56`). Visual: the
  canonical selected treatment `ListRow` uses (`bg-bakin-action-primary-background/10`) on
  `data-highlighted`, with `rounded-bakin-surface` + negative-margin/padding so the tint has room.
  No focus stealing. `scrollIntoView` is optional-called (happy-dom lacks it).
- **Story obligation** (conformance contract "Supported component behavior or props"): new public
  story export `HighlightedField` on `Components/Forms/Plugin settings renderer` with a play assertion
  on `data-highlighted`; `bakinCoverage` gains `deep-link`; `ui:story-compliance:check` +
  `ui:kit-coverage:check` green; `ui:conformance --full` at the final checkpoint. `public-api.json`
  lists the component by name only — no inventory edit expected (verify).
- **Tailwind artifact**: new utility classes in `packages/sdk` change the tracked `packages/sdk/styles.css`.
  Task 2 runs `bun run build:css` and commits `styles.css` with the kit change (memory:
  tailwind-canonical-stylesheet-hermeticity, full-build-chain-before-commit). Never `git add -A`.
- **Producers** hand-write hrefs (existing `/models?tab=routing` convention). No builder.
- **Tests** mount the real route component under the global router shim (`tests/setup.ts` aliases
  `@tanstack/react-router` → `tests/shims/tanstack-router.ts`; `useLocation` reads happy-dom's
  `window.location`). Per-file override of `useNavigate` with a spy records navigations
  (template: `tests/plugins/chat/chat-page-routing.test.tsx:23-29`, `setURL` helper at `:51-55`).

## Dependency graph

```
[T1 route ?tab= + ids + savedValues tag + guard + tests]
        │
        ▼
[T2 kit highlightKey + story + styles.css + adapter + route ?field= + tests]
        │
        ▼
[T3 six producer hrefs + their tests]      (targets must exist: needs T1 ids, T2 field)
        │
        ▼
[T4 docs sweep + spec status]
```

T3 could technically follow T1 alone for the four category-only links, but splitting it would
create two producer commits for one concern. Keep it after T2.

## Task list

### Task 1: `/settings` category rides `?tab=` (commit 1)

**Description:** Rename the two built-in ids, replace `selectedId` state with `useQueryState('tab')`,
normalize unknown tabs after schemas load, guard plugin-id collisions, and retag `savedValues` by
`valuesUrl` so history navigation never shows another category's saved form. Pin with RTL tests.

**Acceptance criteria:**
- [ ] `SYSTEM_SETTINGS_TAB_ID === 'system'`, `PROVIDER_KEYS_TAB_ID === 'integrations'`; no other reference to the old spellings anywhere (`grep -rn "__system\b\|__provider_keys__"` → 0).
- [ ] `/settings?tab=models` mounts with Models active; `/settings` mounts System & Alerts and emits no navigation; `/settings?tab=nope` emits exactly ONE replace navigation to `/settings` and only after schemas resolve; selecting a category emits one replace navigation carrying `tab=<id>` and no `field`; re-selecting the active category emits nothing.
- [ ] A schema entry with id `system` or `integrations` is not rendered and a warning is emitted; `groupAndSortSchemas` tests pass with the renamed constant.
- [ ] After a save on category A, mounting/reading category B via URL shows B's loaded values (savedValues tag test).

**Verification:**
- [ ] `bun test tests/components/settings-route-url-state.test.tsx tests/components/settings-route-save.test.tsx tests/components/settings-sort.test.ts --isolate`
- [ ] `bun run lint && bun run typecheck && bun run ui:conformance --quick`
- [ ] Manual on 3737 (`bun run dev`): refresh on `/settings?tab=tasks` keeps Tasks; Back after two category clicks leaves `/settings` (no per-click entries).

**Dependencies:** None.

**Files likely touched:**
- `src/components/system-settings.ts`, `src/components/provider-keys-tab.tsx`
- `packages/host/src/routes/settings.tsx`
- `tests/components/settings-route-url-state.test.tsx` (NEW), `tests/components/settings-sort.test.ts`, `tests/components/settings-route-save.test.tsx` (only if the URL default needs seeding)

**Estimated scope:** M (5 files)

**Commit:** `feat(settings): category rides ?tab= with system/integrations ids`

---

### Task 2: `?field=` deep link → kit `highlightKey` (commit 2)

**Description:** Add `highlightKey` to the kit `PluginSettingsRenderer` (data attribute + scroll-once +
canonical selected tint), demonstrate it in the public story with a play assertion, thread it through
the host adapter, and have the route read `?field=` (inert on `integrations`, cleared on category
switch — the clear was already wired in T1's `selectPlugin`).

**Acceptance criteria:**
- [ ] `<PluginSettingsRenderer highlightKey="b" …/>` renders exactly one element with `data-highlighted="true"` (the `Field` or `Fieldset` for key `b`); `scrollIntoView` is called once for `b`, not again on re-render, and again after the key clears and returns.
- [ ] `/settings?tab=system&field=dispatch.paused` highlights that field; `/settings?tab=integrations&field=x` renders the keys tab with no highlight and no navigation; an unknown field key highlights nothing and emits no navigation.
- [ ] Story `HighlightedField` exists with a play assertion; `bun run ui:story-compliance:check` and `bun run ui:kit-coverage:check` pass; `packages/sdk/styles.css` regenerated and included in the commit.

**Verification:**
- [ ] `bun test tests/components/plugin-settings-renderer.test.tsx tests/components/settings-route-url-state.test.tsx --isolate`
- [ ] `bun run build:css && git status --short packages/sdk/styles.css` (changed → stage it), `bun run ui:test:stories`, `bun run ui:story-compliance:check`, `bun run ui:kit-coverage:check`, `bun run lint`, `bun run typecheck`, `bun run ui:conformance --quick`
- [ ] Manual on 3737 after `bun run build:vendors` + hard refresh (kit code ships through the vendor bundle): open `/settings?tab=system&field=integrations.discord.guildIds` → scrolled + tinted; click another category → `field` gone from URL.

**Dependencies:** Task 1.

**Files likely touched:**
- `packages/sdk/src/patterns/plugin-settings-renderer.tsx`
- `storybook/public/forms/plugin-settings-renderer.stories.tsx`
- `src/components/plugin-settings-renderer.tsx` (adapter pass-through)
- `packages/host/src/routes/settings.tsx`
- `packages/sdk/styles.css` (generated), `tests/components/plugin-settings-renderer.test.tsx`, `tests/components/settings-route-url-state.test.tsx`

**Estimated scope:** M/L (7 files, two of them tests, one generated) — acceptable because the kit
change and its consumer are one vertical slice; splitting would leave a dead prop.

**Commit:** `feat(sdk): highlightKey on PluginSettingsRenderer`

---

### Task 3: retarget the six `/settings` producers (commit 3)

**Description:** Point every existing "Open …" link at the category and field it names.

| Producer | New href |
|---|---|
| `delivery-discord.ts` no bot token | `/settings?tab=integrations` |
| `delivery-discord.ts` no guilds | `/settings?tab=system&field=integrations.discord.guildIds` |
| `delivery-discord.ts` approval buttons locked | `/settings?tab=system&field=integrations.discord.approvers` |
| `delivery-discord.ts` inbound chat locked | `/settings?tab=system&field=integrations.discord.inbound.allowFrom` |
| `channel-aliases.ts` | `/settings?tab=system` |
| `capabilities-tab.tsx` "Add the key in Settings" | `/settings?tab=integrations` |

**Acceptance criteria:**
- [ ] `grep -rn "href: '/settings'\|to=\"/settings\"" plugins packages/host/src` returns only the sidebar nav item and `route-shadow.ts`.
- [ ] `tests/plugins/health/delivery-discord-check.test.ts` asserts each of the four incidents' `resolution.href`; the channel-aliases case in `system-checks.test.ts` (add one if absent) asserts its href.

**Verification:**
- [ ] `bun test tests/plugins/health/delivery-discord-check.test.ts tests/plugins/health/system-checks.test.ts --isolate`
- [ ] `bun run lint && bun run typecheck`
- [ ] Manual on 3737 (server restart — system checks are server code): Health → run checks → a Discord incident's button lands on the tinted field.

**Dependencies:** Tasks 1–2.

**Files likely touched:**
- `plugins/health/lib/system-checks/delivery-discord.ts`, `plugins/health/lib/system-checks/channel-aliases.ts`
- `packages/host/src/components/runtime/capabilities-tab.tsx`
- `tests/plugins/health/delivery-discord-check.test.ts`, `tests/plugins/health/system-checks.test.ts`

**Estimated scope:** M (5 files)

**Commit:** `fix(health,runtime): deep-link settings resolutions to their category and field`

---

### Task 4: docs sweep + spec status (commit 4)

**Description:** Record the new URL surface where authors and the operator look for it.

**Acceptance criteria:**
- [ ] `.claude/knowledge/url-state-deep-linking.md`: Settings row in Implementation Status (`tab` = `system` | `integrations` | `<pluginId>`, `field`); `field` row in the param table; `tab` row notes the settings values.
- [ ] `docs/src/content/docs/using/settings.md`: short "Deep links" paragraph with both URL shapes.
- [ ] `.claude/knowledge/delivery-bridge.md` / `doctor-and-health-checks.md` checked for quoted resolution targets (grep found none — confirm, no edit if clean); README confirmed unaffected.
- [ ] Spec status → `Phase 1 SHIPPED (PR #…)`, Phase 2 table left intact; this plan's todo ticked.

**Verification:**
- [ ] `bun run lint` (markdown is not linted; this is for the spec's touched code paths — nothing expected)
- [ ] `bun run docs:check` if present, else `grep -n "field" .claude/knowledge/url-state-deep-linking.md`

**Dependencies:** Tasks 1–3.

**Files likely touched:**
- `.claude/knowledge/url-state-deep-linking.md`, `docs/src/content/docs/using/settings.md`, `.claude/specs/settings-url-state.md`, `tasks/settings-url-state/todo.md`

**Estimated scope:** S/M (4 files, docs only)

**Commit:** `docs(settings): URL state, field deep links, knowledge + docs-site sweep`

---

## Checkpoints

### Checkpoint A — after Task 1
- [ ] Focused tests + full `bun run test` green, lint, typecheck, `ui:conformance --quick`
- [ ] 3737 manual: refresh keeps category; unknown tab normalizes once; Back does not walk categories
- [ ] Commit 1 on `feat/settings-url-state`; `git log -1` verified before commit

### Checkpoint B — after Tasks 2–3
- [ ] Full `bun run test`, lint, typecheck, `ui:test:stories`, story-compliance, kit-coverage, `ui:conformance --quick`
- [ ] `styles.css` committed with commit 2; no stamp files (`generated-version.ts`, `_embedded-assets-static.ts`) staged
- [ ] 3737 manual (after `build:vendors` + server restart): Health incident → tinted field; Runtime → Integrations & Keys
- [ ] Commits 2 + 3 on the branch

### Checkpoint C — merge-ready (after Task 4)
- [ ] `bun run ui:conformance --full` green (required: supported-prop change)
- [ ] `bun run check:cycles` green
- [ ] PR opened via `gh pr create` with the live checklist from the spec in the body; NOT merged
- [ ] Mark runs the live checklist; merge is Mark's call

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Normalize effect fires for the outgoing page (params observed one render before unmount) | Med — writes `?tab=system` onto another route | `pathname === '/settings'` guard (health precedent) + test that a non-settings pathname emits nothing |
| Normalize before schemas load treats every plugin tab as unknown | High — every deep link bounces to `system` | Effect returns until `plugins.length > 0`; test 3 asserts zero navigations before schemas resolve |
| `savedValues` shown under the wrong category after Back/Forward | High — stale form saved back over server state (the exact bug the current invariant comment guards) | Tag `savedValues` with `valuesUrl`; dedicated test |
| happy-dom lacks `scrollIntoView` | Low — test crash | Optional call in the kit; tests stub `Element.prototype.scrollIntoView` with a spy |
| Story compliance ratchet rejects a new export lacking play/coverage/baseline | Med — CI red | Follow `CanonicalUsage` shape; run both story checks before commit 2; if the visual-baseline tooling requires generating a NEW snapshot, do it for the new story only (no existing baseline is regenerated) |
| Stale `styles.css` committed / not committed | Med — CI drift check fails | `build:css` then stage `packages/sdk/styles.css` explicitly in commit 2 |
| Kit edit invisible on 3737 (vendor bundle) | Low — false "it doesn't work" | `bun run build:vendors` + hard refresh before manual checks (memory: dev-loop vendor staleness) |
| `useQueryState` setters batching means `setTab`+`setField('')` compose — but `setField('')` with default `''` is a delete, fine; `setTab(SYSTEM)` also deletes | None | Test 4 asserts the composed URL |

## Open questions

- None blocking. If the story tooling insists on a visual baseline for the new `HighlightedField` story, I will generate ONLY that new snapshot and say so in the handoff — regenerating an existing baseline needs your explicit approval and is not planned.

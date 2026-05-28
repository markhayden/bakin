# Spec: #366 — Settings page layout + alphabetization

GitHub issue: https://github.com/markhayden/bakin/issues/366

## Objective

Fix two usability bugs on the `/settings` page:

1. **Cramped editor.** The Messaging settings content-type editor renders 7 sub-fields per row inside a 32rem column. Labels and inputs are clipped.
2. **Unordered plugin list.** Plugin tabs appear in registration order, which is not stable or scannable.

Both bugs live in the host (`markhayden/bakin`), not in the messaging plugin in `bakin-bits-official` — the messaging plugin cannot influence the host's max-width or the host's plugin list ordering. The issue body acknowledges this; the user's kickoff note ("fix will be in bakin-bits-official") was overridden after confirmation.

**Target users:** the single user of this self-hosted Bakin instance (Mark) and any future plugin author whose `settingsSchema` declares a `list` field with more than 2-3 sub-fields.

## Scope

### In scope

- `packages/host/src/routes/settings.tsx` — remove `max-w-lg` on the form column; group + sort the plugin list with section labels.
- `src/components/plugin-settings-renderer.tsx` — switch list-row grid from `repeat(N, minmax(0, 1fr))` to `repeat(auto-fit, minmax(180px, 1fr))` so rows wrap on narrower viewports.
- `src/lib/plugin-registry.ts` — `getSettingsSchemas()` returns `source: 'built-in' | 'user'` per schema.
- `tests/core/plugin-registry.test.ts` — assert the new `source` field.
- `tests/components/plugin-settings-renderer.test.tsx` — assert auto-fit grid style.
- New: a small unit test for the sort/group helper extracted from `settings.tsx`.
- `.claude/knowledge/plugin-system.md` — note the new `source` field and group-by-source UI.

### Out of scope

- Moving `src/components/plugin-settings-renderer.tsx` or `src/components/system-settings.tsx` to `packages/host/src/components` or `@makinbakin/sdk` (called out as TC26/TC27 tech debt; not driven by this issue).
- Regenerating `docs/public/openapi.json` — the schemas endpoint there is documented as a generic `object`; no shape change needed.
- Modifying the messaging plugin's `settingsSchema` — the layout fix at the host level is sufficient.
- Backwards-compatibility shims for the `source` field — single-user app, no external API consumers, callers update in lockstep.

## Acceptance criteria

From the issue:

- ✅ Messaging settings content-type editor expands to full available settings page width.
- ✅ Field labels and controls do not overlap or truncate at normal desktop widths.
- ✅ Layout remains usable on narrower viewports — sub-fields wrap onto subsequent rows.
- ✅ Save / Cancel and Add content-type actions remain visible and aligned with the editor.
- ✅ Settings list is alphabetized in the UI.

Project-specific:

- ✅ System & Alerts remains pinned at the top and is the default landing tab.
- ✅ Built-in plugins (those in `CORE_PLUGINS`) are grouped under a "Built-in" section label, sorted A-Z by display name.
- ✅ User-installed plugins are grouped under an "Installed" section label, sorted A-Z by display name; section hidden if empty.
- ✅ Sort is case-insensitive (use `localeCompare(b, undefined, { sensitivity: 'base' })`).
- ✅ Manual verification against the running `bun run dev/imitation-crab/index.ts --with-bakin` instance: open `/settings`, exercise the Messaging tab at desktop width, then resize to ~600px to confirm list-row wrap.

## Design decisions

(Resolved during interview; recorded here as the rationale anchor.)

| Decision | Choice | Why |
|---|---|---|
| Repo for the fix | `markhayden/bakin` (host) | The constraint and the unordered list both live in host code; the plugin has no way to override them. |
| Width strategy | Remove `max-w-lg` entirely | Cleanest; PageLayout's outer padding still gives a comfortable margin; single-field forms with extra whitespace to the right are harmless. |
| List-row responsiveness | `repeat(auto-fit, minmax(180px, 1fr))` | No breakpoints, no per-plugin knob; handles arbitrary sub-field counts; wraps cleanly when columns can't fit. |
| Plugin ordering | Pin System & Alerts, then Built-in (A-Z), then Installed (A-Z) | Matches the user's "official included vs installed" mental model; preserves the natural entry point. |
| Group surfacing | Small uppercase muted section label above Built-in and Installed | Self-explanatory; hides Installed section entirely when no user plugins. |
| `source` field plumbing | Extend `getSettingsSchemas()` and `/api/plugin-settings/schemas` response | Reuses the existing `isCorePlugin()` predicate; one new field per schema. |

## Architecture impact

- Adds one field (`source: 'built-in' | 'user'`) to the response of `GET /api/plugin-settings/schemas`. No external consumers; openapi schema for this endpoint is already a generic `object`.
- Extracts a small pure helper (`groupAndSortSchemas`) from `settings.tsx` so it can be unit-tested without mounting the route.

## Commit strategy

Three commits, each independently revertable and each landing with its own tests:

1. **`feat(plugin-registry): expose source on settings schemas`**
   - `src/lib/plugin-registry.ts` — extend `getSettingsSchemas()` return type with `source: 'built-in' | 'user'`.
   - `tests/core/plugin-registry.test.ts` — extend existing `getSettingsSchemas` test to assert `source`.
   - Pure data-shape change; no UI yet.

2. **`fix(settings): alphabetize and group plugin list`**
   - `packages/host/src/routes/settings.tsx` — extract `groupAndSortSchemas` helper; render three sections (System pinned, Built-in label + A-Z, Installed label + A-Z hidden when empty).
   - New: `tests/host/settings-sort.test.ts` (or co-located) — unit test the helper across edge cases (no user plugins, mixed case names, missing source defaults to user).

3. **`fix(settings): widen form and wrap list rows responsively`**
   - `packages/host/src/routes/settings.tsx` — remove `max-w-lg`.
   - `src/components/plugin-settings-renderer.tsx` — auto-fit grid for list rows.
   - `tests/components/plugin-settings-renderer.test.tsx` — assert the `gridTemplateColumns` value.
   - `.claude/knowledge/plugin-system.md` — note the `source` field and grouped UI (small append to the settings section).

Validation between commits 2 and 3 uses the running imitation-crab instance for visual confirmation (Messaging tab + resize) before final commit lands.

## Testing strategy

- **Unit:** sort/group helper (commit 2), renderer grid style assertion (commit 3), registry schema shape (commit 1).
- **Manual:** imitation-crab dev loop at `http://localhost:3737/settings` — verify each acceptance criterion in turn. Resize window to confirm responsive wrap.
- **No new integration/e2e** — these are small layout changes, manual verification is appropriate.

## Boundaries

**Always:**
- Run `bun test --isolate tests/...` for any test file we touch (per CLAUDE.md).
- Update `.claude/knowledge/plugin-system.md` when the schemas API shape changes.

**Ask first:**
- (Resolved during kickoff: repo choice, width strategy, list responsiveness, group structure, commit slicing. Nothing else outstanding.)

**Never:**
- Touch `bakin-bits-official` (out of scope; the fix is host-side).
- Introduce a per-plugin width hint API (rejected during kickoff as unnecessary coupling).
- Add backwards-compat for the old schemas response shape (single user, no external consumers).
- Move `plugin-settings-renderer.tsx` or related components — tracked as separate TC26/TC27 tech debt.

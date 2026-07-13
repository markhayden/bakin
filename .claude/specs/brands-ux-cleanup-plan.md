# Brands UX Cleanup — Plan & Task Breakdown

Spec: `.claude/specs/brands-ux-cleanup.md`. Each task = one commit = one rollback
checkpoint; the suite is green at every checkpoint. Vertical slices: each UI task
lands its surface complete (UI + tests + states), not layered halves.

## Dependency graph

```
T0 docs anchor
T1 nav ─────────────────────────────┐ (independent)
T2 SDK SaveBar/SectionCard/DangerZone ─┬─► T8 identity   ─┐
T3 SDK AssetPicker ────────────────────┼─► T10 assets    ─┤
T4 completeness (server) ──────────────┼─► T7 list cards ─┤
T5 builder website mode (server) ──────┼─► T7 chooser    ─┼─► T11 settings/overview ─► T12 docs ─► final verify
T6 routing /brands/$brandId ───────────┴─► T7,T8,T9,T10,T11
T9 doc editor route+UI (needs T2, T6)
```

Build order: T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12.
Checkpoints (pause, full suite + smoke): **C1** after T3 (SDK ready), **C2** after
T6 (routing flipped, old UI still works on new URLs), **C3** after T11 (UI
complete → full browser pass), **C4** after T12 (ship).

One deliberate refinement vs spec §11: the docs editor route file lands WITH its
UI in T9 (vertical slice), not in the T6 routing commit — T6 flips only the
detail route.

---

## T0 — Anchor docs commit
`docs(knowledge): ui-patterns lessons + brands ux cleanup spec/plan`
- Commit the untracked `.claude/knowledge/ui-patterns.md` + spec + this plan.
- **AC**: clean `git status` baseline for the work.

## T1 — Nav: "Branding" + Paintbrush
`feat(host): name Branding nav with Paintbrush icon`
- `plugins/brands/bakin-plugin.json`: label `Branding`, icon `Paintbrush`.
- `packages/host/src/components/layout/app-sidebar.tsx`: import `Paintbrush`,
  add to `ICONS`; comment that manifest icons must exist in this map.
- `plugins/brands/client.tsx` search-hit renderer icon `palette` → paintbrush
  (nav and ⌘K hits agree on the plugin's visual identity).
- **AC**: sidebar shows a paintbrush + "Branding" (today it renders NO icon —
  `Palette` was never in the map). **Verify**: `bun run dev`, look.

## T2 — SDK: SaveBar, SectionCard, DangerZone
`feat(sdk): SaveBar, SectionCard, DangerZone components`
- `src/components/save-bar.tsx` — `{dirty, saving, error, savedFlash, onSave,
  onDiscard}`; renders nothing when clean; "Saved ✓" flash state; beforeunload
  guard helper. Token-only, `data-savebar` hooks. Labels/behavior converge
  with `PluginSettingsRenderer`'s existing dirty/save pattern (disabled until
  dirty, "Saving..."); renderer migration is a tracked follow-up, not here.
- `src/components/section-card.tsx` — `{title, icon?, description?, action?,
  children}`.
- `src/components/confirm-dialog.tsx` — EXTEND with optional `confirmValue`
  prop (typed-confirmation input gates the confirm button); existing consumers
  untouched.
- `src/components/danger-zone.tsx` — `{title, description, confirmValue,
  confirmLabel, onConfirm, busy?, error?}`; destructive flow COMPOSES
  ConfirmDialog (one confirm engine — never a parallel implementation).
- Export all via `packages/sdk/src/components/index.ts`.
- Tests: `tests/components/{save-bar,section-card,danger-zone}.test.tsx` — RTL,
  `rtl-settle`, per CLAUDE.md isolation rules.
- **AC**: SaveBar hidden when clean / bar with Save+Discard when dirty / busy
  disables / error renders / saved-flash then hides; DangerZone button disabled
  until exact `confirmValue` typed; SectionCard renders description slot.

## T3 — SDK: AssetPicker
`feat(sdk): AssetPicker dialog`
- `src/components/asset-picker.tsx` — Dialog: search input, thumbnail grid from
  `GET /api/plugins/assets/versioned` (`/api/assets/<id>/thumb`), drag/drop +
  button upload (`POST /api/plugins/assets/upload`) then auto-pick; skeletons,
  empty state, honest error state when assets API unreachable.
- Export + tests (mock `fetch`; upload path, pick path, error path).
- **AC**: pick fires `onPick(assetId)` and closes; upload → picks new id;
  unreachable API → error state, never a blank grid.

## T4 — Server: kit completeness
`feat(brands): server-side kit completeness`
- `plugins/brands/lib/completeness.ts` — pure `computeCompleteness(manifest,
  docs)` → `{percent, items: [{key, label, done, hint, fixTab}]}`. Items: logo,
  palette ≥3, description, voice.md beyond scaffold, style-guide.md beyond
  scaffold, ≥1 rule, ≥1 terminology, ≥1 reference asset. Compare against
  `scaffold.ts` content for the doc checks.
- Wire: `GET /` per-brand `{percent, missing: key[]}`; `GET /:brandId` full
  checklist. Types in `types.ts`.
- Tests: contract fixtures (empty / scaffold-only / full kit) +
  `routes.test.ts` response-shape cases.
- **AC**: fixtures pin exact percent + missing keys; list + detail responses
  carry completeness.

## T5 — Server: builder website mode
`feat(brands): builder website mode + source-mining prompt`
- `POST /builder` (`plugins/brands/lib/routes.ts:160`): `product` optional;
  require `product OR urls` (zod refine). Prompt: when urls present, explicit
  source-mining steps (fetch each URL, extract palette hex, voice, terminology,
  logo candidates; record what came from where in `_intake.md`).
- Response already returns `taskId` — pin it in a test (drafting banner link).
- Tests: url-only payload accepted; neither product nor urls → 400; prompt
  includes mining instructions when urls present.
- **AC**: url-only create works end-to-end (draft + task).

## T6 — Routing: `/brands/$brandId`
`refactor(host,brands): path routing for brand detail`
- `packages/host/src/routes/brands.$brandId.tsx` (assets.$assetId pattern),
  register in `packages/host/src/router.ts`.
- `plugins/brands/client.tsx`: register slot `page:/brands/:brandId` → wrapper
  reading route params → `BrandDetail`; search hit hrefs → `/brands/<id>`.
- `brands-page.tsx`: drop `useQueryState('brand')` detail switch; cards
  `navigate({to: '/brands/$brandId'})`. `task-brand-panel.tsx` links updated.
  `?tab=` stays. Mind ui-patterns gotcha #1 (single navigation per transition).
- **AC**: detail at `/brands/<id>` with working tabs; list has no detail mode;
  every producer emits path links (repo-wide grep for `brands?brand=` → zero).
- **Verify**: dev smoke — list → card → detail → tabs → back; search hit →
  detail.

## T7 — List page rework
`feat(brands): list page rework — header, chooser, import modal, cover cards`
- `PluginHeader` search (name/id/description filter) + `New Brand` action.
- Chooser Dialog: three plain-language path rows (Build / From website /
  Import) → opens the respective flow.
- **From website** Dialog: name, URLs (1+), agent picker (SDK `AgentSelect` —
  also swapped into the builder wizard; zero hand-rolled agent dropdowns in
  the plugin), optional notes → `POST /builder` url-mode → navigate to draft
  detail.
- Import modal (Dialog): source → Preview (`POST /import/preview`) → preview
  card + replace-warning → Import → toast + navigate. Inline form dies.
- Cover-art cards (spec §5 layout B): tinted cover + logo/monogram (AgentAvatar-
  style initials fallback), palette edge, name, clamped description, status
  badge, completeness via SDK `ui/progress` bar + percent + missing-items
  tooltip (T4 data — no bespoke ring), meta line. 2-col grid, neutral hover.
- Empty state = inline chooser paths + pitch line; skeleton cards while
  loading. Ordering: drafts first, then updated-desc.
- Builder drawer polish (spec §6a): SDK inputs, helper text, labeled agent
  picker, disabled-Next tooltip.
- Tests: header/search filter, chooser paths open, import preview→import flow,
  url-mode create POST body, empty-state paths render, card shows completeness
  tooltip + navigates.
- **AC**: every spec §5/§6 behavior; zero hand-rolled inputs left on the page.

## T8 — Detail: identity + staged save model
`feat(brands): staged manifest draft + SaveBar; identity rework`
- One draft manifest in `BrandDetail` state; all manifest-backed edits mutate
  it; `SaveBar` (dirty/saving/error/saved-flash) does full `PUT /:brandId`,
  refreshes from response (ui-patterns #3). Draft persists across tabs; route-
  leave guard. Blur-to-save + ListEditor Save/Discard die.
- Identity in `SectionCard`s with why-it-matters descriptions; name input +
  description `Textarea`; palette rows with hex↔swatch sync + inline invalid-
  hex error holding Save + teaching placeholders; rules/terminology row
  editors; add-row right-aligned, per-row remove at row end.
- Fix the extra-column bug: replace the `[&>*:nth-child(-n+2)]:lg:col-span-2`
  grid with explicit stable layout; confirm live against the screenshot repro.
- Tests: edit → SaveBar appears; Save PUTs full manifest + flash; Discard
  restores; invalid hex holds Save; hex↔swatch sync; textarea present.
- **AC**: single save path for the whole manifest; no per-section save UI
  anywhere; extra column gone.

## T9 — Docs: lists + dedicated editor route
`feat(brands): doc lists + /brands/$brandId/docs editor route`
- `packages/host/src/routes/brands.$brandId.docs.$kind.$name.tsx` + router
  entry + slot `page:/brands/:brandId/docs` registered in `client.tsx` —
  follow the `workflows.$id.edit.tsx` precedent (route wrapper passes params +
  an `onSaved` navigation callback into the slot component).
- Editor page: breadcrumb, title, Edit|Preview (`MarkdownEditor`), Save +
  dirty guard, honest error surface; new-doc mode (empty content, first Save
  creates via `PUT docs/:kind/:name`).
- Guidelines/Lessons tabs: `SectionCard` doc rows (name, description, meta,
  Edit → route, Delete → `ConfirmDialog` on existing DELETE endpoint).
  Guidelines rows: "Always in context" `Switch` + info tooltip (spec copy).
  New-doc Dialog (filename `.md` auto-append + validation, optional
  description) → editor route.
- Overview Voice card Edit → editor route on voice.md.
- **Build-time verify**: where the doc description persists; fallback =
  first-heading preview, drop the dialog field (spec §7d).
- Tests: row → route navigation, new-doc dialog validation, switch PATCHes
  cardDocs, delete confirm, editor save + dirty guard, not-found doc state.
- **AC**: no inline list-replacement editor left; voice editable in ≤2 clicks
  from Overview.

## T10 — Assets tab rework
`feat(brands): assets tab rework on AssetPicker`
- Three `SectionCard`s with spec §7f descriptions + per-section empty states.
- All adds via `AssetPicker`; raw `<select>` + loose upload strip die.
- Tiles: thumbnail, human title primary, assetId small mono, note editing,
  remove; logo variant as labeled Select (primary/dark/light/mono + custom).
- Manifest ref changes stage into the T8 draft (SaveBar); asset-description
  PATCHes stay immediate (cross-plugin).
- Tests: picker opens per section, pick stages ref (SaveBar dirty), variant
  select stages, remove stages, empty states render.
- **AC**: adding any asset never shows a raw id dropdown; refs save via the
  one save path.

## T11 — Settings, overview checklist, drafting banner
`feat(brands): settings + DangerZone, overview checklist, drafting banner`
- Settings order: Status (publish + blocked-tasks count) → Imported from →
  What agents see (reframed footprint + integrity) → `DangerZone` (typed
  brand-id confirm, consequences copy). Hand-rolled confirm dies. Publish gets
  light confirm + toast.
- Overview: completeness checklist card (T4 data) with jump links; stat tiles,
  voice card, rules/terminology summary, activity — all `SectionCard`s.
- Drafting banner (spec §7h): fresh drafts show agent + task link (builder
  `taskId`) + activity feed + blocked-tasks count; warning/info tokens.
- Detail route states: hero+tabs skeleton; not-found via SDK `ErrorState`.
- All success/failure feedback via SDK `toast` (`@makinbakin/sdk/hooks`).
- Tests: DangerZone requires typed id then DELETEs + navigates; publish
  confirm→toast; checklist links jump tabs; banner renders for drafts with
  task link; not-found state.
- **AC**: delete is big, scary, at the bottom; a fresh draft never looks
  silent/empty.

## T12 — Docs & knowledge sweep
`docs: brands UX — knowledge, docs site, CLAUDE.md`
- `.claude/knowledge/brands-plugin.md`: routing, create flows, completeness,
  save model, website mode. `.claude/knowledge/ui-patterns.md`: new lessons +
  the four SDK components. `.claude/knowledge/repo-architecture.md`: new host
  routes. CLAUDE.md brands bullet (builder website mode).
- Check `docs/src/content/docs/` for brands + SDK component docs; update where
  they exist. Check README for impacted references.
- **AC**: grep for stale `?brand=` / "Brands" nav references in docs comes back
  clean; knowledge matches shipped behavior.

## Final verification (C4 gate, before any merge/PR)
1. `bun run test` green (full suite, `--isolate`, worker cap respected).
2. `bun run dev` browser pass over EVERY surface: list (empty + populated),
   chooser × 3 paths, import preview/import, builder wizard, from-website
   create → drafting banner, detail tabs, SaveBar save/discard/guard, palette
   validation, doc editor (edit + new + delete), assets picker flows, settings
   publish + delete, search-hit navigation, extra-column screenshot repro
   gone. Chrome DevTools MCP for console errors on each page.
3. `/verify` isolated boot: brands API smoke (list w/ completeness, builder
   url-mode, import preview) — guest-URL settings guard per memory.
4. No build-stamp churn staged (`git status` check; never `git add -A`).

## Rollback strategy
Every task is one conventional commit on a feature branch
(`feat/brands-ux-cleanup`); revert = drop the commit. The routing flip (T6) is
the only cross-cutting commit — it lands smallest-possible (route + links only,
no visual changes) so a revert of any later UI commit never re-strands URLs.

# Brands Plugin UX Cleanup

Top-to-bottom polish of the Brands plugin UI. Priority: kill the amateur/confusing
feel by composing established SDK patterns instead of one-off editors, and promote
the missing shared patterns INTO the SDK. Tech-debt reduction over compatibility —
single-user machine, no shims, no legacy URL support.

Interview decisions are locked (2026-07-12); this spec is the record.

## 1. Objective

The `/brands` surface must feel like the rest of Bakin (chat/tasks/assets tier):
consistent header, consistent create flows, consistent editors, consistent
save semantics, honest empty/loading states, and descriptions that tell an end
user why each section matters.

## 2. Locked decisions (from interview)

| Decision | Answer |
|---|---|
| Scope | Full-stack as needed — UI-first, but server routes/store/manifest may change. No compat shims. |
| Create paths | "New Brand" button → chooser with THREE paths: **Build my brand** (questionnaire → agent), **From website** (URL + agent, skips questionnaire), **Import** (portable/GitHub). The bare name-input blank-brand path dies. |
| Completeness | Server-computed checklist; progress shown on cards (tooltip lists missing items) + actionable checklist on detail Overview. |
| Save model | Split: ONE staged manifest draft + sticky SaveBar for all manifest-backed fields; markdown docs save in their own editor. Blur-to-save dies. |
| Doc editor | Dedicated route `/brands/$brandId/docs/$kind/$name` — full-width editor page, deep-linkable. NOT a drawer, NOT inline swap. |
| SDK additions | All four: `SaveBar`, `SectionCard`, `AssetPicker`, `DangerZone`. |
| Card layout | Cover-art card (option B): tinted logo cover band + palette base edge, 2-col grid. |
| Agentic build | Full third path now — "From website" is first-class in the chooser. |
| Routing | Path-based: `/brands/$brandId` (tabs stay `?tab=`), nested docs editor route. Query-param `?brand=` selection dies. |

## 3. Nav

- `plugins/brands/bakin-plugin.json`: `label: "Branding"`, `icon: "Paintbrush"`.
- `packages/host/src/components/layout/app-sidebar.tsx`: add `Paintbrush` to the
  lucide imports + `ICONS` map. (Today `Palette` isn't in the map — the nav item
  renders iconless. Add a comment noting manifest icons must exist in this map.)
- Search hit renderers (`client.tsx`) switch their `palette` icon to the
  paintbrush too — nav and ⌘K hits must agree on the plugin's visual identity.

## 4. Routing (host + slots)

Follow the assets-plugin precedent (`assets.$assetId.tsx`, slot `page:/assets/:assetId`):

- `packages/host/src/routes/brands.$brandId.tsx` → slot `page:/brands/:brandId`.
- `packages/host/src/routes/brands.$brandId.docs.$kind.$name.tsx` → slot
  `page:/brands/:brandId/docs` (component reads `$kind`/`$name` params; kind ∈
  `guidelines|lessons`).
- Register both in the router (memory: core plugin page 404s without host route
  + router.ts entry).
- `brands-page.tsx` drops the `useQueryState('brand')` detail switch entirely.
- Update every `?brand=<id>` link producer: search hit renderers in
  `plugins/brands/client.tsx`, `task-brand-panel.tsx`, blocked-task notification
  landing URLs (`/tasks?brand=` stays — that's the tasks board facet, different
  param), and the brands-page card click → `navigate({ to: '/brands/$brandId' })`.
- Detail tabs remain URL-backed via `useQueryState('tab', 'overview')`.
- Mind ui-patterns gotcha #1: any transition that changes >1 query param uses one
  navigation built from `window.location.search` at call time.

## 5. `/brands` list page

- `PluginHeader title="Branding"` + `count` + `search` (client-side filter over
  name/id/description) + `actions`: one primary **New Brand** button.
- **New Brand chooser**: SDK `Dialog` with three option rows (icon + title + one-line
  description each): Build my brand / From website / Import. Selecting one closes
  the chooser and opens that flow.
- **Cover-art brand cards** (2-col `sm:grid-cols-1 lg:grid-cols-2`):
  - Cover band tinted with brand primary at low alpha; logo image centered
    (first `logos[]` entry via `/api/assets/<id>/thumb`), monogram placeholder
    (first letter on tinted disc) when no logo.
  - Palette strip as the band's bottom edge (existing proportional band logic).
  - Body: name, description (2-line clamp), status badge (`Draft`/`Published`),
    completeness as the SDK `ui/progress` bar + percent with tooltip listing
    missing checklist items (no bespoke ring SVG — nothing else in the app
    draws rings; the bar is the established meter), `N docs · N lessons ·
    N assets` meta line.
  - Whole card clickable → detail. Neutral hover (`hover:bg-foreground/5` tier) —
    accent is signal-only (ui-patterns #2).
- **Empty state IS the chooser**: when no brands exist, skip the button→dialog
  hop — render the three path cards inline (headline: what a brand kit is and
  why it matters, e.g. "Give your agents a brand kit — colors, voice, and logos —
  so everything they make stays on-brand"), each path with its plain-language
  description. Skeleton cards while loading. A blank pane is a bug.
- Ordering: drafts first (they need attention), then published by most recently
  updated.

## 6. Create flows

**Every path ends somewhere obvious.** Agentic paths (6a/6b) navigate to the new
draft's detail page immediately on submit, where a **drafting banner** (§7h)
shows the agent is working. Import (6c) navigates to the imported brand's detail
on success. Success = toast + you're looking at the thing you made — never a
closed dialog over an unchanged list.

**Chooser copy is plain language** (no "portable format", no "questionnaire"):
- *Build my brand* — "Answer a few quick questions and an agent drafts the whole
  kit for you to review."
- *From a website* — "Point an agent at your site or style guide. It extracts
  colors, voice, and terminology automatically."
- *Import* — "Bring in an existing brand kit from GitHub or a folder on disk."

### 6a. Build my brand (existing drawer, polished)
- Keep the 4-step `BakinDrawer` wizard. Polish pass: SDK `Button`/`Input`/`Textarea`/
  `Label` everywhere (kill hand-rolled inputs), consistent field spacing, helper
  text under ambiguous fields, step rail clarity, disabled-Next explains why
  (tooltip), agent picker = the SDK `AgentSelect` component, labeled ("Which
  agent drafts it?") — same in the From-website flow. No hand-rolled agent
  dropdowns anywhere in the plugin.

### 6b. From website (new)
- Minimal form (Dialog or single-step drawer — implementer's choice, Dialog
  preferred): brand name, one-or-more source URLs (website/styleguide/brand PDF
  link), agent picker, optional notes. Submit → same `POST /builder` with a
  `mode: 'website'` (or equivalent) payload; server dispatches a prompt that
  instructs the agent to FETCH the sources and extract palette (hex values),
  voice, terminology, logo candidates, and rules from them.
- Server change: `POST /builder` accepts the URL-led shape — everything beyond
  name + sources + agent optional. Strengthen the dispatched prompt for source
  mining in BOTH modes (questionnaire URLs get the same treatment).

### 6c. Import (modal, replaces the inline form)
- SDK `Dialog`: source input (`github:user/repo` or local path) → **Preview**
  (existing `POST /import/preview`) → preview card (name, palette dots, counts,
  "replaces existing brand" warning styled as a real warning) → **Import**.
  Busy/error states inline; success closes modal + navigates to the brand.

## 7. Brand detail `/brands/$brandId`

Tabs unchanged in structure (`overview, identity, guidelines, lessons, assets,
settings`) — content reworked. Hero (`PaletteHero`) stays, polished: name, id,
status badge, publish button (drafts), palette band, logo.

Route-level states: loading skeleton (hero + tab shell) while fetching; a
designed **not-found state** for a bad `/brands/<id>` or docs URL via the SDK
`ErrorState` component ("This brand doesn't exist — it may have been deleted."
+ back to Branding), never a blank pane or raw error. Logo-less cards/hero use
an initials-monogram fallback (same visual convention as `AgentAvatar`'s
fallback).

### 7a. Save model (manifest)
- ONE staged draft of the manifest spans Identity + Assets tabs: edits mutate a
  local draft; **SaveBar** (new SDK component) appears fixed at the bottom when
  `dirty`: "Unsaved changes" dot, **Discard** + **Save** buttons, busy state,
  inline error on failed PUT. Save = single full-manifest `PUT /:brandId`.
- Dirty guard: navigating away (tab switches are fine — draft persists across
  tabs; route changes prompt) via the SaveBar's guard hookup.
- Ui-patterns #3: after PUT, refresh local state from the response — never keep
  patching from stale props.
- **Save feedback is explicit**: successful save flashes "Saved ✓" (SaveBar
  state or toast) before the bar disappears. Silent success reads as "did it
  work?" to a non-technical user. Same rule for every one-off mutation on the
  page (publish, import, doc save, delete → toast).
- Cross-plugin writes stay immediate (asset description PATCHes the assets
  plugin — different domain, not part of the brand draft).

### 7b. Overview
- Completeness checklist card front and center: each item with done/missing
  state and a jump link to the tab/route that fixes it ("Add a logo → Assets").
- Keep stat tiles, Voice card (its **Edit** button now navigates DIRECTLY to
  `/brands/$brandId/docs/guidelines/voice.md`), rules/terminology summary,
  recent activity. All cards get `SectionCard` treatment with descriptions.

### 7c. Identity
- All in `SectionCard`s with one-line "why this matters" descriptions
  (e.g. Palette: "Agents pull these exact values into everything they generate —
  images, docs, UI."; Terminology: "Words to always/never use — injected into
  every branded task.").
- Name (input) + **description as `Textarea`** (item 13), staged.
- Palette editor: swatch (`input type=color`) + name + hex + usage + remove,
  staged into the draft (the ListEditor's private Add/Save/Discard dies — the
  SaveBar owns save). Swatch and hex field are two views of one value — typing
  a hex updates the swatch live and vice versa; invalid hex gets a friendly
  inline error ("Hex colors look like #FF5A00"), and Save is held while any row
  is invalid. Placeholders teach by example: name "Primary", usage "buttons,
  links, calls-to-action". **Fix the extra-column bug**: the Identity grid's
  `[&>*:nth-child(-n+2)]:lg:col-span-2` dangling-cell layout is replaced with an
  explicit, stable layout; verify against the running app (the screenshot's
  empty box next to trash icons must be gone — likely the same tile/row layout
  used in assets-tab reference rows).
- Add/remove row actions right-aligned and consistent (item 11 — no more
  stuffed-left button clusters; primary action right, destructive per-row at
  row end).
- Rules + terminology editors: same row-editor treatment, staged.

### 7d. Guidelines & Lessons tabs
- Doc list as rows in a `SectionCard` (per-tab description of what these docs
  do): name, description, meta (size/updated), per-row actions: **Edit**
  (→ editor route), **Delete** (ConfirmDialog — the DELETE endpoint exists but
  had no UI).
- Guidelines rows keep the cardDocs toggle, renamed **"Always in context"**
  (Switch, not bare checkbox) + info tooltip: "Included verbatim in every
  branded task's context (within the byte budget). Leave off to keep the
  context small — agents can still fetch the doc on demand." (item 9).
- **New doc**: button → small Dialog (filename with `.md` auto-appended +
  validation, optional description) → navigates to the editor route with empty
  content; first Save creates the file (item 16 — the raw input + suffix-gated
  button dies).
- **Build-time verify**: where doc descriptions persist (the current rows show
  one — confirm the storage spot in the manifest/doc frontmatter). If there is
  no durable home, fall back to a first-heading/first-line preview as the row
  description and drop the dialog field rather than inventing a new sidecar.

### 7e. Doc editor route `/brands/$brandId/docs/$kind/$name`
- Full-width page: breadcrumb (`← Brand / Guidelines / voice.md`), title,
  description, Edit|Preview toggle (`MarkdownEditor`), Save + dirty state +
  unsaved-changes guard, error surface. Draft-gated server errors render
  honestly (published brands reject agent writes, not operator writes).

### 7f. Assets tab (full rework — think end-user)
- Three `SectionCard`s with real descriptions:
  - **Logos** — "The face of the brand. The first logo is used on cards and
    covers; variants (dark/light) help agents pick the right one." Thumbnail
    tile grid; variant as a labeled Select-like input, not a mystery text box.
  - **Asset groups** — "Bundles of reference material (product shots, UI
    screenshots) agents can browse by name."
  - **Default image references** — "Up to 4 images automatically attached as
    style references to every branded image generation. Image tools consume
    these directly."
- Adding an asset ALWAYS goes through the new **AssetPicker** dialog (thumbnail
  grid + search + drag/drop upload-new). The raw `<select>` and the loose
  upload strip die.
- Tiles: proper thumbnails, human title (asset description) primary, assetId
  demoted to small mono, note editing kept, remove per-tile. Manifest ref
  changes stage into the SaveBar draft.
- Empty states per section explain what to add and why.

### 7g. Settings tab
- Layout rework, top to bottom: **Status** (draft/published, publish action,
  and — for drafts — "N tasks are waiting on this brand" from `GET
  /blocked-tasks`), **Imported from** (import provenance + upstream check,
  plain-language — not "provenance"), **What agents see** (the context-footprint
  card reframed for humans: "Each branded task carries ~X of your brand's
  Y-size context window" + integrity warnings — existing BrandHealthSection
  content in `SectionCard` form), and at the very bottom the **DangerZone**:
  red-bordered section, "Delete this brand" with consequences spelled out
  ("Tasks linked to this brand will pause until you remove the link or
  recreate it"), type-the-brand-id-to-confirm, destructive button. The
  hand-rolled two-step inline confirm dies.
- Publishing gets a light confirm ("Publish Acme Co? Agents will start using it
  on linked tasks immediately.") + success toast.

### 7h. Drafting-in-progress state (the wait-for-the-agent story)
- A draft created by Build/From-website lands the user on the detail page with
  a prominent **drafting banner**: which agent is working, "usually takes a few
  minutes", a link to the dispatched task, and the live activity feed
  (`GET /:brandId/activity`) so progress is visible — never a silent empty
  draft. Banner uses warning/info tokens, not accent.
- When blocked tasks exist, the banner (and Settings status) shows the count —
  publishing becomes an obvious, motivated next step instead of a mystery
  button.
- Build-time verify: whether `POST /builder` returns the dispatched task id;
  if not, add it to the response so the banner can link the task.

### 7i. UI copy principles (whole plugin)
- Plain language first; jargon demoted or deleted. Never user-facing: "manifest",
  "provenance", "draft-gated", "byte budget", "cardDocs", "slug". Asset IDs are
  always demoted to small mono under a human title.
- Every section answers "why does this matter to me?" in one sentence (the
  SectionCard description).
- Buttons say what they do to the object: "Save brand", "Create draft",
  "Publish", "Delete this brand" — not bare "Save"/"OK"/"Confirm".
- Disabled controls always explain themselves (tooltip): why disabled, what
  unblocks them.
- Inputs teach by placeholder example, labels stay visible (no placeholder-as-
  label).

## 8. New SDK components (`src/components/`, exported via `@makinbakin/sdk/components`)

All token-only styling (no hardcoded palettes), tooltips via `ui/tooltip`,
`data-*` test hooks, RTL tests with `rtl-settle`.

1. **`SaveBar`** — `{ dirty, saving, error, onSave, onDiscard, children? }` —
   fixed bottom bar within the page container; renders nothing when clean;
   unsaved-dot + label, Discard (ghost) + Save (primary, busy spinner), error
   line. Exposes a `useUnsavedGuard(dirty)` helper (beforeunload + router
   block) or documents the wiring. Behavior/labels align with the codebase's
   existing dirty/save pattern (`PluginSettingsRenderer`: save disabled until
   dirty, "Saving..." busy label) — this is a CONVERGENCE, not a third save
   pattern; migrating PluginSettingsRenderer onto SaveBar is an explicit
   follow-up (out of scope here).
2. **`SectionCard`** — `{ title, icon?, description?, action?, children }` —
   the standard titled card with a muted one-line description under the title.
   Brands adopts it everywhere; existing plugins can migrate later.
3. **`AssetPicker`** — `{ open, onOpenChange, onPick(assetId), filter? }` —
   Dialog: search input, thumbnail grid from `/api/plugins/assets/versioned`,
   drag/drop + button upload-new (posts `/api/plugins/assets/upload`, then
   picks). Loading skeletons, empty state, error state; degrades honestly when
   the assets plugin is unreachable.
4. **`DangerZone`** — `{ title, description, confirmLabel, confirmValue,
   onConfirm, busy?, error? }` — red-bordered section whose destructive flow
   COMPOSES the existing `ConfirmDialog`: extend ConfirmDialog with an optional
   `confirmValue` prop (typed-confirmation input gating the confirm button) so
   there is ONE confirm engine in the SDK — never a parallel confirm
   implementation. Existing ConfirmDialog consumers are untouched (prop is
   optional).

## 9. Server changes (`plugins/brands/lib/`)

1. **Completeness** — pure function `computeCompleteness(manifest, docs)` in
   `lib/completeness.ts`: checklist of `{ key, label, done, hint }`:
   logo set · palette ≥ 3 colors · description present · voice.md has real
   content (beyond scaffold) · style-guide.md has real content · ≥ 1 rule ·
   ≥ 1 terminology entry · ≥ 1 reference asset (groups or default refs).
   Percent = done/total. Returned on `GET /` (per-brand summary: percent +
   missing keys) and `GET /:brandId` (full checklist). Pure function = pinned
   contract test.
2. **Builder website mode** — `POST /builder` schema loosens: name + sources
   (URLs) + agent required, questionnaire fields optional; dispatched prompt
   gains explicit source-mining instructions (fetch each URL, extract palette
   hex values, voice, terminology, logo candidates; cite what came from where
   in `_intake.md`). Response includes the dispatched task id (add if missing)
   so the drafting banner can link to it.
3. No other API shape changes. `PUT /:brandId` full-replace already matches the
   SaveBar model.

## 10. Explicit non-goals

- No rename of plugin id `brands`, route base `/brands`, or storage layout.
- No changes to dispatch/injection, lessons retrieval, import/export engine,
  exec tools, or the tasks-board brand facet.
- No `?brand=` URL back-compat redirects (single-user machine).
- No migration of other plugins onto SectionCard/SaveBar in this pass —
  explicitly including `PluginSettingsRenderer` adopting SaveBar (tracked
  follow-up, §8.1).
- The New-Brand chooser dialog stays brands-local (no second consumer today);
  it is a deliberate one-off, not an SDK candidate yet.

## 11. Commit strategy (checkpoint = compiles + suite green)

1. `feat(host): name Branding nav with Paintbrush icon` — manifest + ICONS map. Tiny, instant win.
2. `feat(sdk): SaveBar, SectionCard, DangerZone components` (+ RTL tests).
3. `feat(sdk): AssetPicker dialog` (+ RTL tests, mocked assets API).
4. `feat(brands): server-side kit completeness` (+ contract tests).
5. `feat(brands): builder website mode + source-mining prompt` (+ route tests).
6. `refactor(host,brands): path routing /brands/$brandId + docs editor route` — host routes, router entries, slots, link producers; detail keeps working, list drops `?brand=`.
7. `feat(brands): list page rework` — header/search/chooser/import modal/cover cards/empty state.
8. `feat(brands): detail identity + staged SaveBar save model` — kills blur-save + ListEditor save, fixes the extra-column layout, description textarea.
9. `feat(brands): doc lists + dedicated editor route UI` — guidelines/lessons rows, Always-in-context switch + tooltip, new-doc dialog, editor page.
10. `feat(brands): assets tab rework on AssetPicker`.
11. `feat(brands): settings rework + DangerZone delete; overview checklist`.
12. `docs: knowledge + docs-site updates for the new brands UX`.

Each commit is a rollback point; UI commits (7–11) land only after the routing
commit so nothing straddles the URL scheme.

## 12. Testing strategy

- **SDK components**: RTL per component (`tests/` alongside existing SDK
  component tests), `rtl-settle` import + `settleReact()` on race-prone
  assertions, `data-*` hooks, isolation mocks per CLAUDE.md.
- **Completeness**: pure-function contract test (fixtures: empty brand, scaffold-
  only, full kit).
- **Brands components**: update existing brands page/detail tests to the new
  structure; add: chooser opens three paths, empty state renders inline paths,
  import modal preview/import flow, SaveBar appears on edit + Save PUTs full
  manifest + Discard restores, save-success feedback shown, doc list → editor
  route navigation, DangerZone requires typed id, completeness ring tooltip
  lists missing items, drafting banner renders for fresh drafts + links the
  task, not-found state for a bad brand id, palette hex↔swatch sync + invalid
  hex holds Save.
- **Builder route**: website-mode payload accepted; prompt includes source URLs.
- **Live verification**: `bun run dev` + browser pass over every surface
  (including the extra-column screenshot repro) + `/verify` isolated boot for
  API-level checks. Chrome DevTools MCP for the visual pass.

## 13. Docs & knowledge coverage

- `.claude/knowledge/brands-plugin.md` — routing, create flows, completeness,
  save model, builder website mode.
- `.claude/knowledge/ui-patterns.md` — add any new hard-won lessons from this
  pass; reference the four new SDK components.
- `.claude/knowledge/repo-architecture.md` — new host route files.
- `docs/src/content/docs/` — brands user docs if they exist (verify during
  build); SDK component docs for the four new components where SDK components
  are documented.
- `README.md` — check for brands/nav references; update if impacted.
- CLAUDE.md brands bullet — update the builder-flow line (website mode).

## 14. Boundaries

- **Always**: token-only styling; SDK-first assembly; empty/loading states on
  every new surface; one staged draft, never parallel save paths; neutral
  hover chrome; mutation feedback (toast/"Saved ✓") on every write; labeled
  inputs + aria on progress/status indicators; layouts collapse cleanly to one
  column; mock content-dir + openclaw home in every test.
- **Ask first**: any manifest schema change beyond what's specced; touching
  dispatch/injection code; renaming API routes.
- **Never**: compat shims/redirects; new one-off editors; hardcoded palette
  values; `git add -A` after a local build (build-stamp trap).

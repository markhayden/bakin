# Brands Plugin (#419)

Structured brand definitions — voice, palette, rules, and reference assets —
linkable to tasks/projects/plans and injected per-task so agent output stays
on brand across a multi-brand instance. Spec: `.claude/specs/brands-plugin.md`
(+ `-plan.md` with the build record). UX pass (2026-07):
`.claude/specs/brands-ux-cleanup.md` (+ `-plan.md`).

## UI (post-UX-cleanup, 2026-07)

Nav is **"Branding"** with the Paintbrush icon (icon must exist in the
app-sidebar `ICONS` map AND the ⌘K `HIT_ICONS` map). Routing is path-based:
`/brands` (list), `/brands/$brandId` (detail, `?tab=` for tabs), and
`/brands/$brandId/docs/$kind/$name` (dedicated full-width doc editor;
`?create=1` = new-doc mode, first save creates the file) — host route files +
router.ts entries + `page:/…` slots, assets-plugin pattern. NO `?brand=` query
selection anywhere.

- **List**: PluginHeader search + ONE "New Brand" action → three-path chooser
  (`new-brand-flows.tsx`): Build my brand (wizard drawer), From a website
  (URL-mode builder dialog), Import (preview→confirm dialog). Empty state IS
  the chooser. Cover-art cards (`brand-card.tsx`): tinted logo cover
  (monogram fallback), palette base edge, completeness bar + missing-items
  tooltip. Drafts sort first.
- **Save model**: ONE staged manifest draft spans the detail tabs
  (identity/assets/cardDocs toggle); the SDK `SaveBar` commits a single
  full-manifest PUT. Docs save in their own editor route. Blur-to-save is
  dead. Pristine added rows are dropped on save; invalid rows hold it with a
  teaching error. Guard rails (2026-07 review): the detail component is
  KEYED by brandId (same-route param navigation must not carry brand A's
  draft to brand B), a pre-PUT freshness gate blocks the snapshot save when
  the server manifest changed underneath (the drafting agent writes while
  the user reviews — save again = deliberate overwrite), mid-flight edits
  survive the post-save clear (snapshot-compare, never a blind
  setStaged(null)), and BOTH dirty surfaces wire the SDK
  `useUnsavedChangesGuard` (in-app route changes prompt; beforeunload alone
  is not a guard). The doc editor fetches FIRST even in `?create=1` mode —
  a colliding/reloaded create URL loads the existing doc instead of seeding
  a blank template over real content; non-404 load failures render a
  retryable error, never "doesn't exist".
- **Completeness** (`lib/completeness.ts`): pure checklist (8 keys, pinned by
  `tests/plugins/brands/completeness.test.ts`; labels mirrored in
  `brand-card.tsx` `COMPLETENESS_LABELS`) — summary on `GET /` per brand,
  full checklist on `GET /:brandId` → the Overview "Finish your kit" card.
- **Drafting banner**: create flows pass the builder `taskId` via
  `?draftTask=` so a fresh draft links its drafting task; blocked-task count
  from `GET /blocked-tasks`. Publish sits behind a light confirm + toast.
- **Settings**: Status → Imported from → What agents see (footprint +
  integrity) → SDK `DangerZone` (typed brand-id confirm) at the bottom.
- **Doc editor**: full-width; breadcrumb + Edit|Preview toggle + Brainstorm
  button in ONE header row. **Brainstorm** = embedded conversation-kit panel
  (`brand-doc-brainstorm.tsx`) on the shared conversation turn engine
  (#703, `lib/brainstorm-bridge.ts`): turns run server-side (202/409 +
  abort route), stream as `brands.brainstorm.*` bus events, and persist to
  a per-doc transcript sidecar (`brands/<id>/brainstorms/<kind>/<name>.json`,
  deleted with the doc) — navigation never kills a turn; reopening
  rehydrates (GET returns `messages` + seeded `streaming`). Per-turn
  ephemeral runtime threads + capped doc/history prompt policy preserved
  (history now built server-side from the transcript); turns meter under
  work class `chat`. Publish button exists ONLY in the draft
  banner + Settings (never the hero). Status chips are the SDK `StatusBadge`
  (Draft=warning, Published=success). Doc rows are distinct tiles; section
  empty states use the centered `SectionEmpty`. Asset tiles' viewer link
  returns via the SDK `useHistoryBack` pattern.
- **Assets tab**: every add goes through the SDK `AssetPicker`; logo variant
  is a labeled select; ref changes stage into the SaveBar draft (asset-note
  edits PATCH the assets plugin immediately — different domain).

- **Lifecycle**: publish AND **unpublish** (`POST /:brandId/unpublish` — back
  to draft, audited `brand.unpublished`, linked tasks defer honestly; Settings
  Status card, behind a consequences confirm). **Per-lesson off switch**:
  manifest `disabledLessons[]` — benched lessons stay on disk but are filtered
  out of retrieval at the CALL SITE (`filterDisabledLessons`, applied after
  the (brandId, query) cache so toggles bite immediately); Lessons rows get an
  Active switch (staged into the SaveBar draft) and render dimmed when off.
  **Asset refs render as thumbnail CARDS** (grid, image-first) — never
  horizontal rows.

## Builder modes

`POST /builder` accepts questionnaire mode (product required) OR **website
mode** (`urls` required, product optional — zod refine enforces one of them).
With urls present the drafting-task prompt gains an explicit source-mining
step (fetch each URL, extract palette hex/voice/terminology/logo candidates,
record findings in `_intake.md`). Response carries `taskId` (pinned by test —
the drafting banner links it), and the manifest is stamped with
**`draftTaskId`** (cleared on publish) so the banner survives reloads.

**Intake materials**: the wizard accepts up to 3 brand-material files
(PDF/screenshots — `materialAssetIds` ≤3 on the route). They attach to the
draft as the `intake-materials` asset group and the prompt gains a mining
step (palette hex, typography, imagery style). **Live status**: the banner
fetches `/api/plugins/tasks/:draftTaskId` and re-renders on every `taskboard`
SSE tick (Queued / Agent working / Draft ready / Blocked); the whole detail
page refreshes on `brand.changed` so tabs fill in live as the agent writes.

## Model

A brand is a directory under `~/.bakin/brands/<id>/` (id = kebab slug = the
identity; rename = create new + relink):

```
brands/<id>/
  brand.json        — zod manifest (machines): palette, rules[], terminology,
                      logos[{assetId,variant}], assetGroups[{name,description,assetIds}],
                      defaultImageReferences (≤4), cardDocs, draft?, source? (import provenance)
  guidelines/*.md   — freeform (agents): voice.md + style-guide.md scaffolded on create
  lessons/*.md      — brand lessons (retrieval-injected per task)
```

Store engine: `plugins/brands/lib/store.ts` — atomic manifest writes, per-brand
async lock, honest corrupt-brand reads (`invalid`, never skipped). Fingerprint
(`lib/fingerprint.ts`): sha256 over brand.json + all docs — recorded on
generations + injection records (the V2 staleness hook). Structure exists ONLY
for what machines read; agents read markdown.

## Resolution & injection (the spine)

Effective brand (LAZY, per dispatch — `src/core/dispatch-context-blocks.ts`):
`task.brandId` → cycle-safe `parentId` ancestry walk (decomposition/corrective
subtasks inherit) → `projects.getBrand` hook (own or inherited projectId).
Drafts resolve as not-found. `resolveEffectiveBrand` also reports the source
(`own|parent|project`) for the task Brand panel.

Dispatch injects a **two-tier brand card** (`plugins/brands/lib/card.ts`, via
the `brands.getContext` hook — core uses structural-mirror types, no plugin
import):
1. Always inline: compliance header + anti-bleed line ("use ONLY this brand's
   materials"), rules, palette, terminology, doc/asset listings with
   descriptions + "pass brandId to image tools".
2. Budgeted whole-unit: `cardDocs` (default voice.md), then top-3 retrieved
   lessons. Anything dropped leaves a visible marker naming the fetch tool.

Budget: `dispatch.maxBrandContextBytes` (default 12288, floor 1024, clamp
`resolveBrandContextBudget`), registered in `configuredDynamicCaps()` so the
context report + `context.startup-size` doctor check measure it. Prompt
placement: `brand` section between `project` and `lessons` in BOTH builders;
full card for subagent/main dispatches, one-liner in triage. Byte fixtures:
`tests/fixtures/dispatch-prompts/{specialist,triage,workflow}-branded.txt` —
unbranded fixtures stayed byte-identical by construction.

## Failure semantics (never a silent tripwire)

- **Missing/draft brand → budget-defer pattern** (`deferForMissingBrand`, wired
  pre-claim in dispatch-cycle + dispatch-single): task stays in todo, no run
  claimed, resumes the cycle the brand returns. Notify-once per (task, brand)
  incident (in-memory; cleared on recovery so a repeat deletion re-notifies):
  audit `brand.dispatch_blocked` + plugin-event → browser notification landing
  on `/tasks?brand=<id>` + derived board badge (`GET /blocked-tasks` through
  the use-budget-status plumbing pattern — never task metadata). The race
  backstop post-gate is a typed `BrandUnavailableError` in prepare (claim
  released).
- **Search down → visible degrade**: card carries "brand lessons unavailable";
  `brand.lessons_unavailable` audited once per brand per 10min.
- **Dangling assetIds → card markers + `brand.asset_missing` audit**; the
  shared scan (`lib/integrity.ts`) backs BOTH `GET /:brandId/integrity` and the
  `brands.integrity` doctor check (dangling refs, ghost/draft-linked todo
  tasks, invalid manifests, stale drafts).

## Observability (spec §5.5)

Every branded dispatch writes a `brand.injected` audit record post-claim
(`dispatch-prepare.ts`): runId, fingerprint, cardBytes, sections/lessons
included, omissions, warnings. Task detail renders a Brand panel via the
`task-brand` slot (`components/task-brand-panel.tsx`): effective brand +
provenance, injection records (`GET /injections/:taskId` — bounded 7d audit
read), quick-add lesson, and a debug-mode rendered-card viewer
(`GET /:brandId/card-preview` — same pure builder; "what would inject now" vs
the audit's "what injected then"). Brand detail shows the live card size vs
budget.

## Lessons

`brand-lessons` file-backed content type (facet `brand_id`) + `brands` content
type (guidelines + manifest) — both watcher-synced with reindex generators
(`lib/search-sync.ts`). Retrieval (`lib/lesson-retrieval.ts`): top-3 by task
title/description, whole-lesson hydration from disk, cache keyed
`(brandId, query)` — NEVER the agent-lesson cache. Authoring:
`bakin_exec_brands_add_lesson` (append-only, audited — the ONE write agents
may make to a published brand) + "Save as brand lesson" quick-add on the task
Brand panel. Absolute rules belong in manifest `rules` (always inline), never
in lessons — retrieval is probabilistic.

## Images (#418 + #419)

`brandId` on generate/edit: palette + identity merge into the provider prompt,
`defaultImageReferences` fill empty reference slots (agent refs always win),
unknown/draft brands hard-error BEFORE billing, and
`generation.{brandId,brandFingerprint}` is recorded (a changed brand version is
a new generation, never a dedupe hit). Caption join: the `assets.describe` hook
(batch description + enrichment caption per assetId) is joined into
`brands.get`/exec `get` so agents pick the right screenshot.

## Builder flow (draft lifecycle)

"Build my brand" questionnaire → `POST /builder` creates a `draft: true` brand
(+ `guidelines/_intake.md`) and dispatches a NORMAL, deliberately-unbranded
task (a draft would trip the brand gate). The agent authors via draft-gated
`bakin_exec_brands_{write_doc,update_manifest}` (typed PUBLISHED error on live
brands). Operator reviews in the standard detail UI; `POST /:id/publish` flips
it live (audited `brand.draft_published`). Drafts are excluded from
`brands.list`, pickers, resolution, injection, and image tools.

## Portable format / import / export

Repo shape = installed shape with relative file refs instead of assetIds;
`lib/portable.ts` is the ONLY converter. Import validates first (zero writes on
failure, zip-slip guarded), ingests files as managed assets (per-import dedup),
stamps provenance `{repo, ref, commit}`; existing ids need explicit overwrite
(local edits win). GitHub sources ride the plugin installer's shared helpers
(`parseGithubSource` + `materializeCachedGithubSource` — ambient git creds;
`github:user/repo/path` normalizes to `#subpath`). `POST /import/preview`
summarizes with zero writes; `GET /import/check?id=` compares provenance commit
vs upstream. Export round-trips semantically.

## Contract surfaces

- **Hooks:** `brands.get` (manifest + docs + fingerprint + asset captions;
  drafts flagged), `brands.list` (drafts excluded), `brands.getContext` (card +
  injection meta | notFound). Consumed: `projects.getBrand` (external projects
  plugin), `assets.describe`.
- **Exec tools:** `bakin_exec_brands_{list,get,read_doc,add_lesson}` +
  draft-gated `{write_doc,update_manifest}`.
- **REST:** CRUD + docs + `blocked-tasks`, `task-context/:taskId`,
  `injections/:taskId`, `:id/card-preview`, `:id/integrity`, `builder`,
  `:id/publish`, `import{,/preview,/check}`, `:id/export`.
- **CLI:** `bakin brands {list,get,import,check,export,remove}`
  (`src/cli/commands/brands.ts`; check takes an INSTALLED id).
- **Settings:** `dispatch.maxBrandContextBytes` (System & Alerts); plugin
  setting `warnUnbranded` (default off — the flag rides the brands list
  response so the tasks UI needs no cross-plugin settings fetch).

## Tasks integration

`brandId?: string` mirrors projectId across `plugins/tasks/lib/task-schemas.ts`,
`packages/core/src/tasks/store.ts` (+ `TaskListOpts.brandId`),
`src/core/task-store.ts`, `dispatch-types.ts`, SDK + core plugin-type tiers,
and the tasks search content type (`brand_id` facet; schemaVersion 1→2). Board:
picker (published brands only; None = inherit), fuchsia brand chip, Brand facet
with a 'no brand' sentinel (`?brand=` URL state), opt-in warnUnbranded nudge.

## Testing notes

`getBakinPaths` mocks in brand-touching tests must include the `brands` key.
Brand caches key on brandId — cross-brand bleed tests live in
`tests/plugins/brands/lesson-retrieval.test.ts` and
`tests/core/dispatch-brand-block.test.ts`. The dispatch fixture suite gained
branded cases only; required-label lists were deliberately untouched.

## External half (bakin-bits-official)

Projects: `brandId` on `ProjectFrontmatter` + `projects.getBrand` hook +
pickers. Messaging: `Plan.brandId` stamped onto every spawned deliverable task
(top-level field, not `source`). Sequenced after the core PR; validated in the
dockerized rig's isolated mode.

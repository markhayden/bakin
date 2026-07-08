# Spec — Brands: structured brand definitions linkable to tasks, projects, and generation (#419)

**Status:** DRAFT v2 — revised after the ten-story consumer review (§2.1); pending approval, then `.claude/specs/brands-plugin-plan.md` (task breakdown + commit strategy) via /agent-skills:plan.
**Origin:** Issue #419. Today "brand" exists only as a routing keyword (`plugins/images/lib/routing.ts:83-88`), prose in the create-image skill, and a UI placeholder. No machine-readable source of truth for voice, palette, logos, or reference material exists anywhere.
**Related:** `.claude/knowledge/{dispatch,startup-context,assets-versioning,agent-packages,layered-context,messaging-plugin,plugin-system,search-plugin-guide}.md`, issue #418 (reference images — SHIPPED), `bakin-bits-official` (external `projects` + `messaging` plugins).
**Branch:** `feat/419-brands-plugin`, PR to `main`.
**Note:** saved under `.claude/specs/` per house convention (not root `SPEC.md`).

---

## 1. Objective

A single Bakin instance serves **multiple brands**. Any agent-produced output — copy, social posts, images, code, docs — for a branded task must be grounded in that brand's real voice, palette, terminology, and reference assets, **without bleeding brand context across tasks for other brands** and **without silent drift** when brand data is missing or stale.

Concretely:

1. **A brand is a first-class record** — a named bundle of machine-readable identity (palette, rules, terminology, logos, asset groups) + agent-readable guidelines (voice, style markdown) + brand-specific lessons, stored on disk, managed in the UI, importable from GitHub.
2. **Tasks (and projects, messaging plans) link to exactly one brand** via optional `brandId`; tasks inherit lazily at dispatch: own → parent-task chain → project.
3. **Dispatch injects a two-tier brand card**: a compact, byte-budgeted, always-inline card (rules, palette, terminology, voice, asset/doc listing with fetch instructions) + exec tools for depth. Minimum compliance is unavoidable; deep docs are pull-based; absolute rules never depend on retrieval.
4. **Brand lessons ride the proven retrieval plane** — indexed per-brand, top-N relevant to the task pulled at dispatch, budgeted, never blocking — and the correction loop is one click (quick-add lesson from task review).
5. **Image generation is deterministic** — `brandId` on the generate/edit tools resolves palette + reference images structurally; provenance (`brandId` + content fingerprint) is recorded on every brand-conditioned generation.
6. **Failure is honest, split by severity, and reaches the operator** — an unresolvable brand hard-blocks dispatch AND notifies (browser + doctor attention); soft failures (lessons retrieval down, dangling assetIds) degrade with visible markers + audit events + a doctor check.
7. **Injection is observable, not asserted** — every branded dispatch writes an injection record (what was included, what was omitted, at what size), surfaced in the task timeline, with the exact rendered card reproducible on demand.
8. **No cross-task contamination, structurally** — prompt assembly is already pure and per-attempt; every brand-scoped cache is keyed by brand id; the card instructs agents to disregard other-brand knowledge. Brand context NEVER enters persistent agent workspace files (SOUL/managed blocks).
9. **Cold start is guided** — new brands scaffold with authoring-hint templates; a "build my brand" flow (UI questionnaire → drafting agent → reviewable draft) gets a real brand stood up without knowing what a good voice.md looks like.

**Non-goals (V1):** staleness badges / regeneration flows for output made under an edited brand (provenance recorded, invalidation deferred); multiple brands per object; a `kind:"brand"` agent-package kind; brand context in the chat plugin; typography/font management beyond freeform markdown; enforcement of brand coverage (visibility only); per-brand spend analytics.

---

## 2. Decisions log (interview outcomes)

| # | Decision | Choice |
|---|---|---|
| D1 | V1 surfaces | Tasks + dispatch injection, projects inheritance, images integration, **and** GitHub import — all in V1 |
| D2 | Record shape | Hybrid: structured JSON only for what machines read (palette, rules, asset refs); freeform markdown for everything agents read |
| D3 | Cardinality | Exactly one optional `brandId` per object, mirroring `projectId` |
| D4 | Inheritance | Lazy at dispatch: `task.brandId` → parent-task chain → `projects.getBrand` hook; task-level always wins |
| D5 | Injection | Two-tier: budgeted inline brand card + exec tools for depth; visible omission markers |
| D6 | Lessons | Mirror agent-lessons retrieval: `brand-lessons` search content type faceted by `brand_id`, top-N by task query, own cache keyed `(brandId, query)` |
| D7 | Brand assets | Named asset groups (`assetId[]` lists + usage notes) and logo slots in the manifest; assets stay in the existing store, brands only point |
| D8 | Images | Optional `brandId` param on generate/edit; images plugin resolves via `brands.get` hook; unknown brandId = hard error; provenance recorded |
| D9 | GitHub import | Plugin-native (`bakin brands import github:…`), portable manifest with file paths → assetIds on ingest, provenance recorded, re-import updates with confirm. NOT an agent-package kind |
| D10 | Failure mode | Hard-block dispatch on unresolvable brand (+ notify); visible-degrade + audit for lessons/asset failures; doctor integrity check |
| D11 | Cross-repo scope | **One effort across both repos** — bakin-bits-official (projects + messaging) changes are later milestones of this same plan |
| D12 | UI scope | Full manage surface: CRUD, palette editor, asset pickers, markdown editing, import action, integrity warnings; tasks picker/badge/board filter; ⌘K |
| D13 | Unbranded posture | Visibility, no enforcement: 'no brand' board facet; opt-in `warnUnbranded` setting (default off) |
| D14 | Versioning | Record `{brandId, brandFingerprint}` on generation; invalidation deferred to V2 |
| D15 | Identity | Kebab-case slug ids (`acme`), id = directory name; display name separate; rename = create new + relink |

### 2.1 Story-review amendments (v2)

Ten consumer stories (solo founder doing marketing + dev; agency operator) were walked against v1. All amendments below are IN scope for V1:

| Story | Rough edge | Amendment |
|---|---|---|
| S1 | Blank-canvas: empty brand injects a useless card | Scaffolded starter guideline files on create (authoring-hint headings); skeletal-brand completeness hints in UI (§9) |
| S2 | Subtasks from decomposition/corrective re-dispatch lose the brand | Resolution walks the `parentId` ancestry before project (§4) |
| S3 | Absolute rules ("never emojis") can't depend on top-N lesson retrieval | Manifest `rules: string[]`, always-inline tier-1 card content (§3.2, §5.1) |
| S4 | Doc listing is bare filenames; agents fetch blind | Guideline docs carry a one-line frontmatter `description`, shown in the card listing (§3.2, §5.1) |
| S5 | Agent runtime memory can flavor brand B with brand A | Anti-bleed instruction in the card header (§5.1) |
| S6 | Import: no private-repo auth story, no preview, no update probe | Auth via existing `github:` fetch path; UI import preview; `import --check` against provenance commit (§7.4, §9) |
| S7 | Agents pick screenshots blind from asset groups | `brands.get`/exec `get` join asset enrichment captions per group member (§7.2) |
| S8 | No record of what was actually injected → off-brand output is unfalsifiable | `brand.injected` audit record per dispatch + task-timeline surfacing + **rendered-card debug viewer** (§5.5) |
| S9 | No pre-dispatch visibility of card weight vs budget | Live card-size preview on brand detail (§9) |
| S10 | Hard-block on deleted brand silently misses scheduled posting windows | Deletion guard with linked-task count; `brand.dispatch_blocked` **notifies** (browser + doctor attention chip) (§5.3, §9) |
| S1/S3 | Cold start + correction loop friction | **Agent-interview brand builder** (§9.1) and **quick-add lesson from task review** (§6) — accepted as V1 scope adds |

---

## 3. Data model & storage

### 3.1 On-disk layout (installed)

```
~/.bakin/brands/<brandId>/
  brand.json          — zod-validated manifest (sole structured source of truth)
  guidelines/*.md     — freeform agent-readable docs (voice.md conventionally the card doc)
  lessons/*.md        — brand lessons, one per file
```

- New `brands` key in `getBakinPaths()` (`packages/core/src/content-dir.ts`); dir created by `initBakinHome()`. Test mocks of `getBakinPaths` must include it (see §12).
- Storage engine mirrors the workflows/assets per-record-dir idiom: atomic temp+rename manifest writes, serialized per-brand mutation (async mutex), zod `safeParse` on read with honest error surfacing (never silently skip a corrupt brand).
- **Scaffolding (S1):** creating a brand in the UI/REST seeds `guidelines/voice.md` and `guidelines/style-guide.md` from starter templates — headed sections with inline authoring hints ("Describe how the brand talks. Three adjectives. Sentences you would/wouldn't write…"). Import and the builder flow (§9.1) skip scaffolding.

### 3.2 Manifest schema (installed, zod)

```ts
brandManifestSchema = {
  id: string,                 // kebab-case slug, = dir name, [a-z0-9-]+, unique
  name: string,               // display name
  description?: string,
  draft?: boolean,            // builder flow (§9.1): draft brands are excluded from
                              // pickers, resolution, and injection until published
  palette: [{ name, hex, usage? }],
  rules?: string[],           // short absolute imperatives ("Never use emojis"),
                              // ALWAYS inline in the card — never retrieval-dependent (S3)
  terminology?: [{ term, rule }],           // do/don't term pairs, always inline
  logos: [{ assetId, variant }],            // variant: 'dark' | 'light' | free-form
  assetGroups: [{ name, description?, assetIds: string[] }],
  defaultImageReferences?: string[],        // assetIds, ≤4 — auto-attached to brand-conditioned
                                            // generation when the agent passes no references
  cardDocs?: string[],        // guideline filenames inlined into the dispatch card
                              // (default: ['voice.md'] if present)
  source?: { repo, ref, commit, importedAt }, // import provenance
  createdAt, updatedAt
}
```

Everything else (style guide, audience, positioning, boilerplate, examples) is freeform markdown in `guidelines/`. Guideline and lesson files may carry YAML frontmatter with a one-line `description:` — surfaced in the card's doc listing so agents fetch the right doc (S4). Machines never parse the markdown bodies; agents never need the JSON.

### 3.3 Fingerprint

`brandFingerprint = sha256` over the canonical serialization of `brand.json` + sorted `guidelines/*.md` + `lessons/*.md` contents. Computed on demand, exposed via `brands.get`, recorded on image generations (§8) and injection records (§5.5). This is the V2 staleness hook — costs a hash now, loses nothing.

### 3.4 Portable format (import/export)

Same layout, but `brand.json` references **relative file paths** instead of assetIds (a repo cannot contain machine-local ids):

```
repo (or exported dir):
  brand.json            — portableBrandSchema: logos[{file,variant}],
                          assetGroups[{name,description,files[]}],
                          defaultImageReferences: files[]
  guidelines/*.md
  lessons/*.md
  assets/*              — files referenced above
```

Two distinct zod schemas (`portableBrandSchema`, `brandManifestSchema`); the importer is the only code that converts between them.

---

## 4. Linking: brandId on tasks (+ projects, plans)

`brandId?: string` mirrors `projectId` exactly across the three task-schema layers:

1. `plugins/tasks/lib/task-schemas.ts` — `createTaskBody`/`updateTaskBody` gain `brandId: z.string().optional()`.
2. `packages/core/src/tasks/store.ts` — `BakinTask.brandId?`, `CreateBakinTaskInput`, `BakinTaskPatch` allowlist, `TaskListOpts.brandId` filter, `createEmptyBakinTask` copy-through.
3. `src/core/task-store.ts` facade + `DispatchTask` (`dispatch-types.ts`).

Plus: SDK task types (`@makinbakin/sdk`) so external plugins can set it; tasks search content type gains a `brand_id` keyword facet. No FK validation at write time (matches `projectId`); integrity is the doctor's job, honesty is dispatch's job.

**Effective brand resolution (core, dispatch-time):**

```
effectiveBrandId(task):
  task.brandId                                       // explicit override, always wins
  else walk parentId ancestry: nearest ancestor's brandId   // S2: subtasks from
                                                     // decomposition/corrective paths inherit
  else if task.projectId (own or inherited):
    hooks.invoke('projects.getBrand', { projectId }) // registered by external projects plugin
  else: undefined                                    // unbranded — perfectly legal
```

Draft brands (§9.1) resolve as **not found** (hard-block per §5.3) — a draft can never silently brand real work. Graceful when the hook is unregistered (same idiom as `assets.listByTask`). Resolution is lazy — re-branding a project retroactively affects every un-overridden task; ancestry walk is bounded and cycle-safe.

---

## 5. Dispatch injection

### 5.1 The brand card

New labeled section `brand` in `buildDispatchSections` (`src/core/dispatch-prompts.ts`), positioned between `project` and `lessons`, in **both** the regular and workflow builders. Branch scope: **subagent and main-agent dispatches get the full card; triage passes get a one-line brand mention only** ("This task is for brand <id>") — triage decides routing, not content, and stays cheap by design. Built by a new async `buildDispatchBrandBlock({ task })` in `src/core/dispatch-context-blocks.ts` (alongside asset/lesson blocks), wired at `dispatch-prepare.ts` and `dispatch-workflow.ts`. Core invokes a `brands.getContext` hook — no plugin import; structural-mirror types at the call site (the `dispatch-team.ts:44-46` precedent).

Card content, in retention-priority order:

1. **Header + compliance instructions** (always): brand name/id; "All output for this task MUST follow this brand"; **"Use ONLY this brand's materials — disregard knowledge of any other brand"** (S5); pointer to exec tools.
2. **Rules + palette + terminology** (always; small, structured-sourced — absolute rules live here, never in retrieval (S3)).
3. **Asset + doc listing** (always): guideline doc names **with their one-line descriptions** (S4) → `bakin_exec_brands_read_doc`; logos + asset groups with usage notes ("group app-screenshots: real product UI — use for any product visual, pass as referenceImages"); `defaultImageReferences` note; "pass `brandId: <id>` to image tools."
4. **Inline card docs** (`cardDocs`, typically `voice.md`) — budgeted.
5. **Retrieved brand lessons** (§6) — budgeted.

### 5.2 Byte budget

`dispatch.maxBrandContextBytes` (default **12288**, floor 1024, unset/0/invalid → default), clamped like `resolveWorkflowContextBudget`. Whole-unit retention in priority order above — never mid-document truncation; anything dropped leaves a **visible omission marker** ("(style-guide.md omitted for size — fetch via bakin_exec_brands_read_doc)"). Registered in `configuredDynamicCaps()` (`src/core/context-report.ts`) so the context report, `bakin agents context`, and the `context.startup-size` doctor check all measure it against `dispatch.contextBudgetBytes`.

### 5.3 Failure semantics (D10 + S10)

- **Effective brandId resolves to a nonexistent/unreadable/draft brand → hard-block via the budget-defer pattern.** The task stays in `todo` but dispatch skips it **pre-claim** each cycle (planning note: the `blocked`-column precedent never auto-retries — dispatch only scans `todo`; deferring in place is what makes "un-blocks when the brand returns" true, exactly like budget-deferred tasks). First skip per incident fires audit `brand.dispatch_blocked` + notification; the board badge is derived state (like budget-deferred badges), never task metadata. A brand-linked task is **never dispatched brandless**, and it resumes automatically the cycle the brand exists again. **The block notifies**: browser notification + doctor attention chip via the existing notification infrastructure — blocked scheduled marketing must reach the operator, not wait to be found (S10).
- **Lessons retrieval fails (search down) → proceed**, card carries "⚠ brand lessons unavailable" + audit `brand.lessons_unavailable` (mirrors agent-lessons never-block).
- **Dangling assetIds → proceed**, listed as missing in the card + audit; doctor flags (§10).

### 5.4 Bleed prevention

Prompt assembly is pure/per-attempt/per-task (fresh `task:<id>:d<seq>` session) — no bleed by construction. The rules that keep it that way: (a) every brand-scoped cache key includes the brand id (lesson cache: `(brandId, query)`, TTL 5 min, cap 200 — NEVER the agent-lesson cache); (b) brand content never enters persistent workspace files / `bakin:managed` blocks — per-dispatch plane only; (c) the card's anti-bleed instruction covers the one plane Bakin can't scope: agent runtime memory (S5).

### 5.5 Injection observability (S8)

Every branded dispatch writes a **`brand.injected` audit record**: `{ taskId, runId, brandId, brandFingerprint, cardBytes, sectionsIncluded, lessonsIncluded: [names], omitted: [what + why] }`. Surfaced in the task timeline (team plugin timeline interleaves audit already). Companion **rendered-card debug viewer**: in debug mode, task detail can render exactly the card a dispatch would produce right now (`GET /api/plugins/brands/:id/card-preview?taskId=…` — same pure builder, on demand). Together these turn "why was this off-brand?" from an argument into a lookup: what was injected then (audit) vs what would inject now (preview).

---

## 6. Brand lessons

- `brands/<id>/lessons/*.md`, registered as a **`brand-lessons` file-backed search content type** (`ctx.search.registerFileBackedContentType`, glob over the brands dir, facet `brand_id`, `schemaVersion: 1`), mirroring `agent-lessons` (`plugins/team/index.ts:183`).
- At dispatch, when an effective brand exists: query `brand-lessons` faceted to the brand with the task title/description, hydrate top-N, render into the card under its budget share, visible marker when omitted or unavailable.
- Guideline docs are separately indexed for search (§9) but injected by explicit `cardDocs` selection, not retrieval — retrieval is for the long tail of lessons. **Absolute rules live in manifest `rules`, never in lessons** (S3) — the UI lesson editor nudges: "Is this an always-rule? Put it in Rules instead."
- `bakin_exec_brands_add_lesson` (append-only, audited) lets agents bank brand learnings — same loop that makes agent lessons compound.
- **Quick-add from task review (scope add):** task detail for branded tasks offers "Save as brand lesson" — pre-fills a lesson (title + body from the correction being made) against the task's effective brand, POSTs to the lessons endpoint, audited. Closes the correction loop in one click instead of a trip to the Brands page.

---

## 7. Contract surfaces

### 7.1 Hooks (registered by brands plugin in `activate`)

| Hook | Shape | Consumer |
|---|---|---|
| `brands.get` | `{ brandId }` → manifest summary + doc list (with descriptions) + fingerprint, or undefined | images plugin, any plugin |
| `brands.list` | `{}` → summaries `[{id, name, description}]` (drafts excluded) | pickers in external plugins |
| `brands.getContext` | `{ brandId, taskQuery, maxBytes }` → `{ card, meta (injection-record fields), warnings[] }` or not-found sentinel | core dispatch |

Consumed by core/brands: `projects.getBrand` `{ projectId }` → `brandId?` (registered by external projects plugin, waterfall kind). All cross-plugin traffic is hooks-only — no direct imports (architecture-test enforced already).

### 7.2 Exec tools (`bakin_exec_brands_*`)

- `list` — id, name, description for all published brands.
- `get` — full manifest view: palette, rules, terminology, logos, groups **with per-member enrichment captions joined from the asset store** (S7 — agents pick the right screenshot, not a blind assetId), guideline doc names + descriptions, lesson names, fingerprint.
- `read_doc` — `{ brandId, doc }` → guideline/lesson markdown body.
- `add_lesson` — `{ brandId, title, body }` → writes `lessons/<slug>.md`, audited. **The only write tool that works on published brands.**
- `write_doc` / `update_manifest` — **draft-gated** (§9.1): usable only while `draft: true`, for the builder agent to author the brand. Typed error on published brands — agents never mutate live brand identity.

### 7.3 REST (plugin routes, `/api/plugins/brands/*`)

CRUD on brands (create scaffolds per §3.1); guideline/lesson doc CRUD; palette/rules/groups/logos edit (manifest PUT); `POST /import/preview` (validate + summarize: name, palette, doc/lesson/asset counts — nothing written) and `POST /import` (`{ source: 'github:user/repo[/path]' | localPath }`); `GET /import/check?id=…` (compare provenance commit vs upstream, S6); `GET /:id/export`; `GET /:id/integrity` (dangling-ref report); `GET /:id/card-preview[?taskId=…]` (§5.5, also drives the brand-detail size preview §9); `POST /:id/publish` (draft → live, §9.1); builder-flow endpoints (§9.1). Mutations broadcast `brand.changed` plugin-events (SSE) and `appendAudit` structured events. GitHub fetch (incl. private-repo auth) reuses the established `github:` source fetch path from the plugin installer — no new auth machinery.

### 7.4 CLI (`src/cli/commands/brands.ts`, HTTP client like the rest)

`bakin brands {list, get <id>, import <source>, check <id>, export <id> [dir], remove <id>}`. Import/remove prompt for consent (house style); `--yes` for non-interactive; `check <id>` reports upstream drift for an **installed** brand using its provenance, without writing (drift-check operates on a brand id, not a source); `remove` shows the linked-task count guard (§9) before confirming.

---

## 8. Images integration

- `generateShape`/`editShape` (`plugins/images/index.ts`) gain optional `brandId`.
- On presence: resolve via `ctx.hooks.invoke('brands.get')` — **unknown/draft brandId is a typed hard error** (never silently generate off-brand). Palette + visual-style notes merge into the prompt packet; if the agent passed no `referenceImages`, the brand's `defaultImageReferences` fill the slots (agent-passed references always win; max-4 respected).
- Idempotency key incorporates `brandId` + `brandFingerprint` (a changed brand is a different generation, not a duplicate).
- `version.generation` records `{ brandId, brandFingerprint }` (D14) — `assets-versioning.md` contract update.
- The `objectiveBias` "brand" string-sniff in `routing.ts` stays as-is (it's provider routing, orthogonal); the create-image SKILL.md gains a line instructing agents to pass `brandId` for branded tasks.

---

## 9. UI & search

**Brands page** (nav item; core-plugin host route: `packages/host/src/routes/brands.tsx` + `router.ts` entry — required or the slot 404s):

- List: brand cards with palette swatch strip, counts (docs/lessons/assets), draft badges, integrity warnings; create + import + **"Build my brand"** (§9.1) actions.
- Detail: name/description; palette editor (name/hex/usage rows); **rules + terminology editors**; logo + asset-group pickers browsing the existing asset store (group members show enrichment captions); guideline + lesson markdown editing (SDK `MarkdownEditor`; lesson editor carries the "always-rule?" nudge, §6; lessons listed newest-first so agent-added drift stays visible); `cardDocs` selection; provenance panel for imported brands (with upstream-drift check action); dangling-ref warnings inline; **completeness hints** for skeletal brands ("no voice doc yet — agents get only palette and rules", S1); **live card-size preview** ("adds ~9.4KB to every branded dispatch; nothing currently omitted" — driven by `GET /:id/card-preview`, S9).
- **Import flow:** source input → **preview step** (validated summary: name, palette swatch, doc/lesson/asset counts) → confirm → install (S6).
- **Deletion guard:** removing a brand queries linked tasks (`TaskListOpts.brandId`) and warns with the count ("7 pending tasks link to acme — they will hard-block until relinked") before confirming (S10).

**Tasks integration:** brand picker (from `brands.list` via REST) on task create/edit; brand badge on board cards; board `FacetFilter` by brand **including an explicit 'no brand' facet** (URL-state backed via `useQueryArrayState`); opt-in `warnUnbranded` plugin setting (default off) badges unbranded cards; task detail shows the effective brand (with "inherited from parent/project" provenance), the `brand.injected` timeline entries, the debug-mode card viewer (§5.5), and the "Save as brand lesson" action (§6).

**Search:** `brands` content type (manifest + guideline docs searchable, facet `brand_id`) + `brand-lessons` (§6); `registerPlugin({ search: { hitRenderers } })` for ⌘K hits navigating to the brand page. Engine-down follows house rules (503, honest UI states).

### 9.1 Brand builder flow (scope add)

The cold-start killer (S1): **"Build my brand"** on the Brands page.

1. **Questionnaire (UI, deterministic):** a form collects the raw material — brand name, what you sell, audience, three tone words, competitors, website URL(s), pasted existing docs/notes. No agent involved in asking.
2. **Draft creation:** submits to `POST /builder` → creates the brand with `draft: true` (excluded from pickers/resolution/injection, §4) and stores the questionnaire answers as `guidelines/_intake.md`.
3. **Drafting task:** dispatches a normal Bakin task to a chosen agent: "Author brand <id> from the intake" — the agent reads the intake + any URLs, then writes `voice.md`/`style-guide.md`/palette/rules/terminology via the **draft-gated** `write_doc`/`update_manifest` exec tools (§7.2). Standard dispatch, standard observability — nothing bespoke.
4. **Review + publish:** the draft renders in the normal brand detail UI with a draft banner; the operator edits freely, then `POST /:id/publish` flips `draft` off (audited `brand.draft_published`). Until then the brand cannot touch real work.

Bounded by construction: one flag, two draft-gated tools, one endpoint, one form — the agent leg is a plain task.

---

## 10. Doctor, audit, settings

- **Doctor:** `brands.integrity` check (warn-level, registered via `ctx.registerHealthCheck`): dangling assetIds in logos/groups/defaultImageReferences; tasks whose `brandId` names no existing (published) brand; unreadable/invalid manifests; stale drafts (created >7d ago, never published — info-level). Findings attach structured `data` — UIs never parse message text. Blocked-branded-tasks surface as a doctor attention chip (§5.3).
- **Audit events:** `brand.created|updated|deleted|imported|exported`, `brand.injected` (§5.5), `brand.dispatch_blocked`, `brand.lessons_unavailable`, `brand.asset_missing`, `brand.lesson_added`, `brand.draft_published`.
- **Settings:** core `settings.json` gains `dispatch.maxBrandContextBytes`; brands plugin `settingsSchema` gains `warnUnbranded` (boolean, default false). Watchdog/dispatch re-read per cycle as usual — no restart.

---

## 11. Cross-repo milestones (bakin-bits-official) — D11

Sequenced **after** the core contract ships (SDK types published/linked first). Both plugins already consume everything via `PluginContext`/hooks, so no new coupling.

**Projects plugin:**
- `brandId?` on `ProjectFrontmatter` (`types.ts`), threaded through `parseProject`/`serializeProject` (`lib/parser.ts`), `createProject`/`updateProject` (`lib/project-service.ts`), REST/exec surfaces (`index.ts`).
- Register `projects.getBrand` (waterfall) in `activate` next to the existing `tasks.*` registrations (`index.ts:212-243`) — reads `readProject(projectId)?.brandId`.
- Brand picker in `project-detail.tsx` metadata + `new-project-dialog.tsx` (fed by `brands.list` via `ctx.hooks` / REST).

**Messaging plugin:**
- `brandId?` on `Plan`/`PlanSchema` (`types.ts`), `CreatePlanInput` (`lib/content-storage.ts`), `/plans` POST/PUT routes.
- Plan activation stamps `brandId` onto each `ctx.tasks.create` (`lib/plan-activation.ts:172-189`) and the repair path (`lib/deliverable-lifecycle.ts:130-146`) — top-level field, not `source`. (Stamping here is correct, not inheritance-duplication: a plan is the brand decision point; its spawned tasks may outlive plan edits deliberately. Tasks whose plan sets no brand still inherit via project if linked.)
- Brand picker in `plan-workspace.tsx` header alongside plan-level fields.
- Test-helpers mock task store: `brandId` on create/list filter (`plugins/test-helpers.ts`).

---

## 12. Testing strategy

House rules apply in full (mock BOTH content-dir paths + OpenClaw home; `getBakinPaths` mocks must include the new `brands` key AND `db`; logger/watcher/AppServices mocked; temp dirs + `afterAll` cleanup; `tests/plugins/test-helpers.ts` for plugin tests; `--isolate` for single files).

- **Unit:** manifest/portable zod schemas (valid/invalid/corrupt, rules/draft fields); slug validation + uniqueness; fingerprint stability (same content → same hash, any file edit → new hash); effective-brand resolution chain (explicit / parent-ancestry incl. cycle safety / project-hook / none / hook-absent / draft-blocks); card builder — section priority, rules always survive, byte-budget retention, whole-unit drops, omission markers, doc descriptions rendered, anti-bleed line present, empty/skeletal-brand degenerate cases; injection-record meta correctness; import path→assetId rewriting; export round-trip (import(export(brand)) ≡ brand); import preview writes nothing.
- **Plugin (routes/tools):** CRUD incl. scaffolding on create; doc CRUD; import preview/import/check (local-path source; GitHub fetch behind a mocked fetcher); integrity report; card-preview endpoint; publish flips draft + audit; exec tools — `add_lesson` append + audit, `write_doc`/`update_manifest` succeed on drafts and typed-error on published brands; deletion guard count.
- **Dispatch integration:** brand section present between `project` and `lessons` in both builders; hard-block on missing AND draft brand (typed, audited, task surfaced, notification emitted); lessons-down visible degrade; `brand.injected` audit written with correct fields; byte fixtures — the dispatch-prompt fixture suite (`tests/fixtures/dispatch-prompts/`) gains branded variants and the static-boilerplate budget test stays green.
- **Images:** brandId resolution, prompt-packet merge, reference fill vs agent-priority, unknown/draft-brand typed error, idempotency key sensitivity to fingerprint, generation provenance recorded.
- **Tasks:** brandId through all three schema layers, list filter, search facet, effective-brand + provenance on detail. (Risk noted: adding a field/import near task-service historically breaks partial task-store mocks across `tests/` — plan a sweep, not one-by-one fixes.)
- **Architecture tests:** no cross-plugin imports; dispatch classifies by `kind` not message text — brand block failures included.
- **External repo:** each plugin's `bun:test` suite + `package-contract.test.ts`; `createTestContext` hook overrides (`has`/`invoke` default false/undefined — must be overridden in brand tests).
- **End-to-end:** /verify skill — isolated boot, create brand via REST (scaffold present), link to task, assert dispatch prompt contains the card (mock runtime), image generate with brandId, builder flow draft→publish, card-preview parity with injected card.

---

## 13. Documentation deliverables

- **New:** `.claude/knowledge/brands-plugin.md` (deep reference: model, resolution chain, card tiers, budgets, injection records, failure modes, draft/builder lifecycle, import format).
- **Updated:** `CLAUDE.md` (13 core plugins; Key Patterns entry for Brands; `~/.bakin/brands/` in the runtime dir map; testing note for the new `getBakinPaths` key), `.claude/knowledge/{dispatch,startup-context}.md` (new section + budget), `assets-versioning.md` (generation `brandId`/`brandFingerprint`), `repo-architecture.md`, `messaging-plugin.md` (+ projects knowledge if present) for the external milestones, `doctor-and-health-checks.md` (new check), `search-plugin-guide.md` only if the brands registration surfaces anything novel.
- **Docs site:** `docs/src/content/docs/` user-facing page (creating brands, the builder flow, linking + inheritance, reading injection records, import format spec for repo authors — the portable manifest is a public contract).
- **README.md:** touched only if it enumerates plugins/features (verify at build time).

---

## 14. Code style & conventions (binding for this work)

Repo conventions apply unchanged: TS strict, zod at all boundaries, functional preference, `createLogger('brands')`, no empty catches, kebab-case files, import order, conventional commits (`feat(brands): …`, `feat(tasks): brandId`, etc.). **No backwards-compatibility shims anywhere** — this machine is the only user; schema changes land clean (no legacy fallbacks, no dual-read paths). Priority is reducing tech debt: reuse the existing idioms named in this spec (per-record-dir store, hook mirror types, budget clamps, file-backed search registration) rather than inventing parallel ones.

## 15. Boundaries

**Always:** graceful no-op when optional hooks are absent; visible markers for anything omitted/degraded; audit every failure and mutation; key brand caches by brand id; keep brand context out of persistent workspace files; write the injection record on every branded dispatch.
**Ask first:** any deviation from the decisions log (§2/§2.1); deleting user brand data outside the guarded `remove` flow; widening scope into staleness UI, chat injection, or package kinds.
**Never:** dispatch a brand-linked task brandless; let agents mutate published brand identity (draft-gated writes + add_lesson only); fabricate brand content when data is missing; parse hook/error message text for control flow; direct imports between plugins; parallel spend/stat/search machinery.

## 16. Acceptance criteria

1. Create brand `acme` in the UI → scaffolded voice/style-guide templates present; add palette, rules, logo, `app-screenshots` group, two lessons → files under `~/.bakin/brands/acme/` match §3; detail page shows completeness state + card-size preview.
2. Task with `brandId: acme` dispatches with a `brand` section (header incl. anti-bleed line, rules, palette, terminology, doc listing with descriptions, voice.md) within `maxBrandContextBytes`, measured by `bakin agents context`; a `brand.injected` audit record lands and appears in the task timeline; debug card viewer reproduces the card.
3. Inheritance: subtask of a branded parent gets the parent's brand; task with only `projectId` whose project carries `acme` gets the card; `task.brandId: other` overrides both.
4. Deleting `acme` warns with the linked-task count; proceeding causes pending linked tasks to defer in todo with a derived brand-blocked badge + reason, audit + browser notification + doctor attention chip; restoring the brand resumes them automatically on the next cycle.
5. Search engine stopped → branded dispatch proceeds; card shows the lessons-unavailable marker; audit event present.
6. `bakin_exec_images_generate({ brandId: 'acme' })` → prompt packet carries palette/style, defaultImageReferences attached, `generation.{brandId,brandFingerprint}` recorded; unknown or draft brandId → typed error.
7. `bakin brands import github:user/acme-brand` → preview shows name/palette/counts without writing; confirm installs, repo assets ingested as managed assets, ids rewired, provenance recorded; `import --check` detects upstream drift; `export` round-trips.
8. Builder flow: questionnaire → draft brand (invisible to pickers/dispatch) → drafting task authors docs via draft-gated tools → publish makes it live; draft-gated tools typed-error on published brands.
9. Board filters by brand incl. 'no brand'; deep-linkable URL state; ⌘K finds brands and brand lessons; "Save as brand lesson" from a branded task's detail writes the lesson + audit.
10. Doctor `brands.integrity` warns on a manually broken assetId ref, a task pointing at a ghost brand, and flags a stale draft.
11. Messaging plan with brand `acme` activates → every spawned deliverable task carries `brandId: acme` (external milestone).
12. Full suite green: `bun run test`, architecture tests, dispatch-prompt byte fixtures, external repo suites.

## 17. Commands

Existing: `bun run test` / `test:watch`, `bun test <file> --isolate`, `bun run dev` / `dev:mock`, `bun run build`, /verify skill for isolated E2E.
New: `bakin brands {list,get,import,check,export,remove}`; settings `dispatch.maxBrandContextBytes`; plugin setting `warnUnbranded`.

## 18. Deferred (V2 candidates)

Staleness detection/badges from fingerprints; multi-brand objects; brand-aware chat; `kind:"brand"` package distribution if sharing outgrows plugin-native import; typography/font asset slots; brand analytics (coverage %, per-brand spend via existing ledger dimensions); website-crawl enrichment for the builder flow beyond simple URL reads.

# Explore Plugin — Discovery Storefront & Unified Curated Catalog

Status: Shipped (issue #163 pivot — spec in the PR branch's `SPEC.md`; the
management scope of #163 — update/remove/drift/`.userEdited` UI — was
deliberately deferred and stays in Team/Health/CLI).

Explore (`plugins/explore/`) is the "do more with Bakin" surface: browse
everything formally supported (curated agents, addon plugins, packs) by
category with use cases, one-click install through the existing host REST
endpoints, and installed / built-in / update-available badges. It is a
**discovery + relay** surface, not a management surface: it never updates,
removes, syncs, or repairs anything.

## IA / Nav

- Route `/explore`; single page with a placeholder hero banner (swap for
  generated art in `explore-page.tsx`), tabs (Agents | Plugins |
  Capabilities | Lessons | Packs), and a per-tab intro (`TAB_INTROS`)
  that explains what the items are for first-time users.
  **The ecosystem lane (#687, `hub-skills-section.tsx`) lives INSIDE the
  Capabilities tab — deliberately NOT a separate tab, and the grouping is
  installed-vs-available, NEVER by source** (live-test rule): an
  "Installed" list holds curated packs AND hub installs together (source
  is a chip — official/clawhub/github/local; removal via ConfirmDialog),
  then a "Get more capabilities" header covering both acquisition paths —
  the paste-a-link CTA (clawhub.ai/github.com URLs → trust preview in a
  **BakinDrawer**: verdict, hub stats, translated requirements, security
  warnings, file list → consent → install via `/api/skills/*` only) and
  the curated catalog grid, which on THIS tab filters to
  not-yet-installed entries (installed ones live in the list above; the
  all-installed empty state points at the paste box). See
  `.claude/knowledge/skill-hub-interop.md`.
  Lessons (lesson-packs) is ALWAYS visible with
  an educational empty state; Packs (skill/workflow packs) auto-hides
  while the catalog has none.
- **Core plugin pages need an explicit host route file** —
  `packages/host/src/routes/explore.tsx` renders `<Slot name="page:/explore">`
  and is registered in `packages/host/src/router.ts`. The plugin catch-all
  route only serves paths claimed via `registerPlugin({ routes })` /
  manifest `contributes.routes`; a `page:/…` slot alone renders
  "Page not found." (Every core plugin page works this way — see
  `routes/models.tsx` etc.)
- Discovery is promoted by the shell-owned **"Make Bakin Yours"** card in
  `packages/host/src/components/layout/sidebar-promo.tsx`, with the line
  "Do more with Bakin—discover agent kits, plugins & more." The card links
  to `/explore`; the Explore plugin contributes the page content, not a nav
  item. This keeps product discovery visually distinct without giving
  plugins access to the utility region.
- Tab, category filter, and selected item all live in URL params
  (`?tab=`, `?category=`, `?item=<kind>:<id>`); detail view is a
  right-side `BakinDrawer`.

## Unified curated catalog (v2)

ONE catalog file replaces the old `curated-agents.json` / `curated-plugins.json`
pair (both deleted, along with the `GET /api/curated` host route):

- Shipped file: `packages/host/src/data/curated-catalog.json` — embedded in
  the binary via the data-dir walk in `scripts/generate-embedded-assets.ts`
  (URL key `/data/curated-catalog.json`).
- Schema: `src/core/curated-catalog/schema.ts` — `CatalogFileSchema`
  (`version: 2`, `entries[]`). Entry fields: `id`, `kind`
  (`agent | plugin | skill-pack | workflow-pack | lesson-pack`), `name`,
  `emoji?`, `description`, `category`, `tags`, `useCases`, `source?`, `ref`,
  `trust`, `builtin` (default false), `dependencies`, `defaultSelected`.
  Refinement: non-builtin entries MUST have a `source`. `screenshots[]`
  holds gallery image URLs (authored in the bits-repo catalog); the detail
  drawer renders placeholder frames until an entry ships real assets.
- Loader: `src/core/curated-catalog/load.ts` — EMBEDDED-FIRST (fresh disk
  read: dev edits show without a restart, matching the old /api/curated
  request-time read; binary reads the compiler-embedded copy), static import
  fallback (unit tests). Every degradation LOGS LOUDLY (no silent empty
  storefront); the static path never throws so a bad catalog edit can't
  crash server startup or the CLI via the module-load RECOMMENDED_* consts.
  `loadCatalogFile(staticJson)` is the injectable core; `loadUnifiedCatalog()`
  is the app entry. `trust` is schema-REQUIRED (no default) — recommendation
  eligibility must never hinge on an implicit default.
- Consumers: onboarding recommendations (`src/core/onboarding/recommended-agents.ts`
  filters `kind==='agent' && !builtin && trust==='official'`;
  `recommended-plugins.ts` same for `plugin`) and the explore plugin.
- `builtin: true` entries are store listings for the core plugins themselves
  (product-tour value); they have no `source` and are never installable.
  Their displayed version comes from the live plugin registry
  (`builtinVersions` in the install-state join). Installed agents render
  their real headshot via `AgentAvatar` (`EntryVisual` in catalog-card);
  uninstalled entries keep the catalog emoji.
- Gate test: `tests/core/curated-catalog.test.ts` validates the shipped file —
  catalog edits fail CI if malformed.

## Server routes (plugin-registered, served at `/api/plugins/explore/*`)

- `GET /catalog` — merged catalog joined with install state. **Offline by
  design**: no network I/O, no runtime adapter calls; lockfiles are the
  ground truth (`~/.bakin/packages/lock.json` for agents + packs,
  `~/.bakin/plugins/lock.json` for plugins, `builtin` short-circuits to
  installed). Merge rule (embedded ⊕ cached remote): keyed `(kind, id)`,
  remote wins EXCEPT builtin listings, which are embedded-only — a remote
  catalog can never override or create builtin entries, and can never claim
  a CORE_PLUGIN_IDS plugin id at all (even one the embedded catalog forgot
  to list). The embedded catalog MUST list every core plugin as builtin —
  set-equality gate in tests/core/curated-catalog.test.ts.
- `GET /catalog?check=1` — explicit update probes, all ASYNC + parallel
  (`checkPackageUpdateAsync` — the sync checker's execFileSync git fetch
  would freeze the event loop on the request path): `runChecks()`
  (`src/core/plugins/upgrade-check.ts`) persists plugin lockfile markers
  (lockfile re-read afterwards); agent probe results fold into the response
  ONLY. **Agent update state is never persisted anywhere upstream** — the
  default response reports `updateAvailable: null` (unknown) for agents.
  **Failed probes stay unknown, never "up to date"** — the checker reports
  errors in-band (`status.error`, it does not throw), and the response
  carries `probeErrors` so the client toast can say "couldn't check N"
  instead of lying with "everything is up to date".
- `POST /catalog/refresh` — user-triggered fetch of
  `https://raw.githubusercontent.com/markhayden/bakin-bits-official/main/catalog.json`
  (injectable fetcher for tests), zod-validated, atomically cached at
  `~/.bakin/plugin-data/explore/catalog.json`. 404 → honest
  "no remote catalog yet" (the bits repo may not have one); network/schema
  failures leave the existing cache untouched. NEVER fetched automatically
  (page load does zero network).

`computeUpgradeAvailable(entry)` was extracted from the plugins manifest
handler into `packages/core/src/plugins/lockfile.ts` so the manifest route
and explore's join share one implementation.

## Install flows (client)

`plugins/explore/components/install-dialog.tsx` routes by kind — **zero new
mutation endpoints**:

- Catalog `ref` pins are honored exactly like onboarding: agent/pack specs
  embed `@ref` into the source via `sourceWithRef` (`src/lib/package-source.ts`,
  shared with onboarding), plugin installs send `ref` in the body — on BOTH
  the consent preflight and the commit (the token is bound to source+ref).
- agent → `POST /api/agent-packages/install` (`installAs`, `adopt`, `replace`)
- plugin → `POST /api/plugins/install` two-phase consent:
  preflight `accepted:false` → `{awaitingConsent, permissions, consentToken}`
  → consent dialog → re-POST `accepted:true + consentToken`. The
  `manifestChanged: true` bounce (manifest drifted between preflight and
  commit) re-prompts with the FRESH token + updated permission list and a
  visible notice — the old token is never reused.
- pack → `POST /api/packages/install`
- "Install from source…" custom mode: source + kind + installAs/adopt/replace;
  source-type inference matches the CLI heuristic (`inferSourceType`).

Server-owned validation/consent is never re-implemented client-side; the
dialogs render server responses (including errors) honestly.

## Tests

`tests/plugins/explore/` — route tests via `tests/plugins/test-helpers.ts`
(real temp lockfiles), pure join tests, jsdom component tests (page, card,
install/consent dialogs incl. the manifestChanged bounce), refresh failure
modes with an injected fetcher (never real network). All follow the
mandatory isolation-mock rules.

## Boundaries (don't regress these)

- No update/remove/sync/repair UI in Explore — deep-link to Team/Health.
- No filesystem/provider mutations from UI code.
- No auto-fetch of the remote catalog; refresh is a user action.
- No provider-specific identifiers (adapter-neutral by construction — it
  only reads lockfiles and calls host REST).

## Capabilities shelf (pi-parity P2, 2026-07-13)

Skill-packs with a `capability` slug get their own tab ("teach your agents
new tricks"): runtime-compat badges/gating against the ACTIVE adapter
(catalog response carries `activeAdapter`; universal `['*']` packs
unaffected), and the install dialog runs the guided key step when the
install response reports missing store-backable secrets (masked POST
/api/secrets, skippable — readiness stays honest). Explore remains the ONE
UI install path; the runtime hub's Capabilities tab shows status and links
here.

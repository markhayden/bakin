# SPEC — Explore: the "do more with Bakin" discovery plugin

**Issue:** [#163](https://github.com/markhayden/bakin/issues/163) (scope pivoted — see § Issue Hygiene)
**Branch:** `feat/163-workshop`
**Status:** Draft for approval

---

## 1. Objective

Bakin's extensibility surface (agents, plugins, skill/workflow/lesson packs) is
powerful but terminal-shaped. A business user who is not comfortable with a CLI
— or with tunneling into their claw machine — has no way to discover what
official content exists, understand what it's for, or install it.

**Explore** is a new core plugin: an app-store-style storefront where the user

- **browses** everything formally supported (curated agents, plugins, packs) by
  category, with use cases and visuals;
- **installs** any of it in one click through the existing host REST endpoints
  (consent flows preserved, never bypassed);
- **sees at a glance** what is already installed, built in, or has an update
  available — and deep-links into Team/Health where lifecycle actions happen.

Explore is deliberately **not** a management surface. Update, remove, sync,
drift repair, and `.userEdited` re-claim stay where they live today (Team,
Health, CLI). Explore relays status; other plugins do the heavy lifting.

### Decisions locked during interview

| Decision | Answer |
|---|---|
| V1 content scope | Full store: agents + plugins + packs (packs tab auto-hides when catalog empty) |
| Plugin identity | New core plugin `explore` (11th core plugin) — team plugin untouched except deep-link targets |
| Actions in Explore | Browse + install + relay status. No update/remove/repair UI |
| Name / nav | "Explore", pinned to sidebar bottom above Settings via new generic `placement: 'bottom'` NavItem field |
| Catalog data | Embedded in binary + optional user-triggered remote refresh from `bakin-bits-official`, cached under `~/.bakin/` |
| Core plugins in store | Yes — showcased with "Built in" badge (education value), not installable |
| Adapter neutrality | All agent state via existing adapter-backed REST; zero provider-specific code |

---

## 2. User Stories

**US-1 — Hire an agent without the terminal.**
As a business user, I open Explore, filter agents by the "Marketing" category,
read what Pixel does and the use cases it's good at, and click Install. The
agent appears in my Team page ready to work. I never see a shell prompt.
*Acceptance:* curated agent install from browser → agent visible in Team;
errors from the install endpoint render human-readable in the dialog.

**US-2 — Extend Bakin with an official plugin.**
As a user, I discover the Messaging plugin in Explore, see its description,
category, and what it depends on, and click Install. Because it declares
permissions, I'm shown a consent dialog listing exactly what it can do; after I
accept, it live-activates — new nav item appears without a restart.
*Acceptance:* `awaitingConsent` responses render a consent dialog; re-POST with
`accepted: true` + `consentToken`; declined consent installs nothing.

**US-3 — Understand what Bakin can already do.**
As a new user, I browse Explore and see the ten built-in plugins presented
like store listings — categories, use cases, screenshots-level descriptions —
each badged "Built in". Explore doubles as the product tour.
*Acceptance:* all core plugins render from the catalog with no Install button.

**US-4 — Know when something is stale, fix it where it belongs.**
As a user, I see an "Update available" badge on an installed item in Explore.
Clicking it takes me to the right place (Team agent detail / Health) to act.
Explore never mutates installed content beyond install itself.
*Acceptance:* update-available state read from existing lockfile-backed
endpoints (`/api/plugins/manifest?check=1`, `/api/agent-packages?check=1`);
badge deep-links; a manual "Check for updates" button triggers the probes
(no network on page load).

**US-5 — Grow an agent's knowledge.**
As a user, I browse lesson packs (and skill/workflow packs) in Explore and
install one. Enabling specific lessons for a specific agent stays in Team's
Lessons tab, one deep-link away.
*Acceptance:* pack install via `/api/packages/install`; Packs tab hidden when
the catalog has no pack entries.

**US-6 — Power-user escape hatch.**
As a developer, I use "Install from source…" in Explore to install from
`github:user/repo` or a local path — same dialog capabilities the CLI offers
(`installAs`, adopt, replace-on-collision), same server-owned validation.
*Acceptance:* custom source round-trips through the same install endpoints.

---

## 3. Architecture & Design

### 3.1 New plugin: `plugins/explore/`

```
plugins/explore/
  bakin-plugin.json        # id "explore", nav, apiRoutes, clientRoutes
  index.ts                 # activate(ctx): register catalog routes
  client.tsx               # registerPlugin({ id, navItems, slots })
  types.ts                 # CatalogEntry, CatalogFile, InstallState …
  lib/
    catalog.ts             # load embedded + cached remote, zod-validate, merge
    refresh.ts             # fetch remote catalog.json → validate → cache
    install-state.ts       # join catalog against lockfiles/manifest (server-side)
  components/
    explore-page.tsx       # tabs (Agents | Plugins | Packs) + category FacetFilter
    catalog-card.tsx       # visual listing: emoji/icon, name, category, use cases
    detail-panel.tsx       # expanded view: full use cases, deps, source, trust
    install-dialog.tsx     # curated one-click + custom source form
    consent-dialog.tsx     # renders permissions from awaitingConsent response
```

- Added to `CORE_PLUGIN_IDS` (`src/lib/core-plugin-ids.ts`) and the build.
- Client pages registered at `page:/explore` (single page, tab + filter state
  in URL via `useQueryState`/`useQueryArrayState`; `<Suspense>`-wrapped).
- No HookRegistry needs in V1: installed/update state comes from host REST the
  client already may call. Server-side routes below exist so the client makes
  one call, not four, and so state-joining logic is testable server-side.

### 3.2 Plugin-registered API routes

Under `/api/plugins/explore/`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/catalog` | Merged catalog (embedded ⊕ cached remote) joined with install state: `installed`, `builtin`, `updateAvailable`, `installedVersion` per entry |
| POST | `/catalog/refresh` | Fetch remote catalog from `bakin-bits-official`, zod-validate, cache to `~/.bakin/plugin-data/explore/catalog.json`, return merged result |

Installs go straight to the existing host endpoints — Explore adds **no** new
mutation routes:

- agents → `POST /api/agent-packages/install`
- plugins → `POST /api/plugins/install` (+ consent round-trip)
- packs → `POST /api/packages/install`

Design rule (from #163, unchanged): the UI layer performs no filesystem or
provider mutations; server-owned validation/consent is never re-implemented
client-side.

### 3.3 Unified curated catalog (replaces two ad-hoc files)

Today: `packages/host/src/data/curated-agents.json` (served by `/api/curated`)
and `curated-plugins.json` (onboarding recommendations only). Tech-debt
reduction: **unify into one file** with one zod schema.

`packages/host/src/data/curated-catalog.json` (embedded via the existing
embedded-assets pipeline):

```jsonc
{
  "version": 2,
  "updatedAt": "2026-07-04",
  "entries": [
    {
      "id": "pixel",
      "kind": "agent",                    // agent | plugin | skill-pack | workflow-pack | lesson-pack
      "name": "Pixel",
      "emoji": "🎨",
      "description": "…",
      "category": "Marketing",            // single primary category
      "tags": ["images", "brand"],
      "useCases": ["Generate on-brand social images", "…"],
      "source": "github:markhayden/bakin-bits-official#agents/pixel",
      "ref": "main",
      "trust": "official",
      "builtin": false,                    // true for the 10 core plugins (no source)
      "dependencies": ["assets"],          // plugin kinds only
      "defaultSelected": true              // onboarding recommendation flag, carried over
    }
  ]
}
```

Migration (single-user machine, no back-compat shims):

- `src/core/onboarding/recommended-agents.ts` / `recommended-plugins.ts` read
  the unified file (filtered by kind + `defaultSelected`).
- `/api/curated` host route is **deleted**; the explore plugin's `/catalog`
  route supersedes it. `tests/api/curated.test.ts` migrates accordingly.
- The two old JSON files are deleted.
- Companion (out of repo): author `catalog.json` at the root of
  `bakin-bits-official` in the same schema for remote refresh. Explore works
  fully without it (refresh reports "no remote catalog yet" cleanly).

### 3.4 Sidebar: generic bottom placement

- `NavItem` gains `placement?: 'bottom'` (`packages/sdk/src/types/registration.ts`).
- `AppSidebar` renders bottom-placed items in the existing pinned-bottom
  section, above the hardcoded Settings link. No other shell special-casing.
- Explore registers `{ id: 'explore', label: 'Explore', icon: 'Compass', href: '/explore', placement: 'bottom' }`.
- Team nav stays exactly where it is.

### 3.5 Status relay (no polling, no page-load network)

- Default catalog join uses **persisted** lockfile markers (`upgradeAvailable`,
  `lastChecked`) — instant, offline-safe.
- "Check for updates" button calls the existing `?check=1` probe endpoints,
  then re-fetches the catalog join.
- Badges deep-link: agents → `/team/{id}`, plugins → (stay in Explore detail
  with CLI hint until a plugin-management UI exists), health issues → `/health`.

### 3.6 Cleanup (tech-debt items folded in)

- Delete orphaned `plugins/team/components/install-dialog.tsx` (never
  imported); Explore owns install UI. Its isolation test moves/adapts to the
  explore plugin.
- Note: `curated-browser.tsx` referenced in #163 never existed — nothing to
  migrate.
- Correct stale comments pointing "Teams UI browse curated view" at the old
  `/api/curated` route (route is deleted).

---

## 4. Commands

| Task | Command |
|---|---|
| Dev loop | `bun run dev` (plugin HMR covers `plugins/explore/`) |
| Mock runtime | `bun run dev:mock` |
| Build all | `bun run build` (never `git add -A` after — build stamp) |
| Full tests | `bun run test` |
| Single file | `bun test tests/plugins/explore/foo.test.ts --isolate` |

No new CLI commands. No changes to existing `bakin` CLI surface.

## 5. Code Style

Repo conventions apply unchanged (CLAUDE.md): strict TS, zod at boundaries
(catalog schema, refresh response), functional style, `createLogger('explore')`,
kebab-case files, import order, URL-backed page state, SDK-only imports in
client components (`@makinbakin/sdk/*`, never `packages/host/src/*`).

## 6. Testing Strategy

- **Plugin server tests** (`tests/plugins/explore/`): `activatePlugin` +
  `callRoute` from `tests/plugins/test-helpers.ts`. Catalog merge (embedded ⊕
  cached remote, version precedence), install-state join (installed / builtin /
  updateAvailable), refresh failure modes (network down, invalid JSON → cached
  copy untouched, honest error).
- **Schema tests**: unified catalog zod schema; the shipped
  `curated-catalog.json` must validate (regression gate for catalog PRs).
- **Component isolation tests**: catalog-card, install-dialog (incl. consent
  round-trip render), explore-page tab/filter URL state — mirroring existing
  team-component test patterns.
- **Onboarding regression**: recommended-agents/plugins still produce the same
  selections from the unified file.
- **Sidebar**: bottom-placement rendering test alongside existing sidebar tests.
- **Mandatory isolation**: every fs-touching test mocks both content-dir
  resolvers + OpenClaw home per CLAUDE.md; `rmSync` cleanup; logger/watcher
  mocked. Remote refresh tests never hit the network (inject fetcher).

## 7. Boundaries

**Always**
- Install through existing host REST; render server responses honestly.
- Preserve consent gates exactly (`awaitingConsent` → dialog → token re-POST).
- Adapter-neutral: agent data only via adapter-backed endpoints.
- Catalog validated with zod at every boundary (embedded, remote, cache).

**Ask first**
- Any new mutation endpoint.
- Any change to team/health plugin behavior beyond adding deep-link targets.
- Schema changes to `bakin-plugin.json` / `bakin-package.json` manifests
  (V1 keeps richness in the catalog, not the manifests).

**Never**
- Update/remove/sync/repair UI in Explore (stays Team/Health/CLI — future #163 follow-up).
- Filesystem or provider mutations from UI code.
- Bypassing consent, or auto-fetching the remote catalog without user action.
- Provider-specific (OpenClaw) identifiers anywhere in the plugin.
- Backwards-compat shims for the catalog migration (single-user machine).

## 8. Out of Scope (V1)

- Hosted registry / non-official third-party listings; ratings, screenshots.
- Plugin update/remove UI; agent update/remove UI; drift repair UI;
  `.userEdited` lock management (remainder of #163, later slice).
- Per-agent lesson toggling inside Explore (lives in Team).
- Scheduled/automatic catalog refresh.
- `bakin-bits-official` catalog.json authoring (companion task, separate repo).

## 9. Docs & Knowledge Updates

- New `.claude/knowledge/explore-plugin.md` (catalog schema, merge/refresh
  semantics, install-state join).
- Update `.claude/knowledge/plugin-system.md` (11th core plugin),
  `repo-architecture.md` (directory map), CLAUDE.md core-plugin count + nav
  pattern (`placement: 'bottom'`), and onboarding knowledge if
  recommended-* internals are documented there.
- README / Astro docs: add Explore to feature overview if plugins are
  enumerated there (verify during build phase).

## 10. Issue Hygiene

This spec supersedes the storefront/discovery portion of #163 and *defers* its
management scope (lifecycle actions, drift repair, `.userEdited` re-claim —
which stay in Team/Health when built). On approval: comment on #163 with the
pivot summary + link to this spec; retitle or split so the remaining
management scope keeps a clean home. Also note two factual corrections to the
issue: `curated-browser.tsx` never existed, and the pack kind is `lesson-pack`
(not `knowledge-pack`).

## 11. Commit Strategy (checkpoints for rollback)

Each lands green (typecheck + suite) and is independently revertable:

1. `feat(sdk,host): NavItem placement:'bottom' + sidebar bottom section support`
2. `feat(explore): scaffold explore core plugin (manifest, activate, empty page, nav)`
3. `feat(explore): unified curated catalog schema + data file; migrate onboarding readers; delete /api/curated + old JSON files`
4. `feat(explore): catalog route with install-state join + explore page (browse, tabs, categories)`
5. `feat(explore): install flows — curated one-click, custom source, plugin consent dialog`
6. `feat(explore): remote catalog refresh + update-available relay/deep-links`
7. `chore(team): delete orphaned install-dialog; migrate its test to explore`
8. `docs(knowledge): explore-plugin.md + CLAUDE.md/repo-architecture updates`

(Granularity may split further during /plan; order is the dependency order.)

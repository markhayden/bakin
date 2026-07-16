# Spec: Routing Overhaul (pre-launch)

**Status:** SHIPPED — PR #692 + #693 + #695 merged 2026-07-16; all success criteria met
**Date:** 2026-07-15
**Priority:** Tech-debt reduction before launch. Deep links become a public contract at launch; URL shapes must be final before then.
**Constraints:** Single user, single machine. NO backwards compatibility, NO redirect shims for old URL shapes. Clean and clear over compatible.

## Objective

Unify Bakin on ONE routing strategy and make every internal navigation client-side. Today two identity conventions coexist (`/team/<id>` vs `/chat?chat=<id>`), seven internal links full-reload the app, there is no real 404, and the router shim carries documented footguns (multi-setter clobber, JSON coercion of query values). All of it gets fixed under one initiative with regression enforcement so it stays fixed.

### The URL Taxonomy (the rule everything follows)

**Path = page identity.** Which page you are on, including full-page resource views and creation surfaces:

- Lists: `/tasks`, `/chat`, `/schedule`, `/memory`, `/assets`, `/brands`, `/team`, `/workflows`
- Full-page details: `/chat/$chatId` (NEW), `/team/$id`, `/assets/$assetId`, `/brands/$brandId`, `/workflows/$id`
- Creation surfaces: `/chat/new` (NEW), `/workflows/new`, `/projects/new`

**Query = overlay + view state.** Anything layered over a page that must compose with the page's other state:

- Drawers (overlay identity): `?taskId=`, `?jobId=`, `?recordId=` — these stay query params by design
- Tabs: `?tab=`
- Filters/view state: `?view=`, `?q=`, `?agent=`, `?status=`, `?type=`, `?sort=`, `?dir=`, `?page=`

**Never a full page reload for internal navigation.** Allowed full reloads are pinned to an explicit allowlist (unsaved-changes guard, `router.refresh()`, dev-loop/manifest reloads, update recovery, plugin-failure banner).

### Decisions locked during interview

| # | Decision | Choice |
|---|----------|--------|
| D1 | Taxonomy rule | Presentation-based: path = page identity, query = overlays/tabs/filters. Drawers deliberately stay query-param. |
| D2 | Chat URLs | `/chat` (list), `/chat?agent=<f>` (filtered list), `/chat/$chatId` (conversation), `/chat/new?agent=<agentId>` (draft composer). |
| D3 | Enforcement | BOTH an architecture test (CI gate) and ESLint restrictions (editor feedback). ESLint 9 flat config already exists; use `no-restricted-properties`/`no-restricted-syntax` — no custom rule infra. |
| D4 | OS notification clicks | SPA navigation via a navigate bridge registered by the host at boot (`browser-notify.ts` falls back to `location.href` if no bridge). |
| D5 | Polish scope | ALL of: useQueryState multi-setter clobber fix, JSON-coercion fix in the router shim, TanStack scroll restoration, real 404 page, plugin-route shadow warning, Health + Models `?tab=` URL state. *(Planning discovery: Health `health-page.tsx:100` and Models `use-models-data.ts:101` already use `useQueryState('tab', …)` — the knowledge doc table is stale; this item is docs-only.)* |
| D6 | Out of scope | TanStack typed-route migration (string-URL API IS the plugin SDK contract), route-level code splitting, route masking, URL redirects/aliases for old shapes. |
| D7 | Delivery | 3 PRs by risk (see Commit Strategy). Branches in the MAIN checkout so 3737 serves them; Mark live-tests each before merge. |

### Assumptions (surfaced, not asked)

1. Old `?chat=<id>` deep links simply stop resolving (render the chat list). Nothing server-side persists chat URLs; the toast/notification/search builders are all computed at event time and get updated in PR2.
2. Drawer param names stay exactly as documented: `taskId`, `jobId`, `recordId`.
3. The already-fixed chat reply toast (uncommitted working-tree change: `chat-badge-provider.tsx`, `use-toast.ts`) ships as the first commit of PR1.
4. The unrelated uncommitted `packages/host/src/api/_embedded-assets-static.ts` change is NOT part of this initiative and stays out of its commits.
5. `visibleChatIdFromLocation` in `plugins/chat/components/attention.ts` moves from parsing `?chat=` to parsing the `/chat/$chatId` pathname in PR2 (suppression rules unchanged).
6. The stale `?asset=` row in the knowledge doc is documentation drift (code already uses `/assets/$assetId`); fixed in the docs sweep.

## Tech Stack

- Bun ≥ 1.2 (runtime, bundler, test runner) — no Node, no Vite
- React 19 + TanStack Router (code-based routes — file-based generation unavailable under `Bun.build()`)
- ESLint 9 flat config (`eslint.config.mjs`)
- Existing SDK surface: `useRouter`/`useQueryState`/`useQueryArrayState` (`@makinbakin/sdk/hooks`), `PluginLink` (`@makinbakin/sdk/components`)

## Commands

```
Typecheck:   bunx tsc --noEmit -p tsconfig.json     (pre-existing astro/fixture errors are known noise)
Lint:        bun run lint
Test (all):  bun run test                            (never bare `bun test` — preload + --isolate matter)
Test (one):  bun test tests/path/foo.test.ts --isolate
Dev:         bun run dev                             (client changes hot-reload; server changes need manual restart)
Live server: nohup bun run dev from MAIN checkout on 3737 (Mark's box — restart required for server-code changes)
```

## Project Structure (files this initiative touches)

```
packages/host/src/router.ts                       → route tree wiring (+ chat.$chatId, chat.new, notFoundComponent, scrollRestoration)
packages/host/src/routes/chat.tsx                 → becomes parent/list route; new chat.$chatId.tsx, chat.new.tsx
packages/host/src/routes/plugin-catchall.tsx      → renders shared NotFound; shadow warning
packages/sdk/src/hooks/router.ts                  → JSON-coercion fix, scroll option honored
src/hooks/use-query-state.ts                      → multi-setter clobber fix
src/lib/browser-notify.ts                         → navigate bridge + fallback
src/components/…                                  → shared NotFound component; search-unavailable anchor fix
plugins/chat/…                                    → chat page path migration, attention.ts, client.tsx (search hit), badge provider
plugins/{tasks,brands,explore,memory}/…           → raw-anchor → PluginLink fixes
plugins/workflows/components/approvals-badge-provider.tsx → toast SPA fix
plugins/{health,models}/…                         → ?tab= URL state
tests/architecture/no-hard-navigation.test.ts     → NEW enforcement scanner
eslint.config.mjs                                 → no-restricted-syntax/properties for client globs
.claude/knowledge/url-state-deep-linking.md       → rewritten around the taxonomy
```

## Code Style

Follow existing conventions (CLAUDE.md). The navigation-specific rules this spec adds:

```tsx
// Internal links in plugins/shared components: PluginLink (real <a>, SPA on plain click)
import { PluginLink } from '@makinbakin/sdk/components'
<PluginLink to={`/chat/${chatId}`}>Open chat</PluginLink>

// Programmatic navigation: the SDK router — never window.location
const router = useRouter()
router.push(`/chat/${encodeURIComponent(chatId)}`)

// Host-internal code may use TanStack <Link> directly.
// Multi-param updates: one URL, one push — never two setters in one tick
// (rule survives until the clobber fix lands in PR3, then setters compose).
```

## Testing Strategy

- **Unit (bun:test):** router shim URL round-trips (string `"123"` stays a string; hash/search preservation), `use-query-state` multi-setter composition, chat `attention.ts` path parsing, notification-bridge fallback.
- **Architecture (`tests/architecture/`):** the new no-hard-navigation scanner — bans `window.location.{assign,replace,href=}` and raw internal `<a href="/…">` in client code, path-pinned allowlist with reasons; a teeth case proving the scanner bites.
- **Component (RTL, `--isolate`, `rtl-settle`):** chat page renders conversation from path param; drawer deep-links still open from query params; 404 renders for unknown paths.
- **Live verification (per PR, by Mark on 3737):** documented click-through checklist in each PR description — cold-boot deep links, back/forward, notification click without reload (SSE connection visibly survives in the network tab).
- Full suite green (`bun run test`) + lint + typecheck before every commit.

## Boundaries

- **Always:** route internal navigation through `PluginLink`/TanStack `Link`/`useRouter()`; update `.claude/knowledge/` docs in the same PR as the behavior change; conventional commits (`feat(chat): …`, `fix(tasks): …`, `test(architecture): …`); branch from `main` in the MAIN checkout; run test+lint+typecheck before each commit; verify HEAD before committing.
- **Ask first:** any URL shape the taxonomy doesn't cover; adding dependencies; non-additive changes to the SDK's public API; touching `packages/core` storage or anything outside the routing surface.
- **Never:** back-compat shims or redirects for old URL shapes; `window.location` navigation for internal paths outside the pinned allowlist; typed-route migration; committing `generated-version.ts`; merging before Mark's live test passes.

## Commit Strategy (rollback checkpoints)

Each commit is atomic, green (test+lint+typecheck), and revertable alone.

**PR1 — `feat/routing-no-hard-nav`** (mechanical, low risk)
1. `fix(chat): SPA-navigate + dismiss reply toast` (the already-done working-tree change)
2. `fix(plugins): replace raw internal anchors with PluginLink` (tasks ×2, brands, explore, memory, search-unavailable)
3. `fix(workflows): SPA-navigate approval toast`
4. `feat(sdk): navigate bridge for browser notifications` (+ host boot registration, fallback)
5. `test(architecture): no-hard-navigation scanner + eslint restrictions`
6. `docs(knowledge): navigation rules in url-state-deep-linking`

**PR2 — `feat/chat-path-routing`** (highest behavior change, isolated)
1. `feat(host): /chat/$chatId and /chat/new routes`
2. `feat(chat): page reads identity from path; draft moves to /chat/new?agent=`
3. `feat(chat): update toast/notification/search-hit URL builders + attention.ts`
4. `test(chat): path-based deep-link coverage`
5. `docs(knowledge): chat-plugin.md URL surface`

**PR3 — `feat/router-polish`** (subtle cross-cutting behavior)
1. `fix(sdk): stop JSON-coercing query values in router shim`
2. `fix(hooks): compose multi-setter useQueryState updates`
3. `feat(host): scroll restoration`
4. `feat(host): NotFound page + catch-all integration + route-shadow warning`
5. `feat(health,models): ?tab= URL state`
6. `docs: knowledge sweep (drop clobber warning, drop stale ?asset=, CLAUDE.md URL-state bullet, plugin authoring docs)`

Rollback: `git revert` any checkpoint; PR boundaries isolate the blast radius (a shim regression never holds back the chat migration, etc.).

## Success Criteria

1. Arch test + `bun run lint` prove zero unallowlisted hard navigations in client code — and fail on a seeded offender (teeth test).
2. `/chat/<id>` cold-boots (hard refresh) into the right conversation; back/forward moves between conversations; `/chat/new?agent=x` opens the draft composer; first send lands on `/chat/<newId>` without a reload.
3. Clicking the reply toast, the workflow approval toast, and an OS notification navigates with NO full reload (SSE connection id unchanged).
4. Every raw internal anchor is gone; middle-click/cmd-click on `PluginLink`s still opens a new tab correctly.
5. Two `useQueryState` setters in one handler both land; query value `"123"` survives as a string through push/replace round-trips.
6. Back/forward restores scroll position on `/tasks` and `/assets`.
7. Unknown paths render the styled 404 with sidebar/nav intact; a plugin route shadowed by a core route logs a warning.
8. Health and Models tabs are deep-linkable via `?tab=` and survive refresh.
9. Full suite, lint, and typecheck green; `.claude/knowledge/url-state-deep-linking.md` rewritten around the taxonomy; CLAUDE.md URL-state bullet updated; README checked (no routing content expected).

## Open Questions

None blocking. Deferred (explicitly out of scope, revisit post-launch if ever): typed-route API adoption, route-level code splitting, route masking.

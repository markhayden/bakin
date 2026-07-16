# Implementation Plan: Routing Overhaul

**Spec:** `.claude/specs/routing-overhaul.md` (approved 2026-07-15)
**Delivery:** 3 PRs by risk, branched from `main` in the MAIN checkout (3737 serves each for live testing). Merge only after Mark's live pass.
**Task list:** `tasks/todo-routing-overhaul.md`

## Overview

Unify on the presentation-based URL taxonomy (path = page identity, query = overlays/tabs/filters), eliminate every full-reload internal navigation with dual enforcement (arch test + ESLint), migrate chat to `/chat/$chatId`, and fix the router shim's footguns. No backwards compatibility.

## Architecture Decisions (from spec + planning discoveries)

- **Navigate bridge must be `globalThis`-based** (`globalThis.__bakinNavigate`, mirroring `__bakinBroadcast`): plugins inline their own copy of `src/lib/browser-notify.ts` (only react/SDK are externalized), so a module-level bridge variable would never reach plugin bundles.
- **Chat routes follow the `team.$id.tsx` pattern:** host route reads params via `Route.useParams()` and passes them to plugin slots as props (`page:/chat/[chatId]` with `chatId`, `page:/chat/new`). TanStack ranks static `/chat/new` above dynamic `/chat/$chatId` — pinned by a test anyway.
- **JSON-coercion fix targets the router config, not more shim gymnastics:** prefer custom `parseSearch`/`stringifySearch` on `createRouter` that treat all values as plain strings (the whole app uses string params). Fallback if TanStack internals fight it: keep parsing in the shim but preserve strings. Decision made inside T3.1 with tests either way.
- **Clobber fix = microtask batching:** `useQueryState` setters merge into ONE navigation per tick (a module-level pending-update queue; `push` wins over `replace` if any update pushed). Reading `window.location` at call time is not reliable mid-tick.
- **Scroll restoration needs a scout step:** the installed TanStack 1.168 exports `<ScrollRestoration />`; but if the app scrolls inside inner containers rather than the window, window-level restoration is a no-op and we need `useElementScrollRestoration` or explicit opt-outs. T3.3 starts with a 15-minute investigation and reports before wiring.
- **Health/Models `?tab=` already exists** (`health-page.tsx:100`, `use-models-data.ts:101`) — PR3's item is docs-only.
- **404 renders inside the root layout** (the `$` catch-all is a child of `__root`), so sidebar/nav stay intact for free; the work is a shared `NotFound` component + wiring + shadow warning.

## Dependency Graph

```
PR1 (independent)                    PR2 (after PR1 merges)          PR3 (after PR2 merges)
  T1.1 toast fix commit                T2.1 host routes                T3.1 search-string fix
  T1.2 anchors → PluginLink            T2.2 chat page props     ┌──── T3.2 clobber fix (uses T3.1's tests)
  T1.3 workflows toast   (needs T1.1's  T2.3 URL builders ◄─────┤     T3.3 scroll restoration (independent)
       toast-id return, already in tree)     (needs T2.1+T2.2)  │     T3.4 NotFound + shadow warn (independent)
  T1.4 navigate bridge                 T2.4 tests               └──── T3.5 docs sweep (last — documents all)
  T1.5 enforcement (LAST — pins T1.1–T1.4)
  T1.6 PR1 docs note
```

PR order is risk-based, not dependency-forced: PR1 mechanical, PR2 the biggest behavior change isolated, PR3 subtle cross-cutting. Within PRs, tasks are sequential except T3.3/T3.4 (either order).

---

## PR1 — `feat/routing-no-hard-nav`

### Task 1.1: Commit the chat reply-toast fix
**Description:** The working tree already contains the chat toast SPA fix (`chat-badge-provider.tsx` + `use-toast.ts` returning the toast id). Commit it as-is; exclude the unrelated `_embedded-assets-static.ts` change.
**Acceptance:** Toast click navigates via router and dismisses the toast; `toast()` returns the id.
**Verify:** `bun test tests/plugins/chat/ --isolate` green; `git status` shows `_embedded-assets-static.ts` still uncommitted.
**Files:** `plugins/chat/components/chat-badge-provider.tsx`, `src/hooks/use-toast.ts` (already edited)
**Commit:** `fix(chat): SPA-navigate + dismiss reply toast` · **Size:** XS

### Task 1.2: Raw internal anchors → PluginLink
**Description:** Replace the six raw `<a href="/…">` internal anchors with `PluginLink` (SDK) / TanStack `Link` (host-shared): `task-card.tsx:156` (`/models?tab=spend`), `task-card.tsx:225` (`/brands`), `task-brand-panel.tsx:83`, `explore/detail-drawer.tsx:112` (`/team/<id>`), `memory-cleanup.tsx:242` (`/tasks`), `search-unavailable.tsx:33` (`/health`). Preserve styling and any `onClick`/stopPropagation semantics (task-card anchors live inside clickable cards — verify propagation).
**Acceptance:** All six navigate without reload; cmd/middle-click still opens a new tab; card-click behavior around nested links unchanged.
**Verify:** `bun run test` (touched plugins' suites), `bunx tsc --noEmit`, manual click-through in dev.
**Files:** 5 files above + `src/components/search-unavailable.tsx` (uses TanStack `Link` or PluginLink — match its import surface)
**Commit:** `fix(plugins): replace raw internal anchors with PluginLink` · **Size:** S

### Task 1.3: Workflows approval toast → SPA
**Description:** Mirror the chat toast fix in `plugins/workflows/components/approvals-badge-provider.tsx:50`: `window.location.href = attention.url` becomes `useRouter().push` + dismiss-on-click via the toast id from T1.1's API.
**Acceptance:** Clicking the approval toast lands on `/tasks?taskId=…` with no reload; toast dismisses.
**Verify:** `bun test tests/plugins/workflows/approvals-attention.test.tsx --isolate` (+ add a click-path assertion if the harness allows).
**Files:** `plugins/workflows/components/approvals-badge-provider.tsx` (+ its test)
**Commit:** `fix(workflows): SPA-navigate approval toast` · **Size:** XS

### Task 1.4: Navigate bridge for OS notifications
**Description:** Add `setNavigateBridge`/`navigateTo` in `src/lib/browser-notify.ts` backed by `globalThis.__bakinNavigate` (typed, mirroring `__bakinBroadcast`). Host registers it at boot (where the router instance exists — `main.tsx` or a `__root` effect) with `router.navigate(toNavigationOptions(url))`. `notification.onclick` → `window.focus()` then bridge; falls back to `window.location.href` when unregistered.
**Acceptance:** Notification click SPA-navigates (SSE connection survives — verify in network tab); with the bridge stubbed out, fallback still navigates.
**Verify:** New unit test for bridge/fallback (`tests/lib/browser-notify*.test.ts`, happy-dom); manual OS-notification click in dev.
**Files:** `src/lib/browser-notify.ts`, host boot file, new test
**Commit:** `feat(sdk): navigate bridge for browser notifications` · **Size:** S

### Task 1.5: Enforcement — arch test + ESLint (pins T1.1–T1.4)
**Description:** (a) `tests/architecture/no-hard-navigation.test.ts`: pure scanner (no app imports — stays exempt from content-dir mocks) over client-side source banning `window.location.assign/replace`, `window.location.href =`, and raw internal `<a href="/…">`; path-pinned allowlist with reasons: `unsaved-changes-guard.tsx`, SDK `router.ts` (`refresh()`), `use-sse.ts` manifest reload, `header.tsx` update recovery, `PluginHost.tsx` failure banner, `browser-notify.ts` fallback line. Teeth: fixture-string cases proving each pattern is caught. (b) `eslint.config.mjs`: `no-restricted-syntax`/`no-restricted-properties` block scoped to client globs with the same allowlist via per-file disables or glob excludes.
**Acceptance:** Suite fails on a seeded offender in a scratch file (manually verified, then removed); `bun run lint` flags the same; current tree passes both.
**Verify:** `bun test tests/architecture/no-hard-navigation.test.ts --isolate`, `bun run lint`, seeded-offender check.
**Files:** new arch test, `eslint.config.mjs`
**Commit:** `test(architecture): no-hard-navigation scanner + eslint restrictions` · **Size:** M

### Task 1.6: PR1 docs
**Description:** Add the navigation rules (PluginLink/useRouter only; allowlisted full reloads; bridge) to `.claude/knowledge/url-state-deep-linking.md` as a new section (full taxonomy rewrite waits for PR3 when the clobber rule dies).
**Verify:** Doc references real file paths; no stale claims introduced.
**Commit:** `docs(knowledge): navigation rules in url-state-deep-linking` · **Size:** XS

### Checkpoint PR1 (before merge)
- [ ] `bun run test` + `bun run lint` + `bunx tsc --noEmit` green
- [ ] Live on 3737: all six former anchors, both toasts, one OS notification — zero full reloads (network tab: SSE conn id stable)
- [ ] Mark approves → merge

---

## PR2 — `feat/chat-path-routing`

### Task 2.1: Host routes for chat
**Description:** Add `routes/chat.$chatId.tsx` and `routes/chat.new.tsx` following the `team.$id.tsx` pattern (`Route.useParams()` → slot props: `page:/chat/[chatId]` with `chatId`; `page:/chat/new`, agent read by the plugin from `?agent=`). Wire into `router.ts`. `routes/chat.tsx` stays the list route.
**Acceptance:** `/chat/abc` renders the `page:/chat/[chatId]` slot with `chatId="abc"`; `/chat/new` matches the static route, not `$chatId`.
**Verify:** New route-ranking test; `bunx tsc --noEmit`.
**Files:** `packages/host/src/routes/chat.$chatId.tsx` (new), `chat.new.tsx` (new), `packages/host/src/router.ts`
**Commit:** `feat(host): /chat/$chatId and /chat/new routes` · **Size:** S

### Task 2.2: Chat page reads identity from props/path
**Description:** `plugins/chat/client.tsx` registers the two new slots; `chat-page.tsx` takes `chatId`/draft-mode via props instead of `useQueryState('chat')`/`('draft')`. Internal transitions become path navigations: select chat → `router.push('/chat/<id>')`, new-chat → `router.push('/chat/new?agent=<id>')`, first send lands on `/chat/<newId>` (replace — the draft URL shouldn't survive in history), close/back → `/chat`. The `?agent=` list filter keeps `useQueryState`. Remove the single-navigation-per-transition `setParams` workaround (obsolete once identity is path-based).
**Acceptance:** All chat flows work from path URLs; cold-boot deep link renders the conversation; draft first-send transitions without reload; `?agent=` filter survives conversation switches only if currently designed to (match existing behavior).
**Verify:** `bun test tests/plugins/chat/ --isolate`; RTL coverage in T2.4.
**Files:** `plugins/chat/client.tsx`, `plugins/chat/components/chat-page.tsx` (+ maybe `chat-view.tsx` props)
**Commit:** `feat(chat): page reads identity from path; draft moves to /chat/new` · **Size:** M

### Task 2.3: Update every chat URL builder
**Description:** `attention.ts` `visibleChatIdFromLocation` parses `/chat/<id>` pathname (suppression semantics unchanged — `/chat/new` and `/chat` yield `''`); badge-provider toast + OS notification URLs → `/chat/<id>`; search-hit renderer in `client.tsx` → `/chat/<id>`; sweep for any other `?chat=` builders (`grep -rn "chat?chat\|?chat=" plugins packages src`).
**Acceptance:** Toast, OS notification, and ⌘K hit all land on the path URL; viewing `/chat/<id>` still suppresses that chat's toast.
**Verify:** `bun test tests/plugins/chat/attention.test.tsx --isolate` (updated); grep returns zero `?chat=` builders.
**Files:** `plugins/chat/components/attention.ts`, `chat-badge-provider.tsx`, `plugins/chat/client.tsx`
**Commit:** `feat(chat): path URLs in toast/notification/search builders` · **Size:** S

### Task 2.4: Chat path tests
**Description:** RTL: chat page renders conversation from `chatId` prop; draft mode from `/chat/new`. Unit: attention pathname parsing table (`/chat/x`, `/chat/x?agent=y`, `/chat/new`, `/chat`, `/tasks`). Follow rtl-settle rules (`import rtl-settle`, `await settleReact()` where a final assertion races a re-render).
**Verify:** `bun test tests/plugins/chat/ --isolate` green; suite green under `bun run test`.
**Commit:** `test(chat): path-based deep-link coverage` · **Size:** S

### Task 2.5: Chat docs
**Description:** Update `.claude/knowledge/chat-plugin.md` URL surface (and `conversation-kit.md` if it references `?chat=`).
**Commit:** `docs(knowledge): chat-plugin URL surface` · **Size:** XS

### Checkpoint PR2 (before merge)
- [ ] Full suite + lint + typecheck green
- [ ] Live on 3737: cold-boot `/chat/<id>` hard refresh, back/forward across conversations, draft → first send → `/chat/<newId>` no reload, toast + OS notif + ⌘K land correctly, old `/chat?chat=<id>` renders list (accepted death)
- [ ] Mark approves → merge

---

## PR3 — `feat/router-polish`

### Task 3.1: Query values stay strings
**Description:** Kill the JSON coercion. Preferred: custom `parseSearch`/`stringifySearch` on `createRouter` treating every value as a plain string, then simplify `toNavigationOptions`/`parseRouterSearch` and `useSearchParams`. Fallback (if TanStack internals require the default serializer): fix inside the shim only. Write the round-trip tests FIRST (they define done): `"123"`, `"true"`, `"a,b"`, URL-encoded, multi-value, hash preservation; `DebugSeed`'s `?debug=true` seed and every `useQueryState` consumer unaffected.
**Acceptance:** All round-trips preserve strings; no `%22`-quoted values in produced URLs; existing param-driven pages behave identically.
**Verify:** New `tests/sdk/router-search.test.ts` (or similar) + full suite.
**Files:** `packages/host/src/router.ts`, `packages/sdk/src/hooks/router.ts`, new test
**Commit:** `fix(sdk): query values survive as strings through the router` · **Size:** M

### Task 3.2: useQueryState multi-setter batching
**Description:** Batch all `useQueryState`/`useQueryArrayState` mutations in one microtask into a single navigation (merged params; `push` if any update pushed). Two setters in one handler both land. Update the assets `pushParams` call-site comment; the workaround pattern keeps working but is no longer required.
**Acceptance:** A handler calling `setView(...)` + `setTags(...)` produces one history entry containing both; existing single-setter behavior unchanged.
**Verify:** New unit test for the batcher; `bun run test` (kanban/assets/schedule suites exercise setters heavily).
**Files:** `src/hooks/use-query-state.ts`, new test
**Commit:** `fix(hooks): compose multi-setter useQueryState updates` · **Size:** M

### Task 3.3: Scroll restoration (scout first)
**Description:** 15-minute scout: find the real scroll container (window vs inner `overflow` div in the shell layout). Then wire the v1.168-supported mechanism (`<ScrollRestoration />` in `__root` and/or `useElementScrollRestoration` for the container). Honor filter-replace ergonomics (no scroll jump on `?q=` typing — `resetScroll: false` on replace navigations if needed).
**Acceptance:** `/tasks` scroll → open detail elsewhere → back restores position; filter typing never jumps scroll.
**Verify:** Manual on 3737 (primary); unit where feasible.
**Files:** `packages/host/src/routes/__root.tsx` and/or `router.ts`
**Commit:** `feat(host): scroll restoration` · **Size:** S

### Task 3.4: Real 404 + route-shadow warning
**Description:** Shared `NotFound` component (styled, link back to `/tasks`, renders inside root layout so nav stays); used by `plugin-catchall.tsx` (replacing the bare div) and registered as router `notFoundComponent` (backstop). At plugin-route registration/resolution, `console.warn` when a plugin pattern is shadowed by a host static route (host route paths are enumerable from `router.ts`).
**Acceptance:** Unknown path renders styled 404 with sidebar intact; a test plugin route colliding with `/tasks` logs the warning.
**Verify:** RTL test for 404 render; unit test for shadow detection.
**Files:** new `packages/host/src/components/not-found.tsx`, `plugin-catchall.tsx`, `router.ts`
**Commit:** `feat(host): NotFound page + route-shadow warning` · **Size:** M

### Task 3.5: Docs sweep (last)
**Description:** Rewrite `.claude/knowledge/url-state-deep-linking.md` around the taxonomy (D1 table, chat URLs, navigation rules; DELETE the multi-setter warning + `pushParams` requirement, stale `?asset=` row, stale Health/Models "pending" rows). Update CLAUDE.md's URL-state bullet. Check `docs/src/content/docs/extending/plugins/` for navigation guidance (PluginLink), README (no routing content expected — verify).
**Verify:** Grep the docs for `?chat=`, `?asset=`, "never call two setters" — zero stale hits.
**Commit:** `docs: routing taxonomy sweep` · **Size:** S

### Checkpoint PR3 / initiative complete
- [ ] Full suite + lint + typecheck green
- [ ] Live on 3737: multi-param interactions (assets folder click), string params with numeric values, back/forward scroll, unknown URL 404, health/models `?tab=` deep links
- [ ] All spec Success Criteria (1–9) checked off explicitly
- [ ] Mark approves → merge → spec status flipped to Shipped

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Custom search serializer breaks an existing param consumer somewhere | High | Tests-first in T3.1; fallback plan is shim-scoped fix; full suite + live pass gate the merge |
| Chat migration breaks attention suppression (toast while viewing) | Med | Dedicated pathname-parsing table test in T2.3/T2.4 before live test |
| Scroll restoration no-ops or misfires with inner scroll containers | Med | Scout step first; feature is droppable from PR3 without blocking the rest |
| Arch scanner false positives (external links, `mailto:`, template literals) | Low | Teeth tests both directions (catches offenders, passes legit); allowlist is path+reason pinned |
| ESLint restrictions flag server-side `window` references | Low | Globs scoped to client dirs only; lint run is part of every commit gate |
| Nested `PluginLink` inside clickable task cards double-fires | Med | T1.2 explicitly verifies propagation on task-card; RTL click test if fragile |

## Open Questions

None — all decisions locked in the spec interview. The only in-flight decision is T3.1's serializer-vs-shim implementation choice, which its tests resolve internally (both outcomes satisfy the same acceptance criteria).

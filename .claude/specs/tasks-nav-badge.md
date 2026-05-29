# Spec: Tasks nav badge (blocked / review)

Branch: `feat/tasks-nav-badge`
Builds on: #265 (nav-badge SDK infra — `setNavBadge`, `nav-badge-providers` slot, `AppSidebar` rendering).
Repo: bakin only (Tasks is a core plugin; single-repo).

## Objective

Surface attention-needing Tasks as a badge on the **Tasks** nav item, using the generic nav-badge infrastructure shipped in #265. The Tasks plugin is the second adopter (after messaging) and the first to need **two severities**:

- **blocked** tasks → `error` tone (red), highest severity.
- **review** tasks → `attention` tone (amber).

This also fills a gap in the shared infra: there is currently no red/`error` tone (the palette is amber/blue/green). Adding it benefits every future plugin, not just Tasks.

**Target users:** the single user of this Bakin instance, who wants an at-a-glance signal that tasks are blocked or awaiting review without opening the board; and future plugin authors who need an `error`-severity badge.

## Scope

### In scope

**Shared infra (host + SDK):**
- `packages/sdk/src/types/index.ts` — add `'error'` to the `NavBadgeTone` union (`'error' | 'attention' | 'info' | 'success'`).
- `packages/host/src/components/layout/nav-badge.tsx` — add `error` to `PILL_TONE` (`bg-red-500/20 text-red-300`) and `DOT_TONE` (`bg-red-400`). Extend `navBadgeAriaSuffix` so `error` reads as a neutral, plugin-agnostic word — `'urgent'` (e.g. `, 3 urgent`).
- `packages/host/src/components/layout/nav-badge-logic.ts` — add `error: 0` to `TONE_PRIORITY` and renumber (`error:0, attention:1, info:2, success:3`) so `error` wins collapsed rollups.

**Tasks plugin:**
- `plugins/tasks/index.ts` — new route `GET /summary` → `{ blocked: number, review: number }` (counts only, from the task store; no full task bodies). The host route matcher prefers this exact path over `/:taskId`.
- `plugins/tasks/hooks/use-task-summary.ts` *(new)* — fetches `/api/plugins/tasks/summary`; refetches whenever `useContentStore(s => s.taskboardVersion)` changes (the existing SSE-driven "taskboard changed" signal — no new EventSource). Returns `{ summary: { blocked, review } | null, refresh }`.
- `plugins/tasks/components/tasks-badge-provider.tsx` *(new)* — background component (renders `null`). Computes a single badge via **winning-severity** rule:
  - `blocked > 0` → `{ count: blocked, tone: 'error' }`
  - else `review > 0` → `{ count: review, tone: 'attention' }`
  - else `null`
  Calls `setNavBadge('tasks', 'tasks', badge)`.
- `plugins/tasks/client.tsx` — add `slots: { 'nav-badge-providers': TasksBadgeProvider }` to the existing `registerPlugin` call.

**Tests:**
- `tests/components/nav-badge.test.tsx` — assert the `error` pill renders `bg-red-500/20`; `navBadgeAriaSuffix` for `error`.
- `tests/components/nav-badge-logic.test.ts` — `error` wins `pickRollupTone` / `collapsedParentRollupTone` over attention; updated `TONE_PRIORITY` ordering.
- `tests/plugins/tasks/...` — `/summary` route returns correct blocked/review counts (and zeros when empty).
- New: `tasks-badge-provider` test — winning-severity resolution (blocked beats review; review when no blocked; null at zero; the blocked→0 / review→0 transitions).

**Docs:**
- `.claude/knowledge/plugin-system.md` — update the "Nav badges (runtime)" section: add `error` to the tone list, note the severity ordering, and that Tasks is the second adopter.
- `docs/src/content/docs/extending/plugins/client-ui.md` — update the `NavBadge` tone enum in the Nav badges subsection.
- `docs/src/content/docs/reference/generated/sdk.md` — regenerate (`bun run docs:generate`) so the `NavBadgeTone` change appears.

### Out of scope

- `bakin-bits-official` ambient SDK type (`sdk-ambient.d.ts`) — messaging doesn't use `error`; leave it until a bits plugin needs it. Keeps this single-repo.
- Overdue / due-date logic — there is no `overdue` column; v1 is `blocked` + `review` only.
- Agent-filter-aware counts — badge is always global.
- Multi-color / segmented badges — rejected during kickoff; one badge, one tone, one count.
- Migrating other core plugins to badges — separate future work.

## Acceptance criteria

- ✅ Tasks nav item shows a **red** badge with the blocked count when ≥1 task is blocked.
- ✅ When nothing is blocked but ≥1 task is in review, shows an **amber** badge with the review count.
- ✅ Badge clears when neither blocked nor review has tasks.
- ✅ Count always matches the tone's meaning (red number = blocked count; amber number = review count).
- ✅ Badge updates live via the existing taskboard SSE signal (no reload, no new EventSource, no cron/heartbeat/MCP).
- ✅ Collapsed sidebar shows the Tasks icon with a red dot (flat item — no rollup needed; `error` dot when blocked, amber when only review).
- ✅ `error` tone added to the shared palette + priority; existing amber/blue/green badges unaffected.
- ✅ Manual verification in imitation-crab (seed a blocked + a review task; observe red count, then amber after unblocking).
- ✅ Tests cover the tone addition, rollup priority, the `/summary` endpoint, and the provider's winning-severity logic.

## Design decisions (from kickoff interview)

| Decision | Choice | Why |
|---|---|---|
| Multi-severity display | Winning-severity count, one color | Number ↔ color stay consistent; a 16px pill can't legibly show two; blocked is what to act on first. |
| Data source | Dedicated `GET /summary` + `taskboardVersion` refresh | Cheap (counts only); reuses the existing SSE-driven signal; no second EventSource. Mirrors messaging `/plans/summary`. |
| Badge scope | Always global | Sidebar is global chrome; agent filter is page-local URL state the provider often can't see. |
| New tone | `error` = `red-500/20` + `red-300` (pill), `red-400` (dot); priority above `attention` | Conventional blocked/error signal; matches existing tone scale; additive to the type. |
| aria wording for `error` | `'urgent'` | The tone is plugin-agnostic in the host; "urgent" reads correctly for blocked tasks, failing health checks, etc. |
| Repo | bakin only | Tasks is a core plugin; no bits changes needed. |

## Architecture impact

- `NavBadgeTone` gains a member — additive, no existing consumer breaks. The `error` tone becomes the new top of `TONE_PRIORITY`, shifting the others down by one (covered by updated tests).
- New cheap Tasks route `GET /summary`; host matcher already prefers exact paths over `/:taskId`.
- Second proof that the nav-badge infra is generic and works for a **core** plugin (messaging was an installed plugin) — same `setNavBadge` + slot contract, different SSE refresh source.

## Commit strategy

Four commits, each independently revertable, each landing with its tests:

1. **`feat(host): add error tone to NavBadge`**
   - SDK `NavBadgeTone` += `'error'`; host `PILL_TONE`/`DOT_TONE`/`navBadgeAriaSuffix`; `TONE_PRIORITY` reorder.
   - `tests/components/nav-badge.test.tsx` + `nav-badge-logic.test.ts` extended.
   - Pure infra; no Tasks code yet.

2. **`feat(tasks): /summary counts endpoint`**
   - `plugins/tasks/index.ts` route + Tasks route test.

3. **`feat(tasks): blocked/review nav badge provider`**
   - `use-task-summary.ts`, `tasks-badge-provider.tsx`, `client.tsx` slot wiring, provider test.

4. **`docs: error tone + Tasks badge`**
   - `.claude/knowledge/plugin-system.md`, `client-ui.md`, regenerated `sdk.md`.

## Testing strategy

- **Unit:** tone palette/aria (string render, no happy-dom mount — consistent with the lightened nav-badge tests), rollup priority, provider winning-severity logic, `/summary` route counts.
- **Manual:** imitation-crab — seed `blocked` + `review` tasks (task JSON under the tasks store), watch the red count, unblock → amber, clear → hidden; collapse sidebar → red dot.
- No e2e.

## Boundaries

**Always:** run `bun test --isolate` for touched files; update `.claude/knowledge/plugin-system.md` when the tone API changes; regenerate `sdk.md`.

**Never:** add multi-color badges; couple the badge to the agent filter; add a second EventSource (reuse `taskboardVersion`); touch `bakin-bits-official`; introduce backwards-compat shims for the tone enum.

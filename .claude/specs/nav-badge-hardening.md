# Spec: Nav-badge infrastructure hardening

Branch: `feat/nav-badge-hardening` (bakin) + a follow-up branch in `bakin-bits-official`.
Follow-up to #265 (infra), #40 (messaging adopter), #377 (Tasks adopter + `error` tone).

## Objective

Harden the nav-badge infrastructure now that it has two adopters (messaging, Tasks). Three things, surfaced by the #377 code review:

1. **Idempotent `setNavBadge`** — make a `set` with an identical `{count, tone}` a no-op, so the public API doesn't rebuild the badge snapshot / notify subscribers on redundant calls.
2. **Shared `useNavBadge` hook** — the two adopters' providers contain identical `useEffect → setNavBadge` glue that has already drifted. Extract the minimal, refresh-agnostic part into `@makinbakin/sdk/hooks` so both consume it and future adopters (e.g. Health) get it for free.
3. **Test headroom** — the happy-dom nav-badge component tests mount React trees; the full `bun test --isolate` suite sits near a Bun segfault threshold. Convert them to `renderToStaticMarkup` (string output, no DOM mount) to cut that file's footprint.

**Target users:** plugin authors writing badge providers (one-liner instead of boilerplate) and the maintainer (less drift, idempotent API, more test headroom). No user-facing behavior change.

## Scope

### bakin PR — `feat/nav-badge-hardening`

**Workstream 1 — idempotent `setNavBadge`** (`packages/sdk/src/register.ts`)
- In the non-null branch of `setNavBadge`, before `plugin.set(navItemId, badge)` + `bumpBadges()`, compare against the current value and return early if `count` and `tone` are equal (treating missing `count`/`tone` consistently). Null/clear branch already early-returns when absent — leave it.
- Rationale: public-API idempotency that protects any direct caller; defense-in-depth with the hook's value-keying.

**Workstream 2 — `useNavBadge` hook** (`src/hooks/use-nav-badge.ts` *(new)*, re-exported via `packages/sdk/src/hooks/index.ts`)
- Signature: `useNavBadge(pluginId: string, navItemId: string, badge: NavBadge | null): void`.
- Calls `setNavBadge(pluginId, navItemId, badge)` inside a `useEffect` keyed on a stable serialization of the badge value (`count` + `tone`), so the effect fires only when the badge actually changes — not on every render (the `badge` object is recreated each render).
- Imports `setNavBadge` from `@makinbakin/sdk` (root); no fetch, no refresh logic — refresh stays in each plugin's own summary hook.
- Does NOT auto-clear on unmount — plugin teardown is already handled by `unregisterPlugin`; clearing on unmount would cause flicker on dev hot-reload.

**Workstream 3 — Tasks migration** (`plugins/tasks/components/tasks-badge-provider.tsx`)
- Replace the `useEffect → setNavBadge` block with `useNavBadge('tasks', 'tasks', badge)`. `useTaskSummary` and the winning-severity derivation stay.

**Workstream 4 — test lightening** (`tests/components/nav-badge.test.tsx`)
- Convert the `NavBadge` / `NavBadgeDot` render assertions from `@testing-library/react` `render` (happy-dom mount) to `renderToStaticMarkup` (HTML string). Assert on the markup string (testid, count text, tone class). `navBadgeAriaSuffix` tests are already pure — leave them.

**Workstream 5 — docs**
- `.claude/knowledge/plugin-system.md` — document `useNavBadge` as the recommended provider glue + the `setNavBadge` idempotency guarantee.
- `docs/src/content/docs/extending/plugins/client-ui.md` — show the provider using `useNavBadge` (simpler than the raw `useEffect`).
- `docs/src/content/docs/reference/generated/sdk.md` — regenerate (`bun run docs:generate`) so `useNavBadge` appears under hooks.

### bakin-bits-official PR (follow-up, after bakin merges + SDK vendor-sync)

- Vendor-sync: add `useNavBadge` to `test-sdk/hooks.js` (runtime stub) and the `@makinbakin/sdk/hooks` module in `types/sdk-ambient.d.ts`.
- Migrate `plugins/messaging/components/plans-badge-provider.tsx` to `useNavBadge('messaging', 'messaging-plans', badge)`. `usePlansSummary` (with its SSE refresh) stays.
- Update its provider test.

### Out of scope

- A fuller fetch-owning `useNavBadgeProvider` (rejected: would force messaging's SSE refresh into a `refreshDeps` mold — leaky). The summary hooks legitimately differ and stay per-plugin.
- Auto-clear-on-unmount in `useNavBadge` (unregisterPlugin handles teardown).
- Migrating other plugins / new adopters (Health) — separate work.
- Broader `bun test --isolate` suite restructuring — only the nav-badge component test is lightened here.

## Acceptance criteria

- ✅ `setNavBadge` with an identical `{count, tone}` does not call `bumpBadges()` (no snapshot rebuild, no subscriber notification) — verified by a test that subscribes and asserts no tick on a redundant set.
- ✅ `useNavBadge` calls `setNavBadge` once on mount and again only when the badge value changes; a re-render with an equal-value badge does not re-call.
- ✅ `TasksBadgeProvider` behaves identically (red blocked count → amber review → cleared) using `useNavBadge`; existing provider tests still pass (adjusted to the hook).
- ✅ `nav-badge.test.tsx` uses `renderToStaticMarkup`, no happy-dom mount; same assertions hold.
- ✅ `bun run typecheck` clean; touched-file tests green.
- ✅ Docs updated; `useNavBadge` in the generated SDK reference.
- ✅ (bits PR) messaging badge unchanged in behavior, now via `useNavBadge`.

## Design decisions (from kickoff)

| Decision | Choice | Why |
|---|---|---|
| PR split | One bakin PR (3 bakin workstreams) + follow-up bits PR | Cohesive theme; messaging is cross-repo and needs the SDK vendor-synced first (mirrors #265→#40). |
| Helper shape | Minimal `useNavBadge(pluginId, navItemId, badge)` | Shares only the identical, refresh-agnostic glue; no leaky abstraction over the two refresh models; composes with any adopter. |
| Equality guard | Keep, as public-API idempotency | Cheap; protects any direct caller; defense-in-depth with the hook's value-keying. |
| Unmount behavior | No auto-clear | Teardown handled by `unregisterPlugin`; avoids hot-reload flicker. |
| Test lightening | `renderToStaticMarkup` for nav-badge component tests | Removes happy-dom mounts; cuts the file's contribution to the suite's memory peak. |

## Architecture impact

- `setNavBadge` gains an equality short-circuit — externally observable only as "fewer redundant ticks." No signature/shape change.
- New public hook `useNavBadge` in `@makinbakin/sdk/hooks` — additive surface. Becomes the documented way to wire a badge provider; the raw `setNavBadge` stays public for non-React/edge callers.
- Both adopters' providers shrink to a `useNavBadge(...)` call; the genuinely-different part (summary fetch + refresh) stays per-plugin.

## Commit strategy

### bakin PR — 5 commits, each independently revertable, each with tests

1. **`feat(sdk): idempotent setNavBadge`** — equality guard in `register.ts` + a `tests/sdk/register.test.ts` case (redundant set → no `subscribeNavBadges` tick; changed value → tick).
2. **`feat(sdk): useNavBadge hook`** — `src/hooks/use-nav-badge.ts` + barrel export + a hook test (mount calls once; equal-value re-render no-ops; changed value re-calls). Mocks `setNavBadge`.
3. **`refactor(tasks): adopt useNavBadge`** — `tasks-badge-provider.tsx` uses the hook; update `tasks-badge-provider.test.tsx` (assertions unchanged in spirit — `setNavBadge` still called with the right payloads).
4. **`test(host): lighten nav-badge component tests`** — `nav-badge.test.tsx` → `renderToStaticMarkup`.
5. **`docs: useNavBadge + setNavBadge idempotency`** — knowledge + client-ui + regenerated sdk.md.

### bits PR — 2 commits (opens after bakin merges + SDK published/vendored)

1. **`chore(sdk): vendor useNavBadge for tests`** — `test-sdk/hooks.js` + `types/sdk-ambient.d.ts`.
2. **`refactor(messaging): adopt useNavBadge`** — `plans-badge-provider.tsx` + its test.

## Testing strategy

- **Unit:** `setNavBadge` idempotency (subscribe + assert tick count); `useNavBadge` (mount/equal/changed) via a tiny null-rendering test component with `setNavBadge` mocked; the migrated Tasks provider test; the lightened `nav-badge.test.tsx` (string assertions).
- **Manual:** imitation-crab — confirm the Tasks badge still behaves (blocked red → review amber → clear) after the migration; confirm no regression in messaging (after the bits PR).
- No e2e.

## Boundaries

**Always:** `bun test --isolate` for touched files; update `.claude/knowledge/plugin-system.md` when the SDK hook surface changes; regenerate `sdk.md`.

**Never:** build the fuller fetch-owning helper; auto-clear badges on unmount; couple `useNavBadge` to a specific refresh model; touch `bakin-bits-official` in the bakin PR; add compat shims for the pre-hook provider shape.

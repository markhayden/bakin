# Spec: Health nav badge (failing checks)

Branch: `feat/health-nav-badge` (bakin, single-repo).
Builds on: #265 (nav-badge infra), #377 (`error` tone), #383 (`useNavBadge` hook).

## Objective

Show a red `error` badge on the **Health** nav item carrying the count of failing doctor checks, so a genuinely-broken state (runtime down, service/search failure) is visible from any page without opening Health. Third adopter of the nav-badge infra — and the canonical use of the `error` tone.

The interesting part is the **refresh signal**: Health's doctor results are cached server-side and refreshed by the watchdog cron, with no per-update SSE event that the existing adopters' patterns (Tasks `taskboardVersion`, messaging file SSE) could ride. But `runDiagnostics()` already calls `appendAudit('doctor.run', …)` on every run (startup, interval, on-demand), and audit entries already broadcast over SSE and reach the client (`use-sse.ts` → content-store). We turn that into a reactive signal.

**Target users:** the single Bakin user (ambient "something is broken" indicator) and future plugin authors (a clean reusable `doctorVersion` signal).

## Scope

### In scope

**Workstream 1 — `doctorVersion` SSE signal (host)**
- `src/hooks/use-content-store.ts` — add `doctorVersion: number` to state (init `0`) and a `bumpDoctor: () => void` action, mirroring `taskboardVersion` / `bumpTaskboard`.
- `src/hooks/use-sse.ts` — in the `data.type === 'audit'` handler, when `entry.event === 'doctor.run'`, call `bumpDoctor()` (in addition to the existing `appendAuditEntry`). Add `bumpDoctor` to the effect deps.

**Workstream 2 — Health badge (plugin)**
- `plugins/health/hooks/use-health-summary.ts` *(new)* — fetch `GET /api/plugins/health/summary`, read `doctor?.summary?.errors ?? 0`; refetch on mount and whenever `useContentStore(s => s.doctorVersion)` changes (no new EventSource). Returns `{ errors: number }` (or `null` until first load). Log fetch failures at debug, keep last good value (matches `use-task-summary`).
- `plugins/health/components/health-badge-provider.tsx` *(new)* — background component (renders `null`). Derives `badge = errors > 0 ? { count: errors, tone: 'error' } : null` and calls `useNavBadge('health', 'health', badge)`. **Errors only** — warnings never badge (many `warn` conditions are steady-state per install: search disabled, mcporter absent, plugin-assets, restart-recovery — an amber badge would be permanently lit and ignored).
- `plugins/health/client.tsx` — add `slots: { 'nav-badge-providers': HealthBadgeProvider }` to the existing `registerPlugin` call.

**Workstream 3 — docs**
- `.claude/knowledge/plugin-system.md` — note Health as the third adopter, and document the `doctorVersion` content-store signal (rides the `doctor.run` audit SSE) alongside `taskboardVersion`.

**Tests**
- `tests/components/use-health-summary.test.tsx` *(or co-located)* — mock fetch + `useContentStore`; assert it reads `doctor.summary.errors`, refetches when `doctorVersion` bumps, handles missing `doctor`/error path → 0.
- `tests/components/health-badge-provider.test.tsx` — mock `use-health-summary` + `useNavBadge` (spy); assert errors>0 → `{count, tone:'error'}`, errors=0 → null, pre-load → null, transition.
- `tests/.../use-sse` or content-store test — assert a `doctor.run` audit bumps `doctorVersion` (and a non-doctor audit does not). Follow the existing use-sse/content-store test setup.

### Out of scope

- Warnings in the badge (decided: errors-only).
- A dedicated count endpoint (reuse the cheap in-memory `/summary`).
- `errors1h` / usage-derived errors (badge reflects doctor check failures only).
- Auto-clear on unmount (handled by `unregisterPlugin`).
- Migrating other plugins; the deferred `count:0`/`navBadgeKey` items.

## Acceptance criteria

- ✅ Health nav item shows a red badge with the count of `status === 'error'` doctor checks when ≥1 exists; cleared at zero.
- ✅ Warnings never produce a badge.
- ✅ Badge refreshes within ~1 render of a `doctor.run` (startup / watchdog interval / on-demand `/doctor`) via `doctorVersion` — no new EventSource, no poll, no cron/heartbeat coupling.
- ✅ `doctorVersion` bumps only on `doctor.run` audit events, not on other audits.
- ✅ Uses the shared `useNavBadge` hook (no hand-rolled `setNavBadge` effect).
- ✅ `bun run typecheck` clean; touched-file tests green.
- ✅ Manual (imitation-crab): with a failing check seeded, Health shows a red count; once it clears (or all pass), the badge clears.

## Design decisions (from kickoff)

| Decision | Choice | Why |
|---|---|---|
| Refresh signal | `doctorVersion` counter in the SSE content-store, bumped on `doctor.run` audit | Rides the existing audit SSE (no new broadcast/poll); reactive value mirrors `taskboardVersion`; reusable; single SSE connection. |
| Badge scope | Errors only (red), no warnings | Many `warn` conditions are steady-state → amber would be permanent banner-blindness; errors are rare + actionable. |
| Data source | Reuse `GET /summary`, read `doctor.summary.errors` | Already a cheap in-memory aggregate; adding a count endpoint is redundant surface (unlike Tasks, whose board fetch was heavy). |
| Hook | Shared `useNavBadge` | Consistent with Tasks/messaging; idempotent + value-keyed. |

## Architecture impact

- Adds a reusable `doctorVersion` reactive signal to the SSE content-store — generalizes "doctor ran" for any future consumer, fed by the audit event that already crosses SSE. No new server broadcast, no new endpoint.
- Health becomes the third nav-badge adopter, validating the infra for a **cron/cache-backed** data source (Tasks = file/SSE, messaging = file/SSE; Health = audit-event-driven cache).
- No SDK API change (`doctorVersion` is internal content-store state; `useContentStore` export shape unchanged) — so no `sdk.md` regeneration.

## Commit strategy

Three commits, each independently revertable, each with tests:

1. **`feat(host): doctorVersion SSE signal`**
   - `use-content-store.ts` (`doctorVersion` + `bumpDoctor`), `use-sse.ts` (bump on `doctor.run` audit).
   - Test: a `doctor.run` audit bumps `doctorVersion`; a non-doctor audit doesn't.
   - Reusable infra; no Health code yet.

2. **`feat(health): nav badge for failing checks`**
   - `use-health-summary.ts`, `health-badge-provider.tsx`, `client.tsx` slot wiring.
   - Tests: summary hook (reads errors, refetch on `doctorVersion`, missing-doctor → 0) + provider (errors→red, zero→null, transitions).

3. **`docs: Health nav badge + doctorVersion signal`**
   - `.claude/knowledge/plugin-system.md`.

## Testing strategy

- **Unit:** content-store/use-sse `doctorVersion` bump; the summary hook (mock fetch + `useContentStore`); the provider (mock the hook + `useNavBadge`).
- **Manual:** imitation-crab — induce a failing check (e.g. stop the runtime / seed an error condition), confirm a red count appears on Health, clears when resolved; confirm it updates on the next `doctor.run` without reload.
- No e2e.

## Boundaries

**Always:** `bun test --isolate` for touched files; update `.claude/knowledge/plugin-system.md` for the new signal/adopter.

**Never:** poll or add a cron/heartbeat for the badge; badge on warnings; add a redundant count endpoint; auto-clear on unmount; add a second EventSource (reuse `doctorVersion`).

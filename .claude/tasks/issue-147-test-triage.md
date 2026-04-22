# Issue #147 — Vitest migration triage

Phase A runs the full Vitest suite on Bun. Categorize each file that depends on Next.js-specific behavior so later phases know what to touch.

Baseline: **2983 passing, 1 skipped** on Bun (tested at TA6 after the TA4 `bun:sqlite` port).

## Category 1 — Unchanged (pass as-is on Bun, no Next.js coupling)

~90% of the suite. No action required. These files use plain vitest + jsdom + React Testing Library and never import from `next/*` or mock its types.

## Category 2 — Adjust mocks (Phase B/C when the route/page they target migrates)

Files mock `next/navigation` (`useRouter`, `useParams`, `usePathname`). After TC25 rewires `@bakin/sdk/hooks` to TanStack Router's equivalents, these mocks need to be rewritten to mock the SDK hook paths directly (or use TanStack's test utilities).

**8 files** — all mock `next/navigation`:

| File | Notes |
|------|-------|
| `tests/plugins/projects/project-grid.test.tsx` | Mocks `useRouter().push/replace` |
| `tests/plugins/messaging/calendar-local-filter.test.tsx` | Mocks `useRouter`, `useSearchParams`, `usePathname` |
| `tests/plugins/messaging/brainstorm-consumer.test.tsx` | Same as above |
| `tests/components/kanban-dnd.test.tsx` | Mocks `useRouter`, `useSearchParams`, `usePathname` |
| `tests/plugins/workflows/workflows-page.test.tsx` | Mocks `useRouter`, `useSearchParams`, `usePathname` |
| `tests/plugins/team/agent-detail-tabs.test.tsx` | Mocks `useRouter`, `useSearchParams`, `usePathname` |
| `tests/plugins/schedule/schedule-page.test.tsx` | Mocks `useRouter`, `useSearchParams`, `usePathname` |
| `tests/plugins/assets/assets-page.test.tsx` | Mocks `useRouter`, `useSearchParams`, `usePathname` |

**Action in TC25/TC27:** when `@bakin/sdk/hooks` re-exports point at TanStack Router equivalents, replace `vi.mock('next/navigation', ...)` with `vi.mock('@bakin/sdk/hooks', ...)` mocking only the functions each test uses.

## Category 3 — Rewrite (Phase B/C)

**0 files currently.** No tests directly exercise Next.js route module behavior (`route.ts` imports). Test coverage for API routes happens through handler function calls, which port cleanly when TB2-TB17 move `route.ts` → `packages/host/src/api/*.ts`.

Watch for this category to emerge during Phase B if any test asserts behavior specific to Next.js's `NextResponse` vs. plain `Response` (e.g. header shape, status cookies).

## Category 4 — New tests (added during later phases)

| Test | Phase | Purpose |
|------|-------|---------|
| Binary smoke tests | G | `bakin version`, `start/stop` lifecycle, SIGTERM handling |
| React-instance identity assertion | D | Shell's `React` and plugin-loaded `React` are reference-equal |
| Plugin build-on-install | E | Source-only fixture → `Bun.build()` in-binary → `dist/` appears |
| End-to-end user plugin lifecycle | F | Install → manifest refresh → client.mjs dynamic import → nav/page/slot register → remove |

## Infrastructure changes already applied in Phase A

- `bun:sqlite` alias in `vitest.config.ts` → `tests/shims/bun-sqlite.ts` (re-exports better-sqlite3 for tests). Runtime uses native `bun:sqlite`; tests use better-sqlite3 via the shim because Vite's module loader doesn't resolve `bun:` protocol.
- `bun-env.d.ts` declares minimal `bun:sqlite` module surface. Avoids pulling in `bun-types` package which would globally augment `typeof fetch`.
- `tsconfig.json` adds `"types": ["node"]` to restrict type auto-inclusion. Prevents transient `bun-types` under `node_modules/.bun/` from being picked up by `tsc`.

## Summary

- **Category 1 (unchanged):** ~217 test files
- **Category 2 (adjust mocks in TC25/TC27):** 8 files
- **Category 3 (rewrite):** 0 files
- **Category 4 (new):** 4 tests to add in Phases D/E/F/G

Zero migration-blocking test issues as of Phase A end. Vitest runs cleanly on Bun; the only Bun-related test infrastructure (bun:sqlite shim + type declarations) has landed.

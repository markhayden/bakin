# Dependency sweeps

How Bakin moves its dependencies, and the couplings that make a "routine bump"
non-routine. First executed as issue #760 (spec
`.claude/specs/dependency-sweep-760/`). Read this before touching
`package.json`, `docs/package.json`, or `packages/adapter-pi/package.json`.

## 1. Order and gate

One PR per package group, **sequential**, each cut from merged `main`, in a
dedicated worktree so the live 3737 server keeps serving `main`. One commit per
package inside a PR; the squash merge is the rollback unit on `main`.

Order that worked (#760): housekeeping + minor batch → zod → TypeScript → ESLint
→ react + ink → base-ui → lucide → small isolated majors → sharp → vite/vitest/
storybook → playwright → docs site → Pi SDK → Bits companion. Toolchain first so
later PRs are gated by the final toolchain; the live-runtime SDK last.

Gate per PR (run in this order, one suite at a time — never two full suites
concurrently):

```bash
bun install && bun run typecheck && bun run lint && bun run check:cycles && bun run lint:home-bypasses
bun run test                       # full suite: zero act warnings, completeness
bun run build:host && bun run ui:conformance --quick   # --full for browser-dep PRs
bun run build                      # PRs touching compile externals (sharp, pi, react/ink)
bun run docs:check                 # docs-site PRs
```

Then CI green → squash merge → fast-forward the live checkout, **`rm -rf node_modules && bun install`**
(bun's isolated store keeps stale nested links across lockfile changes — a plain
`bun install` left the MCP SDK on the old zod after PR 2), restart `bakin dev` on
3737, verify `GET /api/plugins/manifest` is 200.

Targets are **latest on the day the PR is cut**. Nothing is forced past a
declared peer range (`overrides` is banned for this purpose); a package that
cannot move cleanly is deferred with an issue (§3).

## 2. Coupling ledger

| Coupling | Rule |
|---|---|
| `ink` ↔ `react` | ink 8 needs react ≥19.3 — bump react first, same PR |
| `react-dom`/`@types/react*` ↔ `react` | move the four together |
| `zod` minor ↔ Bits plugins ↔ published SDK | zod 4 brands schema types with the literal minor; the SDK's public types expose zod → ONE minor everywhere, **tilde pin**, Bits companion PR in lockstep |
| `@earendil-works/pi-ai` ↔ `pi-coding-agent` | lockstep; two pi-ai copies break the compiled-binary OAuth module registration (`bun-static-modules.ts`, #886) |
| `sharp` devDep ↔ `packages/core/src/media/pin-data.ts` | regenerate the pin (`scripts/generate-media-pin.ts`) whenever the devDep moves; runbook in `media-pipeline.md` |
| `playwright` ↔ canonical image | `scripts/ui/canonical-playwright.mjs`, `.github/workflows/ui-visual.yml` (×5), `tests/ui/architecture/visual-harness.test.ts`; every snapshot re-renders in the new image → own PR |
| `@vitest/browser-playwright` ↔ `vitest` | exact version lock |
| `@storybook/addon-vitest` ≥10.6.1 ↔ `vitest` 5 | 10.6.0 does not admit vitest 5 |
| `@astrojs/starlight` ↔ `astro` ↔ `@astrojs/react` ↔ vite | 0.42 needs astro ≥7.2.10 needs vite 8; `@astrojs/react` 7 needs astro 7 |
| `@types/bun` ↔ `.bun-version` | same minor line as the pinned runtime |
| `typescript` <6.1 ↔ `typescript-eslint` 8.x | TS 7 blocked (see §3) |
| `@happy-dom/global-registrator` ↔ `happy-dom` core ↔ Base UI | registrator pulls core by caret; core ≥20.12 ships `getAnimations`, which flips Base UI closes to async — the suite runs with `globalThis.BASE_UI_ANIMATIONS_DISABLED = true` (`tests/setup.ts`) and a teeth test pins it; bisect the core with `overrides` + `rm -rf node_modules` per probe (`test-suite-health.md § Toolchain`) |
| browser deps ↔ `packages/host/src/api/_embedded-assets-static.ts` | vendor chunk hashes change → regenerate (`build:host` + `build:assets-manifest`) and commit in the same PR |

## 3. Peer-blocked / deferred ledger

| Package | Blocked by | Re-check when |
|---|---|---|
| typescript 7.x | no compiler API until 7.1 (nine `scripts/ui/*` + `scripts/docs/lib/sdk-reference.ts` use it); typescript-eslint peer `<6.1.0` | TS 7.1 ships; typescript-eslint widens its peer |
| bun 1.4.x | not a peer block — the #755 TDZ regression was 1.3.14's and is fixed upstream in 1.4.0; the isolation matrix in `test-suite-health.md § Toolchain` must be re-run first | before any repin |
| eslint-plugin-react | removed in #760 (zero rules were enabled; broken at runtime on ESLint 10; unmaintained). React lint coverage is a separate decision (`@eslint-react/eslint-plugin`) | if we want React lint rules |

## 4. Unused-dependency audit

```bash
bun scripts/audit-unused-deps.ts            # table + deletion candidates
bun scripts/audit-unused-deps.ts --check    # exit 1 if any candidate
```

Counts quoted references in code/config files, bins invoked from `package.json`
scripts, and markdown mentions (reported, never counted). `@types/x` follows
`x`; `@types/bun` is a runtime global. Run it at the start of every sweep;
delete first, then bump — nobody should spend a regression pass on dead weight.
`#760` found `nodemailer`, `@types/nodemailer`, `@tanstack/router-devtools`.

## 5. Per-PR log (#760)

| PR | What moved | Surprises |
|---|---|---|
| 1 | removals; happy-dom 20.14.5; minor/patch batch | happy-dom 20.12.0 added the Web Animations API → Base UI closes went async → 2 deterministic failures + a wedged worker on the first full run. Fixed in the harness with Base UI's `BASE_UI_ANIMATIONS_DISABLED` switch + teeth test. Bisect lesson: wipe node_modules between `overrides` probes. cron-parser <5.6 silently skipped the DST spring-forward day for a daily job — the old test had encoded the bug; 5.10.1 fixed a real scheduler miss. Worktrees need `bun run build:plugins` before `build:assets-manifest` or the manifest silently drops every plugin asset. |
| 2 | zod ~4.3.0 → ~4.6.5 | Stale nested `zod@4.3.6` lock entries under MCP SDK / eslint-plugin-react-hooks did not re-resolve on `bun install` or `bun update zod`; deleting the three lines and reinstalling collapsed them onto the root copy. zod is bundled THREE times in the browser (SDK shared chunk, health, workflows) with all locales — 4.6 adds ~122 KB to each; ratchet regenerated, externalization filed as #948. **After any hand edit to `bun.lock`, `rm -rf node_modules` before trusting a test run** — the isolated store kept the MCP SDK's nested `zod` link on 4.3.6, and a 4.6.5 schema run through 4.3.6's JSON-Schema converter crashed every MCP tool call (`ctx.deferred.push`). zod 4.4+ nests a union member's issues under one `invalid_union` issue (`errors[][]`, message "Invalid input") — code that matched issue *messages* for `Unrecognized key` went blind; the workflows health check now walks nested issues by `code`. CI: the chromium behavior lane timed out once on the multi-navigation workflow-recipe test (30 s budget, firefox/webkit green) — rerun green; treat a single-lane timeout there as a flake first. |
| 3 | typescript 5.9.3 → 6.0.3 | The only new diagnostics were 84 × TS2882: TypeScript 6 checks side-effect imports by default (`noUncheckedSideEffectImports`), and nothing declared `*.css`. One ambient `declare module '*.css'` in `bun-env.d.ts` (next to `*.md`) fixed all of them. typescript-eslint 8.59 already accepts `<6.1`; docgen (Storybook), the seven design-system ratchets and `docs:generate` all run on 6.0. TS 7 stays deferred (no compiler API until 7.1). **Author-facing:** the published-SDK consumer test (reference plugin compiled with `tsc`) hit the same two defaults — `types: []` (so `bun:test` stopped resolving) and unchecked `*.css` side-effect imports. Fixed at the source: the SDK's `./styles.css` export now carries a `types` condition → `styles.css.d.ts` (empty module), and the scaffold + reference plugin ship `env.d.ts` (`declare module '*.css'`) and `types: ["bun"]`; scaffold pins typescript ^6.0.3 and zod ~4.6.5. Bits `_template` needs the same in the companion PR. |
| 4 | eslint 9.39.4 → 10.12.0; typescript-eslint 8.59 → 8.71; eslint-plugin-react REMOVED | eslint-plugin-react was registered with zero rules enabled (both `react/*` entries were `off`), is broken at runtime on ESLint 10 (`getFilename is not a function`) and unmaintained — deleted, no replacement. ESLint 10 produced zero new findings; the same file set is linted (verified by diffing `-f json` output between 9 and 10). Three stale `eslint-disable` directives (rules that are off) removed while here. |
| 5 | react/react-dom/@types 19.2.4 → 19.3.0 (root + docs); ink 7.0.2 → 8.0.0 | React 19.3: zero act warnings, react-dom vendor +29 KB. ink 8: tests and the TUI gallery were clean, but `bun build --compile` failed — `ink/build/devtools.js` statically imports `react-devtools-core`, an optional peer ink 8 no longer pulls in (ink 7's lockfile happened to carry it). Externalizing it is NOT an option: bun compiled binaries resolve externals eagerly at boot even behind a guarded dynamic import (the binary died on `--help`). Fix: declare `react-devtools-core` as a devDependency so it bundles as before (+0.7 MB). **Rule:** after any ink/React bump, run `bun run build` AND execute the compiled binary — the suite never loads the compiled bundle. |

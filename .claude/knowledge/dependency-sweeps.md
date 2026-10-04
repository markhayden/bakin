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

Then CI green → squash merge → fast-forward the live checkout, `bun install`,
restart `bakin dev` on 3737, verify `GET /api/plugins/manifest` is 200.

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
| 1 | removals; happy-dom 20.14.5; minor/patch batch | happy-dom 20.12.0 added the Web Animations API → Base UI closes went async → 2 deterministic failures + a wedged worker on the first full run. Fixed in the harness with Base UI's `BASE_UI_ANIMATIONS_DISABLED` switch + teeth test. Bisect lesson: wipe node_modules between `overrides` probes. |

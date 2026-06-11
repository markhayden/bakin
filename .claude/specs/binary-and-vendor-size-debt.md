# Spec: Binary & Vendor Size Debt (#424 slim + #422)

## Status

Approved (2026-06-10). Companion plan:
`.claude/specs/binary-and-vendor-size-debt-plan.md`.

Plan-phase experiments resolved the two open mechanisms (2026-06-10):

- **Chunk naming:** Bun rejects non-hashed chunk names on collision
  ("Multiple files share the same output path") — chunks are
  `sdk-shared-[hash].js`. Churn in the regenerated
  `_embedded-assets-static.ts` is acceptable: `build-vendors.ts:37` wipes
  the vendor dir each build (no stale-chunk accumulation) and
  `build-binary.ts` regenerates the manifest before every compile (binaries
  always self-consistent).
- **Server-graph attribution:** `bun build --metafile` exists natively — no
  esbuild devDep. Verified against `server.ts`: react-devtools-core 608 KB,
  iconv-lite 315 KB (confirmed bundled via MCP SDK's express), pdfjs-dist
  942 KB, ink+react-reconciler+yoga-layout ~1.07 MB, zod 700 KB.
- **Split-build dry run:** 9 entries + `--splitting` → ~945 KB total vs
  1.55 MB today (~600 KB / 39% saved). `export *` shim entries are safe (no
  SDK entry has a default export).

Related issues:

- #424: Audit optional heavy server dependencies in compiled binaries — **slim scope** (see Verdict)
- #422: Consolidate SDK vendor bundles to reduce duplicate browser payload — **full scope, via code splitting**

## Objective

Reduce shipped-byte tech debt on two fronts without breaking the
self-contained binary contract or the `@makinbakin/sdk/*` plugin contract:

1. **PR1 (#424 slim):** permanent size-measurement tooling, removal of
   genuinely dead dependencies, and an honest keep/remove decision doc that
   closes #424. **No optionalization** — fetch-on-demand or feature-gated
   dependencies are explicitly out of scope (they recreate the hidden
   runtime-dependency failure mode #267 exists to remove).
2. **PR2 (#422):** deduplicate the 9 SDK vendor bundles by building all SDK
   entrypoints in a single `Bun.build` call with `splitting: true`, keeping
   the import-map specifier→URL contract byte-for-byte identical.

## Ground truth (verified 2026-06-10)

These findings supersede the stale numbers in both issue bodies:

- Binaries: `bakin-darwin-arm64` 74 MB, linux ~113 MB. The issue's ~3 MiB
  optionalization ceiling is ~3-4% — not worth the contract risk.
- `pdf-parse`, `sharp`, and the entire ink TUI stack are **already
  runtime-lazy** (dynamic `import()` at `plugins/assets/lib/content-extractor.ts:90`,
  `plugins/assets/lib/asset-service.ts:90`, `plugins/images/lib/tools.ts:72`,
  TTY-gated module imports in `src/core/cli.ts`). Remaining cost is binary
  bytes only, because `bun build --compile` bundles literal dynamic imports.
- `react-devtools-core` is a direct dependency with **zero import sites** in
  the repo. ink declares it an **optional** peer and guards its use:
  `import.meta.resolve` in try/catch + `DEV === 'true'` gate
  (`node_modules/ink/build/reconciler.js:13-25`), with no warning when
  missing. Because it is installed today, ink's devtools module **and the
  `ws` package** are bundled into every binary.
- `iconv-lite` arrives transitively via `express`/`body-parser`, pulled in by
  `@modelcontextprotocol/sdk` (its `package.json` declares `express ^5.2.1`).
  Not ours to remove; whether it lands in the server bundle is exactly what
  the new tooling must answer.
- `@types/js-yaml` and `@types/nodemailer` sit in `dependencies` (manifest
  hygiene only; types never bundle).
- Vendor bundles are already minified (#422's 3.3 MiB figure is stale).
  Current SDK vendor total: **1.55 MB across 9 files**, with confirmed
  duplication — each subpath bundle externalizes the *other subpaths* but
  inlines shared Bakin core code (shadcn primitives, `@bakin/core/format`,
  agent-store hooks). Estimated 600-900 KB duplicate bytes.
- Instance identity is NOT a blocker for consolidation: both SDK registries
  are `globalThis`-keyed (`__bakinClientRegistry` at
  `packages/sdk/src/register.ts:89`, `__bakinSlotRegistry` at
  `packages/sdk/src/slots/registry.ts:24`).
- Vendor cache headers are `public, max-age=300` (prod) / `no-store` (dev)
  (`packages/host/src/api/_static.ts:89-94`) — deterministic (non-hashed)
  chunk names carry the same negligible staleness risk the fixed `sdk-*.js`
  names already do.
- The embedded-assets generator walks all of `public/vendor/`
  (`scripts/generate-embedded-assets.ts:113`) and
  `assert-production-assets.ts` scans every vendor `.js` — new chunk files
  flow through both automatically. The dev loop rebuilds vendors via the same
  script (`scripts/dev.ts:353`), so it is consolidation-compatible.

## Decisions (interview log, all user-approved)

1. **Scope:** #422 full via code-splitting + #424 slim. Optionalization rejected.
2. **Delivery:** two PRs, #424-slim **first**, so the measurement tooling
   exists before the change it measures.
3. **Size tooling:** one standalone script (`bun run size:report`) covering
   artifact sizes AND a server-bundle dependency breakdown. Not wired into
   the build chain.
4. **Dep hygiene:** remove `react-devtools-core`; move `@types/js-yaml` +
   `@types/nodemailer` to devDependencies — **gated on three-mode
   verification** (binary users, repo users, repo devs). Past removals have
   broken real workflows; if any mode regresses, the dep stays and is
   documented as required.
5. **Regression guard for #422:** structural dedup test (shared module
   appears at most once across SDK vendor output; all 9 entry files exist
   with expected exports). **No byte-budget gate** — budgets rot.

## PR1 — #424 slim: tooling, dead deps, decision doc

### Deliverables

1. `scripts/report-sizes.ts` + `"size:report"` npm script:
   - Artifact sizes: per-file + total for `packages/host/public/vendor/`,
     per-plugin `plugins/*/dist/client.js`, host shell
     `packages/host/dist/main.js`, and `dist/bakin-*` binaries when present.
   - Server-graph breakdown (`--server-graph` flag or always-on section):
     bundle `server.ts` (non-compile, `--target bun`) and attribute output
     bytes to top-level `node_modules` packages; print top contributors.
     Mechanism (Bun.build output analysis vs. esbuild metafile as a devDep)
     is a plan-phase decision — requirement is per-package attribution good
     enough to answer "is express/iconv-lite/ink-devtools in the bundle?".
2. `package.json`: remove `react-devtools-core`; move the two `@types/*`
   packages to devDependencies.
3. `.claude/knowledge/binary-size.md`: keep/remove/optional decision table
   for every dep named in #424 (pdf-parse/pdfjs-dist, sharp, ink stack,
   iconv-lite/express via MCP SDK, zod, react-devtools-core), the
   lazy-loading patterns already in place, how to run `size:report`, and
   baseline numbers.
4. Close #424 with a summary comment (decisions + measured numbers + what
   was intentionally not done and why).

### Acceptance criteria

- `bun run size:report` runs from a clean checkout after `bun run build:host`
  and reports all artifact classes; server-graph section attributes bytes per
  package.
- Three-mode verification of the dep changes:
  - **Binary:** `bun run build` succeeds; compiled binary runs `version`,
    `help`, `doctor` in a TTY; `DEV=true <binary> version` does not crash.
  - **Repo user:** `bun run prestart` chain + server boot smoke.
  - **Repo dev:** `bun run dev` boots clean; `bun run test` passes;
    typecheck passes (@types move).
  - If the compile rejects the `react-devtools-core` removal (bundler follows
    ink's literal `import('./devtools.js')`), the dep is **kept** and
    documented as bundling-required — no workarounds, no patching ink.
- Binary size measured before/after the removal and recorded in the doc.

### Commit strategy (rollback checkpoints)

1. `feat(scripts): add size:report with artifact sizes and server-graph breakdown`
   — pure addition; safe to revert alone.
2. `chore(deps): remove react-devtools-core, move type packages to devDependencies`
   — lands only after three-mode verification; reverting restores manifests
   exactly.
3. `docs(knowledge): add binary-size decision audit (#424)` — docs only.

## PR2 — #422: SDK vendor consolidation via code splitting

### Deliverables

1. `scripts/build-vendors.ts`: build the 9 SDK entrypoints in **one
   `Bun.build` call** with `splitting: true`:
   - Output names for the 9 entry files unchanged (`sdk-index.js`,
     `sdk-ui.js`, …) — the import map in `packages/host/public/index.html`
     is **not modified**.
   - Shared chunks emitted into `public/vendor/` with **deterministic
     names** (no content hashes) so the tracked, generated
     `_embedded-assets-static.ts` doesn't churn per build. If Bun cannot
     name chunks deterministically, fall back to hashed names and accept
     regen churn — flag it in the PR.
   - Externals: `react`/`react-dom`/jsx runtimes and
     `@tanstack/react-router` remain external; the SDK-subpath-to-subpath
     externals are dropped (splitting replaces them).
   - React/router/jsx vendor bundles are untouched.
   - **Stale-output cleanup:** the script must remove previous SDK bundle and
     chunk files from `public/vendor/` before emitting, so dead chunks never
     accumulate into the embedded assets.
2. Regenerated `_embedded-assets-static.ts` (via existing generator).
3. Tests:
   - Structural dedup test: a known shared marker (e.g. a distinctive string
     from a shadcn primitive or `@bakin/core/format`) appears **at most
     once** across all SDK vendor output files.
   - Entrypoint contract test: all 9 specifier files exist and expose the
     expected representative exports (e.g. `registerPlugin` from sdk-index,
     `PluginHeader` from sdk-components, `useQueryState` from sdk-hooks,
     `Slot`/`registerSlot` from sdk-slots).
   - Update any existing test asserting a fixed vendor file list
     (`tests/scripts/generate-embedded-assets.test.ts`).
4. Docs: update the import-map/vendor bullets in `CLAUDE.md` and
   `.claude/knowledge/repo-architecture.md` (and any other
   `.claude/knowledge/` file describing vendor layout); append after-numbers
   to `.claude/knowledge/binary-size.md`.
5. Close #422 with before/after numbers from `size:report`.

### Acceptance criteria

- All 9 `@makinbakin/sdk/*` specifiers resolve in the browser; shell + all
  10 core plugins load; nav items and slots render (registries intact).
- `bun run build` full chain passes including
  `build:assert-production-assets`; compiled binary serves the dashboard
  with the new layout.
- Dev loop: vendor rebuild on SDK edit still triggers reload and works.
- `size:report` shows reduced total SDK vendor bytes and reduced embedded
  asset payload; numbers recorded in PR + knowledge doc. If measured savings
  come in under ~100 KB, stop and flag before merging.
- Full test suite passes.

### Commit strategy (rollback checkpoints)

1. `refactor(build): build SDK vendor bundles in one call with code splitting`
   — the layout change + stale-output cleanup + regenerated embedded-assets
   manifest + any existing-test updates needed to stay green. Reverting this
   single commit restores the per-subpath layout entirely.
2. `test(build): add structural dedup and SDK entrypoint contract tests`
   — guards the new property; revertible independently.
3. `docs: update vendor-layout docs and record size deltas (#422)` — docs only.

## Boundaries

**Always:**
- Three-mode verification (binary / repo user / repo dev) before any
  dependency or build-output change merges.
- Follow testing rules in CLAUDE.md (temp-dir mocks; never touch `~/.bakin`).
- Never `git add -A` after a local build (`stamp-version.ts` rewrites a
  tracked file).

**Ask first:**
- If Bun's `splitting` output proves incompatible with the import-map setup
  in any way (e.g. chunk format issues in the browser).
- If measured #422 savings are below ~100 KB.
- Any scope growth beyond the deliverables above.

**Never:**
- Change the public `@makinbakin/sdk/*` specifier surface or the plugin
  externals contract (`src/core/whiskit/externals.ts`).
- Introduce runtime-fetched dependencies or feature-gated installs.
- Patch or fork ink.
- Modify React/router vendor bundling.

## Commands

- `bun run size:report` — new; artifact sizes + server-graph breakdown.
- `bun run build` / `build:vendors` / `build:assets-manifest` — existing chain, unchanged shape.
- `bun run dev`, `bun run test` — verification.

## Testing strategy

- New: structural dedup test + SDK entrypoint contract test (PR2), plus a
  smoke test for `report-sizes.ts` (runs against a fixture dir, not real
  builds).
- Existing suites must stay green: `tests/scripts/assert-production-assets.test.ts`,
  `tests/scripts/generate-embedded-assets.test.ts`,
  `tests/scripts/vendor-entrypoints.test.ts`, `tests/api/host-static.test.ts`.
- Browser verification for PR2 via the dev loop + `dev:mock` (Imitation
  Crab) — confirm plugins register nav/slots after the layout change.

# Plan: Binary & Vendor Size Debt (#424 slim + #422)

Companion spec: `.claude/specs/binary-and-vendor-size-debt.md` (approved
2026-06-10; all open mechanisms resolved by experiment — see spec Status).

## Dependency graph

```
PR1 (branch chore/binary-size-audit, closes #424)
  T1 size:report tooling ──→ T2 baseline capture ──→ T3 dep cleanup ──→ T4 decision doc
                                                          │
                                  three-mode verification gate
PR1 merged  ═══ CHECKPOINT ═══
PR2 (branch refactor/sdk-vendor-splitting, closes #422)
  T5 split vendor build ──→ T6 dedup + contract tests ──→ T7 docs + size deltas
                │
        full-build + browser verification gate
```

PR2 depends on PR1 only through `size:report` (before/after measurement).
Within each PR, tasks are strictly ordered; each task = one commit = one
rollback checkpoint.

## PR1 — `chore/binary-size-audit`

### T1 — `scripts/report-sizes.ts` + `size:report` script

Vertical slice: script + npm script + unit test, landable alone.

- Artifact section: per-file + total bytes for
  `packages/host/public/vendor/*.js`, `plugins/*/dist/client.{js,css}`,
  `packages/host/dist/main.js`, `dist/bakin-*` (skip sections whose
  artifacts aren't built, with a hint to the build command).
- Server-graph section: `bun build server.ts --target=bun
  --metafile=<tmp>` into a temp outdir (removed afterward), aggregate
  `inputs[*].bytes` per top-level package (handle Bun's
  `node_modules/.bun/<pkg>@<ver>+<hash>/node_modules/<pkg>` store paths and
  scoped packages; group app code by top-level dir). Print full table sorted
  desc + total.
- Aggregation lives in a pure exported function;
  `tests/scripts/report-sizes.test.ts` unit-tests it against a small inline
  fixture metafile (no real build in the test; no content-dir access — pure
  scanner-style test).
- **AC:** `bun run size:report` prints both sections after `bun run
  build:host`; test passes; no new dependencies.
- **Commit 1:** `feat(scripts): add size:report with artifact sizes and
  server-graph breakdown`

### T2 — Baseline capture (no commit)

- Run `bun run build` (full, including binary) on main + branch pre-T3;
  record: binary sizes, vendor totals, server-graph table. Stash numbers
  for T4's doc. Mind the stamp-version trap: never `git add -A` after.
- **AC:** baseline table exists in working notes.

### T3 — Dependency cleanup

- `package.json`: delete `react-devtools-core` from dependencies; move
  `@types/js-yaml` + `@types/nodemailer` to devDependencies; `bun install`
  to refresh `bun.lock`.
- **Three-mode verification gate (all must pass before commit):**
  1. **Repo dev:** `bun run test` green; typecheck green; `bun run dev`
     boots and serves.
  2. **Repo user:** `bun run prestart` chain + server boot smoke.
  3. **Binary:** `bun run build` succeeds; `dist/bakin-darwin-arm64
     version|help|doctor` render in a TTY; `DEV=true dist/bakin-darwin-arm64
     version` exits clean (exercises ink's guarded devtools path with the
     package absent).
- Predecided fallback: if the compile follows ink's literal
  `import('./devtools.js')` and fails, **keep** `react-devtools-core`,
  document as bundling-required in T4, and proceed with only the @types
  move.
- Re-run `size:report` server-graph + binary size; expect
  react-devtools-core to drop from the table (~608 KB source bytes) and the
  binary to shrink accordingly.
- **Commit 2:** `chore(deps): remove react-devtools-core, move type
  packages to devDependencies`

### T4 — Decision doc + close #424

- `.claude/knowledge/binary-size.md`: keep/remove/optional table —
  pdf-parse/pdfjs-dist (keep, runtime-lazy), sharp (keep, runtime-lazy +
  graceful degrade), ink/react-reconciler/yoga-layout (keep, TTY-gated
  lazy), iconv-lite/express (keep, transitive via
  @modelcontextprotocol/sdk, 315 KB measured), zod (keep, core), 
  react-devtools-core (removed — or bundling-required if T3 fallback fired).
  Plus: how to run `size:report`, baseline + post-T3 numbers, and the
  explicit non-goal (no optionalization; #267 rationale).
- **Commit 3:** `docs(knowledge): add binary-size decision audit (#424)`
- Open PR1 (`Closes #424`), body includes before/after table. Run
  `/agent-skills:review`-style self-review before requesting merge.

### ═ CHECKPOINT: PR1 merged before PR2 work begins ═

## PR2 — `refactor/sdk-vendor-splitting`

### T5 — Split SDK vendor build

Vertical slice: build change + regenerated manifest + existing tests green.

- `scripts/build-vendors.ts`:
  - Generate 9 SDK shim entries via the existing `writeEntry` pattern
    (`export * from '<abs path>'`), named `sdk-index.ts` … `sdk-routing.ts`
    so `--entry-naming '[name].[ext]'` yields the current output filenames.
    (Needed because every real SDK entry file is named `index.ts(x)`.)
  - Replace the 9 per-subpath subprocess builds with ONE subprocess:
    `bun build <9 shims> --outdir vendor --target browser --format esm
    --splitting --entry-naming '[name].[ext]'
    --chunk-naming 'sdk-shared-[hash].[ext]'
    --external react --external @tanstack/react-router` (+ `--production`
    per existing flag logic). Drop the SDK-sibling externals.
  - React-family + tanstack-router builds: untouched.
  - NS-import patch: already iterates all `vendor/*.js` flat — chunks are
    covered; no change.
  - Stale-output cleanup: already handled by the existing dir wipe at top.
- Regenerate `_embedded-assets-static.ts` (`bun run build:assets-manifest`)
  and commit it (hashed chunk filenames are tracked content now; expected
  to churn when SDK code changes).
- Update any test asserting a fixed vendor file list
  (`tests/scripts/generate-embedded-assets.test.ts`) to accept
  `sdk-shared-*.js` chunks.
- **Verification gate:**
  - `bun run build` full chain green, incl. `assert-production-assets`.
  - `import.html` import map diff: **empty**.
  - Browser smoke via `bun run dev:mock`: shell loads, all 10 core plugins
    register (nav items present), a slot-rendering page works, no console
    errors. Use Chrome DevTools MCP / browser-testing skill if available.
  - Dev loop: touch an SDK file, vendor rebuild + reload still works.
  - Full test suite green.
- **AC:** vendor SDK total drops to ~945 KB (±, measured by `size:report`);
  all gates pass.
- **Commit 1:** `refactor(build): build SDK vendor bundles in one call with
  code splitting`

### T6 — Dedup + entrypoint contract tests

- Refactor `build-vendors.ts` to export a `buildSdkVendorBundles({ outDir,
  production })` helper (the script calls it; tests call it with a temp
  outDir). Pure build orchestration — no content-dir access, but tests
  still follow CLAUDE.md isolation rules (temp dirs, cleanup in
  `afterAll`).
- `tests/scripts/sdk-vendor-bundles.test.ts`:
  1. **Dedup:** build into temp dir; assert a distinctive marker string
     from a known shared module (pick a unique literal from
     `@bakin/core/format` or a shadcn primitive, verified present in built
     output) appears in **at most one** output file.
  2. **Entrypoint contract:** all 9 `sdk-*.js` files exist; dynamic-import
     representative ones from the temp dir in bun-test (bare `react`
     resolves from repo node_modules) and assert expected exports:
     `registerPlugin` (sdk-index), `PluginHeader` (sdk-components),
     `useQueryState` (sdk-hooks), `Slot` + `registerSlot` (sdk-slots).
     If browser-target bundles prove un-importable under bun-test, fall
     back to static export-name scanning of the bundle text.
- **AC:** new tests pass and fail when splitting is reverted (prove-it:
  verify the dedup test fails against the old per-subpath layout once,
  locally).
- **Commit 2:** `test(build): add structural dedup and SDK entrypoint
  contract tests`

### T7 — Docs + size deltas + close #422

- Update `.claude/knowledge/repo-architecture.md` (vendor layout) and the
  CLAUDE.md "Import map + vendor bundles" bullet to mention shared
  `sdk-shared-*` chunks; sweep `.claude/knowledge/` for other vendor-layout
  mentions (`dev-loop.md`, `plugin-system.md`, `release-pipeline.md`) and
  README/CONTRIBUTING if they describe vendor bundles.
- Append after-numbers to `.claude/knowledge/binary-size.md`.
- **Commit 3:** `docs: update vendor-layout docs and record size deltas
  (#422)`
- Open PR2 (`Closes #422`) with before/after `size:report` output.

## Rollback strategy

- Each commit is independently revertible; PR2 commit 1 alone restores the
  old vendor layout completely (commit 2's tests would then fail and revert
  with it).
- PR boundaries are the coarse rollback units; PR1 and PR2 don't share code
  changes (only the measurement workflow).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Compile fails without react-devtools-core | Predecided: keep + document; only @types move lands |
| Browser chokes on split chunks | Caught by dev:mock browser gate before merge; revert commit 1 |
| NS-import patch needed on a chunk it doesn't match | Patch already covers all flat vendor *.js; dedup test + browser gate catch regressions |
| `export *` shim drops an export | Entrypoint contract test + import-map diff gate |
| Hashed chunk churn in tracked manifest | Accepted (spec); binary builds self-regenerate; never `git add -A` after local builds |
| Measured savings < 100 KB | Dry run already showed ~600 KB; if final differs, stop and flag (spec boundary) |

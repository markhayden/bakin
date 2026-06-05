# Plan: Stop embedding core plugin server bundles (#421)

## Context

The compiled binary embeds every file under `plugins/<id>/dist/` as a servable browser asset — including each core plugin's server bundle (`dist/index.js`, ~2.3 MiB across 10 plugins) and stray server-build artifacts (`plugins/health/dist/SKILL-r49bkmzv.md`). These bytes are dead weight: core plugin server activation uses the static import table (`src/lib/plugin-static-imports.ts`) compiled from source, and the browser only ever fetches `client.js`/`client.css`. Nothing fetches `index.js` over HTTP for any plugin.

Approved spec: `.claude/specs/core-plugin-browser-assets.md`. Decisions locked via interview: allowlist embed filter; 404 guard on the assets route; stop *building* core server bundles; 5 commits refactor-first; one-off Docker binary e2e as the completion gate. Single-user machine, no backwards compat, tech-debt reduction prioritized.

Branch: `perf/421-no-embedded-server-bundles`, PR to `main`.
After approval: copy this plan to `tasks/plan.md` + checklist to `tasks/todo.md` (kickoff workflow artifacts).

## Validated key facts (explored, not assumed)

- `generate-embedded-assets.ts` auto-runs `main()` at module scope (line 212); `build-binary.ts:38` spawns it as a subprocess → `import.meta.main` guard preserves that.
- `slugCounter` is module-level state (line 46) — a real testability bug; two `collectAssets()` calls in one process produce `_1`-suffixed varnames. Must move inside `collectAssets`.
- Tracked generated output has zero `_N` suffixes today → **byte-identical regen in commit 1 is achievable** if collection/readdir order is preserved.
- `tests/api/curated.test.ts` greps the generator *source* for literals (`walk(distDir`, `packages/host/public/globals.css`, …). Keep `walk(distDir` (filter its output, don't replace with file checks) and commit 1 changes none of its assertions.
- `dev.ts:450` already excludes `index.ts` from the dev watcher; rebuild broadcasts use `client.js` mtime with a `Date.now()` fallback — client-less plugins (git, images) are safe.
- `assert-production-assets.ts:37` scans only `dist/client.js`. No build step asserts dist non-emptiness. `git`/`images` have no `client.tsx` → their dist becomes empty; manifest endpoint already omits `clientEntry` for them.
- Nothing in `tests/` asserts core `index.js` IS embedded — commit 2 breaks no existing test.
- `tests/api/plugins-build.test.ts` exercises `buildUserPlugin` (user path) — unaffected by the `serverEntry` flag.
- E2E user-plugin fixture: `tests/fixtures/sample-user-plugin/` (has both `index.ts` + `client.tsx`).

## Commit 1 — `refactor(scripts): extract testable collectAssets/emitManifest from generate-embedded-assets`

**Files:** `scripts/generate-embedded-assets.ts`; `tests/scripts/generate-embedded-assets.test.ts` (new).

- Export `collectAssets(repoRoot: string): AssetSource[]`, `emitManifest(assets, outFile): string`, `main(repoRoot?)`; gate execution behind `if (import.meta.main) main()` (pattern: `scripts/assert-production-assets.ts:60`).
- Move `slugCounter`/`makeVarName` into `collectAssets` as a per-call closure; thread into `walk`.
- Derive `OUT_FILE` from `repoRoot` inside `main`; keep `assertRequiredAssetsExist` on `main`'s path only (so fixture roots can run `collectAssets`).
- Preserve verbatim: collection order (host/dist → public → vendor → plugins/*/dist → data), `walk(distDir`, required-assets literals, `EMBEDDED_ASSET_COUNT` emission.
- New test (fixture temp root, `tests/scripts/` conventions): pre-change behavior — `index.js` IS collected; URL paths exact; `emitManifest` deterministic across two calls (proves the slugCounter fix).

**Verify:** `bun test tests/scripts/generate-embedded-assets.test.ts --isolate` · `bun test tests/api/curated.test.ts --isolate` · regen + `git diff --exit-code packages/host/src/api/_embedded-assets-static.ts` (**byte-identical**; needs dist trees built first) · `bun run test`.

## Commit 2 — `feat(core): embed only browser assets for core plugins (#421)`

**Files:** `scripts/generate-embedded-assets.ts`; `packages/host/src/api/_embedded-assets-static.ts` (regenerated); `tests/scripts/generate-embedded-assets.test.ts` (updated); `tests/architecture/embedded-assets-static.test.ts` (new).

- `CORE_PLUGIN_ASSET_ALLOWLIST = new Set(['client.js', 'client.css'])`; filter the plugin-dist walk output inside the plugin loop; log each skip: `embedded-assets: skip plugins/health/dist/index.js (not in core-plugin allowlist)`.
- Regenerate: imports 42 → 31; plugin entries 23 → 10 (8× client.js, 2× client.css); `SKILL-r49bkmzv.md` key gone.
- Update generator test: allowlist-only collection + stray artifacts skipped.
- New architecture scan (pattern: `tests/architecture/adapter-boundary.test.ts` — `readFileSync` + string assertions on the *tracked* generated file): no `/api/plugins/*/assets/index.js` key, no `SKILL-` key.

**Verify:** both unit/arch tests `--isolate` · `curated.test.ts` still green · regen + `git diff --exit-code` (no drift) · `bun run test`. **Stage files explicitly — never `git add -A`** (tracked generated output; build-stamp trap).

## Commit 3 — `feat(build): skip server entry for core plugin builds`

**Files:** `scripts/dev-build-one-plugin.ts`; `scripts/build-plugins.ts`; `scripts/dev.ts`; `tests/scripts/dev-build-one-plugin.test.ts` (extended).

- `BuildOnePluginOptions.serverEntry?: boolean` (default `true`); wrap the server `bun build` block (lines 61–72) in `if (opts.serverEntry ?? true)`.
- Exactly two callers pass `false`: `build-plugins.ts:29`, `dev.ts:327`. `buildUserPlugin`/whiskit untouched (default true).
- Extend test: `serverEntry: false` → no `dist/index.js`, `client.js` present; existing default cases keep proving the user path emits `index.js`.

**Verify:** `bun test tests/scripts/dev-build-one-plugin.test.ts --isolate` · `bun run build:plugins && ls plugins/*/dist` (client-only; git/images empty; no index.js / SKILL-*) · regen + `git diff --exit-code` (matches commit 2 — proves allowlist and dist now agree) · `bun run test`.

## Commit 4 — `feat(api): refuse to serve plugin server bundles over HTTP`

**Files:** `packages/host/src/api/plugins/assets.ts`; `tests/api/plugins-assets.test.ts` (new).

- After the `parsePath` null-check (400 still wins), before all fallbacks: `if (relPath === 'index.js' || relPath.endsWith('/index.js'))` → 404 `{ error: 'Plugin server bundles are not served' }`.
- New test (handler is directly callable: `get(req, new URL(...))`; mock content-dir **both paths** + logger; temp dir + cleanup): ① index.js 404 with file on disk in content dir; ② 404 with key in embed map (`setEmbeddedAssets`); ③ 404 via repo-cwd fallback; ④ client.js 200 control; ⑤ client.css 200 control.

**Verify:** `bun test tests/api/plugins-assets.test.ts --isolate` · `bun run test`.

## Commit 5 — `docs(knowledge): update plugin/build docs for browser-only embeds`

**Files (verify each, don't assume):** `CLAUDE.md` (line ~27 embedded-assets sentence; "built … into `dist/{index.js, client.js}`" claim); `.claude/knowledge/plugin-system.md` (~line 11 dist contents); `.claude/knowledge/dev-loop.md` (rebuild description + pre-existing `index.ts` watcher exclusion); `.claude/knowledge/repo-architecture.md` (embed mentions); grep sweep `CONTRIBUTING.md`, `docs/plugin-authoring.md`, `README.md`, `docs/src/content/docs/extending/plugins/build.md`.
- Document: allowlist + skip log; `serverEntry` flag; core dist = browser assets only; git/images empty dist is expected; user plugins unchanged.
- Remove `SPEC.md` from repo root in this commit (it was a working artifact) — or move content under `.claude/specs/` per repo convention; decide at execution per what `.claude/specs/` contains.

**Verify:** grep for stale claims (`dist/{index.js`, "embedded" + index.js) · `bun run test`.

## Final gate — Docker binary e2e (spec §6)

Run binary from `/tmp` (cwd outside repo so the repo-disk fallback can't mask embed failures), rig env (`BAKIN_HOME` → rig instance home, `OPENCLAW_HOME` → `dev/openclaw-home`):

1. `bun run build` → record binary size before/after (expect ≈2.3 MiB ↓ raw).
2. `bun run instance up` → rig healthy.
3. `GET /api/plugins/manifest` → 10 core plugins active; `clientEntry` for 8; absent for git/images.
4. `client.js` 200 ×8; `client.css` 200 ×2 (team, workflows); `index.js` 404 for every plugin.
5. Real browser (Chrome DevTools MCP): dashboard loads, sidebar nav populated, zero console errors.
6. `bakin plugins install tests/fixtures/sample-user-plugin` → activates; its client.js serves; its index.js 404; clean remove.
7. Paste full evidence into PR body. PR closes #421.

## Risks already accepted (spec §10)

- Dev overlay loses on-save server-build check for core plugins (already weak: watcher excludes `index.ts`; LSP/restart/binary-compile still catch errors). Isolated in commit 3 for clean revert.
- Future core client emitting hashed assets won't embed — generator logs skips; documented in plugin-system.md.

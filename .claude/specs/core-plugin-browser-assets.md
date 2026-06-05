# SPEC: Stop embedding core plugin server bundles as static browser assets (#421)

**Issue:** https://github.com/markhayden/bakin/issues/421
**Branch:** `perf/421-no-embedded-server-bundles`
**Status:** Implemented (PR for #421)

## 1. Objective

The compiled binary embeds every file under `plugins/<id>/dist/` as a servable
browser asset, including each core plugin's server bundle (`dist/index.js`,
~2.3 MiB across 10 plugins) and stray server-build artifacts (e.g.
`plugins/health/dist/SKILL-r49bkmzv.md`). These bytes are pure dead weight:

- Core plugin **server activation** uses the static import table
  (`src/lib/plugin-static-imports.ts` → `CORE_PLUGIN_IMPORTS`), compiled from
  *source* by `bun build --compile`. `dist/index.js` is never read in binary mode.
- The **browser** only ever fetches `client.js` and `client.css`
  (verified: `PluginHost.tsx`, manifest endpoint). Nothing fetches `index.js`
  over HTTP for core *or* user plugins.

End state: `plugins/<id>/dist/` contains exactly what the browser consumes,
the embed map contains exactly what `dist/` contains, and the assets route
refuses to serve server bundles for any plugin. Binary shrinks ~2.3 MiB raw.

### Decisions (interview log, 2026-06-05)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Embed filter | **Allowlist** `client.js` + `client.css` per core plugin; generator logs every skipped file |
| 2 | HTTP surface | Assets route returns **404 for `index.js`** for all plugins (core + user) |
| 3 | E2E scope | **Full compiled-binary e2e in the Docker rig + real-browser verification** (see §6) |
| 4 | Commits | **5 commits, refactor-first**, each independently revertable (see §7) |
| 5 | Build scope | **Stop building** core plugin server bundles (`serverEntry` flag on `buildOnePlugin`); user plugin builds untouched |
| 6 | E2E artifact | **One-off runbook**; evidence pasted into PR body. No new smoke script |

## 2. Scope

### In scope
1. `scripts/generate-embedded-assets.ts` — refactor for testability
   (export `collectAssets`/`emitManifest`, root-dir parameter), then apply the
   core-plugin allowlist (`client.js`, `client.css`). Log skipped files.
2. Regenerate `packages/host/src/api/_embedded-assets-static.ts`
   (**git-tracked generated output** — regen lands in the same commit as the
   generator change; never `git add -A`).
3. `scripts/dev-build-one-plugin.ts` — add `serverEntry?: boolean` (default
   `true`); core callers (`scripts/build-plugins.ts`, `scripts/dev.ts`) pass
   `false`. Delete stale `dist/` contents as today (`rmSync` already handles it).
4. `packages/host/src/api/plugins/assets.ts` — guard: requests for `index.js`
   → 404 before any disk/embed lookup, all plugins.
5. Regression tests (see §5).
6. Docs sweep (see §8).
7. Docker-instance binary e2e before completion (see §6).

### Out of scope (explicitly fenced)
- The self-contained user plugin builder (#267). `user-plugin-builder.ts`,
  whiskit build/publish, plugin install/upgrade/link: **zero changes**.
  User plugins still build and require `dist/index.js` exactly as before.
- Vendor bundles, host shell embedding, agent-package exclusions in the
  generator (untouched; the agents/ exclusion comment stays).
- No backwards-compat shims of any kind (single-user machine).

## 3. Behavior contract (acceptance criteria)

| Surface | Before | After |
|---------|--------|-------|
| Embed map plugin entries | 23 (10× index.js, 8× client.js, 2× client.css, 1× SKILL-*.md, …) | **10** (8× client.js, 2× client.css) |
| `GET /api/plugins/<core>/assets/client.js` (binary, cwd outside repo) | 200 | **200** (embedded) |
| `GET /api/plugins/<core>/assets/client.css` (team, workflows) | 200 | **200** (embedded) |
| `GET /api/plugins/<any>/assets/index.js` | 200 (leaks server code) | **404** |
| Core plugin activation in compiled binary | static imports | **unchanged** |
| User plugin install → activation → asset serving | works | **unchanged** (route 404s index.js, which nothing fetches) |
| `plugins/<id>/dist/` after `bun run build:plugins` | index.js (+artifacts), client.js, client.css | **client.js, client.css only** (git/images: empty) |
| Dev loop save in `plugins/<id>/` | rebuilds server + client | **rebuilds client only**; HMR unchanged |
| Binary size | baseline | **≈2.3 MiB smaller raw** (recorded in PR) |

Edge cases:
- `git` and `images` have no `client.tsx`: their dist is empty post-build;
  manifest already omits `clientEntry` for client-less plugins — must remain so.
- Dev-mode disk fallback in `assets.ts` (step 3) still serves `client.js`
  rebuilt by the dev loop; the index.js guard sits **before** all fallbacks.
- `tests/api/curated.test.ts` spawns the generator against the real repo —
  must keep passing with the allowlist in place.

## 4. Commands

```bash
bun run test                      # full suite (CI parity)
bun test tests/scripts/generate-embedded-assets.test.ts --isolate
bun test tests/scripts/dev-build-one-plugin.test.ts --isolate
bun run build:plugins             # verify dist contents
bun run build                     # full binary (e2e prerequisite)
bun run instance up               # dockerized OpenClaw rig
```

## 5. Testing strategy

Follows existing `tests/scripts/` fixture patterns (`assert-production-assets.test.ts`).

1. **Generator unit tests** (`tests/scripts/generate-embedded-assets.test.ts`, new):
   temp fixture tree with fake plugin dists containing `index.js`, `client.js`,
   `client.css`, and a stray artifact. Assert: only allowlisted files collected;
   skips logged; host/vendor/public/data walks unaffected; URL paths correct.
2. **Architecture scan** (extend or add under `tests/architecture/`): the
   *tracked generated* `_embedded-assets-static.ts` contains no
   `/api/plugins/*/assets/index.js` key — guards against regenerating with a
   stale generator and committing it.
3. **buildOnePlugin** (`tests/scripts/dev-build-one-plugin.test.ts`, extend):
   `serverEntry: false` → no `dist/index.js`, client assets present; default
   `true` behavior unchanged (user-plugin path).
4. **Assets route guard** (plugin/api tests via existing helpers): `index.js`
   → 404 even when the file exists on disk (user dir + repo fallback);
   `client.js`/`client.css` unaffected.
5. **Existing suites green**: `plugins-build.test.ts` (user plugins),
   `plugin-manifest-embedded.test.ts`, `curated.test.ts`.

All new tests obey the CLAUDE.md mocking rules (content-dir ×2, OpenClaw home,
logger, temp dirs + cleanup).

## 6. Docker-instance binary e2e (required before completion)

Run from a **cwd outside the repo** — the assets route's repo-disk fallback
(`process.cwd()/plugins/...`) would otherwise mask embed failures.

1. `bun run build` → record binary size before/after (expect ≈2.3 MiB ↓).
2. `bun run instance up` → dockerized OpenClaw healthy.
3. Launch the compiled binary from `/tmp` with rig env
   (`BAKIN_HOME` → rig instance home, `OPENCLAW_HOME` → `dev/openclaw-home`).
4. `GET /api/plugins/manifest` → 10 core plugins `active`; `clientEntry` set
   for the 8 with clients; absent for git/images.
5. `GET /api/plugins/<id>/assets/client.js` → 200 for all 8;
   `client.css` → 200 for team + workflows.
6. `GET /api/plugins/<id>/assets/index.js` → 404 for every plugin.
7. Real browser (Chrome DevTools MCP): dashboard loads, sidebar nav populated
   from plugin registrations, zero console errors.
8. `bakin plugins install <fixture plugin>` → activates; its `client.js`
   serves from disk; its `index.js` → 404; remove cleanly.
9. Paste full evidence (commands + output + sizes + browser result) into PR.

## 7. Commit strategy (rollback checkpoints)

Branch `perf/421-no-embedded-server-bundles`, PR to `main`. Each commit green.

1. `refactor(scripts): extract testable collectAssets/emitManifest from generate-embedded-assets`
   — zero behavior change; regenerated manifest byte-identical; fixture tests
   prove **pre-change** behavior.
2. `feat(core): embed only browser assets for core plugins (#421)`
   — allowlist + regenerated `_embedded-assets-static.ts` + updated unit tests
   + architecture scan. ← rollback restores embedding.
3. `feat(build): skip server entry for core plugin builds`
   — `serverEntry` flag + callers + tests. ← one-line-ish revert restores old
   dist output without touching embedding.
4. `feat(api): refuse to serve plugin server bundles over HTTP`
   — assets.ts guard + route tests. ← revert restores serving independently.
5. `docs(knowledge): update plugin/build docs for browser-only embeds`

Generated-file discipline: stage files explicitly; never `git add -A`
(build stamps + regenerated manifests).

## 8. Docs impact (sweep during commit 5)

- `CLAUDE.md` — "each built … into `plugins/<id>/dist/{index.js, client.js}`"
  and embedded-assets description: update to client-only dist for core.
- `.claude/knowledge/plugin-system.md` — embedding + build sections.
- `.claude/knowledge/repo-architecture.md` — embedded-assets mentions.
- `.claude/knowledge/dev-loop.md` — dev rebuild description (server entry no
  longer built for core plugins).
- `CONTRIBUTING.md` + `docs/plugin-authoring.md` + `README.md` — grep sweep for
  embedding/dist claims; update only where core-plugin statements changed
  (user-plugin docs should need no changes — verify, don't assume).

## 9. Boundaries

**Always:** strict TS; Zod at boundaries; `createLogger`; conventional commits;
test mocks per CLAUDE.md; stage generated files explicitly.
**Ask first:** any change touching `user-plugin-builder.ts`, whiskit, or plugin
install/upgrade paths (fenced); any new follow-up issue worth filing.
**Never:** backwards-compat shims; `git add -A`; weakening the agents/
exclusion in the generator; parallel stat/tracking systems; touching
`~/.bakin` / `~/.openclaw` from tests.

## 10. Risks

| Risk | Mitigation |
|------|------------|
| Future core plugin client emits hashed assets (images/fonts) → silently not embedded | Generator logs skips at build time; allowlist is explicit and documented in plugin-system.md |
| Dev overlay no longer catches core server-code build errors on save | Accepted (decision #5): LSP + restart + binary compile still catch them; revertable commit |
| Repo-disk fallback masks embed failures during verification | E2E runs binary from /tmp cwd |
| Tracked generated manifest drifts via stale regeneration | Architecture scan test on the committed file |
| Empty dist for git/images surprises a consumer | Manifest already handles client-less plugins; e2e asserts both remain active |

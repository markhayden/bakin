# Bakin Full-System Audit — Phase 0 Report

**Date:** 2026-06-11 · **Spec:** `SPEC.md` (root) · **Method:** 66-agent workflow — 10 dimension auditors + 27 per-file cohesion analysts; every P0/P1 claim adversarially verified by an independent agent before inclusion.
**Companions:** `APPENDIX-findings.md` (full evidence per finding), `APPENDIX-cohesion.md` (full per-file split plans), `findings.json` (raw data).

## Scoreboard

| | Count |
|---|---|
| Confirmed findings (survived adversarial verification) | 29 |
| Refuted by verifiers | 0 (one downgraded P1→P2) |
| P0 — fix immediately | **0** |
| P1 — this effort | 28 |
| P2 — documented, deferred by auditors | 28 |
| Oversized files analyzed | 27 — **all 27 verdict: split** |

**Headline:** the system is structurally healthy where it matters — the adapter boundary is real and test-enforced, the install/supply-chain pipeline is properly hardened (argv-array git, `--ignore-scripts`, consent tokens, tar validation), and secret isolation works (0600 secrets.json, masked GET). Nothing is on fire. The debt is concentrated in four themes: **(1) a stalled CLI migration** that left three CLIs with behavioral drift, **(2) stalled type/contract unification** (the plugin contract exists as 2–6 independently drifting copies), **(3) infrastructure living in the wrong layer** (exec-tool registry under `scripts/`, core extension points inside the workflows plugin), and **(4) SDK gaps** that push plugins into copy-paste (formatters ×7, confirm dialogs ×6, fetch boilerplate ×11, raw EventSources ×3).

## Notable correctness bugs found incidentally

These surfaced during cohesion analysis (not the security lenses) and deserve early fixes:

1. **search-registry `pluginTables` is a 1:1 map with silent last-write-wins** (`src/core/search-registry.ts:460`), but the team plugin registers TWO content types — so `ctx.search.index()` calls for `team`/`agent-lessons` can write to the wrong table. Fix during WS5's search-registry split (or pull forward).
2. **`scripts/dev.ts` plugin list omits `images`** — the dev loop never watches `plugins/images` (core plugin id list drifted across 3 copies).
3. **Workflow start-validation divergence** — REST `POST /instances/start` uses a weak validator that skips nested-workflow recursion/cycle detection; the hook and exec-tool paths use the strong one.
4. **Schedule pause route vs exec tool drift** — route unconditionally assigns `meta.pauseUntil`, exec tool only when present.
5. **`BAKIN_URL` ignored by `bakin schedule *`** — `src/cli/schedule.ts` hardcodes localhost; every other command honors the override.
6. **`bakin update` advertised but unimplemented in the npm-bin entry**; no-arg behavior differs between binary (`start`) and npm bin (help).
7. **server.ts dead write** — `dispatchState.serverStart = Date.now()` mutates a throwaway object; never saved.

## Security posture (Tailscale-perimeter threat model)

**Confirmed actionable (2):**
- **P1 — Agent avatar path traversal:** `packages/host/src/api/agents/avatar.ts:12-24` joins an unvalidated query `id` into a filesystem path (`?id=../...`). Limited by the fixed `avatar.jpg` suffix, but it's the one route that skips the containment discipline every other route follows. Small fix: validate id shape + realpath-contain.
- **P1→P2 — Shell injection in dead legacy installer:** `src/core/plugin-installer.ts:116` builds `git clone` via string interpolation from caller input. Unreachable in production but kept alive (re-adoptable) by its passing test. **Delete the file + test.**

**Verified strong (no findings):** asset serving (`isValidAssetId` everywhere), plugin asset catch-all, tar extraction (no zip-slip in whiskit artifacts or uninstall snapshots), github installs (argv git, `--` end-of-options, ref regex, realpath containment), `bun install --ignore-scripts`, env-allowlisted build subprocesses, consent tokens bound to manifest sha, secrets store (0600, write-only API, masked reads), no SSRF read-back path, SSE carries no secrets.

**P2 invariant drift (deferred):** antfly basic-auth password rides `settings.json` and is returned unredacted by `GET /api/settings` (contradicts the secret-store's own invariant); execution ledger stores up-to-500-char image prompts in `idempotency.result_json` (contradicts "coordination facts only"); github installs trust a shipped `dist/` that is never rebuilt from the import-validated source; plugin-settings route skips plugin-id validation (no current exploit).

## Proposed workstreams

Dependency-ordered. Each is one branch + PR per SPEC §7; one revertable commit per file/finding.

### Phase 1 — Foundations

**WS1 `refactor/contract-types` — one source of truth for the plugin contract.**
The contract types exist as independently drifting text in up to six places.
- `@makinbakin/sdk/types` ↔ `packages/core/src/plugin-types.ts`: hand-maintained fork (HealthCheckResult, PluginContext, BakinPlugin, ExecToolDefinition…); core's own manifest parser already imports the SDK copy while core also keeps a stale `PluginManifest`. Pick the SDK as source of truth; core re-exports.
- `Task`/`TaskLogEntry` defined 4–6×, already drifted (`updatedAt`/`version` missing from SDK copy). Home: `packages/core/src/tasks/store.ts`, SDK re-exports.
- `AvailableModel` ×2 (drifted), `WorkflowInstance` SDK shape contradicts the real wire shape (`id` vs `instanceId`), `AgentUsage` ×2 + a plugin-dir-escaping import.
- Split both type god-files along the audited seams: `packages/sdk/src/types/` → primitives/manifest/runtime/services/registration/context (+ delete the dead misc block: CalendarEvent, MemoryEntry, etc.); `packages/core/src/plugin-types.ts` → plugin-contract/{search-api,services,registrations}.
- Includes: kill `src/types/index.ts` Next.js residue (12 of 15 exports dead, 4th stale Task model) and the 6 verified-dead files (~620 LOC): `new-task-dialog.tsx`, `curated-browser.tsx`, calendar pair, `plugin-slot.tsx`, `panel.tsx`.

**WS2 `refactor/core-extractions` — move infrastructure to its layer, kill server-side duplication.**
- `scripts/lib/registry.ts` (the production exec-tool registry!) → `src/core/exec-tools/`; breaks the 17-cycle circular-dependency cluster with plugin-registry/task-service/dispatch.
- Workflow source/node-type/notification-channel registries out of `plugins/workflows/lib/` → `packages/core` (core plugin loader currently cannot function without one plugin's source tree; also fixes the images→assets direct-import precedent by giving cross-plugin surfaces a sanctioned home — extend assets hooks for the images plugin).
- One `PluginContext` factory (registry's `buildContext` vs catch-all's `buildCtx` have already drifted in `updateSettings` behavior).
- `packages/core/src/plugins/settings-store.ts` (5 hand-rolled copies, diverging change-notification).
- Promote `atomicWriteJson` to `packages/core/src/storage/` (7 hand-rolled tmp+rename copies).
- `packages/core/src/format/frontmatter.ts` (one regex ×10 files, `parseSkillFile` ×3, lesson parser ×4).
- `healthOk/healthWarn/healthError` constructors (13+ files, 2 divergent signatures).
- Gate or type the `runtime.config.get()/replace()` whole-config surface (it bypasses the raw-config allowlist+audit gate; promote real uses to typed adapter methods).
- Add the missing architecture guards: cross-plugin import rule, `packages/sdk` in scan roots, config-surface governance.

**WS3 `feat/sdk-gaps` — client-side primitives plugins keep reinventing.**
- `usePluginEvent()` — multiplex the existing singleton SSE connection (assets plugin currently opens 3 raw `EventSource`s with no reconnect; host store hardcodes per-plugin bump counters).
- `useJsonFetch()`/`useAsyncData()` — the `let cancelled = false` effect ×11.
- `ConfirmDialog` — hand-rolled ×6 across 5 plugins.
- `formatDuration`/`formatDateTime` in `packages/core/src/format.ts` (+ migrate 7 reimplementations; health's copy is byte-identical to SDK `formatAge`).
- `EmptyState` consolidation (team's fork shadows the SDK one, both used in the same plugin).
- `useAvailableModels()` hook; `toneBadgeClass`/`StatusBadge` (P2, optional).

### Phase 2 — Decomposition & redesign

**WS4 `refactor/cli` — consolidate three CLIs into one.** The audit's biggest single win (~1,500+ lines die).
- Finish the stalled migration: `src/core/cli/{runner,parser,options,result}.ts` is a complete, tested framework with **zero production callers**.
- Target: `src/core/cli/` with `http.ts` (one BAKIN_URL-aware client), `output.ts` (one `renderInkReport` replacing 44 byte-identical `printXxxTui` wrappers + 155 `isTTY` branches), `commands/` one file per group; `cli/bakin.ts` shrinks to a bin shim; `src/cli/schedule.ts` folds in; kill the `process.exit`/`argv` monkey-patch delegation.
- Split `readonly.tsx` (2,808) into `ui/reports/{format,command-meta,runtime,settings,tasks,workflows,plugins,packages,search,schedule,trash}` + barrel; fix the `unknown`-typed DTO design while there.
- Fix behavioral divergences (no-arg, `update`, BAKIN_URL, help-registry drift).
- Split `tests/cli/readonly-commands.test.ts` along the same seams + extract the copy-pasted TTY harness (×10 files); de-chain mega-`it()`s.

**WS5 `refactor/core-splits` — the big core/server/adapter files.** Per-file plans in APPENDIX-cohesion.md.
- `src/core/dispatch.ts` (2,079 → 11 modules; dedupe the ~120-line dispatchTasks/dispatchSingleTask copy-paste; singleton placement is the risk to manage).
- `src/lib/plugin-registry.ts` (1,608 → 7; unify duplicate topological sorts + duplicate activation pipelines; move it out of src/lib while at it — it's server-only).
- `src/core/search-registry.ts` (1,134 → 4; **fix the pluginTables 1:1 bug**).
- `server.ts` (837 → declarative route table + boot/recovery modules; delete dead dispatch-state write).
- `src/core/plugins/upgrade.ts` (926 → 6; delete dead `checkUpgradeAvailable`; consolidate the two directory hashers).
- `packages/adapter-openclaw/src/runtime.ts` (3,069 → 13 capability factories; dedupe `deepMerge` with packages/core).

**WS6 `refactor/plugin-splits` — plugin god-files + their tests.**
- `plugins/team/index.ts` (2,338 → 11; the route↔exec-tool verbatim duplication collapses into `lib/agent-lifecycle.ts`).
- `plugins/workflows/index.ts` (2,115 → 12; **fix the start-validation divergence**; delete the `triggerDispatch` copy), `lib/runtime.ts` (1,633 → 8), `workflow-canvas-editor.tsx` (1,803 → 6; delete shadowed dead node renderers), `node-config-drawer.tsx` (976 → 4).
- `plugins/schedule/index.ts` (1,440 → 7; route/exec-tool drift fixed via `lib/job-service.ts`).
- `plugins/tasks/index.ts` (1,089 → 8; COLUMNS triplication; REST/MCP guard inconsistency), `task-detail-dialog.tsx` (1,031 → 7; split create/edit/detail modes).
- `plugins/health/components/health-page.tsx` (1,141 → 7; per-section fetching instead of the all-or-nothing Promise.all), `plugins/models/components/models-page.tsx` (947 → 6), `plugins/assets/lib/asset-service.ts` (835 → 5; merge duplicate lazy sharp loaders).
- Test splits: schedule/tasks/workflows route+runtime test files along source seams, with shared harnesses (also **fixes the missing packages/core content-dir mock** in tasks routes tests — a CLAUDE.md-mandated mock that's absent today).

**WS7 `refactor/tooling` — build/dev tooling.**
- `scripts/docs/generate.ts` (2,585 → ~13 modules; delete the dead legacy OpenAPI generator; share renderers with `check.ts`, whose ~150-line copy has already diverged).
- Externals contract: `packages/host/build.ts` + `scripts/dev.ts` import `PLUGIN_CLIENT_EXTERNALS` instead of inline copies (the exact bug class the module was created to kill).
- Single CORE_PLUGINS list (fixes the missing `images` watcher), shared dir walker (×5 ad-hoc), JSON.stringify in embedded-assets codegen, gate imitation-crab usage-seed out of the production binary, delete/wire orphan scripts.

### Phase 3 — `fix/security` (small, fast PR — can go first)
- Avatar route id validation + containment (P1).
- Delete `src/core/plugin-installer.ts` + test (P1→P2 injection liability).
- Plugin-settings route id validation (P2, one-liner).
- Pulled in at triage: antfly password → secrets store; ledger idempotency rows store promptHash not prompt; github `dist/` trust removal.
- **Github dist verification (post-audit, confirmed 2026-06-11):** the historical reason for `trustExistingDist` is gone — Whiskit's `buildPluginWithSystemBun` rebuilds server bundles from a compiled binary, and `resolveSdkEntrypoints` supports consumer machines via the plugin's own `node_modules/@makinbakin/sdk`. Remaining call sites: `api/plugins/install.ts:718` (github installs), `upgrade.ts:705,821` (unconditional), `user-plugin-builder.ts:317` (boot, locked github plugins). Fix: remove the github trust everywhere, always rebuild from the import-validated source (freshness mtime skip stays as the cache); the option then has zero callers and is deleted.

### Phase 4 — test coverage & docs sweep
Per SPEC §2: `/agent-skills:test` over redesigned areas; update `.claude/knowledge/{repo-architecture,plugin-system,adapter-architecture,dispatch,search-system,dev-loop}.md`, `CLAUDE.md` (CLI section changes materially), `README.md`, `docs/*`.

## Deferred (P2) inventory — 28 items

Documented in full in `APPENDIX-findings.md`. Categories: src/lib layering doc-drift (server-only modules in the "client-safe" layer); SDK package-to-app circular dependency (implementations live in `src/components/`, works but undocumented — defer per auditor; release smoke test covers it); `cli/bakin.ts` god-file notes (superseded by WS4); help-registry drift (folded into WS4); docs hook-extraction regex scraping; tone-badge styling idiom; host package-route body-parse boilerplate; param-injection shim running twice per request (quick delete folded into WS2); plus the security-invariant items listed above.

Several P2s are absorbed into workstreams where the file is already open (marked above). The rest stay deferred unless you pull them in (SPEC §8: ask first).

## Suggested execution order

```
fix/security            (small, independent — land first)
refactor/contract-types (WS1)  ──┐
refactor/core-extractions (WS2) ─┼─ Phase 1, ordered WS1 → WS2 → WS3
feat/sdk-gaps (WS3)     ─────────┘
refactor/cli (WS4)               — biggest single payoff
refactor/core-splits (WS5)
refactor/plugin-splits (WS6)     — after WS1–WS3 so splits land on shared code
refactor/tooling (WS7)           — independent; can interleave
docs + test sweep                — final PR
```

# Implementation Plan: Whiskit Plugin Builder

Spec: `.claude/specs/whiskit-plugin-builder.md`
Date: 2026-06-04

## Overview

Whiskit is a multi-PR architecture change built around the **two-lane model**:
consumers download and verify prebuilt artifacts (never build); producers and
developers build from local source with system `bun` (CI publish or `--dev`).

The safest route is to ship the decoupled, high-value lazy-loading fix first,
then land the shared build backend, artifact format, and publish pipeline; in
parallel extract the **shared install core** from the proven agent-package
patterns; move plugin install onto it; then migrate official repos to
source-only; **converge the agent-package installer onto the shared core last**
(behavior-preserving); and finally harden for release. `BUN_BE_BUN` self-invoke
is not on the critical path and is deferred.

Every phase leaves Bakin in a working state with a natural rollback point.

## Phase Numbering Note

The dependency graph and the phase headings use the **same numbers**: phase N ==
graph node N. Each phase is one PR/commit, labeled `C<N>` below, except Phase 10
(producer repo migration), which spans two repos and therefore two PRs (`C10a`
Bakin, `C10b` official repo). There is no separate global commit counter — the
commit label always matches its phase number. Two phases are about install
reliability for both primitives: **P5 shared install core** and **P11
agent-package convergence**.

## Dependency Graph

```text
P0 baseline + fixtures + agent-package characterization tests
P1 lazy browser plugin loading            (decoupled; ships first; fixes #267 UX)
P2 shared build backend (system bun)
   -> P3 artifact format + provenance + checksum (signing deferred post-v1)
      -> P4 producer publish pipeline (bakin plugins publish + CI action)
P5 shared install core (extract from the proven agent-package patterns)
   -> P6 consumer plugin install path on the shared core (download/verify/publish)
      -> P7 [DEFERRED post-v1] elevated install-script / native trust
         -> P8 dev-link / hot-reload on the system-bun backend
            -> P9 startup verifier + legacy-install migration + host-upgrade refetch
               -> P10 producer repo migration: no committed dist (a: Bakin docs, b: official repo)
P11 agent-package convergence onto the shared core (LAST, behavior-preserving)
   -> P12 release hardening (smoke BOTH install paths)
```

P5 (shared core) and the plugin build/publish track (P2–P4) are independent and
can proceed in parallel; P6 depends on both. P11 (agent convergence) is
deliberately last and gated on P5 being proven by the plugin path first, plus
the P0 characterization tests staying green — we do not destabilize the
currently-robust agent-package installer to achieve sharing.

Notes:

- P1 (lazy loading) is intentionally first and independent. It is the actual
  user-visible complaint in #267 and does not depend on any builder change.
  `Promise.all` eager import can be restored in isolation if it regresses.
- P6 (consumer install) depends on P3/P4 (artifacts must exist to download) and
  on P5 (the shared install core it runs on).
- P10 (remove committed dist from official repos) must come after P4/P6 prove
  artifacts can be published and consumed, so installs never break for a
  released Bakin.
- `BUN_BE_BUN` self-invoke and remote-source-build-on-consumer are explicitly
  out of scope (see spec "Deferred: Remote Source Build"). No phase implements
  them.

## Phase 0: Baseline And Fixtures

Purpose: capture today's behavior and create the fixtures every later phase
needs, before changing anything.

Tasks:

- Add source-only fixture plugins:
  - pure server-only plugin
  - server + client plugin
  - plugin with a declared pure-JS dependency
  - plugin requiring a blocked install script
  - plugin with an explicitly approved (producer-consented) script package
  - native fixture (or a stubbed native addon) to exercise per-platform
    artifacts and the runtime `node_modules` layout
- Add a hermetic **fixture artifact server/host** helper so consumer-path tests
  download from a local source, never live network or `~/.bakin`/`~/.openclaw`.
- **Add characterization tests that lock the CURRENT agent-package installer
  behavior** (staging→atomic-rename, install lock, write-log rollback,
  `.installedBy`/`.userEdited`, lockfile fields). These are the safety net that
  must stay green through P5 and gate P11 — they prove the agent path is not
  regressed when it moves onto the shared core.
- Add tests describing desired behavior, marked pending until the relevant phase
  lands.

Likely files:

- `tests/fixtures/plugins/whiskit-*`
- `tests/fixtures/whiskit-artifact-server.ts`
- `tests/core/whiskit/`

Commit:

- C0. `test(plugins): add Whiskit fixtures and hermetic artifact host`

Verification:

```sh
bun test --isolate tests/core/whiskit
bun run typecheck
```

Rollback: tests/fixtures only.

## Phase 1: Lazy Browser Plugin Loading (ships first, decoupled)

Purpose: fix the user-visible "Loading plugins" delay independently of the
builder rework. This is the **only** phase that speeds up the browser — prebuilt
artifacts do not (clients are already prebuilt today).

Scope reality (verified in code): this is NOT a host-only change. Today
`registerPlugin` takes eager `ComponentType` route/slot refs, each plugin
imports all page components at `client.tsx` module top, plugins build as a single
non-split bundle, and nav lives only in the runtime registry (not the manifest).
So it requires a manifest-schema + per-plugin change touching `@makinbakin/sdk`
(published), every core plugin, and the two official plugins.

APPROACH: **(a) declarative manifest metadata** (chosen — see spec). Nav/route/
slot metadata moves into `bakin-plugin.json` (extending existing
`contributes.clientRoutes`); the sidebar renders from manifest JSON; a plugin's
`client.js` loads only on first navigation into its routes. No code-splitting
(deliberately avoided to not disturb import-map / hot-reload machinery).
Approach (b) factories+splitting is a future per-plugin optimization, not in v1.

Tasks:

- Add declarative `contributes.nav` / `contributes.routes` / `contributes.slots`
  to the manifest schema and serve it from `/api/plugins/manifest`.
- Render the sidebar/shell from manifest metadata after the manifest fetch only
  (replace the `Promise.all` full-bundle import in `PluginHost.tsx`); load a
  plugin's `client.js` lazily on first navigation into one of its routes.
- Keep `registerPlugin` runtime registration as the **escape hatch** for
  `eager: true` plugins (background providers / `nav-badge-providers` /
  conditional nav), loaded eagerly.
- Add a **drift validation check** (build/publish + startup diagnostic): every
  declared manifest route/nav has a matching runtime registration and vice versa.
- Add plugin-local error boundaries for failed lazy plugin imports.
- Update every core plugin's `bakin-plugin.json` + `client.tsx` (and coordinate
  the two official plugins in `bakin-bits-official`) to the declarative shape.
- Preserve dev hot-swap and version-mismatch behavior.

Likely files:

- `packages/host/src/plugin-host/PluginHost.tsx`
- `packages/sdk/src/register.ts`
- `packages/sdk/src/slots/index.tsx`
- `packages/host/src/components/layout/app-sidebar.tsx`
- `packages/host/src/api/plugins/manifest.ts` (serve declarative nav/route/slot)
- `packages/core/src/plugins/manifest.ts` (schema for `contributes.nav` etc.)
- every `plugins/<id>/bakin-plugin.json` + `plugins/<id>/client.tsx`
- component tests

Commit:

- C1. `perf(host): lazy-load noncritical plugin clients`

Verification:

```sh
bun test --isolate tests/components/plugin-host.test.tsx tests/plugins/contract.test.ts
bun run typecheck
```

Manual browser verification:

- Cold load shell with plugin diagnostics enabled; confirm only the eager
  registration step runs before render, not full plugin bundles.
- Navigate to a plugin route; confirm lazy import of that plugin's route code.
- Trigger dev hot swap; confirm route/slot refresh.

Rollback: restore eager `Promise.all` import behavior + revert the SDK shape.
Independent of all later phases, but note the SDK-contract change ships in the
published package, so coordinate with plugin authors.

## Phase 2: Shared Build Backend (system bun)

Purpose: one build code path that runs identically in CI and on dev machines,
shelling out to system `bun` so it does not depend on in-process `Bun.build()`
inside a compiled binary.

Tasks:

- Add `src/core/whiskit/types.ts` (build + artifact + failure types).
- Add `src/core/whiskit/externals.ts` as the single source for host externals,
  SDK entrypoints, and the `externalsContract` string.
- Add `src/core/whiskit/import-scan.ts` (move the scanner out of
  `user-plugin-builder.ts`).
- Add `src/core/whiskit/source-hash.ts`.
- Add `src/core/whiskit/command.ts`: stable system-`bun` runner with timeout,
  cwd, env allowlist, stderr capture, sanitized errors.
- Add `src/core/whiskit/build.ts`: server **and** client builds shell out to
  system `bun build` for the publish/install paths (so the same code works under
  a compiled binary), **plus `bun install` for declared deps.** Match the proven
  externals strategy: client externalizes React + SDK; **server externalizes
  React/router but inlines the SDK** (the official `bakin-bits-official` build
  does exactly this via an esbuild SDK resolver — Whiskit must reproduce it or
  server output diverges). Run `bun install --ignore-scripts` (pure-JS only; the
  elevated install-script path is deferred to Phase 7).
- **Hot-reload speed guard:** keep an in-process `Bun.build()` fast path for
  source-run dev mode so per-save reload latency does not regress vs. today.
  Shelling out is for publish/install, not the dev hot loop.
- Keep `buildUserPlugin()` as a thin adapter over the new backend so existing
  install/dev/startup callers keep working until later phases move them.

Likely files:

- `src/core/whiskit/{types,externals,import-scan,source-hash,command,build}.ts`
- `packages/host/src/plugin-host/user-plugin-builder.ts`
- `scripts/dev-build-one-plugin.ts`
- tests under `tests/core/whiskit/`

Commit:

- C2. `feat(plugins): shared Whiskit build backend on system bun`

Verification:

```sh
bun test --isolate tests/core/whiskit tests/api/plugins-build.test.ts tests/scripts/dev-build-one-plugin.test.ts
bun run typecheck
```

Rollback: revert backend; restore prior `buildUserPlugin` body.

## Phase 3: Artifact Format, Provenance, Verification

Purpose: define the Lane-1 distribution unit and how it is verified.

Tasks:

- Add `src/core/whiskit/provenance.ts` (read/write/validate `build.json`,
  schema `version: 2`, includes `externalsContract`, `bakinRange`,
  `sourceCommitSha`, approved scripts with name+version, runtimeModules).
- Add `src/core/whiskit/artifact.ts`: assemble tarball (`dist/` + required
  `node_modules/` + `.whiskit/build.json`), compute checksum, and verify
  checksum + provenance on the consumer side (signing deferred post-v1).
- Add safe extraction (zip-slip / path-traversal guard, escaping-symlink
  rejection, decompressed size cap).
- Define `whiskit-artifacts.json` index schema (platforms, versions, checksums,
  externalsContract).
- Signing: **checksum only in v1** (Open Q1 resolved). Reserve the optional
  `.sig` asset + signed-index shape in the format so authenticity signing can be
  added post-v1 without a layout change. Do not implement signature verification
  now.

Likely files:

- `src/core/whiskit/{provenance,artifact}.ts`
- `packages/core/src/plugins/manifest.ts` (reuse existing `bakin` compat field +
  add build-trust schema; provenance stores resolved range as `bakinRange`)
- tests under `tests/core/whiskit/`

Commit:

- C3. `feat(plugins): Whiskit artifact format, provenance, and verification`

Verification:

```sh
bun test --isolate tests/core/whiskit
bun run typecheck
```

Rollback: artifact module is additive; nothing consumes it yet.

## Phase 4: Producer Publish Pipeline

Purpose: turn local source into checksummed artifacts (per-platform only when the
plugin is platform-sensitive; pure-JS is a single artifact).

Tasks:

- Add `bakin plugins publish <dir> [--platforms] [--allow-install-scripts]`.
- Locally builds the host platform; CI builds the declared matrix.
- Detect platform-sensitivity from resolved deps (Open Q5): `os`/`cpu`
  constraints, platform-keyed `optionalDependencies`, or native addons force
  per-platform artifacts; otherwise emit one platform-neutral artifact.
- Stamp `bakinRange` from the build when the manifest omits it (Open Q4).
- Assemble + checksum artifacts; build a per-release immutable
  `whiskit-artifacts.json` by **carrying forward** the previous latest index's
  entries for plugins not rebuilt (Open Q3), so each release is a complete
  catalog and plugins release independently; attach index + artifacts to the
  GitHub release (or emit to a target dir for CI to upload).
- Add the reusable GitHub Action wrapper with a platform matrix.

Likely files:

- `src/core/whiskit/publish.ts`
- `src/core/cli/registry.ts` (register `plugins publish`)
- `.github/actions/whiskit-publish/` (reusable action)
- tests under `tests/core/whiskit/` and `tests/cli/`

Commit:

- C4. `feat(plugins): bakin plugins publish + reusable CI action`

Verification:

```sh
bun test --isolate tests/core/whiskit tests/cli/plugin-publish.test.ts
bun run typecheck
bakin plugins publish ./tests/fixtures/plugins/whiskit-server-client --platforms <host>
```

Rollback: publish command is additive; producers can still ship the old way
until P10.

## Phase 5: Shared Install Core (extract from the proven agent-package patterns)

Purpose: one hardened install backbone consumed by both primitives, eliminating
the parallel-drift regression class. Built by **generalizing the agent-package
installer's existing patterns** (it is the reference) — NOT inventing new ones,
and NOT yet moving agent packages onto it (that is P11).

Tasks:

- Extract a shared module set under `src/core/install-core/`:
  - **Source parsing** — unify `parseGithubSource` (plugins) and
    `parseGithubSpec` (agent packages) into one parser with identical
    path-traversal / `..` / subpath-containment guards.
  - **Source materialization** — one fetch path over the shared
    `github-source-cache.ts` (system git for dev/source installs) and HTTPS
    artifact download (consumers, P6); bounded timeout, size cap, git-arg
    allowlist.
  - **Transaction** — staging → atomic rename, advisory install lock, and
    **write-log rollback** lifted from the agent-package projector
    (`src/core/agent-packages/projector.ts`, `install-lock.ts`).
  - **Lockfile IO** — one generic `atomicWriteLockfile(path, schema, content)`
    (tmp+rename+fsync) used by both lockfiles.
  - **Provenance** — generalize `.installedBy` sidecars so both primitives can
    record per-file provenance.
- Keep the agent-package installer calling the SAME underlying behavior via a
  thin adapter so P0 characterization tests stay green (no behavior change yet).
- No consumer of the new core in this phase except a parity test harness.

Likely files:

- `src/core/install-core/{source,materialize,transaction,lockfile-io,provenance}.ts`
- `packages/core/src/plugins/source.ts` + `src/core/agent-packages/source-fetcher.ts`
  (route through the unified parser)
- `src/core/github-source-cache.ts`
- tests under `tests/core/install-core/`

Commit:

- C5. `refactor(install): extract shared hardened install core`

Verification:

```sh
bun test --isolate tests/core/install-core tests/core/agent-packages
bun run typecheck
```

Rollback: the core is additive + adapter-backed; agent/plugin install behavior
is unchanged until P6/P11 adopt it. P0 characterization tests must stay green.

## Phase 6: Consumer Plugin Install Path (on the shared core)

Purpose: install on a consumer machine with no build toolchain, using the shared
core's transaction/rollback/lock so plugins reach the agent-package robustness
standard.

Tasks:

- Add `src/core/whiskit/resolver.ts`: the `WhiskitArtifactResolver` interface
  (Open Q2) + the single v1 `github-release-assets` implementation. Downstream
  download/verify/extract/validate/publish must not reference GitHub directly.
- Add `src/core/whiskit/source-materializer.ts` consumer path:
  - parse via `packages/core/src/plugins/source.ts`
  - resolve platform + artifact location via the resolver (`whiskit-artifacts.json`)
  - download artifact + checksum over HTTPS (public repos; private-repo token
    auth deferred)
  - verify checksum, then safe-extract to staging
  - clear `NO_PREBUILT_ARTIFACT` / `CHECKSUM_MISMATCH` errors
- Rewrite install/upgrade transaction (`install.ts`) to run **on the P5 shared
  install core** (so the build-in-place-with-no-rollback regression surface is
  gone — plugins now get staging → atomic publish, install lock, and write-log
  rollback like agent packages):
  - download/verify/validate artifact in staging
  - shared atomic publish to `~/.bakin/plugins/<id>` with rollback on failure
  - shared install lock + pre-flight collision check
  - lockfile write (shared IO) with artifact provenance + `.installedBy`
  - live-activate with a cache-busted `import()`
- Remove `trustExistingDist` as install policy.
- Replace `git clone` materialization for the consumer path; keep git only for
  developer/source convenience.
- Forward-compatible lockfile schema bump (additive, version-gated).

Likely files:

- `packages/host/src/api/plugins/install.ts`
- `src/core/plugins/upgrade.ts`
- `packages/core/src/plugins/lockfile.ts`
- `src/core/whiskit/source-materializer.ts`
- lifecycle tests

Commit:

- C6. `feat(plugins): install verified Whiskit artifacts on the shared core`

Verification:

```sh
bun test --isolate tests/plugins/lifecycle/install-artifact.test.ts tests/plugins/lifecycle/install-subpath.test.ts tests/api/user-plugin-lifecycle.test.ts tests/plugins/lifecycle/upgrade-flow.integration.test.ts
bun run typecheck
```

Rollback: revert install/upgrade callers to old builder + `trustExistingDist`.

## Phase 7: Dependency And Install-Script Trust (publish/dev side) — DEFERRED post-v1

**Deferred (2026-06-04):** no current plugin needs it — both official plugins
are pure-JS, and pure-JS dependency install (`bun install --ignore-scripts`)
already lives in Phase 2. This phase (elevated install-script trust, native
deps, per-platform matrix, name+version re-consent) is implemented only when a
real native/scripted plugin appears. v1 ships **pure-JS plugins only**; a plugin
that declares `build.installScripts` fails with a clear "elevated install
scripts are not supported yet" error until this phase lands. The design below is
retained as the spec for that future work.

Purpose: make dependency install explicit and safe — on the build side only.

Tasks:

- Add manifest parser for `build.installScripts` (resolved field per Open Q4:
  entries of `package` + `version` + `reason` + `platforms`; no
  `nativeDependencies`).
- Validate: no wildcard trusted packages; each trusted package is in
  `dependencies`; supported platform includes the build platform; reason present.
- Producer consent at publish: `--allow-install-scripts` / interactive prompt,
  separate from the permission `--yes` shortcut.
- Record approved packages by **name + version**; re-consent triggers on
  identity change (name+version or `packageLockSha`).
- `bun install --ignore-scripts` default; package-level trusted deps only after
  approval.
- Errors: `SCRIPT_BLOCKED`, `SCRIPT_CONSENT_REQUIRED`, `DEPENDENCY_INSTALL_FAILED`.
- Reject third-party deps that import React / host singletons (one-React guard).

Likely files:

- `packages/core/src/plugins/manifest.ts`
- `src/core/whiskit/{dependencies,script-trust}.ts`
- `src/core/whiskit/publish.ts`
- tests under `tests/core/whiskit/` and `tests/cli/`

Commit:

- C7. `feat(plugins): gate install scripts through producer-side Whiskit trust`

Verification:

```sh
bun test --isolate tests/core/whiskit tests/cli/plugin-publish-scripts.test.ts
bun run typecheck
```

Rollback: leave pure-JS publish active; disable elevated script mode.

## Phase 8: Dev Link And Hot Reload On Whiskit

Purpose: keep developer experience fast on the shared system-`bun` backend.

Tasks:

- Make `bakin plugins install --dev` and the hot-reload coordinator call the
  Whiskit build backend (local source, system `bun`).
- Confirm it works whether Bakin runs from source or as a compiled binary, as
  long as system `bun` is present.
- Preserve per-plugin debounce/inflight, old-plugin-stays-active on failure,
  watcher survival on build error, and client hot-swap.
- Use the in-process `Bun.build()` fast path in source-run dev (no subprocess per
  save); benchmark reload latency against today to prove no regression.
- Add diagnostics for Whiskit dev rebuild spans.

Likely files:

- `src/core/plugins/link.ts`
- `src/core/plugin-host/hot-reload-coordinator.ts`
- `src/core/plugin-host/reload-pipeline.ts`
- `packages/host/src/plugin-host/PluginHost.tsx`
- hot reload tests

Commit:

- C8. `feat(plugins): route dev hot reload through Whiskit`

Verification:

```sh
bun test --isolate tests/plugins/lifecycle/hot-reload-coordinator.test.ts tests/plugins/lifecycle/hot-reload-integration.test.ts tests/components/plugin-host.test.tsx
bun run typecheck
```

Rollback: switch dev-link back to the P2 adapter.

## Phase 9: Startup Verifier, Doctor Repair, Host-Upgrade Refetch

Purpose: remove install-grade builds from startup and handle host upgrades.

Tasks:

- Replace `buildAllUserPlugins()` startup behavior with artifact verification:
  - manifest present, `dist/index.js` present, `.whiskit/build.json` valid
  - checksum status acceptable (signature deferred post-v1)
  - `externalsContract` + Bakin range compatible
- Mark incompatible artifacts **needs-update** (not permanently inactive); the
  repair path **re-fetches a compatible published artifact**, it does not
  rebuild locally.
- Mark genuinely failed plugins inactive with error metadata.
- **Migrate pre-Whiskit installs (regression guard).** Plugins installed before
  Whiskit have committed dist, no `.whiskit/build.json`, and no artifact
  provenance. On the first startup after upgrade they must NOT be silently
  marked inactive. Detect "legacy install" (lockfile entry without artifact
  provenance) and either grandfather the existing dist as valid-but-unverified,
  or auto-refetch the published artifact once. A one-time
  `bakin plugins migrate` / doctor repair drives it. This must be covered by a
  test that upgrades a legacy-install fixture and asserts the plugin stays
  active.
- `bakin doctor` checks + repair: re-fetch missing/stale/incompatible artifacts,
  clear Whiskit cache, explain when a newer release is required.
- Update the health plugin to surface plugin artifact failures.

Likely files:

- `server.ts`
- `packages/host/src/plugin-host/user-plugin-builder.ts` (or replacement)
- `src/core/doctor.ts`
- `plugins/health/lib/system-checks/plugin-assets.ts`
- plugin manifest route + tests

Commit:

- C9. `perf(plugins): verify artifacts at startup, refetch on host upgrade`

Verification:

```sh
bun test --isolate tests/core/doctor-plugin-checks.test.ts tests/core/plugin-startup-diagnostics.test.ts tests/api/plugin-manifest-embedded.test.ts
bun run typecheck
```

Rollback: restore `buildAllUserPlugins()` startup behavior while keeping the
Whiskit install path.

## Phase 10: Producer Repo Migration (source-only)

Purpose: make official plugin repos source-only and artifact-published.

Tasks in Bakin (10a):

- Docs: source-only producer repos + artifact publishing is the contract.
- Update recommended install paths if needed.
- CI check / docs test that no official catalog entry requires committed `dist`.

Tasks in `markhayden/bakin-bits-official` (10b) — scoped against the actual repo:

- Two plugins today: `messaging`, `projects`. Both are **pure-JS** (`js-yaml`,
  `lucide-react`, `zod` — zero native, zero install scripts), so they produce a
  **single platform-neutral artifact each; no platform matrix needed** (Open Q5
  detection confirms pure). Per-platform/matrix work is deferred until a native
  plugin actually exists.
- Remove committed `plugins/*/dist/**`. Today `.gitignore` explicitly
  **un-ignores** `!plugins/*/dist/` + `!plugins/*/dist/**` — invert that to
  ignore dist. Decide whether to purge dist from git history (~2 MB of bundles)
  or just stop tracking going forward (simpler; history stays).
- **Flip the CI gate.** Current `ci.yml` builds dist and **fails if it is
  stale** ("dist/ is out of date") — the exact opposite of the target. Replace
  with: build via Whiskit, publish artifacts, and assert dist is **absent**.
- Replace `scripts/build-plugins.ts` with the `bakin plugins publish` action.
  Preserve its externals strategy (server inlines SDK; client externalizes it).
- Add a release workflow that publishes per-plugin checksummed artifacts +
  `whiskit-artifacts.json` (carry-forward) to GitHub Releases, keyed off the
  existing `<plugin-id>-v<semver>` tag convention.
- Update README install examples (still git-subpath source string; now resolves
  to a published artifact, not committed dist).

Commits/PRs:

- C10a. Bakin PR: `docs(plugins): document source-only Whiskit plugin repos`
- C10b. Official repo PR: `refactor: publish artifacts, drop committed dist`

Verification:

```sh
# consumer install against a freshly published release, no toolchain
BAKIN_HOME=/tmp/bakin-whiskit-home ./dist/bakin-<plat> \
  plugins install github:markhayden/bakin-bits-official#plugins/messaging
```

Rollback: the official repo can temporarily keep committed dist until the Bakin
Whiskit release is tagged; the target contract remains source-only + published
artifacts.

## Phase 11: Agent-Package Convergence (LAST, behavior-preserving)

Purpose: move the agent-package installer onto the P5 shared core so the two
primitives stop drifting — without regressing the currently-robust content path.

Why last: the shared core is proven by the plugin path (P5/P6) first; only then
does the working agent installer migrate, gated on the P0 characterization tests
staying green at every step.

Tasks:

- Route agent-package source parse + fetch + transaction + lockfile IO +
  provenance through `src/core/install-core/` (replacing the parallel
  `source-fetcher.ts` / projector internals with the shared implementations).
- Behavior-preserving: P0 characterization tests must pass unchanged; any
  intended difference is an explicit, reviewed delta.
- Close the two known agent-package gaps now that they are cheap on the shared
  core: finish the deferred pre-flight collision check (today
  `preflightCollisions()` returns `[]`), and add manifest-integrity hashing
  (parity with plugin `manifestSha`).
- Delete the now-dead parallel implementations (unify, don't leave both).

Likely files:

- `src/core/agent-packages/{installer,source-fetcher,projector}.ts`
- `packages/core/src/agent-packages/{manifest,lockfile,markers}.ts`
- `tests/core/agent-packages/` + the P0 characterization suite

Commit:

- C11. `refactor(agent-packages): converge install onto the shared core`

Verification:

```sh
bun test --isolate tests/core/install-core tests/core/agent-packages tests/api/agent-packages
bun run typecheck
```

Rollback: the agent installer keeps its pre-convergence path until this lands;
revert routes it back. P0 characterization tests are the gate.

## Phase 12: Release Hardening

Purpose: prevent regressions before launch.

Tasks:

- Release workflow smoke (**both install paths**):
  - consumer binary installs a published plugin fixture artifact with no system
    bun/git
  - agent-package install of a source-only fixture succeeds on the shared core
  - failed install (bad artifact / interrupted) rolls back cleanly for both
    primitives — no partial state
  - `CHECKSUM_MISMATCH` / zip-slip fixtures rejected
- Binary artifact size report (executable / embedded host assets / embedded core
  plugin assets / vendor bundles).
- Startup benchmark: artifact verification vs. old rebuild behavior.

Likely files:

- `.github/workflows/release.yml`
- `scripts/build-binary.ts`
- `scripts/report-binary-size.ts`
- `scripts/bench/plugin-startup.ts`

Commit:

- C12. `ci(release): smoke Whiskit install + publish (both primitives)`

Verification:

```sh
bun run build:binary
gh workflow run release.yml   # or PR checks when wired
```

Rollback: release checks can be disabled temporarily without reverting runtime
Whiskit behavior, but should block launch once stabilized.

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| No signing in v1 (checksum only) | A compromised GitHub release could swap artifact + checksum together | Accepted for v1: trust = GitHub HTTPS + account security, same as Obsidian community plugins. Format reserves signing for post-v1 if impersonation risk appears |
| Native deps in the artifact mismatch consumer platform | Plugin fails at activation | Per-platform artifacts built+tested in CI matrix; `UNSUPPORTED_PLATFORM` on resolve; runtime `node_modules` shipped inside the artifact |
| Hard GitHub dependency for artifact hosting | Installs fail if GitHub is down/changed | Keep "no SaaS" runtime; allow a content-addressed mirror later (Open Q2) |
| Host upgrade invalidates externals contract | Plugins go inactive after Bakin update | Needs-update state + refetch a compatible published artifact, never local rebuild (P9) |
| System bun absent on a dev machine | Dev build / publish fails | Dev/publish require system bun (already the contributor requirement); consumers never need it |
| Lockfile schema change breaks rollback | Rollback can't read new lockfiles | Additive, version-gated, forward-compatible parsing |
| Install scripts run untrusted code at publish | Producer/supply-chain risk | Package name+version trust, explicit producer consent, staging, timeout, checksummed provenance (deferred Phase 7) |
| Runtime trust overstated | Users think pure-JS deps are sandboxed | Spec states explicitly: install-time gating only, no runtime sandbox |
| Producer repo migration too early | Installs break for released Bakin | Ship publish + consumer install (P4/P6) first, then migrate repos (P10) |
| `BUN_BE_BUN` temptation creeps back | Reintroduces the consumer-build risk | Explicitly deferred; no phase implements it; consumer never builds |
| Converging onto the shared core regresses the working agent-package installer | Breaks the currently-robust content path | Agent installer is the reference, not the rewrite target; P0 characterization tests lock current behavior; P11 is last + behavior-preserving + gated on those tests staying green |
| Plugin install loses state on failure (build-in-place, no rollback) — current bug | Half-installed plugins | P5/P6 move plugins onto the shared staging→atomic→rollback core, matching agent packages |

## Commit Strategy

Keep commits small and independently revertible. Commit label == phase number
(`C10` spans `C10a`/`C10b` across two repos):

- C0   Fixtures + hermetic artifact host + agent-package characterization tests.
- C1   Lazy browser plugin loading (ships first, decoupled).
- C2   Shared system-bun build backend.
- C3   Artifact format + provenance + verification.
- C4   Producer publish pipeline + CI action.
- C5   Shared install core (extract from the proven agent-package patterns).
- C6   Consumer plugin install on the shared core.
- C7   [DEFERRED post-v1] Elevated install-script / native trust.
- C8   Dev hot reload on Whiskit.
- C9   Startup verifier + legacy-install migration + doctor refetch.
- C10a Bakin docs: source-only producer contract.
- C10b Official repo migration: publish artifacts, drop committed dist.
- C11  Agent-package convergence onto the shared core (last, behavior-preserving).
- C12  Release hardening (both primitives).

Ship C1 (lazy loading) on its own PR ahead of everything else. Keep C11
(agent-package convergence) last and on its own PR, gated on the C0
characterization tests — do not fold it into a builder PR. Avoid combining C10
(repo migration) with any builder PR — different failure modes, separate review.
```
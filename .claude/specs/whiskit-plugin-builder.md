# Spec: Whiskit Plugin Builder

Status: In flight — P0–P6, P8, P10 shipped; P7 deferred post-v1; P9 mostly
shipped; P11 partial; P12 not started. Per-phase detail in the companion
plan's Status block.
Date: 2026-06-04 (status updated 2026-06-05)
Related issue: https://github.com/markhayden/bakin/issues/267
Companion plan: `.claude/specs/whiskit-plugin-builder-plan.md`

## Objective

**Primary goal: rock-solid, regression-free installation for both Bakin
install primitives — plugins and agent packages (agent kits).** No more
battling dependencies, partial/half-applied installs, or fragile
build-and-commit `dist/` dances that bloat repos and silently go stale when
someone forgets to rebuild. A continuous secondary aim is keeping the UI feeling
fast (addressed by lazy loading, decoupled from the install work).

Whiskit is therefore two things:

1. A **shared, hardened install core** — source parsing, fetch, atomic
   staging→publish with rollback, install locking, lockfile IO, and provenance —
   consumed by **both** the plugin and agent-package install paths, so the two
   stop drifting into subtly-different implementations of "the same install."
2. A **plugin-specific layer** on top: build, validation, publish (checksummed;
   signing reserved post-v1), and the consumer-side path that materializes
   published plugin artifacts — so a non-developer never compiles a plugin, and
   producer repos never commit `dist/`.

Agent packages are pure content (no build, no dependencies, no `dist/`), so they
need only layer 1; plugins need both.

The plugin layer's reliability sub-goal is to make installation work for
non-developer users while keeping authoring fast for developers — **without ever
asking a non-developer's machine to compile a plugin.**

Normal users should be able to install Bakin and plugins with:

```sh
bakin plugins install github:markhayden/bakin-bits-official#plugins/messaging
```

They should not need to install or understand Bun, Node, npm, git, a source
checkout, committed `dist/` artifacts, or a build toolchain of any kind. On
their machine, install is **download → verify → validate → publish**, never
build.

Plugin producers ship source. The build happens where a real toolchain already
exists — producer CI (to publish official/third-party artifacts) and developer
machines running `--dev` against a local checkout. The same Whiskit build code
runs in both; it never runs on a consumer's machine.

## Scope: Two Primitives, One Install Core

Bakin has two install primitives that today run **parallel, drifted**
implementations of the same fundamentals — a regression source in itself:

- **Plugins** ship code: build → `dist/` → activate. Source via `git clone`
  (`github-source-cache.ts`) + `parseGithubSource`. Install **copies to target
  then builds in place with no rollback**, has no pre-flight collision check,
  and records no per-file provenance. This is the **weaker, more regression-prone
  installer**.
- **Agent packages** ship content (SOUL/IDENTITY/skills/workflows/lessons/assets;
  no build, no deps, no `dist/`). Source via a *separate* `parseGithubSpec` +
  fetch wrapper over the *same* `github-source-cache.ts`. Install is
  **staging → atomic rename, with an advisory install lock, write-log rollback,
  `.installedBy` provenance sidecars, and `.userEdited` sentinels**. This is the
  **more robust installer** and is largely rock-solid today.

Reference-implementation principle: **the agent-package installer is the proven
reference. Plugins converge *up* to its robustness via the shared core; agent
packages are migrated onto that core *last*, behavior-preserving, only after
characterization tests lock their current behavior.** We do not risk the working
content path to achieve sharing — the win is eliminating drift and lifting
plugins, not rewriting what already works.

What the shared core unifies (one implementation, both primitives consume):
source-string parsing, source fetch/materialization (incl. the no-system-git
HTTPS path), staging → atomic publish, rollback, install locking, lockfile IO,
and provenance/`.installedBy`. What stays primitive-specific: the plugin build /
artifact / publish layer (plugins only) and runtime-agent creation /
lesson-marker projection (agent packages only).

Agent packages also have two of their own gaps to close cheaply once on the
shared core: finishing the deferred pre-flight collision check, and adding
manifest-integrity hashing (which plugins already have via `manifestSha`).

## The Two-Lane Model

This is the central decision of the revised spec. There are two distinct
personas with two distinct paths that barely overlap.

### Lane 1 — Consumer (the happy path, ~all real installs)

Who: a non-developer running the released Bakin binary on a Mac mini.

What they install: **official / published plugins** whose build and publishing we
(or a trusted third-party producer) control.

How install works on their machine:

1. Resolve the source ref to a **published release artifact** for their
   platform.
2. Download the artifact over HTTPS.
3. Verify checksum and provenance (signature deferred post-v1; see Open Q1).
4. Validate manifest, permissions, externals-contract compatibility.
5. Atomically publish into `~/.bakin/plugins/<id>/` and activate.

No Bun, Node, npm, git, compiler, or `bun install`. The binary never invokes a
build. Install latency is a download plus a hash check.

### Lane 2 — Producer / Developer

Who: someone building a plugin (their own, or contributing to an official one).

What they have: a **local source checkout** and **system Bun** on PATH (already
the documented contributor requirement — see `CONTRIBUTING.md`).

How build works:

- `bakin plugins install --dev .` + `bakin dev` builds from local source using
  the Whiskit build backend, which **shells out to system `bun`** for both
  server and client builds, plus `bun install` for declared dependencies. Hot
  reload stays fast.
- `bakin plugins publish` (or the reusable GitHub Action) runs the **same**
  Whiskit build in CI across the supported platform matrix, then signs and
  attaches per-platform artifacts to a GitHub release. This is how Lane-2 source
  becomes a Lane-1 consumable.

The build pipeline is identical code in dev and CI. The only difference is where
it runs and what it emits (a hot-swapped local `dist/` vs. a checksummed release
artifact). **It never runs on a consumer machine.**

### Why this shape

Every mature plugin/extension ecosystem builds in CI and distributes prebuilt
(VS Code `.vsix`, Obsidian release `main.js`, Homebrew bottles, npm prebuilt
native binaries), falling back to source build only for developers — exactly
where a toolchain already exists. The earlier draft inverted this and made
"compile a remote repo on the consumer's machine" the default, which forced a
binary self-build mechanism (`BUN_BE_BUN`), on-device `bun install`, on-device
install-script consent, and on-device native compilation. The two-lane model
removes all of those from the critical path.

The spec's own platform-CI requirement for native plugins already implies this:
if CI must build and prove `sharp` on `darwin-arm64` before release anyway, ship
that artifact rather than rebuilding it on the user's machine.

## End-User Experience Walkthrough

### A. Non-developer installs an official plugin (Lane 1)

```sh
bakin plugins install github:markhayden/bakin-bits-official#plugins/messaging
```

1. Whiskit parses the source string (`packages/core/src/plugins/source.ts`) and
   resolves owner/repo/ref/subpath.
2. Whiskit looks for a **published artifact** for `messaging` at the resolved
   ref matching the current platform (`darwin-arm64`). The lookup target is a
   release asset named by a stable convention (see "Published Artifact").
3. Found → download over HTTPS, verify checksum, verify the artifact provenance
   declares a compatible `externalsContract` and Bakin range.
4. Validate manifest + permissions, run permission consent if needed.
5. Atomically publish into `~/.bakin/plugins/messaging/` and live-activate.

Time cost: one download + hash verify. No compiler, no network beyond the
artifact host.

### B. Non-developer wants a community plugin with no published artifact

```text
NO_PREBUILT_ARTIFACT: messaging-fork has no published release for darwin-arm64.

Ask the plugin author to publish a release, or install it as a developer:
  1. git clone / download the repo
  2. install Bun (https://bun.sh)
  3. bakin plugins install --dev ./messaging-fork
```

Bakin does **not** silently attempt an on-device compile. A non-developer
machine is, by definition, not set up to build, and we will not pretend it is.

### C. Developer builds their own plugin (Lane 2)

```sh
bakin plugins install --dev .
bakin dev
```

- Whiskit builds from the local checkout using system `bun` (build + install).
- Hot reload rebuilds + hot-swaps on save (existing coordinator behavior).
- No remote fetch, no artifact, no signing.

### D. Producer publishes a plugin (Lane 2 → Lane 1)

```sh
bakin plugins publish ./plugins/messaging
# or, in CI, the reusable GitHub Action
```

- Runs Whiskit build across the declared platform matrix.
- For native/scripted plugins, runs `bun install` with the producer's declared,
  consented install-script trust — **on CI, under the producer's authority**,
  not on a consumer.
- Emits one checksummed artifact per platform, attached to the GitHub release
  (signature deferred post-v1).

### E. Developer installs a third-party plugin from a remote repo (residual edge)

This is the only case the consumer-vs-source distinction blurs. Resolution
order:

1. If the repo publishes artifacts → Lane 1 (download/verify), even for a dev.
2. Else, if the developer has system Bun → optional deferred path: build the
   remote source locally with system `bun` (see "Deferred: remote source
   build"). This is a developer convenience, gated on system Bun, never the
   non-dev path.
3. Else → the Lane-1 "no prebuilt artifact" error.

## Core Decisions

**Overarching:** install reliability for **both** primitives is the primary goal;
a shared hardened install core serves plugin and agent-package install alike. The
agent-package installer is the proven reference; plugins converge up to it, and
agent packages move onto the shared core last and behavior-preserving.

1. Whiskit is the public boundary. The implementation backend is private.
2. **The consumer binary never builds.** Lane-1 install is download → verify →
   validate → publish. Build happens only in CI (publish) and on developer
   machines (`--dev`), both of which have system Bun.
3. The Whiskit build backend shells out to **system `bun`** for build and
   `bun install`. It does not depend on in-process `Bun.build()` being available
   inside a compiled binary, and does not depend on a binary self-invoke trick.
4. `BUN_BE_BUN=1` self-invoke is **deferred / rejected for v1**. It is only
   relevant to the residual edge case of compiling remote source on a non-dev
   machine, which the two-lane model removes from the critical path. See
   "Deferred: remote source build."
5. GitHub plugin installs for consumers fetch **published release artifacts**
   over HTTPS. No system git required. Developer/source paths may keep system
   git and/or a local checkout.
6. Plugin repos that serve plugins must not commit `dist/`. Built artifacts are
   produced by CI and distributed as checksummed release assets (signing reserved
   post-v1), never committed to the source tree.
7. Native and install-script dependencies are resolved **at publish time in CI**
   on the supported platform matrix, and shipped inside the per-platform
   artifact. They are not installed or compiled on consumer machines.
8. Install scripts are allowed only through explicit producer-side trust
   declarations, visible producer consent at publish time, staging isolation,
   and checksummed provenance recorded in the artifact and the consumer lockfile
   (signing deferred post-v1).
9. Startup never performs install-grade plugin builds. Startup verifies recorded
   artifact provenance + checksum and activates verified artifacts.
10. Dev-linked plugins keep hot reload fast using the system-`bun` build backend
    against a local source checkout.
11. Official plugins with elevated install scripts or native dependencies must
    prove install/build on every supported platform in CI before release — and
    those CI outputs **are** the shipped artifacts.

## Current State

Current plugin build behavior is split:

- Core plugins build through `scripts/build-plugins.ts`, delegating to
  `scripts/dev-build-one-plugin.ts` (shells out to `bun build`; does not run
  `bun install`).
- User plugins build through
  `packages/host/src/plugin-host/user-plugin-builder.ts`. `buildUserPlugin()`
  runs `bun install` when deps are declared, scans imports with a Bun
  `Transpiler`, builds the **server in-process via `Bun.build()`**, and builds
  the **client by shelling out to `bun build`**.
- User install, dev-link, upgrade, startup, and hot reload all call the user
  plugin builder directly.
- Normal startup calls `buildAllUserPlugins()` before the registry imports user
  plugins — it rebuilds stale plugins on every cold start.
- GitHub source materialization uses **system `git clone --depth 1`** via
  `src/core/github-source-cache.ts`. It does not download archives over HTTPS.
- GitHub-installed plugins were historically treated as trusted prebuilt
  `dist/` when present, via the `trustExistingDist` policy in the builder and
  lockfile. That policy was removed (fix/security T6, `1d4a4b34`): source
  installs always rebuild, and the install commit deletes any shipped
  `dist/` before compiling. Only provenance-verified Whiskit artifacts skip
  the rebuild.
- `bakin-bits-official` currently has a publisher-side build script and
  explicitly unignores `plugins/*/dist/**` in `.gitignore`.

Implications for this revision:

- The server-side in-process `Bun.build()` path will not work inside a compiled
  consumer binary — which is precisely why the consumer path must not build. The
  build backend should standardize on shelling out to system `bun` so the same
  code works in dev (compiled binary or source run) and CI.
- `trustExistingDist` was the ad-hoc precursor to a real verified-artifact
  model (checksummed; signing reserved post-v1). It was replaced, not
  extended — the option no longer exists.

Local measurements from 2026-06-04:

- `dist/bakin-darwin-arm64`: about 73 MB.
- `dist/bakin-linux-x64`: about 110 MB.
- `dist/bakin-linux-arm64`: about 109 MB.
- Host/vendor/core-plugin browser JS/CSS: about 3.6 MB uncompressed and about
  0.93 MB gzip.
- Core plugin client JS only: about 1.2 MB uncompressed.

Conclusion: Whiskit is primarily an install-correctness, plugin-repo-hygiene,
distribution, and startup/load-time architecture project. It will not by itself
cut the compiled binary in half. The user-visible "Loading plugins" delay is
addressed by lazy browser loading, which is decoupled and can ship first.

## Published Artifact

A published plugin artifact is the Lane-1 distribution unit. One per supported
platform when the plugin has native/platform-specific content; one
platform-neutral artifact when the plugin is pure JS/TS.

Proposed layout (tarball):

```text
messaging-0.1.0-darwin-arm64.tar.zst
  bakin-plugin.json
  dist/
    index.js
    client.js        optional
    client.css       optional
  node_modules/       only the runtime deps the bundle cannot inline
    ...               (e.g. native addons: sharp/*.node, ffmpeg binary)
  .whiskit/
    build.json        provenance (see "Build Provenance")
```

Accompanying release assets:

- `messaging-0.1.0-darwin-arm64.tar.zst.sha256` (mandatory; consumer verifies)
- A per-plugin `whiskit-artifacts.json` index listing available platforms,
  versions, checksums, and the `externalsContract` each was built against.
- `messaging-0.1.0-darwin-arm64.tar.zst.sig` — **deferred (post-v1)**. The
  format reserves an optional signature asset so authenticity signing can be
  added later without changing the layout. Not produced or required in v1.

Key properties:

- **Pure-JS plugins** produce a single platform-neutral artifact; the bundle
  inlines pure-JS deps, so `node_modules/` is absent or empty. Publish verifies
  pureness by inspecting resolved deps (Open Q5) — a dep with `os`/`cpu`
  constraints, platform-keyed `optionalDependencies`, or a native addon forces
  the plugin into the per-platform path.
- **Native/scripted plugins** produce per-platform artifacts; `node_modules/`
  carries only the runtime files the bundle cannot inline (native addons,
  downloaded binaries). This is the answer to "where do native deps live at
  runtime" — they ship inside the artifact, produced once in CI.
- The consumer never runs `bun install`; whatever the plugin needs at runtime is
  already in the artifact.

## Whiskit Contract

Whiskit exposes one internal build contract used by `--dev` build, CI publish,
and (deferred) remote source build. It also exposes a separate consumer-side
materialize/verify contract.

```ts
// Build contract — runs in CI (publish) and on dev machines (--dev). Never on a
// consumer machine.
interface WhiskitBuildRequest {
  pluginId: string
  sourceDir: string
  outputDir: string
  mode: 'production' | 'development'
  sourceKind: 'local-copy' | 'linked-source' | 'core'
  platform: string            // build target, e.g. 'darwin-arm64'
  allowInstallScripts: boolean
  approvedScriptPackages: string[]
  expectedBakinVersion: string
}

interface WhiskitBuildResult {
  ok: true
  manifest: PublicPluginManifest
  buildId: string
  sourceTreeSha: string
  manifestSha: string
  packageLockSha?: string
  externalsContract: string
  platform: string
  outputs: {
    serverEntry: string
    clientEntry?: string
    clientCss?: string
    runtimeModules?: string[]  // native/runtime files kept in node_modules
  }
  provenance: WhiskitBuildProvenance
}

// Consumer contract — runs on every machine, including the released binary.
interface WhiskitArtifactRequest {
  pluginId: string
  source: string              // parsed via packages/core/src/plugins/source.ts
  platform: string
  expectedBakinVersion: string
}

// Pluggable artifact resolution (Open Q2). v1 ships only the
// github-release-assets implementation. Everything below resolve() —
// download, checksum-verify, extract, validate, publish — is shared and
// ecosystem-agnostic.
interface WhiskitArtifactResolver {
  scheme: string                              // 'github' (v1), later 'mirror' | 'npm' | ...
  canResolve(source: ParsedSource): boolean
  resolve(req: WhiskitArtifactRequest): Promise<WhiskitArtifactLocation | WhiskitFailure>
}

interface WhiskitArtifactLocation {
  artifactUrl: string
  checksum: string            // SHA256, from the signed-later whiskit-artifacts.json index
  indexUrl: string
  sourceCommitSha?: string
}

interface WhiskitArtifactResult {
  ok: true
  artifactPath: string        // verified, in staging
  manifest: PublicPluginManifest
  provenance: WhiskitBuildProvenance
  checksum: string            // mandatory, verified in v1
  signatureVerified?: boolean // reserved; signing deferred post-v1 (Open Q1)
}

interface WhiskitFailure {
  ok: false
  code:
    | 'SOURCE_PARSE_FAILED'
    | 'NO_PREBUILT_ARTIFACT'
    | 'ARTIFACT_FETCH_FAILED'
    | 'CHECKSUM_MISMATCH'
    | 'SIGNATURE_INVALID'        // reserved; signing deferred post-v1 (Open Q1)
    | 'MANIFEST_INVALID'
    | 'BAKIN_RANGE_INCOMPATIBLE'
    | 'EXTERNALS_CONTRACT_INCOMPATIBLE'
    | 'UNSUPPORTED_PLATFORM'
    // build-path only (CI/dev):
    | 'DEPENDENCY_DECLARATION_INVALID'
    | 'SCRIPT_CONSENT_REQUIRED'
    | 'SCRIPT_BLOCKED'
    | 'DEPENDENCY_INSTALL_FAILED'
    | 'SERVER_BUILD_FAILED'
    | 'CLIENT_BUILD_FAILED'
    | 'OUTPUT_VALIDATION_FAILED'
  message: string
  details?: Record<string, unknown>
}
```

Public CLI/API layers render stable error codes and concise messages. Raw `bun`
output attaches to verbose logs only; it is not the contract.

## Publish Pipeline

Producers turn source into Lane-1 artifacts.

`bakin plugins publish <pluginDir> [--platforms ...] [--allow-install-scripts]`:

1. Validate manifest, dependency declarations, Bakin range, and script-trust
   declarations.
2. For each requested platform (locally only the host platform; full matrix in
   CI):
   - Materialize source to staging.
   - Run Whiskit build with system `bun` (build + `bun install`).
   - For native/scripted plugins, run the producer's consented install scripts.
   - Validate outputs.
   - Assemble the artifact tarball with `dist/`, required `node_modules/`, and
     `.whiskit/build.json`.
   - Emit checksum (signature deferred post-v1).
3. Assemble `whiskit-artifacts.json` for this release: the rebuilt plugin's new
   entries, **carried forward** with the previous latest index's entries for all
   plugins not rebuilt (their absolute URLs still point at older releases). Attach
   the index + new artifacts to the GitHub release. This makes each release a
   complete catalog while letting plugins release independently.

A reusable GitHub Action wraps the same command with a platform matrix so a
hobbyist producer adds ~10 lines of workflow to get multi-platform artifacts.
Pure-JS plugins need only the host platform job.

## Source Materialization

Lane-1 consumer install does **not** fetch source. It fetches the published
artifact:

1. Parse the source string through `packages/core/src/plugins/source.ts`,
   keeping the existing `github:owner/repo@ref#subpath` and `--ref` behavior as
   the single source of truth.
2. Resolve owner/repo/ref/subpath and the platform.
3. Resolve `whiskit-artifacts.json` to the artifact URL for that
   plugin/version/platform: for "latest", read the `releases/latest/download/`
   redirect; for a pinned `@tag`, read that tag's index. The matched entry's
   absolute URL may point at an older release (carry-forward).
4. Download the artifact + checksum over HTTPS (signature deferred post-v1).
5. Verify checksum and provenance compatibility.
6. Extract into staging with path-traversal / zip-slip protection,
   escaping-symlink rejection, and a size cap.
7. Record provenance in the lockfile.

Lane-2 dev build uses the local checkout directly (no fetch). For exact upstream
provenance, publish records the commit SHA in the artifact at build time, so the
consumer inherits a real commit SHA without needing the GitHub API at install.

`bakin plugins list --check` for artifact-installed plugins compares the
installed artifact version against the latest `whiskit-artifacts.json` via the
`releases/latest/download/` redirect over HTTPS — no GitHub API, no rate limit,
not `git ls-remote`.

## Dependency Install And Script Trust

Dependency installation happens **only in the build path (CI/dev)**, never on a
consumer.

Default build mode:

- Install only runtime dependencies needed to build/activate the plugin.
- Use Whiskit-controlled cache directories.
- Run `bun install` with `--ignore-scripts` by default.
- Allow Bun's package-level `trustedDependencies` only for packages explicitly
  declared in the manifest and consented by the **producer** at publish time.
- No wildcard package trust.
- Bounded timeouts and output capture; staging only.

Elevated install-script mode (publish/dev only):

- Requires manifest-declared packages, each with reason + platforms.
- Requires producer consent at publish time (`--allow-install-scripts` or
  interactive prompt). This is the producer's machine/CI, not the consumer's.
- Records approved package **name + version** (not just name), platform, Whiskit
  version, build backend, and result in `.whiskit/build.json`.
- Re-consent is keyed on package identity (name + version) or `packageLockSha`,
  so a version bump of an already-trusted scripted package re-prompts rather
  than silently running new code.

Consumer side:

- The consumer never runs install scripts. It verifies the artifact checksum and
  the `approvedInstallScripts` provenance, and may surface what scripts ran at
  publish time for transparency.

## Build Outputs

Lane-1 installed layout (extracted artifact):

```text
~/.bakin/plugins/<id>/
  bakin-plugin.json
  dist/
    index.js
    client.js        optional
    client.css       optional
  node_modules/       only when the plugin has native/runtime deps
  .whiskit/
    build.json
```

The runtime registry imports only `dist/index.js` for user plugins. `dist/` and
`node_modules/` are artifact contents — not committed in producer repos, safe to
delete and re-fetch, covered by checksummed provenance.

Lane-2 dev layout is the developer's own checkout plus a locally built `dist/`
(gitignored).

## Build Provenance

Whiskit writes a build record into the artifact at publish time:

```json
{
  "version": 2,
  "pluginId": "messaging",
  "pluginVersion": "0.1.0",
  "bakinVersion": "0.0.1-rc.15",
  "bakinRange": ">=0.0.1-rc.15 <0.1.0",
  "whiskitVersion": "1",
  "buildBackend": "system-bun",
  "platform": "darwin-arm64",
  "sourceCommitSha": "...",
  "sourceTreeSha": "...",
  "manifestSha": "...",
  "packageLockSha": "...",
  "externalsContract": "react19-sdk-makinbakin-v2",
  "approvedInstallScripts": [
    {
      "package": "sharp",
      "version": "0.34.5",
      "reason": "Installs platform image-processing binaries"
    }
  ],
  "outputs": {
    "serverEntry": "dist/index.js",
    "clientEntry": "dist/client.js",
    "runtimeModules": ["node_modules/sharp"]
  },
  "builtAt": "2026-06-04T00:00:00.000Z"
}
```

Startup uses this record (plus checksum verification) to decide whether
artifacts are valid. It does not rebuild on the normal cold-start path.

## Install Transaction

Lane-1 consumer install is all-or-nothing:

1. Parse source; resolve platform + artifact URL.
2. Download artifact + checksum into staging (signature deferred post-v1).
3. Verify checksum, manifest, permissions, Bakin range, and `externalsContract`
   compatibility.
4. Run permission consent gates.
5. Extract into staging (zip-slip / symlink / size guarded).
6. Install plugin-owned defaults/assets from staging if needed.
7. Atomically replace or publish `~/.bakin/plugins/<id>`.
8. Extend the lockfile entry with artifact provenance, checksum, approved script
   packages, and source metadata (signature status reserved post-v1).
9. Live-activate if the registry is running, using a cache-busted `import()` so
   an upgrade does not load a stale module.

If any step before publish fails, active plugin state is unchanged. If live
activation fails after publish, Bakin reports a clear activation failure and
retains enough state for rollback or doctor repair. Upgrade follows the same
shape with prior-state rollback.

Lockfile schema changes are additive and version-gated so a code rollback can
still read newer lockfiles (forward-compatible parsing).

## Browser Loading Direction

**Important framing:** prebuilt artifacts do **not** speed up the browser. Plugin
client bundles are already prebuilt today — the browser imports `client.js`, it
never builds. The build/distribution rework speeds up *install* and *server
startup* (the startup-verifier phase stops rebuilding at boot), not the browser. The user-visible
"Loading plugins" delay is fixed **only** by this section, which is decoupled
from Whiskit and should ship first.

The delay's actual cause (`PluginHost.tsx`): the host `Promise.all`-imports
**every** plugin's full `client.js` and waits for all of them to download +
execute before rendering the shell. Today that is ~1.2 MB of core-plugin client
JS plus user/official plugins (e.g. the official `messaging` client.js is
~690 KB), eagerly, every cold load.

**This is not a host-only change.** Investigation of the current code shows:

- `registerPlugin` (`packages/sdk/src/register.ts`) takes `routes`/`slots` as
  **eager `ComponentType` references**, not lazy factories.
- Each plugin's `client.tsx` imports all its page components at module top and
  passes them to `registerPlugin`, so importing `client.js` pulls the whole
  bundle's code just to register a nav item.
- Plugins build as a **single bundle, no code-splitting**.
- Nav items are **not** in the manifest — they exist only after `client.js`
  executes.

CHOSEN APPROACH (2026-06-04): **(a) Declarative metadata in the manifest.** Move
nav/route/slot metadata into `bakin-plugin.json` (extending the existing
`contributes.clientRoutes` precedent), so the sidebar renders from manifest JSON
without executing any `client.js`; a plugin's bundle imports only on first
navigation into one of its routes. Chosen over (b) lazy-factories+code-splitting
because it gives the bigger boot win (zero plugin JS for unvisited plugins),
avoids code-splitting (the riskiest interaction with the import-map / externals /
per-plugin versioned hot-reload machinery), and builds on a pattern already in
the repo. Param routes (`/tasks/[id]`) are fully supported — the path pattern is
declared, the component lazy-loads. The known costs are accepted and mitigated:

- **Drift** (manifest declares a path/nav the runtime registration doesn't
  supply, or vice versa) → a validation check at build/publish + a startup
  diagnostic.
- **Conditional/dynamic nav visibility** is not expressible in static manifest
  JSON. Not needed today (no conditional nav exists). Addressable later, per
  plugin, via the retained **runtime-registration escape hatch** for `eager:
  true` plugins — no rework required. (b)'s per-route code-splitting likewise
  remains a future optimization layerable on top of (a) for any single oversized
  plugin.

Target behavior:

- The shell renders after the manifest fetch + a small eager registration step
  only.
- Most plugin route component code loads when the route is first visited.
- Background providers (e.g. the `nav-badge-providers` slot) opt in with
  explicit `eager: true`.
- Failed lazy imports surface plugin-local errors without blanking the app.

This is still independent of the build/artifact/install pipeline (so it ships
first), but it is a real SDK-contract + per-plugin change, not a one-file swap.

## Security Boundaries

Always:

- Consumers verify the mandatory SHA256 checksum + provenance before extracting
  an artifact (signature verification is deferred post-v1; see Open Question 1).
  Treat artifacts as untrusted input regardless: guard extraction against
  zip-slip / path traversal, cap decompressed size, and **reject symlink entries
  that resolve outside the extraction root**. Note the tension: artifacts for
  native plugins ship `node_modules/`, which can contain internal symlinks — so
  the rule is "reject escaping symlinks," not "reject all symlinks," OR the
  publish step packs `node_modules/` hoisted/symlink-free. (Pure-JS plugins ship
  no `node_modules/`, so this only affects native plugins, of which there are
  none today.)
- Build from source in staging (CI/dev), validate manifests before dependency
  install, reject imports from app internals, `@bakin/core`, old `@bakin/sdk`,
  and undeclared third-party packages.
- Reject third-party dependencies that themselves import React or another
  host-singleton, so the "one React, one SDK" invariant holds. Such deps must be
  externalized by the host or refused.
- Keep host-provided externals explicit and one React / one SDK per instance.
- Disable broad install-script execution by default; record elevated trust with
  package name + version in checksummed provenance and the lockfile.
- Redact raw command output in user-facing errors.
- Be explicit that Whiskit gates **install-time** script execution only. All
  plugin code is fully trusted **at runtime** — there is no runtime sandbox. A
  pure-JS dependency with no install script still runs arbitrary code in-process
  at activation. Consent prompts must not imply otherwise.

Ask first:

- Allowing install scripts for package dependencies (producer consent at
  publish).
- Supporting native/system dependencies for an official plugin.
- Adding a new host-provided external.
- Changing the plugin manifest build-trust schema after it is published.
- Distributing or rotating artifact-signing keys.

Never:

- Build a plugin on a consumer machine.
- Commit plugin `dist/` in repos that serve plugins.
- Import user plugin source directly at runtime.
- Mutate active plugin state before verification/build succeeds.
- Require normal users to install Bun, Node, npm, or git.
- Treat `BUN_BE_BUN=1` as public API, or rely on it in the consumer path.
- Allow wildcard trusted install scripts.

## Deferred: Remote Source Build

Compiling a remote (non-published) plugin on the installing machine is
explicitly out of v1 scope. It is the only case that would require either system
Bun on a consumer machine or a `BUN_BE_BUN` self-invoke in the compiled binary.

If revisited later, it is a **developer-only** convenience: `install
github:owner/repo#sub` on a machine **with system Bun present** may build the
remote source locally. It is never offered on a machine without system Bun, and
never on the non-developer happy path. The `BUN_BE_BUN` self-invoke remains
rejected unless a concrete, measured need appears that the publish model cannot
serve.

## Host Upgrade Compatibility

Externals versions are additive within the same family: a v2 host can load v1
and v2 artifacts, while a v1 host rejects artifacts that require v2. A breaking
React or SDK change starts an incompatible family. Installed artifacts whose
provenance contract the host cannot satisfy are marked **needs-update**, not
silently inactive-forever. The repair path is to fetch a
newer compatible **published artifact** (a normal download), not a local
rebuild. Doctor surfaces this and can perform the re-fetch. This avoids the
"upgrade Bakin → all plugins vanish until manual rebuild" failure mode, and is
consistent with "consumers never build."

## Testing Strategy

1. Unit: source parsing (the unified parser), artifact resolution, checksum
   verification, provenance read/write/validate, source hashing, manifest
   build-schema parsing, dependency scanning, script-trust (name+version
   re-consent), externals-contract compatibility.
2. Consumer-path: artifact download/verify/extract with hermetic fixtures (a
   local fixture artifact server; no real network, no `~/.bakin`, no `~/.openclaw`
   — per the project testing rules). Cover `NO_PREBUILT_ARTIFACT`,
   `CHECKSUM_MISMATCH`, zip-slip rejection, escaping-symlink rejection, size-cap.
3. Build-path: Whiskit build via system `bun` against source-only fixtures (v1
   pure-JS; a native/scripted fixture lands with the deferred Phase 7). Use a
   vendored offline dependency fixture or a local registry — no live npm.
4. Shared install core / transaction (both primitives): failed verification or
   extract does not mutate active plugin/agent-package directories or lockfiles;
   failed upgrade keeps the prior artifact active; rollback unwinds cleanly. The
   P0 agent-package characterization suite must stay green through the
   convergence.
5. Dev-link hot reload: build failures keep the old plugin active; successes
   hot-swap; uses system `bun`, works whether Bakin runs as source or compiled
   binary.
6. Publish pipeline: `bakin plugins publish` emits a verifiable artifact +
   checksum + carried-forward index (signature deferred post-v1).
7. Browser: lazy plugin-client loading (declarative manifest metadata) and
   failed-lazy-import behavior.

## Commands

Focused tests expected during implementation:

```sh
bun test --isolate tests/core/whiskit/*.test.ts
bun test --isolate tests/api/plugins-build.test.ts
bun test --isolate tests/plugins/lifecycle/install-artifact.test.ts
bun test --isolate tests/plugins/lifecycle/install-subpath.test.ts
bun test --isolate tests/plugins/lifecycle/upgrade-flow.integration.test.ts
bun test --isolate tests/plugins/lifecycle/hot-reload-integration.test.ts
bun test --isolate tests/components/plugin-host.test.tsx
```

Build/release checks:

```sh
bun run typecheck
bun test --isolate
bun run build:vendors
bun run build:plugins
bun run build:host-shell
bun run build:assert-production-assets
bun run build:binary
```

Manual smoke (consumer path, no toolchain):

```sh
BAKIN_HOME=/tmp/bakin-whiskit-home ./dist/bakin-darwin-arm64 \
  plugins install github:markhayden/bakin-bits-official#plugins/messaging
```

Manual smoke (producer publish):

```sh
bakin plugins publish ./plugins/messaging --platforms darwin-arm64
```

## Open Questions

1. RESOLVED (2026-06-04): **Checksum-only for all plugins in v1; signing
   deferred.** Every artifact ships a mandatory SHA256 that the consumer
   verifies on download (catches corruption/MITM). No keys, no signing, no
   Bakin-release coupling — any developer publishes a tarball + checksum and
   anyone installs it with zero ceremony, which is the core goal. Authenticity
   signing (an "official producer" badge) is a later upgrade, justified only the
   day a third party could plausibly impersonate the official producer. The
   artifact format already reserves an optional `.sig` asset + the signed-index
   shape, so signing slots in without a rewrite. If/when added, the likely path
   is an Ed25519 official key anchored in the already-notarized Bakin binary,
   with third-party staying checksum-only.
2. RESOLVED (2026-06-04): **Pluggable artifact resolver; GitHub release assets
   are the only v1 backend.** Artifact resolution goes through a
   `WhiskitArtifactResolver` interface (`scheme` + `canResolve` + `resolve`)
   whose sole job is to turn a parsed source ref into a verified-against-checksum
   artifact location (or buildable source). Everything downstream — download,
   checksum-verify, extract, validate, publish, activate — sits *below* the
   resolver and is ecosystem-agnostic (never references GitHub/npm directly),
   mirroring how `source.ts` is the single source-parse point. v1 ships exactly
   one resolver: github-release-assets. A self-hosted mirror is a pure
   location/transport adapter (one new `resolve()`, zero downstream changes). A
   foreign ecosystem (npm/JSR/OCI; pip is not a fit for JS plugins) is a new
   adapter that maps the registry's response into our artifact/source shape — a
   new resolver, not an install rewrite. v1 assumes **public** repos; private-repo
   token auth is deferred. `--check` polls the release's `whiskit-artifacts.json`
   over HTTPS (a release-asset fetch, not the rate-limited GitHub API), which
   partly subsumes Open Question 3.
3. RESOLVED (2026-06-04): **Per-release immutable index + `releases/latest`
   redirect + carry-forward, enabling independent per-plugin releases.**
   - Each GitHub release attaches an **immutable** `whiskit-artifacts.json`.
   - Index entries carry **absolute** artifact URLs, so an entry may point at a
     tarball attached to an *older* release.
   - On publish, the tool **carries forward** unchanged plugins' entries from the
     previous latest index, so the latest index is always a **complete catalog**
     even when a release rebuilt only one plugin. This is what lets plugins in a
     monorepo release **independently** (clear blast radius; scales to many
     plugins) without forcing a full re-publish each time.
   - "Latest" is read via GitHub's stable, unauthenticated, **non-API** redirect
     `https://github.com/owner/repo/releases/latest/download/whiskit-artifacts.json`
     — no rate limit, no API call. `--check` uses the same URL.
   - Pinned installs (`@tag`) read that tag's index directly at
     `releases/download/<tag>/whiskit-artifacts.json`.
4. RESOLVED (2026-06-04):
   - **Script trust: single field `build.installScripts`.** Gate on the real
     risk (a package running a lifecycle/postinstall script), not on
     "native" — a pure-JS package can have a malicious postinstall and a native
     package can ship prebuilt binaries with no script, so "native" is
     explanatory metadata, not the trust boundary. There is no
     `nativeDependencies` field. Each entry: `package`, `version` (a declared
     range that must match the resolved version at publish; the lockfile records
     the exact resolved version and drives name+version re-consent), `reason`,
     and `platforms` (producer's proven-on claim; build fails
     `UNSUPPORTED_PLATFORM` if the build platform isn't listed).
   - **Compatibility: reuse the existing manifest `bakin` field** (the official
     plugins already use `"bakin": ">=0.0.1-rc.1"` — do NOT introduce a separate
     `bakinRange` field). It is an explicit semver range string, evaluated with
     `includePrerelease: true`. Pre-1.0 + RC tags (`0.0.1-rc.15`) make
     caret/tilde shorthand a foot-gun (standard semver excludes prereleases from
     `^0.0.1`, and `0.0.z` treats every patch as breaking), so require an explicit
     two-sided range like `">=0.0.1-rc.15 <0.1.0"`. The `bakin` field is
     **optional**; when omitted (or only a floor like `>=x`), `bakin plugins
     publish` stamps a range derived from the Bakin version it built against
     (`>=<built-version> <next-minor>`) into provenance — honest by construction,
     never broader than what was built. Provenance stores the resolved range as
     `bakinRange`; the manifest authoring field stays `bakin`. Mismatch →
     `BAKIN_RANGE_INCOMPATIBLE` at install, `needs-update` at startup after a host
     upgrade.
5. RESOLVED (2026-06-04): **Default to one platform-neutral artifact, but
   `bakin plugins publish` detects platform-sensitivity and forces a matrix.**
   Publish inspects resolved dependency metadata (after `bun install`) and marks
   the plugin platform-specific if any dep has `os`/`cpu` constraints,
   platform-keyed `optionalDependencies` (esbuild/swc/lightningcss-style), or a
   native addon. Platform-specific → require per-platform artifacts (or fail with
   a clear "not pure-JS; declare platforms"). Genuinely pure plugins stay
   single-artifact and frictionless. The tool checks reality rather than trusting
   the producer to self-classify — same spirit as deriving `bakinRange` from the
   build.
6. RESOLVED (2026-06-04): **Lazy browser loading ships first, in its own PR,
   ahead of the builder rework.** It is the actual user-visible #267 complaint,
   is fully decoupled (a self-contained host + SDK-registration change to replace
   the `Promise.all` eager import in `PluginHost.tsx`; touches none of the
   build/artifact/install machinery), and has a clean independent rollback. Plan
   sequences it as Phase 1 / C1. Not gated behind the distribution rework.
```

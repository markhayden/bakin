---
title: Distribute
description: Publish checksummed plugin artifacts with bakin plugins publish, and understand how installs, update checks, and upgrades flow through the Whiskit artifact lane.
---

Bakin distributes plugins as prebuilt, checksum-verified artifacts — the Whiskit lane. A consumer's machine never needs git, Bun, or the SDK to install or upgrade a published plugin.

## Publish

From the plugin's source directory:

```sh
bakin plugins publish ./my-plugin --build --out ./release
```

`--build` compiles the plugin first through the shared build backend (system `bun`): declared dependencies install with `bun install --ignore-scripts`, the client bundle externalizes React and the SDK (the host's import map provides the singletons), and the server bundle inlines the SDK so `dist/index.js` activates without any local SDK install. Without `--build`, publish requires an existing `dist/`.

Publish then assembles the artifact and its release metadata:

- `<id>-<version>-<platform>.tar.gz` — `dist/` + manifest + `.whiskit/build.json` provenance (source files and `node_modules` are excluded)
- a `.sha256` sidecar checksum
- `whiskit-artifacts.json` — the immutable release index. Re-publishing into the same `--out` directory carries forward other plugins' entries, so each release is a complete catalog and plugins in a monorepo release independently.

Attach the artifacts and the index to a GitHub release. The `bakin-bits-official` repo tags `<id>-v<semver>` to drive this in CI.

### SDK sources for the server build

Server bundles inline `@makinbakin/sdk`. The build resolves SDK sources in order: the `BAKIN_SDK_PATH` environment variable (point it at an installed copy of the package — CI/hermetic builds), the Bakin repo's SDK source when publishing from a source checkout, then the plugin's own `node_modules/@makinbakin/sdk` (declare it as a devDependency). The build fails with a remedy when none is available.

## Install

```sh
bakin plugins install github:owner/repo#plugins/my-plugin
```

For a `#subpath` GitHub source, install prefers a published artifact: it reads `whiskit-artifacts.json` from the release's `releases/latest/download/` redirect (or `releases/download/<tag>/` when the source pins `@<tag>`), downloads the artifact, verifies the checksum, safely extracts it, and checks that the host supports the artifact's externals contract. Contract versions are additive within one family, so newer hosts can load artifacts built against an earlier compatible version. Only when no published artifact exists does install fall back to git clone + local build.

## Check and Upgrade

Artifact installs are version-based — there is no remote git sha to compare.

```sh
bakin plugins list --check   # polls each release's whiskit-artifacts.json over HTTPS
bakin plugins upgrade my-plugin
```

`--check` records the latest published version in the plugin lockfile; the plugins UI and CLI surface `update available` when it differs from the installed version. `upgrade` refetches the latest artifact through the same verify/extract pipeline as install, gates widened permissions behind consent before touching disk, refuses artifacts built for a newer host contract (update Bakin first), and atomically replaces the installed plugin.

One host-upgrade note for older plugins: the manifest `entry` and `tests` fields were removed. A previously-installed plugin whose manifest still carries them fails to load after a Bakin upgrade with a message naming the field — the remedy is deleting the field from the installed `bakin-plugin.json` (or reinstalling the plugin); there is no automated migration.

## Develop Against a Live Bakin

```sh
bakin plugins link ./my-plugin     # symlink your source tree as a plugin
BAKIN_DEV_HOTRELOAD=1 bakin start  # rebuild + hot-swap on save
```

Linked plugins rebuild through the same build backend on every save — in-process fast path from a source run, system `bun` under the compiled binary — and hot-swap into the browser without a page reload. Build failures keep the previous version active and surface in the dev overlay.

## Starting Point

The reference plugin is mirrored to [`markhayden/bakin-plugin-starter`](https://github.com/markhayden/bakin-plugin-starter) on stable releases — fork it for a complete, working starting point whose SDK dependency matches a released Bakin.

## Next

- [Manifest](/docs/extending/plugins/manifest/)
- [Build a Plugin](/docs/extending/plugins/build/)

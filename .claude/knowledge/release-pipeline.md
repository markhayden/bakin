# Release Pipeline Runbook

Canonical reference (the originating spec shipped and was retired).

## Release Shape

- Version source of truth: git release tag.
- Stable tag: `vMAJOR.MINOR.PATCH`, npm dist-tag `latest`, GitHub release.
- RC tag: `vMAJOR.MINOR.PATCH-rc.N`, npm dist-tag `next`, GitHub prerelease.
- Workspace package versions stay non-publishable (`0.0.0-workspace`); root stays `0.0.0-dev`.
- `packages/core/src/generated-version.ts` is stamped at build time.
- The updates engine's `bakin` source (`src/core/updates/sources/bakin.ts`,
  #1007) looks up the latest GitHub release with a conditional request and
  records it as the `bakin:bakin` record; source/dev/Bun runtimes get
  `unsupported` with a manual pointer, so the header banner, Health → Updates
  and `bakin update` only offer a release where the compiled binary can be
  replaced. Applying is the self-update OPERATION (download → verify →
  prepare-restart → swap → restarting) started by `POST
  /api/updates/bakin:bakin/apply`; the old process ends it and the client
  verifies the new boot explicitly. Runbook: `.claude/knowledge/updates.md`
  § Self-update.

## Maintainer Commands

Releases are two steps: prepare the changelog on `main`, then dispatch the
release workflow. Nothing local creates or pushes tags.

1. Write the notes under `[Unreleased]` in `CHANGELOG.md` (summary line, then
   Added / Changed / Fixed / Upgrade notes), commit to `main`.
2. Move them into the versioned section (`scripts/prep-release.ts`, the
   `release` script; dry-run first):

   ```sh
   bun run release patch --rc --dry-run   # prints the target tag, e.g. v0.0.1-rc.41
   bun run release patch --rc             # writes CHANGELOG.md (add --create-branch for a PR)
   ```

   Commit as `docs(release): prepare <tag>` on `main` (directly or via a PR).
3. Dispatch the release from `main`:

   ```sh
   gh workflow run release.yml --ref main -f version=<tag>
   ```

   The gate job requires `## [<version>]` in CHANGELOG.md, creates the tag
   at the dispatched commit if it does not exist (or reuses an existing one —
   it must be on `main` history), and every job builds that tag's commit.

**Retrying a failed release:** fix the cause on `main` and dispatch again
with the same version. The existing tag is reused (the workflow file comes
from the dispatched ref, the code from the tag), so the tag never has to
move. Never delete and recreate a tag a GitHub release points at — it
spawns duplicate release objects. The npm wait allows 10 min (raised from
120 s after the propagation race failed `Smoke SDK install` four times at
~3 min of lag); if it still times out, `gh run rerun <id> --failed` once
`npm view @makinbakin/sdk@<version> --prefer-online` resolves.

`scripts/release.ts` holds the shared tag/changelog helpers the prep script
and its tests use; it is not a separate tagging command.

## CI Sequence

`.github/workflows/release.yml` runs on strict `v*` release tags:

1. Plugin contract guard (`scripts/check-plugin-contract.ts`, before the tag is created): if the externals-contract FAMILY changed since the previous release tag, every official Bits plugin must already have a published release that runs on it, or the release refuses. Release prep (`bun run release …`) runs the same guard. See `plugin-system.md`.
2. Validate tag grammar and ensure the tag commit is on `main`.
3. Install dependencies, lint, typecheck, test.
4. Build production browser assets and all three binaries.
5. Smoke the Linux x64 binary on the host runner.
6. Dry-run SDK publish package generation.
7. Sign and notarize `bakin-darwin-arm64` on macOS.
8. Package signed binaries into `bakin-<platform>-<arch>.tar.gz` archives and compute archive checksums.
9. Extract release notes from committed `CHANGELOG.md`.
10. Create/update a draft GitHub release and upload archives plus `checksums.txt`.
11. Publish `@makinbakin/sdk` from the generated package with npm trusted publishing; include provenance only when the source repository is public.
12. Render the Homebrew formula for all tags.
13. Stable only: push `Formula/bakin.rb` to `markhayden/homebrew-tap`.
14. Publish/undraft the GitHub release.
15. `release.yml` runs post-publish smoke jobs, which verify release archives, SDK install/imports, and stable Homebrew install/test. The SDK smoke first runs `scripts/wait-for-npm-version.ts` to gate on the exact version becoming resolvable on npm (bounded exponential backoff, loud failure at the deadline), closing the read-after-write propagation race before `bun add`.

If the Homebrew push fails, the GitHub release remains draft. Fix the tap/push issue and rerun the tail before publishing the release.

## One-Time Setup

### npm

`@makinbakin/sdk` must exist before trusted publishing can be configured.

1. Build the SDK package locally with a bootstrap version.
2. Manually publish once with interactive npm auth:

   ```sh
   bun run scripts/build-sdk-package.ts --version 0.0.0-bootstrap.0 --out /tmp/bakin-sdk-bootstrap
   cd /tmp/bakin-sdk-bootstrap
   npm publish --access public --tag bootstrap
   ```

3. On npmjs.com, configure trusted publishing for:
   - Package: `@makinbakin/sdk`
   - Publisher: GitHub Actions
   - Owner/repo: `markhayden/bakin`
   - Workflow filename: `release.yml`
4. Optional:

   ```sh
   npm deprecate @makinbakin/sdk@0.0.0-bootstrap.0 "bootstrap only; use a tagged Bakin release"
   ```

Do not configure `NPM_TOKEN`; the workflow uses OIDC.

### Apple Developer ID

Create these GitHub Actions secrets:

- `APPLE_DEVELOPER_ID_CERT_P12_BASE64`
- `APPLE_DEVELOPER_ID_CERT_PASSWORD`
- `APPLE_DEVELOPER_IDENTITY`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY`

Use Developer ID Application signing. Prefer App Store Connect API-key auth for notarization.

### Homebrew Tap

Create or confirm `markhayden/homebrew-tap` with `Formula/` on `main`.

Create GitHub Actions secret:

- `HOMEBREW_TAP_TOKEN`

Use a fine-grained PAT or GitHub App token with contents write permission to `markhayden/homebrew-tap`.

## Rollback

Default: roll forward.

1. Fix the bug on `main`.
2. Add a changelog bullet under `[Unreleased]`.
3. Cut a patch release.
4. Deprecate the bad SDK version if needed:

   ```sh
   npm deprecate @makinbakin/sdk@<bad-version> "broken: use <fixed-version>"
   ```

5. Edit the bad GitHub release body to point at the fixed release.
6. The next stable release updates Homebrew to the fixed formula.

Full yank is only for leaked secrets or active security vulnerabilities:

1. Rotate the secret.
2. Move Homebrew away from the bad asset or to a fixed version.
3. Delete affected release assets.
4. Deprecate or unpublish npm only when the npm security policy allows and the risk justifies it.
5. Publish a fixed release.

## User Install UX

## Compiled-binary PDF constraint (#746)

Single-file binaries CANNOT render PDF pages: `@napi-rs/canvas`'s platform
loader breaks under `$bunfs` (the raw `.node` addon itself DOES embed — the
blocker is the package's resolution, not Bun). The engine handles the split:
text extraction (`readPdf`, and therefore asset PDF indexing) works in
binaries via canvas-less stubs + pdf-parse's embedded data-URL worker
(`installCanvaslessStubs` + `setWorker(getData())` in
`src/core/pdf/engine.ts`); `renderPdfPages` throws a typed `pdf_unavailable`
with an honest message. `bun run verify:compiled-pdf` proves both halves
against a real compiled binary — run it when touching the engine's import
story or bumping pdf-parse. Re-evaluate full render support on future Bun
releases (the `.node`-embeds finding suggests it may become tractable).

Preferred macOS install:

```sh
brew install markhayden/tap/bakin
```

Fallback installer:

```sh
curl -fsSL https://raw.githubusercontent.com/markhayden/bakin/main/install.sh | bash
```

## macOS entitlements (hardened runtime)

`scripts/release/bakin.entitlements` is applied by `scripts/sign-macos-binary.ts`
(`codesign --options runtime --entitlements …`). It carries two groups:

- `com.apple.security.cs.disable-library-validation` — the media store dlopens
  sharp's npm-signed native prebuild (margo, rc.33).
- `com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory`,
  `disable-executable-page-protection` — operation resource locks are held
  with flock(2) through `bun:ffi`, and Bun's FFI generates executable call
  trampolines at dlopen time that the hardened runtime refuses without these
  (Bun's documented set for compiled executables; #896 D3.5).

The signing job then runs the SIGNED binary against a throwaway home
(`bakin mkdir` + `bakin version`): the `mkdir` component declares
`resources: ['install-state']` (creating the home is an install-state write),
so in-process it takes the flock before `initBakinHome` runs — a hardened
binary that cannot load libc through FFI fails the operation (non-zero exit)
there, never on an operator's box. The step also asserts `install.lock` is
gone afterwards (released locks are unlinked). Keep `mkdir` owning
`install-state`: it is the one lock the smoke relies on. Locally compiled macOS binaries
are linker-signed by Bun and cannot be re-signed (`codesign` refuses strict
validation), which is why this smoke lives in the release job — the darwin
binary is cross-compiled on the Linux build job and signed on macOS.

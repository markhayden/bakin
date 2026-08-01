# Release Pipeline Runbook

Canonical reference (the originating spec shipped and was retired).

## Release Shape

- Version source of truth: git release tag.
- Stable tag: `vMAJOR.MINOR.PATCH`, npm dist-tag `latest`, GitHub release.
- RC tag: `vMAJOR.MINOR.PATCH-rc.N`, npm dist-tag `next`, GitHub prerelease.
- Workspace package versions stay non-publishable (`0.0.0-workspace`); root stays `0.0.0-dev`.
- `packages/core/src/generated-version.ts` is stamped at build time.
- Browser self-update checks call `/api/update/status`, which looks up the
  latest GitHub release and compares it to `/api/version`. The route refuses
  source/dev/Bun runtimes so the UI banner only appears for compiled `bakin`
  binaries where `POST /api/update/apply` can safely invoke the existing
  self-update path.

## Maintainer Commands

Dry-run first:

```sh
bun run release patch --dry-run
```

Cut releases:

```sh
bun run release patch
bun run release minor
bun run release major
bun run release minor --rc
bun run release promote
```

The local script requires:

- Current branch is `main`.
- Worktree is clean, except generated version output.
- Local `HEAD` matches `origin/main`.
- Main CI is green for the exact head SHA.
- `CHANGELOG.md` has bullets under `[Unreleased]`.
- Target tag does not exist locally or remotely.
- First `1.0.0` requires explicit confirmation.

On success, the script moves `[Unreleased]` into a concrete changelog section, commits `chore(release): <tag>`, tags, and pushes `main` plus the tag atomically.

## CI Sequence

`.github/workflows/release.yml` runs on strict `v*` release tags:

1. Validate tag grammar and ensure the tag commit is on `main`.
2. Install dependencies, lint, typecheck, test.
3. Build production browser assets and all three binaries.
4. Smoke the Linux x64 binary on the host runner.
5. Dry-run SDK publish package generation.
6. Sign and notarize `bakin-darwin-arm64` on macOS.
7. Package signed binaries into `bakin-<platform>-<arch>.tar.gz` archives and compute archive checksums.
8. Extract release notes from committed `CHANGELOG.md`.
9. Create/update a draft GitHub release and upload archives plus `checksums.txt`.
10. Publish `@makinbakin/sdk` from the generated package with npm trusted publishing; include provenance only when the source repository is public.
11. Render the Homebrew formula for all tags.
12. Stable only: push `Formula/bakin.rb` to `markhayden/homebrew-tap`.
13. Publish/undraft the GitHub release.
14. `release.yml` runs post-publish smoke jobs, which verify release archives, SDK install/imports, and stable Homebrew install/test. The SDK smoke first runs `scripts/wait-for-npm-version.ts` to gate on the exact version becoming resolvable on npm (bounded exponential backoff, loud failure at the deadline), closing the read-after-write propagation race before `bun add`.

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

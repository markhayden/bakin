# SPEC: Build/Release/Deploy Pipeline Lock-Down

**Status:** Approved v4 (ready for implementation planning)
**Author:** markhayden
**Date:** 2026-05-04
**Related:** GitHub issue [#246](https://github.com/markhayden/bakin/issues/246) (macOS signing + notarization, now in scope)

**Changelog from v3:** Added Homebrew install/tap publishing, moved macOS Developer ID signing + notarization into release-critical scope, fixed the tap-name/install-command mismatch, and added signing/formula verification to gates, smoke, rollback, docs, and commit slices.

---

## 1. Objective

Lock down Bakin's build/release/deploy pipeline so that cutting a release is a single command (`bun run release minor`), the result is reproducible, version-consistent across every surface that displays it, and verifiable post-publish.

### Constraints

- **Single user.** External users do not exist yet.
- **No backwards compatibility** required. Pre-1.0; breaking changes ship freely under `MINOR`.
- **Reduce tech debt.** Fewer moving parts over speculative flexibility.
- **Manual/explicit triggers only.** No auto-bump from commits.
- **Public OSS** via GitHub releases + npm + Homebrew tap.

### Non-goals

- GPG-signed checksums, cosign, SLSA (deferred until external users exist)
- Homebrew/homebrew-core submission
- Auto-rollback on smoke failure
- Beta/staging npm registry
- Per-platform install pages
- Migration guides between versions

---

## 2. Decisions

### D1. Version source of truth

**Git tag is the single source of truth.** Strict semver: `vMAJOR.MINOR.PATCH[-rc.N]`. Bakin app and published SDK package `@makinbakin/sdk` share one version. Pre-1.0; breaking → `MINOR`, fixes → `PATCH`.

**Mechanism:** `scripts/stamp-version.ts` runs as a `prebuild` hook. Idempotent — if the resolved version equals the current file content, it does not write (preventing dirty worktree on no-op runs).

**Write target:**
- `packages/core/src/generated-version.ts` — **tracked, committed** with stub content `export const APP_VERSION = '0.0.0-dev'`. Stamp script overwrites locally for tagged builds. **Not** gitignored — clean checkouts work without running the stamp first.

**Resolution order (highest → lowest):**
1. `GITHUB_REF` env when it starts with `refs/tags/v`: strip prefix → `1.2.3`
2. `git describe --tags --exact-match --match 'v[0-9]*'` (local, on a tagged commit) → `1.2.3`
3. `git describe --tags --match 'v[0-9]*' --abbrev=7 --dirty` (local dev) → `1.2.3-4-gabc1234-dirty` (never publishable)
4. Fallback: `0.0.0-dev`

**Critical:** every `git describe` invocation uses `--match 'v[0-9]*'` to ignore non-release tags (this repo currently has `search-checkpoint-5`, `agent-pkg-phase-j`, etc.).

**SDK package.json is not mutated in source:** `packages/sdk/package.json:version` stays at `"0.0.0-workspace"`. Publish-time stamping happens in the generated SDK package directory (see D8) — never dirties the source tree.

**Other version surfaces:**
- Root `package.json:version` → `"0.0.0-dev"` (sentinel; `private: true`)
- Workspace package versions (`docs/package.json` + `packages/*/package.json`) → `"0.0.0-workspace"` (sentinel)
- Plugin-local `plugins/*/package.json:version` fields are not release SOT. Leave them at the existing `"0.0.0"` unless implementation finds Bun workspace/package tooling requires the same sentinel.

**Starting version:** first release is `v0.1.0`. Iterate `0.2.0`, `0.3.0`… until launch → `v1.0.0`.

### D2. Tag grammar + prerelease channel routing

**Regex:** `/^v\d+\.\d+\.\d+(-rc\.\d+)?$/`. Only stable + RC. Anything else fails the workflow.

| Tag pattern | npm dist-tag | GH release type | Use case |
|---|---|---|---|
| `v0.2.0` | `latest` | full release | normal version bump |
| `v0.2.0-rc.1` | `next` | prerelease | release candidate |
| anything else | **fail fast** | none | malformed |

Local dev does not use tags. The `0.0.0-dev` fallback in the stamp script covers untagged builds. If you need a one-off dev artifact, do not prefix with `v` — the workflow won't fire and nothing publishes.

`scripts/publish-sdk.ts` routes `--tag next` when the version contains `-rc.`, otherwise `--tag latest`. The `softprops/action-gh-release` `prerelease` field is set to the same boolean.

### D3. Tagging mechanism — local script

`scripts/release.ts` is the **primary** way to cut a release. The existing tag-triggered `release.yml` is preserved as an emergency escape hatch (`git tag v0.2.0 && git push --atomic origin main v0.2.0`).

The script accepts inputs from CLI args **or** env vars (`RELEASE_BUMP=minor`, `RELEASE_PRERELEASE=1`, `RELEASE_YES=1`) so a future `workflow_dispatch` wrapper can pass args via env.

### D4. Bump UX + prerelease lifecycle

```
bun run release patch             # 0.3.0 → 0.3.1     final, npm "latest"
bun run release minor             # 0.3.0 → 0.4.0     final, npm "latest"
bun run release major             # 0.3.0 → 1.0.0     final, npm "latest"

bun run release patch --rc        # 0.3.0 → 0.3.1-rc.1   prerelease, npm "next"
bun run release minor --rc        # 0.3.0 → 0.4.0-rc.1   prerelease, npm "next"
bun run release minor --rc        # 0.4.0-rc.1 → 0.4.0-rc.2   (same target, increments RC)

bun run release promote           # 0.4.0-rc.2 → 0.4.0   drops -rc, ships final

bun run release --dry-run minor   # preview only, no acts
```

**Pre-flight checks (in order):**

1. Branch is `main`
2. Worktree is clean (excluding `packages/core/src/generated-version.ts` which the stamp script may have written)
3. Local main matches `origin/main` (`git fetch origin main`, then exact match required)
4. **Specific** main CI workflow is green for the head SHA: `gh run list --workflow "Main CI" --branch main --commit <sha> --json conclusion --jq '.[0].conclusion' == "success"`. Not "any green run."
5. `[Unreleased]` in `CHANGELOG.md` has at least one non-empty bullet
6. Tag does not exist locally or on origin
7. Resolved version matches the regex
8. For `release major` while pre-1.0: extra "type 1.0.0 to confirm" prompt

**Conflict handling (intentionally simple):** if `release patch|minor|major` (no `--rc`) is run while latest tag is `-rc.N`, OR if `--rc` is run with a target that conflicts with an in-flight RC line, the script **fails loudly** with the conflict and exits. The releaser fixes the situation manually (`promote` first, or push a manual override flag like `--force-target=0.4.0` if the script gets it wrong). Over-engineering this for a first release is wasted work.

**On success:**

1. Move `CHANGELOG.md [Unreleased]` content into `[<version>] - YYYY-MM-DD`. Update link refs.
2. Commit `chore(release): v<version>`.
3. Tag `v<version>`.
4. **Atomic push:** `git push --atomic origin main v<version>` (not `--follow-tags`). Atomicity prevents a race where the commit lands but the tag fails.
5. Hand off — release.yml fires.

**Releaser UX (the script must produce):**

```
Release plan
────────────
Target version:  v0.2.0
Channel:         stable (npm dist-tag: latest)
Release type:    full release
Tag:             v0.2.0 (does not exist)

Preflight
─────────
  ✓ on main
  ✓ worktree clean
  ✓ main matches origin/main (ahead 0, behind 0)
  ✓ Main CI green for c0d5a05b (run #25353955538)
  ✓ CHANGELOG.md [Unreleased] has 5 bullets
  ✓ tag v0.2.0 does not exist on origin
  ✓ tag format valid

Release notes preview
─────────────────────
### Added
- ...
### Fixed
- ...

Proceed? [y/N]
```

On `y`: side effects logged in order. On completion: print the workflow run URL.

### D5. Release notes — CHANGELOG.md is canonical, extracted in CI

`CHANGELOG.md` (new, root-level) in Keep-a-Changelog format. Format identical to `bakin-bits-official`'s.

**Sections:** `Added`, `Changed`, `Fixed`, `Removed`, `Security`. (No `Deprecated` — out of scope per no-backwards-compat.)

**Flow:**
- During PR work: bullets added to `[Unreleased]`. Self-discipline; no CI enforcement.
- Release script's pre-flight enforces non-empty `[Unreleased]`.
- Release script moves to `[<version>] - YYYY-MM-DD` and commits.

**Release notes in CI:** the workflow strips the leading `v` from `${{ github.ref_name }}` and extracts the matching `[<version>]` section from the **committed** `CHANGELOG.md`. No artifact is passed between local script and workflow. `body_path:` points at a workflow-step-generated file (e.g., `.release-notes.md` written during the workflow run from CHANGELOG, then deleted).

This means `dist/release-notes.md` (which v1 of the spec wrongly assumed would persist) is gone. The single source of truth in CI is the committed CHANGELOG.

**First release special case:** `[0.1.0]` is a single bullet — `Initial public release`. Real release notes start with `[0.2.0]`.

**LLM-curated notes:** future tool, decoupled from this spec.

### D6. CI gates

**Pre-tag (local, `scripts/release.ts`):** the 8 checks above.

**Pre-publish (in `release.yml`, on tag push):**

- Workflow permissions are explicit: `contents: write` for GitHub release creation, `id-token: write` for npm trusted publishing.
- `actions/checkout@v4` with `fetch-depth: 0` (full history)
- Re-run full test suite (`bun test --isolate`)
- Typecheck, lint
- Tag well-formedness regex (defense-in-depth)
- Tag is selected from release tags only: enumerate tags matching `v[0-9]*`, then parse with the D2 regex before choosing "latest" or resolving bumps.
- Tag is on `main` ancestor: `git fetch origin main && git merge-base --is-ancestor "$GITHUB_SHA" origin/main`
- Re-stamp: `bun run scripts/stamp-version.ts` (writes `generated-version.ts` to the tag's version)
- Build all 3 binaries successfully
- Sign + notarize the macOS artifact before checksum generation or release upload (D7)
- **Host-platform smoke only:** the runner is `ubuntu-latest`, so it can run `bakin-linux-x64 --version` directly. macOS and linux-arm64 binaries: existence + non-zero size check only. Full cross-platform smoke is post-publish (D9).
- Extract release notes from CHANGELOG into a workflow-local file
- Build the publishable SDK package (D8) and verify no unresolved repo aliases remain
- `scripts/publish-sdk.ts --dry-run` resolves to the correct version
- Render the Homebrew formula from the post-signing checksums in dry-run mode (D11)

Only after all gates pass do we publish.

**Concurrency:** `release.yml` declares `concurrency: { group: release-publish, cancel-in-progress: false }`. Different release tags serialize globally; killing a half-published workflow is worse than waiting.

**Not gates:** test coverage thresholds, bundle size diffs, performance regression checks, manual approval clicks.

### D7. macOS Developer ID signing + notarization

**In scope.** The Apple Developer account exists, so the release pipeline should not ship an unsigned macOS binary or make `xattr -d com.apple.quarantine` the normal install path.

**Mechanism:**

1. Build `dist/bakin-darwin-arm64` with the normal binary build.
2. Hand that artifact to a macOS signing job before checksum generation and before GitHub release upload.
3. Import the Developer ID Application certificate into a temporary keychain from CI secrets.
4. Sign the binary with hardened runtime and timestamp:
   `codesign --force --options runtime --timestamp --sign "$APPLE_DEVELOPER_IDENTITY" dist/bakin-darwin-arm64`
5. Verify locally on the runner:
   `codesign --verify --verbose=3 --strict dist/bakin-darwin-arm64`
6. Zip the signed binary for the notary upload, then submit with `xcrun notarytool submit ... --wait`.
7. Always fetch and print the notary log on failure.
8. Treat successful `codesign --verify` plus `notarytool` `Accepted` status as the release gate for the standalone CLI binary.
9. Compute SHA256 checksums only after signing/notarization succeeds.

**Secrets/config:**
- `APPLE_DEVELOPER_ID_CERT_P12_BASE64`
- `APPLE_DEVELOPER_ID_CERT_PASSWORD`
- `APPLE_DEVELOPER_IDENTITY`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY`

Prefer App Store Connect API-key auth over an Apple ID app-specific password. The workflow may support the password flow as a fallback, but the documented path is API-key based.

**Artifact shape:** keep the public GitHub release asset name `bakin-darwin-arm64` unless Gatekeeper testing proves a package artifact is required. Apple can notarize a ZIP containing the signed binary, but standalone binaries cannot currently be stapled, and `spctl` assessment is not a required gate for the raw executable. Do not claim the standalone binary is stapled. If a stapled offline artifact becomes important, add a future `pkg`/`dmg` distribution rather than pretending the raw binary has a stapled ticket.

**Implementation preference:** put the signing/notary command orchestration in a small script (`scripts/sign-macos-binary.ts`) with a `--dry-run`/command-plan mode, not as an opaque block of YAML. The real signing/notary path only runs on macOS CI with secrets present.

### D8. SDK package build, npm bootstrap, and provenance

**SDK package build is in scope.** Publishing the current raw source package is not acceptable: exported subpaths currently point at `.ts/.tsx` files and several subpaths import repo-only aliases such as `@/components/*` and plugin internals. A clean npm install must work without the Bakin monorepo.

Add `scripts/build-sdk-package.ts`:

1. Build a self-contained publish directory (e.g., `dist/sdk-package` locally, temp dir in CI).
2. Emit JavaScript and declarations for every exported SDK subpath:
   - `.`
   - `./ui`
   - `./hooks`
   - `./components`
   - `./slots`
   - `./types`
   - `./utils`
   - `./metadata`
   - `./routing`
3. Generate a publish-only `package.json` whose `version` is the resolved release version and whose `exports` point at built JS + declaration files. The source `packages/sdk/package.json` stays at `"0.0.0-workspace"`.
4. Externalize only true peer dependencies (`react`, `react-dom`). Public type/runtime dependencies such as `zod` must be declared in the publish package if they remain referenced by public declarations.
5. Fail the build if published JS or `.d.ts` contains repo-only imports: `@/`, `@bakin/<plugin>`, `workspace:`, absolute repo paths, or `packages/host` / `src/` internals.
6. Smoke the package from a scratch directory with Bun before publish.

**One-time npm bootstrap.** `@makinbakin/sdk` does not currently exist on npm. npm trusted publisher configuration requires the package to exist first, so there is a single documented exception to D1:

1. Build the SDK publish directory locally.
2. Stamp version `0.0.0-bootstrap.0`.
3. Manually publish once with an interactive npm login: `npm publish --access public --tag bootstrap`.
4. Immediately configure npm trusted publishing for package `@makinbakin/sdk`, repository `markhayden/bakin`, workflow filename `release.yml` (filename only, not `.github/workflows/release.yml`).
5. Optionally deprecate the bootstrap version with `npm deprecate @makinbakin/sdk@0.0.0-bootstrap.0 "bootstrap only; use a tagged Bakin release"`.

The bootstrap version is never `latest` or `next`, has no GitHub release, and is not documented as installable. All real app+SDK versions still come from git tags.

**npm trusted publishing (primary):**
- Configure trusted publisher on npmjs.com linking to `markhayden/bakin` and workflow filename `release.yml`
- `release.yml` declares `permissions: { contents: write, id-token: write }`
- `scripts/publish-sdk.ts` runs `npm publish --provenance` — npm uses the OIDC token from GH Actions; **no `NPM_TOKEN` needed**
- Requires Node ≥ 24 and npm ≥ 11.5.1 in the workflow runner; workflow prints and checks both versions before publish

**SDK publish mechanics (no source-tree mutation):**
1. `bun run scripts/build-sdk-package.ts --version <version> --out <temp-dir>`
2. `cd <temp-dir> && npm publish --provenance --tag <latest|next>`
3. Cleanup temp dir (CI runner is ephemeral anyway)

**Idempotency rewrite:** `scripts/publish-sdk.ts` pre-checks with `npm view @makinbakin/sdk@<version> version --json`. If exists → log and exit 0 (the version is already published, this is a re-run). If not exists → publish; **any failure is a real failure**, exit non-zero. The current "swallow any non-zero" behavior in `BAKIN_PUBLISH_IDEMPOTENT` mode is removed entirely.

**Removed:** `NPM_TOKEN` secret. The workflow no longer reads it. (Document removal in CONTRIBUTING and the runbook so it's clear why the secret is gone.)

**Keep:** SHA256 checksums for binaries.

**Skip (deferred):** GPG-signed checksums, cosign, SLSA. Revisit when external users exist.

### D9. Post-publish smoke matrix

`.github/workflows/release-smoke.yml`, triggered on `release: published`:

**`binary` job (matrix):**
- `macos-latest` × `bakin-darwin-arm64`
- `ubuntu-latest` × `bakin-linux-x64`
- `ubuntu-24.04-arm` × `bakin-linux-arm64`

Each step:
1. `gh release download "${{ github.event.release.tag_name }}" -p <artifact>` (with `env.GH_TOKEN: ${{ github.token }}`)
2. `chmod +x <artifact>`
3. macOS only: `codesign --verify --verbose=3 --strict <artifact>`
4. `actual=$(./<artifact> --version)`; `expected=${{ github.event.release.tag_name }}`; assert `actual == ${expected#v}`

**`sdk` job:**
1. `runs-on: ubuntu-latest`, install Bun (`oven-sh/setup-bun`)
2. `mkdir scratch && cd scratch && bun init -y`
3. `bun add react@^19 react-dom@^19 @makinbakin/sdk@<exact-tag-version>` (not `latest` — verify the exact published version)
4. `bun -e "import('@makinbakin/sdk').then(m => { if (typeof m.registerPlugin !== 'function') throw new Error('missing registerPlugin'); })"`
5. One `bun -e "import('@makinbakin/sdk/<subpath>')"` line per entry in the SDK's `exports` map

**Critical:** the smoke uses Bun because Bakin plugin authors target Bun. The package must still be a real published package: built JS, declarations, no repo-only imports, and installable from a clean directory.

**`homebrew` job (stable releases only):**
1. `runs-on: macos-latest`, skip when `github.event.release.prerelease == true`
2. `brew update`
3. `brew install markhayden/tap/bakin`
4. `bakin version` matches `${{ github.event.release.tag_name }}` without the leading `v`
5. `brew test markhayden/tap/bakin`

RCs do not update the Homebrew tap. The release workflow still renders the formula in dry-run mode for RCs so template breakage is caught before the first stable cut.

**On failure:** workflow fails loudly. Release is already published. Roll forward per D10.

### D10. Rollback strategy

**Default: roll forward.** Six manual steps:

1. Fix the bug (normal PR)
2. Update CHANGELOG `[Unreleased]` with `fixes regression in 0.2.0`
3. `bun run release patch` → `0.2.1`
4. `npm deprecate @makinbakin/sdk@0.2.0 "broken: use 0.2.1"`
5. Edit the bad GH release with a banner pointing to `0.2.1`
6. Stable releases: the next successful release workflow updates the Homebrew tap to the fixed version. If the tap update itself is the failed piece, fix and re-run only the tap publish/smoke step.

**Exception (secrets leaked / active security vuln):** full yank within 72h:

1. Rotate the leaked secret immediately
2. `npm unpublish @makinbakin/sdk@0.2.0` (falls back to `npm deprecate` if blocked)
3. Update the Homebrew tap first so it no longer points at the asset being deleted (or points at the fixed version if already available)
4. `gh release delete v0.2.0`
5. `git push --delete origin v0.2.0`
6. `git tag -d v0.2.0`
7. Open a security advisory if warranted
8. Cut the fix as the next patch with a security note in CHANGELOG

Documented as a runbook section of `.claude/knowledge/release-pipeline.md`. Copy-paste commands.

**Not built:** rollback automation script, auto-rollback on smoke failure, beta/staging registry.

### D11. Homebrew install + tap publishing

**Homebrew is in scope for stable releases.** It should be automated, not a manual copy/paste afterthought.

**Tap decision:** keep the existing tap repository target `markhayden/homebrew-tap`. In Homebrew terms, that is the tap `markhayden/tap`, not `markhayden/bakin`.

**User install UX:**

```sh
brew install markhayden/tap/bakin
```

Optional two-step equivalent:

```sh
brew tap markhayden/tap
brew install bakin
```

The current draft Homebrew docs that say `brew tap markhayden/bakin` are wrong for `markhayden/homebrew-tap`; that command would look for `markhayden/homebrew-bakin`. Do not document `markhayden/bakin` unless we intentionally create/rename to `markhayden/homebrew-bakin`.

**Formula source:**
- `homebrew/bakin.rb` remains the canonical formula template in this repo.
- `scripts/update-homebrew-formula.ts` renders the template for a release:
  `bun run scripts/update-homebrew-formula.ts --version <version> --checksums dist/checksums.txt --out <tap-checkout>/Formula/bakin.rb`
- The script fills release URLs and SHA256 values for `bakin-darwin-arm64`, `bakin-linux-x64`, and `bakin-linux-arm64`.
- Checksums come from the final release artifacts after macOS signing/notarization, never from unsigned build output.
- The formula `test do` asserts `bakin version`.

**Publishing:**
- Stable releases only: `release.yml` uploads GitHub release assets/checksums to a draft release, publishes npm, checks out `markhayden/homebrew-tap`, renders `Formula/bakin.rb`, commits `bakin <version>`, pushes, then publishes/undrafts the GitHub release. The `release: published` smoke event fires only after the tap points at the new version.
- Use `HOMEBREW_TAP_TOKEN` (fine-grained PAT or GitHub App token with contents write to `markhayden/homebrew-tap`). This token is separate from npm trusted publishing.
- RCs render the formula as a dry-run validation but never push to the tap.
- If the tap push fails after npm publish but before the GitHub release is undrafted, leave the GitHub release draft in place, fix the tap, then re-run the tap/publish tail. Do not republish binaries or npm.

**Out of scope:** Homebrew/homebrew-core. Revisit after external users exist and the source-build story is acceptable to Homebrew maintainers.

### D12. Documentation surfaces

| Surface | Action | Slice |
|---|---|---|
| `CHANGELOG.md` (root) | Created | 2 |
| `.claude/knowledge/release-pipeline.md` (full architecture + rollback/signing/Homebrew runbook) | Created | 9 |
| `README.md` | Add Releases subsection; Homebrew as preferred macOS install | 9 |
| `CONTRIBUTING.md` | Add "Releasing" section | 9 |
| `CLAUDE.md` | Add 3-sentence "Releases" subsection | 9 |
| `docs/src/content/docs/start/install.mdx` | Sync with README | 9 |
| `homebrew/README.md` | Replace manual copy flow with automated tap-publish flow and correct tap name | 9 |
| `.claude/specs/release-pipeline.md` | Archived approved spec | complete |

`install.sh` and `bakin update` read the GitHub API; verify they still work with the signed/notarized macOS artifact and any asset-shape decision from D7.

### D13. Commit strategy

Single feature branch: `feat/release-pipeline`. One PR. Each commit independently revertible.

| # | Commit | Highlights |
|---|---|---|
| 1 | `feat(release): drive APP_VERSION from git tag at build time` | `scripts/stamp-version.ts`, `packages/core/src/generated-version.ts` (committed stub), `constants.ts` re-exports, root + workspace `package.json:version` sentinels, prebuild hook, unit tests for resolver |
| 2 | `feat(release): build a publishable SDK package` | `scripts/build-sdk-package.ts`, package-output alias scanner, source SDK version sentinel, package smoke tests |
| 3 | `docs(release): add CHANGELOG.md skeleton` | Keep-a-Changelog template |
| 4 | `feat(release): add release script with bump verbs and pre-flight checks` | `scripts/release.ts`, npm script, unit tests, strict release-tag parsing, Releaser UX from D4 |
| 5 | `feat(release): sign and notarize macOS release binaries` | `scripts/sign-macos-binary.ts`, release workflow macOS signing job, Apple secret docs, post-signing checksum order |
| 6 | `feat(release): tighten workflow gates and enable trusted publishing` | `release.yml` updates (permissions, gates, fetch-depth: 0, global concurrency, CHANGELOG extraction). `scripts/publish-sdk.ts` rewritten (publish built SDK package, `npm view` pre-check, no NPM_TOKEN, no swallowed errors, `--provenance`, `--tag` routing). |
| 7 | `feat(release): automate Homebrew tap publishing` | `scripts/update-homebrew-formula.ts`, formula render tests, tap checkout/commit/push for stable releases only, RC dry-run render |
| 8 | `feat(release): add post-publish smoke matrix` | `release-smoke.yml`: binary matrix (macOS/linux-x64/linux-arm64), SDK install + import via Bun, Homebrew stable install/test, `GH_TOKEN` env |
| 9 | `docs(release): document release pipeline and rollback runbook` | README, CONTRIBUTING, CLAUDE, `.claude/knowledge/release-pipeline.md` (with bootstrap + signing + Homebrew + rollback), `install.mdx` sync, `homebrew/README.md` corrected |
| 10 | (verification, no code commit) | Manually publish `@makinbakin/sdk@0.0.0-bootstrap.0` with dist-tag `bootstrap`; configure npm trusted publisher for `release.yml`; configure Apple signing/notary secrets; configure `HOMEBREW_TAP_TOKEN`; cut `v0.1.0-rc.1`, watch full pipeline without tap push. Fix any bugs. Then `bun run release promote` → `v0.1.0` first official release and verify tap install. |

---

## 3. Commands (after implementation)

| Command | Purpose |
|---|---|
| `bun run release {patch\|minor\|major}` | Cut next stable release (npm `latest`) |
| `bun run release {patch\|minor\|major} --rc` | Cut/iterate prerelease (npm `next`) |
| `bun run release promote` | Drop `-rc` suffix, ship final |
| `bun run release --dry-run <verb>` | Preview only |
| `bun run build` | Build binaries; `prebuild` stamps version |
| `brew install markhayden/tap/bakin` | Preferred user install after first stable release |

---

## 4. Project Structure (changes)

**New files:**
- `scripts/stamp-version.ts`
- `scripts/build-sdk-package.ts`
- `scripts/sign-macos-binary.ts`
- `scripts/update-homebrew-formula.ts`
- `scripts/release.ts`
- `tests/scripts/release.test.ts`
- `tests/scripts/stamp-version.test.ts`
- `tests/scripts/build-sdk-package.test.ts`
- `tests/scripts/sign-macos-binary.test.ts`
- `tests/scripts/update-homebrew-formula.test.ts`
- `packages/core/src/generated-version.ts` (**committed stub**, not gitignored)
- `CHANGELOG.md`
- `.github/workflows/release-smoke.yml`
- `.claude/knowledge/release-pipeline.md`

**Modified files:**
- `packages/core/src/constants.ts` (re-exports from `generated-version.ts`)
- `package.json` (root: version → `"0.0.0-dev"`, add `prebuild` + `release` scripts)
- Workspace `package.json` files (`docs/package.json`, `packages/*/package.json`) (version → `"0.0.0-workspace"`)
- `packages/sdk/package.json` (source version sentinel, package build script if useful; published package is generated)
- `.github/workflows/release.yml` (gates, atomic push, concurrency, trusted publishing, CHANGELOG extraction)
- `scripts/publish-sdk.ts` (rewritten — publish built SDK package, `npm view` pre-check, fail-loud, `--provenance`)
- `homebrew/bakin.rb` (correct comments/test if needed; template remains canonical)
- `homebrew/README.md` (automated publish flow + correct tap name)
- `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`
- `docs/src/content/docs/start/install.mdx`

**Removed:** `NPM_TOKEN` secret (no file change, but worth noting).

---

## 5. Code Style

Follows existing conventions per `CLAUDE.md`. New scripts in `scripts/`, tests in `tests/scripts/`, deep reference in `.claude/knowledge/`.

---

## 6. Testing Strategy

**Unit tests:**
- `tests/scripts/release.test.ts` — `resolveBump`, `resolveRcBump`, `promote`, CHANGELOG validation, regex, conflict detection
- `tests/scripts/stamp-version.test.ts` — all 4 resolution layers, `--match 'v[0-9]*'` filter, idempotent no-op write
- `tests/scripts/build-sdk-package.test.ts` — publish package has built JS + declarations for every export, stamped version, correct peer/dependency fields, and no repo-only imports
- `tests/scripts/sign-macos-binary.test.ts` — dry-run command plan validates signing before notarization, notarization before checksum, no secret values printed
- `tests/scripts/update-homebrew-formula.test.ts` — renders correct URLs/SHA256 values, uses `markhayden/tap`, refuses missing checksums, never emits placeholder values

**Integration verification (manual, slice 10):**
- Manually publish `@makinbakin/sdk@0.0.0-bootstrap.0` with dist-tag `bootstrap`, then configure npm trusted publisher for `release.yml`
- Configure Apple Developer ID/notary secrets and `HOMEBREW_TAP_TOKEN`
- Cut `v0.1.0-rc.1`, observe full pipeline runs green; verify RC formula render is dry-run only
- `bun add react@^19 react-dom@^19 @makinbakin/sdk@0.1.0-rc.1` from a clean shell, import all exports
- `codesign --verify --strict` passes for `bakin-darwin-arm64`; `./bakin-darwin-arm64 --version` matches the tag
- Confirm npm provenance attestation visible at npmjs.com
- Run `bun run release promote` to ship `v0.1.0`
- `brew install markhayden/tap/bakin`, `bakin version`, and `brew test markhayden/tap/bakin` pass after stable release

**Not tested:** `npm publish` itself, offline Gatekeeper behavior for an unstapled standalone binary, end-to-end `bakin onboard && bakin start` flow.

---

## 7. Boundaries

### Always do
- Bump version via `bun run release {verb}`. Never hand-edit version fields.
- Add bullets to `CHANGELOG.md [Unreleased]` for any user-visible PR change.
- Conventional commits with `(release)` scope for pipeline commits.
- `git push --atomic origin main v<version>` (script handles this; never push commit-then-tag separately).
- `git describe --tags --match 'v[0-9]*'` (filter is mandatory).
- Publish the generated SDK package only; never publish `packages/sdk` source directly.
- Sign/notarize the macOS artifact before checksum generation and before publishing.
- Use `brew install markhayden/tap/bakin` as the documented one-command Homebrew install unless the tap repo is intentionally changed.

### Ask first
- Cutting first `v1.0.0`. Confirm intent.
- Anything requiring `npm unpublish`.
- Changing trusted publisher config on npmjs.com.
- The one-time `@makinbakin/sdk@0.0.0-bootstrap.0` manual publish if it fails or needs repeating.
- Creating/renaming the Homebrew tap repo, submitting to Homebrew/homebrew-core, or changing `HOMEBREW_TAP_TOKEN` scope.
- Rotating Apple signing certificates/notary credentials, or shipping an emergency unsigned macOS artifact.

### Never do
- Auto-bump from commits.
- Push raw `git tag` from CI on a non-tag-triggered run.
- Hand-edit `packages/core/src/generated-version.ts` (always via stamp script).
- Commit a stamped version of `packages/sdk/package.json` (publish-time only, in temp dir).
- Publish bootstrap under `latest` or `next`.
- Re-introduce `NPM_TOKEN` (use trusted publishing).
- Swallow npm publish errors as success.
- Publish a public macOS asset whose checksum was computed before signing/notarization.
- Push Homebrew tap updates for RC releases.
- Document `xattr -d com.apple.quarantine` as the normal macOS install path.

---

## 8. Open Questions / Future Work (not in scope)

1. `workflow_dispatch` wrapper for the release script
2. Homebrew/homebrew-core submission
3. Rename/create `markhayden/homebrew-bakin` if the prettier `markhayden/bakin` tap UX becomes worth the repo churn
4. Stapled macOS `pkg`/`dmg` distribution for offline Gatekeeper ticket validation
5. GPG-signed checksums + cosign
6. LLM-curated release notes (separate tool, writes into CHANGELOG)
7. End-to-end smoke (binary launches a server)
8. Broader Node-compatible SDK runtime beyond the Bun/Bakin plugin-author target
9. Bumping `bakin` peer-version constraints in plugin manifests on majors

---

## 9. Review-driven changes (v1 → v4)

Folded review feedback into the spec. Each item below maps to a specific section.

| # | Finding | Resolution | Section |
|---|---|---|---|
| 1 | `dist/release-notes.md` won't survive into CI (gitignored, deleted by `build-binary.ts`) | Re-extract from committed CHANGELOG.md in the workflow; no artifact passed between local and CI | D5 |
| 2 | Gitignored `generated-version.ts` breaks clean checkout (typecheck/lint imports fail) | Commit the file as a tracked stub; stamp script idempotent — same version → no write | D1 |
| 3 | Stamping mutates tracked `packages/sdk/package.json` → fights clean-worktree check | Stamp into a temp directory copy at publish time; source SDK package.json stays at `"0.0.0-workspace"` | D1, D8 |
| 4 | Tag regex accepts `v…-dev.*` but routing table contradicts | Tightened regex to `^v\d+\.\d+\.\d+(-rc\.\d+)?$`; dropped dev-tag row | D2 |
| 5 | `git describe` would pick up `search-checkpoint-5` etc. | All `git describe` calls use `--match 'v[0-9]*'` | D1 |
| 6 | `NPM_TOKEN` is the legacy path; modern flow is trusted publishing | Removed `NPM_TOKEN`; trusted publishing primary; documented npmjs.com config as verification prerequisite | D8 |
| 7 | Current `BAKIN_PUBLISH_IDEMPOTENT` swallows all errors as success | Replaced with `npm view` pre-check; any actual publish failure now fails loudly | D8 |
| 8 | SDK smoke uses `node -e` against raw TS exports | Smoke uses `bun -e`; SDK is documented as Bun-targeted | D9 |
| H1 | Shallow checkout breaks ancestry checks | `fetch-depth: 0` + explicit `git fetch origin main` | D6 |
| H2 | `--follow-tags` is non-atomic | `git push --atomic origin main v<version>` | D4 |
| H3 | "Any green run" too vague for CI gate | Specific workflow check via `gh run list --workflow "Main CI" --commit <sha>` | D4 |
| H4 | Pre-publish smoke can't run cross-platform binaries on Ubuntu | Clarified — host-platform inline only, full matrix is post-publish | D6, D9 |
| H5 | `gh release download` needs auth in smoke jobs | `env.GH_TOKEN: ${{ github.token }}` documented | D9 |
| H6 | Two simultaneous tag workflows could race | `concurrency:` block on `release.yml` | D6 |
| H7 | SDK package did not exist on npm, blocking trusted publishing bootstrap | Added one-time `0.0.0-bootstrap.0` publish and npm trusted publisher setup | D8 |
| H8 | Raw SDK source exports were not externally installable | Added publishable SDK package build and clean-directory smoke | D8, D9 |
| H9 | macOS signing was deferred even though an Apple Developer account exists | Moved Developer ID signing/notarization into release-critical workflow | D7 |
| H10 | Standalone macOS binary notarization can be confused with stapling | Explicitly notarize but do not claim stapling for a standalone binary | D7 |
| H11 | Existing Homebrew docs point at `markhayden/bakin` while the target repo is `markhayden/homebrew-tap` | Standardized on `markhayden/tap` and `brew install markhayden/tap/bakin` | D11 |
| H12 | Homebrew release flow was manual copy/paste | Added formula render script, stable-only tap push, and Homebrew smoke | D9, D11 |

Trimmed: D4's over-spec'd "different target than current RC" handling → fail loudly + `--force-target` flag. D12 docs surface table compressed.

---

## Approval

Approved on 2026-05-05. Companion implementation plan: `.claude/specs/release-pipeline-plan.md`.

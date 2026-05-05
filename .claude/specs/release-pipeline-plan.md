# Execution Plan — Release Pipeline Lock-Down

Companion to `.claude/specs/release-pipeline.md`. Read the spec first for the decisions; this is the implementation order, exact edit surface, acceptance criteria, verification, and rollback story.

## Refresher

One branch: `feat/release-pipeline`. End state: a release is cut locally with `bun run release <patch|minor|major>`, CI gates the tag, publishes signed binaries, publishes `@makinbakin/sdk` with npm trusted publishing and provenance when repository visibility supports it, updates the Homebrew tap for stable releases, and then emits post-publish smoke.

**State of main before this work:**
- Root `package.json` is `1.0.0`; `packages/core/src/constants.ts` hardcodes `APP_VERSION = '1.0.0'`.
- Actual Bun workspaces are `docs` + `packages/*`. Plugin `package.json` files exist under `plugins/*`, but they are not root workspaces.
- `.github/workflows/release.yml` runs on `v*`, uses Ubuntu only, has `contents: write` only, computes checksums before any signing, generates release notes automatically, and publishes SDK only when `NPM_TOKEN` exists.
- `scripts/publish-sdk.ts` mutates `packages/sdk/package.json`, uses broad `git describe --tags --abbrev=0`, and treats every npm failure as success when `BAKIN_PUBLISH_IDEMPOTENT=1`.
- `packages/sdk/package.json` publishes raw `.ts/.tsx` source and export subpaths import repo-only aliases/plugin internals.
- `@makinbakin/sdk` does not exist on npm yet, so trusted publishing needs one manual bootstrap publish before the first real tag.
- `homebrew/bakin.rb` exists as a template, but `homebrew/README.md` documents a manual flow and the wrong tap name for `markhayden/homebrew-tap`.

## Pre-Flight Checklist

- [ ] Branch from clean `main`: `git checkout -b feat/release-pipeline`.
- [ ] Baseline: `bun install --frozen-lockfile`.
- [ ] Baseline: `bun test --isolate`.
- [ ] Baseline: `bun run typecheck`.
- [ ] Baseline: `bun run lint`.
- [ ] Confirm `gh auth status` can read workflow runs and push tags.
- [ ] Confirm npm account owns `@makinbakin` scope or can publish `@makinbakin/sdk`.
- [ ] Confirm Apple Developer ID certificate export path is understood: `.p12` + password + App Store Connect API key.
- [ ] Confirm `markhayden/homebrew-tap` exists and decide whether `HOMEBREW_TAP_TOKEN` will be a PAT or GitHub App token.

## Dependency Graph

```
C1 version stamping ─┬─▶ C3 changelog ─▶ C4 release script ─┐
                     │                                      │
                     └─▶ C2 SDK package build ──────────────┤
                                                            │
C5 macOS signing script ────────────────────────────────────┤
                                                            ▼
                                      C6 release workflow + npm publish rewrite
                                                            │
                                                            ▼
                                      C7 Homebrew formula automation
                                                            │
                                                            ▼
                                      C8 post-publish smoke
                                                            │
                                                            ▼
                                      C9 docs/runbook
                                                            │
                                                            ▼
                                      C10 manual bootstrap + first RC/final release
```

**Parallelizable after C1:** C2 SDK packaging, C3 CHANGELOG shape, and C5 signing script can be built independently. C6 is the integration point and should wait for those to land.

## Critical Files

| Path | Role |
|---|---|
| `scripts/stamp-version.ts` | Resolves release/dev version and writes `generated-version.ts`. |
| `packages/core/src/generated-version.ts` | Tracked stub, stamped during builds. |
| `packages/core/src/constants.ts` | Re-exports `APP_VERSION`. |
| `scripts/build-sdk-package.ts` | Builds self-contained SDK publish directory. |
| `scripts/publish-sdk.ts` | Publishes built SDK package with trusted publishing and optional provenance. |
| `scripts/release.ts` | Local bump, CHANGELOG, commit, tag, atomic push UX. |
| `scripts/sign-macos-binary.ts` | Developer ID signing/notary orchestration. |
| `scripts/update-homebrew-formula.ts` | Renders tap formula from release checksums. |
| `.github/workflows/release.yml` | Tag-triggered release pipeline. |
| `.github/workflows/release-smoke.yml` | Post-publish binary/SDK/Homebrew smoke. |
| `homebrew/bakin.rb` | Canonical formula template. |
| `homebrew/README.md` | Tap publishing docs. |
| `CHANGELOG.md` | Release notes source of truth. |
| `.claude/knowledge/release-pipeline.md` | Deep runbook for release, rollback, secrets. |

## Per-Commit Plan

### C1 — `feat(release): drive APP_VERSION from git tag at build time`

**Description:** Add version resolver/stamper and replace hardcoded app/package versions with sentinels.

**Files likely touched:**
- `scripts/stamp-version.ts`
- `tests/scripts/stamp-version.test.ts`
- `packages/core/src/generated-version.ts`
- `packages/core/src/constants.ts`
- `package.json`
- `docs/package.json`
- `packages/*/package.json`

**Acceptance criteria:**
- [ ] `APP_VERSION` comes from `packages/core/src/generated-version.ts`.
- [ ] `generated-version.ts` is tracked with `0.0.0-dev` stub content.
- [ ] Resolver prefers `GITHUB_REF`, exact release tag, nearest release tag, then `0.0.0-dev`.
- [ ] Every `git describe` uses `--match 'v[0-9]*'`.
- [ ] Root version is `0.0.0-dev`; workspace versions are `0.0.0-workspace`.
- [ ] Plugin-local package versions stay at existing `0.0.0` unless implementation proves they need a sentinel.

**Verification:**
- [ ] `bun test tests/scripts/stamp-version.test.ts --isolate`
- [ ] `bun run typecheck`
- [ ] `bun run build:binary`
- [ ] `./dist/bakin-linux-x64 --version` prints a dev-compatible version locally.

**Dependencies:** None.

**Rollback:** Revert C1. No external state.

### C2 — `feat(release): build a publishable SDK package`

**Description:** Make the SDK publishable as `@makinbakin/sdk` from a generated package directory instead of raw repo source.

**Files likely touched:**
- `scripts/build-sdk-package.ts`
- `tests/scripts/build-sdk-package.test.ts`
- `packages/sdk/package.json`
- `packages/sdk/src/**/*.ts`
- `packages/sdk/src/**/*.tsx`

**Implementation notes:**
- Use `Bun.build()` for JS outputs.
- Generate declarations through a temp tsconfig that overrides `noEmit`, `declaration`, `emitDeclarationOnly`, `rootDir`, and `outDir`.
- Generate a publish-only `package.json` in the output dir; never mutate source `packages/sdk/package.json`.
- Scan generated `.js` and `.d.ts` for forbidden imports: `@/`, `@bakin/<plugin>`, `workspace:`, absolute repo paths, `packages/host`, and `src/` internals.
- If an exported SDK subpath cannot be made cleanly external, reduce or rewrite that SDK export in this commit rather than shipping a broken package.

**Acceptance criteria:**
- [ ] Generated package contains JS + `.d.ts` for every exported subpath.
- [ ] Generated `package.json` has stamped version and correct `exports`.
- [ ] Only true peers (`react`, `react-dom`) are peer dependencies.
- [ ] Public runtime/type dependencies such as `zod` are declared if referenced.
- [ ] Scratch install/import with Bun works from outside the repo.

**Verification:**
- [ ] `bun test tests/scripts/build-sdk-package.test.ts --isolate`
- [ ] `bun run scripts/build-sdk-package.ts --version 0.1.0-rc.1 --out /tmp/bakin-sdk-package-smoke`
- [ ] From a scratch dir: `bun add react@^19 react-dom@^19 /tmp/bakin-sdk-package-smoke`
- [ ] From scratch: `bun -e "import('@makinbakin/sdk').then(m => { if (typeof m.registerPlugin !== 'function') throw new Error('missing registerPlugin') })"`
- [ ] One `bun -e "import('@makinbakin/sdk/<subpath>')"` per export.
- [ ] `bun run typecheck`

**Dependencies:** C1 preferred, but can start independently if version is passed as a script arg.

**Rollback:** Revert C2. Source SDK package remains unchanged except any intentional export cleanups.

### C3 — `docs(release): add CHANGELOG.md skeleton`

**Description:** Add Keep-a-Changelog file and release-note extraction assumptions.

**Files likely touched:**
- `CHANGELOG.md`
- `tests/scripts/release.test.ts` (CHANGELOG parsing fixtures may land here or in C4)

**Acceptance criteria:**
- [ ] `[Unreleased]` exists with `Added`, `Changed`, `Fixed`, `Removed`, `Security`.
- [ ] `[0.1.0]` initial-public-release section is represented as specified.
- [ ] Link refs match the version-without-leading-`v` format.

**Verification:**
- [ ] Manual parse using the helper added in C4, or a focused unit test if helper lands here.

**Dependencies:** None.

**Rollback:** Revert C3. No external state.

### C4 — `feat(release): add release script with bump verbs and pre-flight checks`

**Description:** Implement the local release UX: preflight, bump/RC/promote, changelog move, release commit, tag, atomic push, workflow URL output.

**Files likely touched:**
- `scripts/release.ts`
- `tests/scripts/release.test.ts`
- `package.json`
- `CHANGELOG.md`

**Acceptance criteria:**
- [ ] Supports `patch`, `minor`, `major`, `--rc`, `promote`, and `--dry-run`.
- [ ] Uses only tags matching `^v\d+\.\d+\.\d+(-rc\.\d+)?$`.
- [ ] Checks branch, clean worktree exception for generated version, origin/main parity, specific Main CI success for current SHA, non-empty `[Unreleased]`, tag uniqueness, tag regex, and first `1.0.0` confirmation.
- [ ] Moves `[Unreleased]` to `[<version>] - YYYY-MM-DD`.
- [ ] Creates `chore(release): v<version>` and tag locally.
- [ ] Pushes with `git push --atomic origin main v<version>`.
- [ ] Dry-run performs no writes and prints the full release plan.

**Verification:**
- [ ] `bun test tests/scripts/release.test.ts --isolate`
- [ ] `bun run release --dry-run patch`
- [ ] `bun run typecheck`

**Dependencies:** C1, C3.

**Rollback:** Revert C4. Delete any local dry-run artifacts if created by a bug.

### C5 — `feat(release): sign and notarize macOS release binaries`

**Description:** Add scriptable Developer ID signing/notarization path with testable dry-run command planning.

**Files likely touched:**
- `scripts/sign-macos-binary.ts`
- `tests/scripts/sign-macos-binary.test.ts`

**Implementation notes:**
- Real mode requires macOS, a binary path, and required secret env vars.
- Dry-run mode prints a redacted command plan and can run on any platform.
- Order is fixed: import cert/keychain, `codesign`, verify, zip for notary upload, `notarytool submit --wait`, fetch log on failure, then leave artifact ready for checksum.
- Do not print certificate passwords, private keys, or keychain passwords.

**Acceptance criteria:**
- [ ] Fails fast with clear missing-env messages in real mode.
- [ ] Dry-run proves command order and redaction.
- [ ] Real mode refuses to run outside macOS.
- [ ] Script does not compute checksums; workflow owns checksum after script success.

**Verification:**
- [ ] `bun test tests/scripts/sign-macos-binary.test.ts --isolate`
- [ ] `bun run scripts/sign-macos-binary.ts --dry-run --binary dist/bakin-darwin-arm64`
- [ ] `bun run typecheck`

**Dependencies:** None, but workflow integration waits for C6.

**Rollback:** Revert C5. No external state.

### C6 — `feat(release): tighten workflow gates and enable trusted publishing`

**Description:** Rewrite release workflow and SDK publish script around strict gates, signed artifacts, draft release sequencing, and npm trusted publishing.

**Files likely touched:**
- `.github/workflows/release.yml`
- `scripts/publish-sdk.ts`
- `scripts/build-sdk-package.ts`
- `scripts/sign-macos-binary.ts`
- `tests/scripts/release.test.ts`
- `tests/scripts/build-sdk-package.test.ts`

**Implementation notes:**
- Workflow permissions: `contents: write`, `id-token: write`.
- Workflow concurrency: `group: release-publish`, `cancel-in-progress: false`.
- Checkout with `fetch-depth: 0`.
- Re-run `bun test --isolate`, `bun run lint`, `bun run typecheck`.
- Validate tag grammar and `main` ancestry.
- Build all binaries, upload unsigned artifacts between jobs as needed.
- Sign/notarize `bakin-darwin-arm64` on macOS before checksum generation.
- Compute checksums after signed macOS artifact is returned.
- Extract notes from committed `CHANGELOG.md` into workflow-local `.release-notes.md`.
- Create a draft GitHub release with assets.
- Setup Node >= 24 and npm >= 11.5.1 before publish.
- `scripts/publish-sdk.ts` should:
  - accept `--dry-run`, `--package-dir`, `--version`, and optional `--tag`;
  - pre-check `npm view @makinbakin/sdk@<version> version --json`;
  - exit 0 only when version already exists;
  - publish with `npm publish [--provenance] --tag <latest|next>` from the generated package dir;
  - never read `NPM_TOKEN`.
- After npm publish, C7 handles tap update; then workflow undrafts/publishes the GitHub release.

**Acceptance criteria:**
- [ ] Malformed `v*` tags fail before build/publish.
- [ ] Tags not on `main` fail before build/publish.
- [ ] Generated SDK package dry-run uses the tag version.
- [ ] npm publish errors are not swallowed.
- [ ] `NPM_TOKEN` and `BAKIN_PUBLISH_IDEMPOTENT` are gone.
- [ ] GitHub release is not published before npm and stable tap sequencing completes.

**Verification:**
- [ ] `bun test tests/scripts/build-sdk-package.test.ts tests/scripts/release.test.ts --isolate`
- [ ] `bun run scripts/publish-sdk.ts --dry-run --version 0.1.0-rc.1 --package-dir /tmp/bakin-sdk-package-smoke`
- [ ] `bun run typecheck`
- [ ] YAML sanity check by `gh workflow view Release` after push, or review rendered YAML locally.

**Dependencies:** C1, C2, C3, C5.

**Rollback:** Revert C6. If a draft release was created during testing, delete it manually.

### C7 — `feat(release): automate Homebrew tap publishing`

**Description:** Render the Homebrew formula from release checksums and push stable updates to `markhayden/homebrew-tap`.

**Files likely touched:**
- `scripts/update-homebrew-formula.ts`
- `tests/scripts/update-homebrew-formula.test.ts`
- `homebrew/bakin.rb`
- `homebrew/README.md`
- `.github/workflows/release.yml`

**Acceptance criteria:**
- [ ] Formula renders URLs for `bakin-darwin-arm64`, `bakin-linux-x64`, `bakin-linux-arm64`.
- [ ] Formula renders SHA256 values from `dist/checksums.txt`.
- [ ] Missing checksum fails loudly.
- [ ] Placeholder values never appear in output.
- [ ] Tap naming is `markhayden/tap`; install command is `brew install markhayden/tap/bakin`.
- [ ] Stable releases push `Formula/bakin.rb` to `markhayden/homebrew-tap`.
- [ ] RC releases render dry-run only and never push.
- [ ] If tap push fails, GitHub release remains draft.

**Verification:**
- [ ] `bun test tests/scripts/update-homebrew-formula.test.ts --isolate`
- [ ] `bun run scripts/update-homebrew-formula.ts --version 0.1.0 --checksums tests/fixtures/release/checksums.txt --out /tmp/bakin.rb`
- [ ] On macOS when practical: `brew audit --strict --online /tmp/bakin.rb` and/or `brew test /tmp/bakin.rb`.
- [ ] `bun run typecheck`

**Dependencies:** C6 for workflow integration. Script/test can be built earlier.

**Rollback:** Revert C7. If a bad tap commit lands, push a correcting formula commit or revert in `markhayden/homebrew-tap`.

### C8 — `feat(release): add post-publish smoke matrix`

**Description:** Add release-published smoke for macOS/Linux binaries, SDK clean install/import, and stable Homebrew install/test.

**Files likely touched:**
- `.github/workflows/release-smoke.yml`

**Acceptance criteria:**
- [ ] Trigger supports explicit `workflow_dispatch` from `release.yml`, with `release: published` kept for human-published releases.
- [ ] Binary matrix downloads exact release assets with `GH_TOKEN`.
- [ ] Linux x64 and Linux arm64 run `--version` and match tag without `v`.
- [ ] macOS verifies `codesign`, then runs `--version`.
- [ ] SDK smoke installs exact `@makinbakin/sdk@<version>` with Bun and imports every export subpath.
- [ ] Homebrew job runs only for stable releases and verifies `brew install markhayden/tap/bakin`, `bakin version`, and `brew test`.

**Verification:**
- [ ] YAML review.
- [ ] First `v0.1.0-rc.1` proves binary + SDK jobs; stable `v0.1.0` proves Homebrew.

**Dependencies:** C6, C7.

**Rollback:** Revert C8. Published releases remain valid; smoke visibility is lost until restored.

### C9 — `docs(release): document release pipeline and rollback runbook`

**Description:** Update user docs, contributor docs, agent context, Homebrew docs, and deep runbook.

**Files likely touched:**
- `.claude/knowledge/release-pipeline.md`
- `README.md`
- `CONTRIBUTING.md`
- `CLAUDE.md`
- `docs/src/content/docs/start/install.mdx`
- `homebrew/README.md`

**Acceptance criteria:**
- [ ] README/install docs prefer Homebrew on macOS and keep install script/manual path as fallback.
- [ ] Homebrew docs use `markhayden/tap`, not `markhayden/bakin`.
- [ ] Runbook covers release, RC, promote, npm bootstrap, trusted publisher setup, Apple secrets, Homebrew token, rollback, yank, and smoke failure handling.
- [ ] CONTRIBUTING explains no `NPM_TOKEN` and no hand-edited versions.
- [ ] CLAUDE.md has a short release pipeline pointer for future agents.

**Verification:**
- [ ] `bun run docs:check`
- [ ] `bun run lint`
- [ ] Manual read-through of `.claude/knowledge/release-pipeline.md` copy-paste commands.

**Dependencies:** C1-C8.

**Rollback:** Revert C9. No external state.

### C10 — verification and first release, no code commit

**Description:** Configure one-time external state and exercise the pipeline through RC and stable release.

**Steps:**
1. Build SDK package locally with bootstrap version.
2. `npm publish --access public --tag bootstrap` from the generated SDK package dir.
3. Configure npm trusted publisher for `@makinbakin/sdk`: repo `markhayden/bakin`, workflow filename `release.yml`.
4. Configure GitHub secrets:
   - `APPLE_DEVELOPER_ID_CERT_P12_BASE64`
   - `APPLE_DEVELOPER_ID_CERT_PASSWORD`
   - `APPLE_DEVELOPER_IDENTITY`
   - `APP_STORE_CONNECT_KEY_ID`
   - `APP_STORE_CONNECT_ISSUER_ID`
   - `APP_STORE_CONNECT_PRIVATE_KEY`
   - `HOMEBREW_TAP_TOKEN`
5. Cut `v0.1.0-rc.1` with `bun run release minor --rc`.
6. Watch release workflow, confirm RC GitHub prerelease, npm `next`, no Homebrew tap push.
7. Smoke exact SDK RC from a clean dir.
8. Verify macOS binary signing/notary checks in release-smoke.
9. Promote with `bun run release promote`.
10. Verify `v0.1.0` stable release, npm `latest`, Homebrew tap update, `brew install markhayden/tap/bakin`, and `brew test`.
11. Optionally deprecate bootstrap package version.

**Acceptance criteria:**
- [ ] `@makinbakin/sdk@0.1.0-rc.1` exists with dist-tag `next`; provenance exists when repository visibility supports it.
- [ ] `@makinbakin/sdk@0.1.0` exists with dist-tag `latest`; provenance exists when repository visibility supports it.
- [ ] GitHub releases have expected assets + checksums.
- [ ] macOS asset is signed/notarized and smoke passes.
- [ ] `markhayden/homebrew-tap` formula points at `v0.1.0`.
- [ ] `brew install markhayden/tap/bakin` works on macOS.

**Rollback:** Follow D10 runbook. Prefer roll-forward unless secrets/security require yank.

## Checkpoints

### Checkpoint A — after C1-C4
- [ ] `bun test tests/scripts/stamp-version.test.ts tests/scripts/release.test.ts --isolate`
- [ ] `bun run typecheck`
- [ ] `bun run release --dry-run patch`
- [ ] No source package file is dirtied by version stamping.

### Checkpoint B — after C5-C7
- [ ] `bun test tests/scripts/build-sdk-package.test.ts tests/scripts/sign-macos-binary.test.ts tests/scripts/update-homebrew-formula.test.ts --isolate`
- [ ] `bun run scripts/build-sdk-package.ts --version 0.1.0-rc.1 --out /tmp/bakin-sdk-package-smoke`
- [ ] `bun run scripts/sign-macos-binary.ts --dry-run --binary dist/bakin-darwin-arm64`
- [ ] `bun run scripts/update-homebrew-formula.ts --version 0.1.0 --checksums <fixture> --out /tmp/bakin.rb`

### Checkpoint C — after C8-C9
- [ ] `bun test --isolate`
- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run docs:check`
- [ ] `bun run build`

### Checkpoint D — C10
- [ ] First RC passes without Homebrew tap push.
- [ ] First stable release passes with Homebrew tap push.
- [ ] Release-smoke is green for binary, SDK, and Homebrew jobs.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| SDK exports depend on host/plugin internals | High | Fail package build on repo-only imports; clean SDK surface in C2 before touching npm. |
| Apple notary rejects Bun-compiled binary | High | Add dry-run script first, test via RC, keep artifact shape explicit, and do not undraft release until checks pass. |
| Homebrew smoke races tap update | Medium | Create draft release first, update tap before undrafting/publishing GitHub release. |
| Trusted publishing bootstrap is blocked by npm scope/package ownership | Medium | Verify ownership in pre-flight; manual bootstrap is isolated to `0.0.0-bootstrap.0`. |
| Tap token has too much or too little access | Medium | Use separate `HOMEBREW_TAP_TOKEN` scoped only to `markhayden/homebrew-tap` contents write. |
| Release workflow grows hard to debug | Medium | Keep complex shell in scripts with unit tests; workflow should orchestrate, not hide logic. |
| A failed stable release leaves npm published but no GitHub release | Medium | GitHub release remains draft; rerun tap/publish tail or roll forward per runbook. |

## Open Questions Before C10

- [ ] Exact GitHub secret names match the final workflow.
- [x] Confirm whether `spctl --assess --type execute` passes on the raw signed/notarized binary after ZIP notary submission. It rejects the raw executable as not an app; use `codesign` verification plus accepted notarization for the binary, and add a `pkg`/`dmg` artifact later if stapled offline Gatekeeper validation becomes required.
- [ ] Confirm `brew audit --strict --online` expectations for binary-only formula in a third-party tap.
- [ ] Decide whether to deprecate `@makinbakin/sdk@0.0.0-bootstrap.0` immediately after `v0.1.0` ships.

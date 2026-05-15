# Release Process

Bakin releases are prepared locally and published by GitHub Actions.

Local commands must never create release tags or publish artifacts. The only
manual publish step is running the `Release` workflow after the release PR has
merged to `main`.

## Summary

1. Create a release branch from `main`.
2. Run `bun run release ...` to prepare `CHANGELOG.md`.
3. Curate release notes in the release PR.
4. Run the `Release` workflow on `main`.
5. Watch the single `Release` workflow through publish and smoke.

## Prepare A Release

Start from an up-to-date `main`:

```sh
git switch main
git pull
```

For the first public release, where `0.1.0` already exists in
`CHANGELOG.md`:

```sh
bun run release --version 0.1.0 --create-branch
```

For normal future releases:

```sh
bun run release patch --create-branch
bun run release minor --create-branch
bun run release major --create-branch
```

For a release candidate:

```sh
bun run release minor --rc --create-branch
```

The helper:

- Computes the target version from remote release tags.
- Creates `release/vX.Y.Z` when `--create-branch` is supplied.
- Moves `[Unreleased]` notes into `## [X.Y.Z] - YYYY-MM-DD` when needed.
- Leaves an existing target version section unchanged.
- Does not tag, push, or publish.

Review and curate the changelog on the release branch. The version section in
`CHANGELOG.md` is the source of truth for GitHub release notes.

## Open The Release PR

Push the branch and open a PR titled:

```text
release: vX.Y.Z
```

The PR should normally contain only:

- `CHANGELOG.md` release notes.
- Release-specific docs/install updates.
- Small fixes that are explicitly required to ship the release.

Use the PR review to edit the release notes until they read like public-facing
product notes, not a commit log.

Merge the PR after CI passes.

## Publish

After the release PR is merged, go to GitHub Actions and run:

```text
Release
```

Run it from `main` with:

```text
version: X.Y.Z
```

Use the version without the leading `v`.

`Release` validates that:

- It is running from `main`.
- The input version is valid.
- The remote tag does not already exist.
- `CHANGELOG.md` has a matching `## [X.Y.Z]` section.
- Release notes can be extracted.

If validation passes, it creates and pushes `vX.Y.Z`, then continues to:

- Builds and tests.
- Builds Linux and macOS binaries.
- Signs and notarizes the macOS binary.
- Uploads release assets and checksums.
- Publishes `@makinbakin/sdk`.
- Updates the Homebrew tap for stable releases.
- Publishes the GitHub release.
- Runs post-publish smoke tests for binaries, SDK install/imports, and stable
  Homebrew installs.

## After Publish

Watch the `Release` workflow until all publish and smoke jobs pass.

If publish fails before the GitHub release is made public, fix the issue and
rerun the failed workflow/job if possible.

If publish fails after npm, GitHub release, or Homebrew has been updated, prefer
a forward fix with a new patch release.

## Important Notes

- Do not create release tags locally.
- Do not run `scripts/release.ts` directly; local publishing is retired.
- `bun run release` is a prep command only.
- Version selection uses remote tags, not local tags.
- If local tags are stale, they should not affect `bun run release`, but they
  can still confuse manual git commands and local version stamping.

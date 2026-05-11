# Changelog

All notable changes to Bakin are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with Bakin versions driven by git tags.

## [Unreleased]

## [0.1.0] - 2026-05-05

### Added
- Initial public release of Bakin.
- Ship a standalone `bakin` CLI and local web app.
- Add core plugins for tasks, team, assets, memory, schedule, workflows, models, health, and git worktrees.
- Add plugin and agent package authoring surfaces.
- Publish signed macOS and Linux binaries.
- Publish `@makinbakin/sdk`.
- Add Homebrew installation through `markhayden/tap/bakin`.

### Fixed
- Stamp release versions into binaries so `bakin --version` matches the release tag.
- Sign and notarize macOS release binaries.
- Publish release assets, SDK packages, Homebrew formula updates, and post-publish smoke checks from CI.

[Unreleased]: https://github.com/markhayden/bakin/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/markhayden/bakin/releases/tag/v0.1.0

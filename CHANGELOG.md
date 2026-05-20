# Changelog

All notable changes to Bakin are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with Bakin versions driven by git tags.

## [Unreleased]

## [0.0.1-rc.1] - 2026-05-19

### Added
- Prepare the first release-candidate binary and SDK publishing path for fresh-machine install testing.
- Ship the standalone `bakin` CLI and local web app.
- Add core plugins for tasks, team, assets, memory, schedule, workflows, models, health, and git worktrees.
- Add plugin and agent package authoring surfaces.
- Add consistent Ink TUI output across core CLI commands, including onboarding, doctor, list/get surfaces, JSON mode, tables, prompts, logs, and error responses.
- Add doctor repair delegation and verification output for task-board handoff workflows.

### Changed
- Align bundled adapter versions and compatibility ranges with the `0.0.1` release train.
- Start unpublished patch release prep at `v0.0.1-rc.1` instead of `v0.1.0-rc.1`.

### Fixed
- Stamp release versions into binaries so `bakin --version` matches the release tag.
- Sign and notarize macOS release binaries.
- Publish release assets, SDK packages, Homebrew formula updates, and post-publish smoke checks from CI.

[Unreleased]: https://github.com/markhayden/bakin/compare/v0.0.1-rc.1...HEAD
[0.0.1-rc.1]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.1

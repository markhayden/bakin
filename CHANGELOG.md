# Changelog

All notable changes to Bakin are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with Bakin versions driven by git tags.

## [Unreleased]

### Fixed
- Repair compiled binary service setup and restart launch paths so macOS LaunchAgents and Linux user services run the real `bakin serve` executable instead of Bun virtual filesystem paths.

## [0.0.1-rc.6] - 2026-05-27

### Added
- Seed imitation-crab with the production five-agent roster, canonical asset fixtures, projects and messaging plugin data, expanded schedule fixtures, and Health usage/session cost data for richer local smoke testing.
- Add workflow editor support for ordered canvas editing, node configuration, add/reorder/delete/copy flows, enable/disable handling, availability tracking, and unsaved-change protection.

### Changed
- Update release-candidate install commands to pin `v0.0.1-rc.6`.
- Keep Health cost reporting tied to runtime-provided values, including nullable unavailable costs and totals derived from runtime cost components.

### Fixed
- Reconcile accepted runtime dispatch failures when app-server idle or runtime errors arrive after handoff, while preserving the existing retry and cooldown path for delivery failures.
- Route OpenClaw schedule cron list/create/update/delete/run-history operations through the CLI/Gateway path, preserve provider-generated ids and timezones, expose full-day calendar coverage, and confirm scheduled job deletes.
- Show current Health search document counts by normalizing adapter document count fields across memory, search, and CLI health surfaces.
- Retry SDK publishes without provenance when npm records a duplicate transparency-log entry before the package version reaches the registry.

## [0.0.1-rc.5] - 2026-05-27

### Changed
- Superseded by `0.0.1-rc.6`; the release workflow created this tag but did not publish public artifacts after npm returned a duplicate transparency-log entry during SDK publish.

## [0.0.1-rc.4] - 2026-05-25

### Fixed
- Embed the Bakin runtime skill template in release binaries so first-time installs can sync the `bakin` skill outside a source checkout.

## [0.0.1-rc.3] - 2026-05-25

### Changed
- Update release-candidate install commands to pin `v0.0.1-rc.3`.

### Fixed
- Fix `bakin update` for prerelease-only release trains by falling back to the newest published release candidate when GitHub has no stable `/latest` release.

## [0.0.1-rc.2] - 2026-05-25

### Added
- Add native OpenClaw MCP registration during onboarding so Bakin tools are available to fresh main-agent sessions.
- Add a Bakin runtime skill during onboarding to explain Bakin task, project, workflow, asset, schedule, and agent coordination.

### Changed
- Make the release-candidate install command explicit in README and install docs while stable Homebrew publishing remains pending.
- Rename the official research agent from `jessica-fetcher` to `jessica` across curated agent data and guidance.

### Fixed
- Preserve the adapter boundary while syncing Bakin MCP server entries through the runtime config interface.
- Improve fresh-machine install guidance for shells that need `~/.local/bin` added to `PATH`.

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

[0.0.1-rc.1]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.1

[0.0.1-rc.3]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.3
[0.0.1-rc.2]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.2

[Unreleased]: https://github.com/markhayden/bakin/compare/v0.0.1-rc.6...HEAD
[0.0.1-rc.6]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.6
[0.0.1-rc.5]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.5
[0.0.1-rc.4]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.4

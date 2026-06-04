# Changelog

All notable changes to Bakin are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with Bakin versions driven by git tags.

## [Unreleased]

### Fixed
- Build installed plugin client bundles with the production JSX runtime in release binaries, and repair stale installed client bundles that still import `react/jsx-dev-runtime`.

## [0.0.1-rc.13] - 2026-06-04

### Added
- Add compressed release archive packaging for platform binaries, including tar.gz generation/extraction helpers, archive checksum publishing, and post-publish smoke coverage for archive downloads.

### Changed
- Ship GitHub release binaries, installer downloads, Homebrew formula output, and self-update downloads as `bakin-<platform>-<arch>.tar.gz` archives instead of raw executable assets.
- Minify production browser, plugin, and vendor assets during release builds, with an assertion step that fails CI when unminified production assets are emitted.
- Document compressed release artifacts across install, operations, Homebrew, security, release-pipeline, and architecture notes.

### Fixed
- Prevent versioned asset delete requests from hanging by treating delete lifecycle routes as writable operations and reflecting deletion progress/error state in the asset detail UI.
- Type self-update platform overrides correctly so archive-based update tests and platform-specific update paths stay aligned.

## [0.0.1-rc.12] - 2026-06-03

### Added
- Add plugin startup diagnostics for boot/build/registration failures, including a `bakin diagnostics plugin-startup` CLI command, persisted diagnostics settings, host API metadata, and UI surfacing in plugin cards.
- Add plugin startup diagnostics documentation and knowledge notes covering the troubleshooting workflow and usage-recording semantics.

### Changed
- Compress startup and static API responses over remote links to reduce payload size during app boot.
- Refresh generated CLI, settings, API, SDK, and core plugin reference docs for the startup diagnostics surfaces.

### Fixed
- Preserve actionable plugin startup errors from manifest loading, user-plugin builds, embedded plugin registration, and runtime startup so plugin boot failures can be diagnosed instead of collapsing into generic load failures.

## [0.0.1-rc.11] - 2026-06-03

### Added
- Add structured dispatch failure details for task handoffs, including provider, model, error code, retryability, suggested next actions, and raw provider response metadata.
- Surface dispatch failure context in task cards, task detail dialogs, activity feeds, SSE activity events, and audit-message mapping so failed handoffs are readable from both task and timeline views.

### Changed
- Update GitHub Actions workflows to the Node 24-based v5 action releases.
- Document provider failure context semantics in dispatch knowledge notes.

### Fixed
- Embed core plugin manifest permissions in the static plugin imports so packaged plugins retain their declared startup permissions outside a source checkout.

## [0.0.1-rc.10] - 2026-06-02

### Added
- Add memory cleanup: find a stale term across runtime memory tiers, dispatch one cleanup task per affected agent (the agent edits its own source), and verify remaining occurrences per agent, with a dedicated find → dispatch → verify UI flow. Cleanup edits to package-projected files are protected so managed content is not overwritten.
- Add update controls and agent cleanup flows to the UI for managing installed plugins and agent packages.
- Add workflow skill drift detection and repair, surfacing stale skills (including those in parallel workflow groups) with an in-place upgrade action.
- Add a dockerized OpenClaw rig (`bun run instance up`/`dev`/`run`/`shell`/`reset`/`down`) for one-command UI + CLI development against a real OpenClaw in Docker without touching `~/.openclaw`, including 1Password-driven secrets, Discord channel wiring, MCP tool bridging via mcporter, and Codex device-code login.

### Changed
- Document the memory cleanup capability and amend the read/dispatch invariant (Bakin never writes runtime-memory content).
- Refine workflow skill drift repair copy and move the stale-skill upgrade action below the skill details.

### Fixed
- Route OpenClaw channel/message delivery through the CLI path so agent messages are delivered reliably.
- Resolve the OpenClaw workspace against the resolved home directory rather than foreign config paths.
- Report managed plugin and agent-package versions from their lockfiles instead of stale or fabricated values.
- Harden image generation retries against provider timeouts while preserving billing idempotency.
- Lazy-load `sharp` in core plugins so release binaries start without eagerly resolving the native module.
- Keep stale workflow node content readable while drift repair is pending.
- Scaffold an empty changelog section during release branch prep instead of blocking the branch when the section is missing.

## [0.0.1-rc.9] - 2026-06-01

### Added
- Add the versioned asset model across storage, HTTP routes, search indexing, lifecycle operations, uploads, trash, relinking, and the asset browser UI, including version timelines, previews, current-version pinning, and empty states.
- Add runtime-routed image generation with the core images plugin, execution tools, workflow defaults, provider routing, provider-key management, and OpenClaw native image support.
- Add SDK and host nav-badge support, including Tasks and Health badge providers and Health doctor-version signaling.
- Add the TypeScript compiler-backed SDK reference generator and refresh generated documentation/reference output.

### Changed
- Cut asset, task-asset, image, clipboard, inbox, health, search, and agent-facing asset flows over to stable asset IDs and retire the legacy filename-based asset UI/routes/surfaces.
- Improve Settings layout, plugin setting grouping, labels, and responsive row behavior.
- Update asset, image, plugin, and release-pipeline docs for the new runtime and release-candidate behavior.

### Fixed
- Prevent schedule cron double execution.
- Gate the release `smoke-sdk` job on the exact SDK version becoming resolvable on npm (bounded exponential backoff via `scripts/wait-for-npm-version.ts`) so it no longer races registry propagation right after publish.
- Bound npm registry checks to the full timeout budget to avoid stuck release gates.
- Harden versioned asset path resolution, filename sanitization, thumbnails, export/range handling, stale grid previews, and search result stability.
- Harden image generation billing/idempotency, provider fallback, credential lookup, generated-dimension recording, and provider settings error reporting.
- Harden provider secret storage with atomic `0600` writes and secret id validation.
- Fix host/sidebar nav-badge rollups, test stability, and onboarding asset plugin isolation.

## [0.0.1-rc.8] - 2026-05-28

### Changed
- Update release-candidate install commands to pin `v0.0.1-rc.8`.

### Fixed
- Remove stale lint violations that blocked release-candidate CI after `v0.0.1-rc.7`.

## [0.0.1-rc.7] - 2026-05-28

### Changed
- Update release-candidate install commands to pin `v0.0.1-rc.7`.

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

[0.0.1-rc.8]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.8
[0.0.1-rc.7]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.7
[0.0.1-rc.6]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.6
[0.0.1-rc.5]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.5
[0.0.1-rc.4]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.4
[0.0.1-rc.3]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.3
[0.0.1-rc.2]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.2
[0.0.1-rc.1]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.1

[0.0.1-rc.9]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.9

[0.0.1-rc.10]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.10

[0.0.1-rc.11]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.11

[0.0.1-rc.12]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.12

[Unreleased]: https://github.com/markhayden/bakin/compare/v0.0.1-rc.13...HEAD
[0.0.1-rc.13]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.13

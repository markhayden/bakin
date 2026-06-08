# Changelog

All notable changes to Bakin are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with Bakin versions driven by git tags.

## [Unreleased]

## [0.0.1-rc.18] - 2026-06-08

### Added
- **Bakin-owned scheduler — ends the scheduled-task double-fire.** Bakin now owns the firing of its own schedules instead of delegating to OpenClaw cron (which used to fire a rogue agent turn *and* a Bakin task for the same job). A dependency-injected, fake-clock-testable tick computes due occurrences, claims a deterministic per-occurrence run id in the execution ledger (exactly-once via the `(job_id, run_id)` key), and creates the task directly. Startup catch-up coalesces a downtime gap to the single most-recent missed occurrence and lands it in **Todo** within a configurable safety window or **Blocked** when stale. An idempotent cutover migrates existing schedules off OpenClaw cron automatically on startup, with `bakin doctor --full` to verify (the `schedule-cutover` check) and `bakin doctor --fix` to complete it if the runtime was unreachable at boot.
- Native (runtime-owned) crons are surfaced **read-only** with adopt / restore-native actions, a next-run column, and 403/404 mutation guards — Bakin owns Bakin schedules; the runtime owns the crons agents create for themselves.
- A prompt **danger-zone guard** that warns when a schedule prompt tells the agent to keep one large message and not split near the channel transport limit (the shape that caused the "Invalid Form Body" split/repair loop).
- **Schedule run visibility.** Each schedule's job drawer now shows a real run history read from the execution ledger (`cron_fires`) — fired / skipped / blocked per occurrence — replacing the post-cutover-empty runtime-cron history. Skipped fires (overlap / paused / skip-count / auto-paused) emit a `schedule.fire_skipped` activity-audit event and persist their reason (new `cron_fires.skip_reason` column) instead of silently dropping beats.
- **Per-task run history.** The task detail drawer gains a collapsible **Run History** section listing every dispatch attempt for the task (seq, agent, time, status — settled / superseded / lost — settle reason, duration) from the `runs` ledger, via `GET /api/plugins/tasks/:taskId/runs` and a `listRunsByTask` read verb.

### Changed
- The scheduling of Bakin tasks is now Bakin-owned end to end; OpenClaw cron is no longer involved in firing them. Removed the cron→task bridge webhook + shared secret, the reconcile-poll, the legacy main-session-wake repair cluster, the sidecar `processedRunIds` seeding, and the adapter's Bakin-specific cron payload shaping (~500 lines of wrangling).
- Mock (`dev:mock`) seeds Bakin schedules, `cron_fires`, and `runs` history so the new run-history surfaces are exercisable; native-cron fixtures trimmed so the list isn't a wall of "missing cron tools" warnings.

### Fixed
- The 9am scheduled-task double-post (one cron fire → two executions → duplicate Discord post + delivery-repair loop) — eliminated structurally by the Bakin-owned scheduler.
- Schedule fire no longer duplicates a task when a post-create effect fails after the task row is written — the existing task is attached to the claim instead of left for the healer to re-create (#472).
- A timed pause whose window elapsed no longer leaves a schedule permanently disabled; a newly created schedule no longer phantom-fires its pre-creation occurrence on the first tick.
- The schedule list-row actions menu sizes to its content instead of clipping / wrapping "Adopt into Bakin".

## [0.0.1-rc.17] - 2026-06-06

### Added
- **Execution safety ledger — exactly-once task firing and completion.** A SQLite coordination ledger at `~/.bakin/bakin.db` (WAL) where UNIQUE constraints are the locks: cron fires are claimed before task creation, every dispatch path claims its run before sending (the ledger mints the dispatch sequence), completions are first-write-wins (retries report `alreadyComplete` instead of erroring), and billed image results are durable idempotency rows with no TTL so client-timeout retries cannot double-bill. Duplicates are suppressed and audited; a ledger that cannot be opened fails closed.
- Server singleton lock (`~/.bakin/server.lock`) taken before any side effect, with graceful shutdown on `EADDRINUSE` so a second instance can never double-fire scheduled work.
- An `execution-safety` doctor check surfacing suppressed duplicates, claim leaks, and ledger health.
- Optimistic task versioning with freeze-on-complete edit safety, so concurrent edits cannot silently clobber a task that has finished.
- **Asset tags and folders.** Tags are now first-class asset-level metadata (decoupled from the version mirror) with normalization, a metadata edit drawer with tag input, bulk multi-select tagging, global tag rename/remove and bulk-apply APIs, a tags facet filter, and a folders view that groups assets by tag with breadcrumb navigation and URL-backed state. Generation provenance is indexed for search, and the asset grid uses a content-driven tile layout.
- **Lazy plugin loading.** Plugin manifests can declare `contributes.nav/routes/slots/eager`; the host boots navigation from the manifest and lazy-loads noncritical plugin clients on demand instead of importing every plugin at startup.
- Whiskit shared build backend: user-plugin builds run on the system Bun through one hardened runner, `bakin plugins publish` gains `--build`, plugin `check`/`upgrade` route through the Whiskit artifact lane, and dev hot-reload surfaces Whiskit rebuild diagnostics.

### Changed
- Dispatch I/O efficiency pass: an in-memory task-store index (id→path + column buckets, self-healing), a single SSE broadcast per task write, an mtime-validated asset manifest cache behind asset-service reads with debounced grid refetch, a lesson-retrieval cache, reverse tail reads for audit time-window queries, incremental trajectory forensics scans, an LRU cap on the session store cache, and dispatch threadId sequence mints folded into one persist-before-send state save.
- Dispatch prompts slimmed: the static tool catalog moved out of every dispatch prompt into a managed execution-tools block in agent workspaces (`bakin agent-rules --apply-all` covers subagent blocks).
- Core plugin builds skip the server entry; release binaries embed only browser assets (`client.js`/`client.css`) and the server refuses to serve plugin server bundles over HTTP. Whiskit publish fails server builds that retain host-provided browser externals.
- Watchdog recovery is supersede-first and uses ledger heartbeats for liveness instead of racing the original turn.
- Shell bundle moved to `/_app/*` so client routes like `/assets` survive a hard refresh.

### Fixed
- Deterministic Discord digest delivery.
- Completion retries on an already-done task no longer trip the task store's transition guard.
- Watchdog respects a manual restart-recovery classification instead of re-diagnosing the turn.
- Silent lesson drops: lesson retrieval now carries an omission marker when lessons are truncated.
- `assets.listByTask` hook backed by a taskId index, repairing the broken asset block in dispatch prompts.
- SDK root barrel is server-safe — the slots registry split from the `<Slot>` rendering layer so server code can import the barrel without pulling in React DOM.

## [0.0.1-rc.16] - 2026-06-05

### Added
- **Whiskit plugin artifacts — toolchain-free plugin installs.** `bakin plugins publish` assembles a plugin into a versioned, prebuilt `.tar.gz` artifact (manifest + `dist/` + build provenance) with a SHA256 checksum and a carry-forward `whiskit-artifacts.json` release catalog. Installing a GitHub plugin now downloads and verifies that prebuilt artifact and extracts it into the content directory — nothing builds on the user's machine.
- GitHub-release artifact resolver, consumer materialization, and live install into the content directory with a lockfile entry; safe extraction rejects symlinks, zip-slip paths, and oversized archives.
- Startup verification of installed plugin artifacts against the host externals contract, plus a doctor/health check that flags installed plugin artifacts which are outdated or invalid and need a rebuild.
- Shared install core unifying the plugin and agent-package install paths: one subpath guard, atomic JSON lockfile writes, an advisory install lock, and a staging→commit transaction.
- **Session-death recovery ladder.** Diagnosed agent-session deaths now salvage partial output as an asset and escalate through corrective re-dispatch, decomposition into subtasks, and a diagnostic block instead of blind retries — backed by a read-only OpenClaw trajectory forensics parser, fail-fast detection of session deaths during pending turns, a session-death health check, and audit query helpers.
- **Concurrent dispatch.** An in-flight turn registry with per-agent and global concurrency caps (`maxConcurrentTurns` / `maxTurnsPerAgent`), settle-time reconciliation, and per-dispatch provider sessions with stable idempotency keys.
- Output-discipline prompt rules (deliverables to files + `bakin_exec_assets_save`, one at a time, terse chat), a runtime-derived agent roster, and shared tool documentation carried on dispatch prompts.
- A dockerized rig validation campaign with functional end-to-end coverage and benchmarks against a real OpenClaw instance.

### Changed
- Classify dispatch and runtime failures by a typed `kind` rather than error-message text, and treat task continuation as a full re-dispatch against a fresh per-attempt provider session.
- Exclude `node_modules` from published plugin artifacts (pure-JS plugins, v1).

### Fixed
- Add a request timeout to artifact downloads so a stalled release host cannot hang an install.
- Treat a `dependsOn` pointer to a hard-deleted task as satisfied, preventing dependent tasks from being stranded.
- Abort the session-activity poller when a chat-stream consumer breaks early.
- Close three recovery-flow gaps plus idle-determinism and recovery-completeness issues surfaced by the live rig ladder smoke and code review.

## [0.0.1-rc.15] - 2026-06-04

### Fixed
- Add a production JSX dev-runtime compatibility shim so stale installed plugin client bundles that still call `jsxDEV(...)` load instead of crashing after the production asset build change.

## [0.0.1-rc.14] - 2026-06-04

### Fixed
- Build release plugin client bundles with the production JSX runtime so packaged core plugins do not import `react/jsx-dev-runtime`.
- Rebuild stale installed-plugin `dist/client.js` bundles that still contain JSX dev-runtime output, even when existing GitHub-installed plugin artifacts would otherwise be trusted.

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

[0.0.1-rc.13]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.13

[0.0.1-rc.14]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.14

[0.0.1-rc.15]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.15

[0.0.1-rc.16]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.16

[0.0.1-rc.17]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.17

[Unreleased]: https://github.com/markhayden/bakin/compare/v0.0.1-rc.18...HEAD
[0.0.1-rc.18]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.18

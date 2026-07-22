# Changelog

All notable changes to Bakin are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with Bakin versions driven by git tags.

## [Unreleased]

## [0.0.1-rc.23] - 2026-07-22

A field-hardening patch, same day as rc.22. Recovering a second production machine surfaced fourteen distinct failures across install, model acquisition, health reporting, and recovery tooling — every item in this release (#718) traces to one of them. The theme: when search breaks, Bakin says what is actually wrong and fixes it with one action. **If search is broken on an existing install:** upgrade, run `bakin install search` (a current binary no longer skips service provisioning), and if the engine state itself is suspect, `bakin search:reset` rebuilds it clean in one command.

### Added
- **`bakin search:reset` (#718).** Stop the engine → wipe its derived index data (content and models untouched) → provision → clean start → repair reindex, as one confirmation-gated verb (`POST /api/search/reset`). This exact sequence was assembled by hand across eight separate steps during the field recovery. Refuses in guest mode — a non-default engine URL belongs to someone else.
- **Pinned model distributions (#718).** The adapter now pins the exact per-model file set verified against the pinned engine (with sha256 from the known-good install). The field failure: `antfly inference pull` served a wrong distribution — ONNX where the engine's Metal runtime needs the paired GGUFs — and the old any-weight-file check passed it while the engine crash-looped 161 times on MissingWeight. Missing pinned files now fail the check BY NAME; hash drift is reported without blocking; unpinned (operator-configured) models keep the generic check.
- **Preload pre-check (#718).** The engine exits outright on a `--preload-model` it cannot load, and the supervisor's respawn turns one broken model into an invisible crash loop. Models failing the distribution check are left off the service argv: the engine boots, that leg degrades honestly, and the models health check names the broken model.
- **Dead-shard watchdog (#718).** An engine can be partially sick — some tables' shard actors dead (status reads 404, queries hang) while every other table progresses, which evades the heartbeat wedge watchdog entirely. The migration pump now probes listed-but-unreadable active tables each tick and bounces the engine (debounced, attempt-capped; the doctor owns escalation). This was the final failure on the recovered box: 2 of 12 tables dark inside a "healthy" engine.
- **Async reindex (#718).** `POST /api/reindex?async=1` returns a 202 job handle; `GET /api/reindex/status` reports progress; `bakin reindex` polls with elapsed-time narration. The old sync-only shape held the HTTP socket across the whole multi-minute blue/green pass with no timeout and no progress — a long rebuild was indistinguishable from a hang. Old servers ignore the flag and answer sync; the CLI handles both.

### Changed
- **"Disabled" and "unreachable" are different states (#718).** `getSearchHealth` used to report `enabled: false` with zero tables whenever the engine was down — telling an operator with a crash-looping engine that search wasn't even configured. The snapshot now carries `engineReachable` (SDK: `SearchHealthSnapshot`), keeps registry tables listed from local state while the engine is down, and every surface renders the difference: CLI header (`enabled — engine UNREACHABLE`), the stats report, the Health system tab (with reindex disabled until the engine answers), and the doctor's index observations.
- **"Missing" and "unreadable" are different diagnoses (#718).** The consistency check treated any null stats read as "Active Search index is missing" → blue/green rebuild. A dead shard inside a live engine 404s the status path while `tables.list` still names the table — and the right fix is a 20-second engine restart, not a GPU-hours rebuild. The check now corroborates against the engine's table list: confirmed-missing → rebuild repair; listed-but-unreadable → a new engine-restart repair; list unavailable → honest unknown (ambiguity never resolves to a rebuild). The adapter client enforces the same discipline: only the engine's own 404 reads as "gone"; every other rejection surfaces as its real error.
- **Disabled embedders degrade to keyword-only (#718).** A disabled/unusable embedder used to flow into table creates as a dimension-0 vector spec the engine 500s on — bricking every media-capable table on the box. Legs whose embedder is off are now skipped (keyword-only table), adapter `capabilities()` stops advertising the leg, and a doctor advisory names the content types serving degraded results so the trade-off is visible, not silent.
- **The "Verify" dead-ends got documented resolutions (#718).** "Spend evidence is incomplete" now walks through completing it (cache model pricing via the Models page — unpriced models are the usual gap on a fresh install; read the named gaps via `bakin spend`; fail-closed deferral is by design). The generic "could not be verified" card now says plainly that the check itself crashed, points at the captured error in its own detail, and gives the diagnose→fix→report path.

### Fixed
- **A noop install still provisions and starts the engine service (#717, folded into #718).** `bakin install search` with a current binary previously did nothing — a box with a wiped or missing service unit stayed dark forever with no path back short of manual launchctl surgery. The noop path now re-provisions the unit and starts the service if it isn't answering.
- **`bakin search:stats` TTY view rendered fiction (#718).** The ink renderer read fields that never existed on the route and printed `-` names and `?` doc counts for perfectly healthy tables — while the piped plain view told the truth. It now renders the real snapshot (per-table docs, backlog split into queued/embedding, migration phase, journal summary) and shows engine-unreachable as its own state.
- **Test runs can no longer touch the machine-global engine service (#718).** While validating this release, the test suite rewrote the real `io.bakin.antfly` LaunchAgent to point at a test temp dir and bounced production search — the second incident of this class. `detectServiceMode` now refuses `launchd`/`systemd` under `NODE_ENV=test` (explicit override still available), so a missed mock in any future test physically cannot reach the real unit.

## [0.0.1-rc.22] - 2026-07-22

A search-reliability release, one day after rc.21. A production incident during an attempted antfly rc.21 engine upgrade turned into a full audit of the search migration machinery — five blind design reviews, a minimal-reproduction ladder against the engine, and a rebuilt migration core. The engine stays pinned at antfly rc.18 (rc.19–rc.21 fail evaluation with a crash dossier, filed upstream); everything Bakin-side is substantially hardened. If search on an rc.21 install shows "degraded", upgrade to this release, then clean-slate the engine (`bakin install search` after removing `~/.bakin/antfly`) and run `bakin reindex`.

### Added
- **Search migration engine v2 (#714).** The blue/green migration core rebuilt around the failure modes a real incident exposed:
  - **Persisted migration identity.** The green's target fingerprint is recorded (`migrating_fp`, search.db v4) and resume replays it verbatim — the old recompute path lost rebuild nonces, could alias the live table, and the post-flip drop would have deleted it (found by review, confirmed in code, guarded by invariants: a migration target equal to the active physical is repaired, never staged, never dropped).
  - **Progress-aware convergence.** A frozen green (doc/indexed/pending counts all static) parks in ~60 seconds instead of holding a flat 10-minute timeout; a leg in error state parks immediately; a still-progressing green gets up to 30 minutes; a failed stats read is never treated as flip evidence.
  - **Backfill-only serialization.** The process-wide chain now bounds only the embed-heavy backfill; converge-waits run per-table off-chain — three stuck tables once serialized into a ~30-minute global stall.
  - **Migration pump.** Parked migrations self-heal on a 5-minute tick (attempt-capped; the doctor owns escalation). Active tables whose physical vanished engine-side (data-dir wipe) are regenerated — judged from one authoritative table listing, never from per-table status errors, and skipped inside a post-restart grace window (a status-error misread once mass-regenerated 10 healthy tables in a feedback loop).
  - **Dominance flip.** An unconverged green whose corpus landed fully now flips over an EMPTY old physical — parking used to leave queries serving zero docs while a complete table sat unflipped.
  - **Surgical reindex.** `bakin reindex` / `POST /api/reindex` is repair-by-default: resume parked, regenerate engine-missing, migrate drifted, skip healthy. `--force` (`?force=1`) restores fresh-generations-for-everything. Overlapping passes single-flight — stacked passes once rebuilt one healthy table through 8 generations in an evening. Rebuilds run in product-priority order (assets first, memory last) at bounded concurrency.
  - **Engine wedge watchdog.** A progress heartbeat (backfill chunks, converge movement, outbox drains) feeds a 30-second watchdog while migrations are in flight; a stale heartbeat bounces the engine via the adapter's own supervised restart instead of waiting on the doctor's 30-minute cadence.
- **Cold drops (#715).** Every engine-side table drop is tombstone-first; the actual DELETE runs only in the doctor's sweep after a 30-minute cold dwell. Defends against antfly#386 (dropping a table with a hot embedding queue crashes affected engine versions — a regression since rc.18 still present upstream): the ladder gate protects Bakin's pin choices, cold drops protect end users from the regressions nobody tested for.

### Changed
- **Antfly stays pinned at 0.2.0-rc.18 (#712 evaluated, reverted in #714).** rc.21 was adopted, battle-tested, and rejected the same day on shell-only reproductions: concurrent embed-bearing writes crash the engine (Metal command-buffer failure, process exit), it exits mid table-creation on an empty data dir, sustained embed load sickens its data plane, and the in-place upgrade migrates table files one-way (a rollback then finds `InvalidTableFile`). Findings filed upstream (antfly #382, #383, #384, #386) with scripted repros; the pin comment documents the re-evaluation recipe for the next release. `bakin install search` now re-provisions the OS service unit unconditionally and treats an engine version change as a rebuild event (derived data dir cleared; the repair reindex regenerates).
- **All engine writes are serialized (#714)** — one write in flight process-wide, matching the engine's demonstrated concurrency contract. Reads are unaffected; rebuild passes stay pipelined.
- **Table identity is the base fingerprint (#714).** Plain ensures no longer treat a nonce'd rebuild generation as drift and migrate it back to the base name — the "boomerang" that re-ran enumerators and re-embedded healthy tables after every rebuild.

### Fixed
- **The search query fan-out shares one wall-clock budget (#714).** Sequential rerank fan-outs gave each of 12 tables its own budget slice (32-second spinners under rebuild load) and the scan fallback's HTTP request ignored the deadline entirely (default 30s timeout after the budget was already spent). Tables past the shared deadline are honestly omitted.
- **The antfly idle-detection override is restored and re-scoped (#713).** Upstream's #319 fix covers media templates but skip-heavy text corpora can still report building-forever while idle; retiring the override had parked every such table. Its companion test is now a guard on the mapping plus raw-flag evidence logging.
- **Gallery test de-flaked for release builds (#711)** — the brand-header assertions survive long describe-stamped versions.

## [0.0.1-rc.21] - 2026-07-21

The largest release to date: ~90 PRs over four weeks. Bakin becomes genuinely multi-runtime — the new Pi adapter runs the full product alongside OpenClaw behind a capability-declared runtime contract with a first-class, carry-everything switch. Around that core: the search stack rebuilt on a durable outbox + blue/green tables, a Chat plugin and ONE conversation engine for every chat surface, cost control v2 with work-class model routing and honest usage attribution, the Brands plugin, team-aware task assignment, the #191 schedule initiative, a client-routing overhaul, and same-agent concurrency.

### Added
- **Pi runtime adapter (#619, #624).** A second runtime implementation: Pi runs in-process via SDK (vs OpenClaw's gateway/MCP), selected by `settings.runtime.adapter`. The full Bakin surface — dispatch, workflows, images, memory, health — works on either runtime.
- **Runtime Capability Foundation (#630).** Every adapter declares a `CapabilitySet` (tool calling, delivery, image gen, memory, sessions, workspace files — native/shimmed/unavailable) plus `describeToolAccess()`; `channels`/`cron` became optional members consumers feature-detect. One renderer feeds dispatch prompts and the AGENTS.md tool-access section. A **runtime conformance suite (#644)** is the acceptance gate for any adapter — shared behavioral checks run against the dev mock, Pi, and the OpenClaw mock, with a teeth file proving the checks bite.
- **First-class runtime switch with carry-over (#657).** `bakin runtime use <adapter>` orchestrates backup → flip → provision → roster reconcile (model + subagent-model mapping with an honest unmapped report) → workspace content carry (soul/memory verbatim, agent-authored skills) → drift-gated sync, ending in a capability + can't-carry + credential report. `--dry-run` previews the whole thing with zero writes.
- **Pi parity program (P1–P5).** **Integration secrets (#662):** named secrets in `~/.bakin/secrets.json`, masked `/api/secrets`, Settings → Integrations & Keys, env-first injection at server boot. **Capability packs (#664, #674, #675):** skill-packs that grant per-turn powers (web search, …) with pinned sha256 binaries, npm payloads, model prereqs, and enforced secret slots — one readiness engine behind the REST surface, doctor findings, CLI, and hub; plus three fast-follow packs. **Task-completion tail (#666):** approval attention, model preservation, cron adoption. **Runtime hub (#667, #672, #673):** the `/runtime` page rebuilt as a tabbed hub on the SDK kit with one-click Fix for setup checks. **Pi-native image completion (#676)** with keyed-lane edit + multi-reference parity, and a **Pi extension trust lane (#677)** — third-party extension code requires approval before it runs.
- **Search & asset rebuild (#457).** Antfly v0.2 (Zig), pinned + SHA256-verified, running as an OS-supervised service (launchd/systemd user unit). Writes journal through a durable SQLite outbox and land via a drain pump — engine down means rows wait, never lost. Tables are blue/green versioned: schema/model changes migrate in the background with queries pinned to the old table until convergence; boot performs zero engine calls when state matches. Plus zero-config asset enrichment.
- **Search trust & speed (#651, #653).** Engine pinned to rc.18; every request runs under a query budget (default 2s) with per-table cooperative deadlines and honest degradation to keyword-only or omission (`meta.partial`/`meta.tables[]`) — never a silent stall. Health surfaces carry per-table freshness + numeric backlog, and a `search-spin` watchdog catches zero-progress backfills with a one-click blue/green rebuild repair. Cold-boot search readiness went 28.8s → 1.0s.
- **Chat plugin (#622, #660).** Streamed multi-chat with any agent: schema-v2 transcripts, one in-flight turn per chat with abort, image attachments, budget-gated auto-titles, unread/attention (nav badge + tab-title prefix + toast/chime/OS notification), and transcripts in global search. The client side shipped as a reusable **SDK conversation kit** — turn folding, bus-driven threads, attention rules, renderers, composer.
- **Shared conversation turn engine (#703: PRs #704, #705).** ONE server-side turn engine (`createConversationTurnService`) behind every chat-like surface: background turns detached from HTTP (202 on send, 409 busy), incremental persistence, abort → clean done. Chat and brands consume it; external plugins get it via `ctx.conversations` with declarative metering.
- **Cost control v2 (#628).** Budget policy as a rule list — global/agent/provider scopes × billing lanes, with unit-per-lane (metered rules cap USD, subscription rules cap tokens). Breaches open durable ledger-backed incidents that notify and resolve via raise/ack/resume; a dispatch kill switch; budget-deferred tasks badged on the board; fresh installs are never silently uncapped.
- **Work-class model routing (#696).** ONE routing + spend-attribution key: every LLM-consuming call site is a `WorkClass`, routes (class → model/thinking) + tag overrides live in models settings, and every metered turn writes a route receipt — the dimension that routes IS the dimension spend reports on (Spend tab, `bakin spend`, Team Diagnostics). A `models.routing` health check flags unrouted classes/unavailable routes/standing clamps with a one-click apply-recommended-routes repair. Heartbeats are zero-token on both runtimes.
- **Usage attribution & health sensitivity (#698).** usage.db rows carry adapter-labeled session origin, so non-task usage splits into `interactive` (advisory) vs `unexplained` (watch) vs `runaway` (action_required, with a cron-jobs downgrade guard) — NULL-honest, day-aligned. Doctor incidents gained a 10-value `class` enum projected through a sensitivity policy (`developer|standard|quiet`) — calm the noise without hiding action-required findings. Plus **durable usage history (#599)**: per-(session, day, model) rollups in usage.db, beyond the latest session.
- **Brands plugin (#629, #631, #663).** Brand records under `~/.bakin/brands/` (zod manifest for machines, markdown for agents); tasks carry `brandId` with lazy ancestry/project resolution at dispatch and a byte-budgeted two-tier brand card injected into prompts; image tools take `brandId` (palette merge, default references, provenance). Draft lifecycle: questionnaire or website mode → agent authors via draft-gated tools → publish. Portable repo import/export, dedicated doc editor, server-computed kit completeness, and a top-to-bottom UX pass.
- **Team-aware task assignment (#612, #697).** Tasks can be assigned to a team: dispatch resolves the best-suited member pre-claim via an LLM-routed hook riding the runtime's own transport (no API keys), sticky once resolved, with structural failures blocking honestly. Workflow steps target teams the same way via `team:<id>` tokens (#611), sticky per step.
- **Agent health diagnostics (#613, #616).** The supervision layer: sync drift, context budget, burn/spike heuristics, and a per-agent activity timeline (run spine + audit interleave). Surfaces: Health incidents with structured resources + bounded evidence, Team Diagnostics, `bakin agents doctor <id>`, and a hand-rolled SDK chart kit. **Health itself was redesigned as an action-first observability dashboard (#684).**
- **Schedule initiative #191 (#681–#685).** Foundation hardening; first-class one-shot "at" schedules; server-computed occurrences feeding the calendars; and **plugin-contributed scheduled domain events** — any plugin can put its dates (publish dates, deadlines) on the Schedule calendars via a `{pluginId}.scheduledEvents` hook, with per-provider budgets and `droppedProviders` honesty. Tasks is the in-tree provider (`availableAt`/`dueAt`, reschedulable).
- **Same-agent concurrency (#447, #699).** Per-agent parallelism is capability-gated: isolated on Pi via per-run workspace dirs under `~/.bakin/run-workspaces/` (sidecar-classified, watchdog-swept, size-budgeted); serialized on OpenClaw (clamped to 1 with an audit receipt). Repo-bound tasks get a git worktree per run — the branch is the deliverable.
- **Explore storefront (#610, #586, #585).** The `explore` plugin is the discovery storefront at `/explore` — one curated catalog drives both onboarding recommendations and browse+install. H'enrich joined the catalog default-selected, and agent packages can now seed a team persona.
- **Workflow map fan-out + Multi-Image Select (#203, #623, #598).** `map_workflow` steps fan a nested workflow out over a list; the images plugin gained multi-image selection.
- **Gate approvals & Discord notifications (#607).** End-to-end validated and hardened, with threaded gate UX.
- **True streaming + live dispatch activity (#632, #633).** The OpenClaw adapter streams via gateway push events; dispatch surfaces live turn activity with trajectory-tail deletion.
- **Startup context diagnostics (#357, #589).** Per-source measurement + bounds on what a fresh dispatch session costs: one engine behind `bakin agents context`, `GET /api/context-report`, and a warn-only doctor check; workflow prior-step dumps are byte-budgeted with visible omission markers; static boilerplate pinned by byte fixtures.
- **SDK: testing harness, golden path, tightened types (#635, #636, #642).** A published `@makinbakin/sdk/testing` entry with an isolated per-test harness, a plugin scaffold + semver gate + sync-manifest for external authors, `TurnOutputView`, and a reference plugin.
- **Dual-runtime dev rig (#652).** `bun run instance` runs a real runtime against dev-scoped state on either adapter — OpenClaw in Docker, Pi in-process with a throwaway `PI_HOME` — with asset-save parity and isolated per-instance search.

### Changed
- **Main navigation reorganized (#694)** and the client made a real SPA (#692, #693, #695): internal navigation never full-reloads (architecture-test enforced), chat moved to path routes (`/chat/$chatId`), query params became plain strings with per-tick setter batching, element-level scroll restoration is on, and unknown paths render a real 404 page. Presentation-based taxonomy: path = page identity, query = overlays/tabs/filters.
- **Audit follow-up workstreams FW1–FW8 (#587, #588, #591, #592, #594, #596).** Guards & correctness; the stalled CLI consolidation finished (`bakin.ts` 4,413 → 209 lines, one lazy module per command group); the plugin boundary made real (registries moved to core, one sanctioned crossing, guards); the four UI god-files and the server god-files (models/assets indexes, install phases, upgrade lanes) decomposed; dedup remainder, test god-files, and a docs sweep.
- **Workflows: dead YAML surface deleted (#600) — breaking** for workflow authors using `dependsOn`, `on_approve`, or passthrough schemas; cross-plugin nested refs became order-independent (#595).
- **Legacy per-request conversation streaming deleted (#705) — breaking** for plugin authors on the old SDK stream surface; everything rides the shared SSE bus + conversation kit now.
- **Parallel test workers (#634, #638, #640, #700).** CI's test step went ~9.4min → ~2min, with parallel-safe React component tests, per-test RTL cleanup under bun:test, and the kanban-dnd suite un-quarantined.
- **Task delete aborts its in-flight agent turn (#604, #609)** — an `AbortController` per registry entry settles the turn clean, and the watchdog sweeps orphaned turns whose task is gone.
- Removed the orphaned validate-package script (#602); general cleanup sweep — rig off mcporter, doc drift, SDK primitive adoption (#643).

### Fixed
- **Search:** every global-search hit navigates to its exact record (#593); wedged-engine incidents are prevented, detected, and auto-repaired, and orphaned blue/green tables are swept (#659); degraded multiQuery logs one aggregated warn instead of one per table (#661).
- **Doctor/health:** the SendFailed wedge variant is caught and stale/archived escalation covers un-muted (#680); audit-feed noise from missing manifest permissions and empty-agent capability probes silenced (#679).
- **Plugins/host:** plugin boot is bounded — no more infinite "Loading plugins" (#654); hot reload re-registers declarative routes (#649); honest build output for server-only plugins (#655); package-update probes are async so the Team page can't freeze the server (#656); brands declares the capability permissions it uses (#631).
- **OpenClaw adapter:** bakin MCP servers scoped per agent (#639); sessionless MCP GETs answer 405 instead of stalling codex clients 5s (#641); server-side abort works for threaded turns (#637).
- **Workflows:** `$preferred` selectors resolve on fan-out board tasks (#658).
- **Dispatch/tests:** a dispatch-concurrency contention wedge + mock-checker false positives (#701); rig OpenClaw image tag pinned + effort Done-column clarity (#616).
- **Audit sweeps:** 8 bugs from the rig audit + Imitation Crab demo seeds (#603); lint backlog, schedule resilience, orphan cleanup, policy table (#605); credential merge + kanban flake follow-ups (#678).
- **Notifications:** toast content can't paint past the toast box, closed nav groups roll hidden child badges up to the header, and conversations show the working dot instantly at turn-accept (#707).
- Team avatar 304 declaration + pending-search empty state (#590).

## [0.0.1-rc.20] - 2026-06-24

A hotfix for rc.19: the production binary shipped a stale embedded-asset manifest, so vendor-chunk imports 404'd and every SDK-hooks-consuming plugin failed to load.

### Fixed
- **Stale embedded-asset manifest in release builds (#579).** `_embedded-assets-static.ts` lists which content-hashed vendor bundles get compiled into the binary, but only `bun run dev` regenerated it — `bun run build` and `release.yml` never did. So the resize work in #577 changed the SDK shared-chunk hashes while rc.19 embedded the old set, 404'ing `sdk-hooks.js`'s chunk imports in the binary (`module '@makinbakin/sdk/hooks' does not provide an export named 'usePluginEvent'`). The manifest is regenerated, and `build:assets-manifest` is now part of the `build` chain and `release.yml` (after host-shell, before assert + binary) so it can't go stale in a release again.

## [0.0.1-rc.19] - 2026-06-24

This is primarily an architecture release: ~380 commits, the bulk of them a behavior-preserving, codebase-wide module-splitting refactor (the "great refactor"). Alongside it ship metered spend + budgets, layered team context, reference images, and a batch of audit-driven fixes.

### Added
- **Metered spend and budgets.** Per-run cost is now recorded on settle and fed into the single usage recorder; image generation is metered as a spend event. A budget policy + evaluator (window boundaries, warn → defer-with-audit, fail-closed) gates dispatch, with a budget config UI and a spend-vs-budget health check. The health dashboard splits its cost cards into **usage** vs **spend** and adds full-width Context Usage; the models page gains a **Spend** view (`/spend` route) and a routing config UI (origins + tag overrides).
- **Layered team context + agent-sync UI (#401).** Team context is composed from layers — `global.md` (all agents) + role layer (`orchestrator`/`subagent`) + per-team file — projected through `bakin agents sync`. New team detail pages, a global pseudo-team, graph badges, and a health-repair path surface and drive sync from the UI.
- **Reference / context images for image generation (#418, #379, #380).** `generate` and `edit` accept reference/context images; runtime `media://` URIs resolve as references; attachments auto-import (tagged) into the asset store; iteration lands as a new **version** rather than a sibling asset. Channel delivery is deduped — an asset is delivered to a channel once per task, and oversized images are delivered as derived exports instead of duplicates.
- **Real task-outcome run history (#481).** The task run history reflects the actual task outcome (block / reopen / archive), not just the last dispatch outcome, with pre-ledger completions backfilled.
- **Dual-format avatar support (#339)** — WebP / PNG / JPEG agent avatars.
- **Session-store retention health check (#435).**
- **SDK client primitives.** `usePluginEvent` collapses every plugin onto one shared shell SSE connection; plus `useJsonFetch`, `useAvailableModels`, `useHorizontalResize` (+ a shared resizable-pane core), `ConfirmDialog`, `EmptyState`, formatters, and `toneBadge` for outline status badges.

### Changed
- **Codebase-wide module split (behavior-preserving).** The core monoliths were decomposed into focused, single-responsibility modules with thin barrels, run as parallel workstreams (WS2 core extractions + dependency-cycle break, WS3 SDK primitives, WS4 CLI, WS5 search) plus phased per-subsystem splits. Highlights: `runtime.ts` 3,188 → 1,560 lines across 10 PRs; `server.ts` split into a request-handler router, search-startup, startup-recovery, and Web-handler migrations; the OpenClaw adapter broken into ~10 helper modules (agent-turn, channels, config, session-activity, approvals, image-inference, cron-store, errors); the schedule plugin split across 7 phases (util → context → fire-engine → loop → job-service → exec-tools → routes); workflows split into runtime seams, routes, exec-tools, and hooks; `asset-service` reduced to a barrel over `asset-core` / `asset-mutations` / `asset-upsert` / `asset-media` / `asset-trash`; the docs-generate pipeline, models page, canvas editor, and the health / team / tasks plugins all thinned the same way; `plugin-registry` moved `src/lib` → `src/core`; the CLI gained a readonly split + shared HTTP client.
- **SDK vendor bundles consolidated via code splitting (#422)**, plus a binary-size audit with `size:report` tooling, dependency hygiene, and a decision doc (#424).
- **Subagent role defaults** gained an invoker-reporting rule, and agent content was put on a diet to trim dispatch-prompt weight.
- **Asset duplicates are now structurally impossible** — store-path reflection + same-task content dedupe replace after-the-fact cleanup.
- Deleted the dead legacy OpenAPI generator (−227 lines).

### Fixed
- **Security audit** — path-traversal, secret-handling, and supply-chain findings closed (#497); a full-system audit swept incidental correctness bugs — dev images watcher, a dead server write, schedule pause drift (#505).
- Workflows: nested workflows are cycle-detected on the REST start path so a cyclic graph can't be started.
- Schedule: a blocked task no longer suppresses that schedule's fire (#479).
- Tasks: the completion-row invariant holds across block / reopen paths, which could previously strand the row (#485).
- Search: multi-content plugins route by a primary table instead of writing to the wrong one.
- Dev loop: signal handlers no longer preempt lifecycle shutdown (#459); the pinned local Tailwind binary is spawned directly instead of `bunx @latest`; the images plugin is now watched.
- Team: client-side routing + page polish so navigation doesn't full-reload.
- CLI: sync-migration prompt handles a 409, and the agent-sync check runs off-server.
- Health/workflows: plugin-assets init and the skill check both work off-server / registry-aware.
- Core: the bare core exec-tool context is granted full permissions.
- Dockerized rig: cron-CLI operator scopes + a stale host `agentDir` on reused state (#487).
- Manual-test batch (#577): dev start, team sync UX, resizable split panes, and channel delivery + permissions.

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

[0.0.1-rc.18]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.18

[0.0.1-rc.19]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.19

[0.0.1-rc.20]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.20

[0.0.1-rc.21]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.21

[0.0.1-rc.22]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.22

[Unreleased]: https://github.com/markhayden/bakin/compare/v0.0.1-rc.23...HEAD
[0.0.1-rc.23]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.23

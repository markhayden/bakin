# Spec: Plugin Startup Diagnostics and Performance Metrics

## Objective

Diagnose and prevent Bakin startup regressions that present as the browser
staying on "Loading plugins", with immediate focus on plugin loading,
activation, user-plugin rebuilds, browser plugin-client imports, and adjacent
startup stages that can be mistaken for plugin loading.

Success means:

1. Local startup logs identify each plugin load stage, duration, status, and
   slowest contributors when verbose diagnostics are enabled.
2. The browser-side plugin loader reports client manifest fetch/import timing
   separately from server-side plugin activation.
3. Startup benchmark tests make regressions visible in CI or local release
   prep before they reach normal usage.
4. Non-critical plugin startup work is moved out of the critical path when it
   is not required for HTTP readiness.
5. A separate, opt-in metrics design exists for installed Bakin instances
   without any path for leaking user content, secrets, task bodies, prompts,
   file paths, agent messages, or plugin-owned records.

## Assumptions

1. The immediate bug is best handled as observability plus one or more targeted
   critical-path fixes, not a broad plugin-system rewrite.
2. Bakin remains a single-user, single-machine system; no compatibility shim is
   needed for old diagnostic formats.
3. Local diagnostics should be disabled by default for normal service/autostart
   runs and enabled through a persistent local setting or one-off env override.
4. Existing logger env vars remain valid one-off controls:
   `BAKIN_STARTUP_DIAGNOSTICS=1`, `BAKIN_CONSOLE_FORMAT=verbose`, and
   `BAKIN_LOG_LEVEL=debug`.
5. Remote/ecosystem metrics must be a separate feature gate and disabled by
   default.

## Current Findings

The local log at `/Users/roscoe/.bakin/logs/server.log` shows recent startup
sessions with these repeated timings:

- Total from `Loading plugins...` to `All plugins ready`: about 1.7s to 3.8s
  in the latest observed sessions.
- Core plugin activation itself is usually a few milliseconds per plugin.
- `schedule` consistently contributes about 950ms to 1.1s.
- Search startup reconcile contributes about 650ms to 1.0s.
- The remaining gap before `All plugins ready` is mostly `plugin.onReady()`,
  especially schedule reading merged cron jobs.
- Browser "Loading plugins" currently covers a different stage:
  `PluginHost` fetches `/api/plugins/manifest`, imports every client bundle
  with `Promise.all`, injects CSS, and then flips `ready`.
- A remote browser load over Tailscale DERP showed `/api/plugins/manifest`
  around 122ms to 547ms from the browser while active plugin client imports all
  completed around the same 12s mark. That shape points to browser resource
  transfer/import waiting rather than a single slow plugin activation.
- A follow-up resource summary showed 25 startup resources transferring about
  9MB, with `encodedBytes` equal to `decodedBytes` for large JS and `/api/state`.
  That identified missing compression as a major remote-load contributor.
- React StrictMode in development can mount `PluginHost` twice. PluginHost now
  shares in-flight boot work across that immediate remount so one dev reload
  does not start two manifest/import cycles.
- Plugin client JS URLs are versioned with `?v=<mtime>` and are now cacheable
  by URL even in dev. Unversioned plugin asset URLs remain `no-store` so direct
  dev requests still pick up rebuilt bundles.
- Safe text-like API/static/plugin responses are compressed with Brotli or gzip
  when the browser advertises support. SSE, already-encoded responses, small
  payloads, non-2xx responses, and no-transform responses are skipped.

Relevant recent changes:

- `src/lib/plugin-static-imports.ts` now statically imports every core plugin
  module for compiled builds.
- `src/lib/plugin-registry.ts` now carries embedded core manifest permissions.
- `src/lib/plugin-skill-loader.ts` auto-loads plugin workflow skills after
  activation.
- `plugins/schedule/index.ts` runs startup sync/repair work during
  `activate()` and `onReady()`.

Probable diagnostic gap:

- Logs show plugin loaded events but not per-stage durations.
- Default pretty console suppresses several plugin-registry info lines.
- Browser-side import timing is invisible except for console errors.
- `/api/plugins/manifest` computes asset mtimes and reads plugin lockfile, but
  it has no request-local breakdown.

Probable critical-path candidate:

- `schedule.activate()` awaits `syncRuntimeJobsToSearch()`, which calls
  runtime cron listing via `readMergedRuntimeJobs()`.
- `schedule.onReady()` also awaits merged cron job reads before the HTTP server
  starts listening, because `server.ts` calls `await pluginRegistry.onAllReady()`
  before `server.listen(...)`.
- `runLegacyCronRepair(ctx)` is already fire-and-forget, which is good; the
  measured one-second gap appears before the schedule activated log and is more
  likely runtime cron listing / search indexing / adapter startup interaction.

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Server entry: `server.ts`
- Server plugin registry: `src/lib/plugin-registry.ts`
- User plugin builder: `packages/host/src/plugin-host/user-plugin-builder.ts`
- Browser plugin host: `packages/host/src/plugin-host/PluginHost.tsx`
- Plugin manifest route: `packages/host/src/api/plugins/manifest.ts`
- Existing logger: `packages/core/src/logger.ts`
- Existing local usage recorder: `src/core/usage.ts`
- Existing health surface: `plugins/health`
- Tests: Bun test, component tests, optional Playwright smoke for boot UX

## Commands

Focused diagnostics tests:

```sh
bun test --isolate tests/core/plugin-startup-diagnostics.test.ts
bun test --isolate tests/core/plugin-registry.test.ts
bun test --isolate tests/api/plugin-manifest.test.ts
bun test --isolate tests/components/plugin-host.test.tsx
```

Schedule critical-path tests:

```sh
bun test --isolate tests/plugins/schedule/routes.test.ts
bun test --isolate tests/plugins/schedule/health-checks.test.ts
```

Benchmark command after implementation:

```sh
bun run scripts/bench/plugin-startup.ts --home /tmp/bakin-plugin-startup-bench --runs 5
```

Broader verification:

```sh
bun run typecheck
bun test --isolate
```

Manual local debug:

```sh
bakin diagnostics startup on --slow-ms 250
bakin restart
tail -n 300 ~/.bakin/logs/server.log
```

One-off foreground debug:

```sh
BAKIN_STARTUP_DIAGNOSTICS=1 BAKIN_CONSOLE_FORMAT=verbose BAKIN_LOG_LEVEL=debug bun run server.ts
```

## Project Structure

- `packages/core/src/logger.ts` keeps logger behavior and console formatting.
- `src/core/startup-diagnostics.ts` should own reusable span timing helpers and
  summary rendering.
- `src/lib/plugin-registry.ts` should emit server plugin discovery, import,
  migration, route registration, activation, skill loading, audit logging, and
  total duration spans.
- `packages/host/src/plugin-host/user-plugin-builder.ts` should report user
  plugin build skip/install/server-build/client-build durations.
- `packages/host/src/api/plugins/manifest.ts` should report manifest route
  duration and per-plugin asset version lookup cost in debug/verbose mode.
- `packages/host/src/plugin-host/PluginHost.tsx` should report browser
  manifest fetch, CSS injection, client import, total plugin-host boot, and a
  compact resource-timing summary to `console.debug` in dev or verbose browser
  diagnostics.
- `plugins/schedule/index.ts` should move best-effort startup sync and onReady
  expensive checks after readiness where safe, or time them explicitly if they
  must block.
- `scripts/bench/plugin-startup.ts` should provide a reproducible local
  benchmark against a temp Bakin home.
- `.claude/knowledge/plugin-system.md` and `.claude/knowledge/usage-recording.md`
  should document the diagnostics/metrics contracts after implementation.

## Code Style

Use explicit span names and structured log data. Avoid free-form timing strings
as the only source of truth.

Example:

```ts
const span = startStartupSpan(log, 'plugin.activate', {
  pluginId,
  source: state.source,
})
try {
  await plugin.activate(ctx)
  span.end({ status: 'ok' })
} catch (err) {
  span.end({ status: 'error', error: errorMessage(err) })
  throw err
}
```

Expected log data shape:

```ts
interface StartupSpanLog {
  phase: 'plugins' | 'plugin' | 'manifest' | 'browser-plugin-host' | 'search' | 'server'
  span: string
  pluginId?: string
  source?: 'core' | 'user'
  durationMs: number
  status: 'ok' | 'error' | 'skipped'
  count?: number
}
```

Do not log plugin settings, request bodies, task content, prompts, file paths
outside Bakin-owned roots, auth tokens, raw errors from external providers that
may contain credentials, or arbitrary plugin-returned objects.

## Testing Strategy

Use prove-it coverage:

1. Unit-test the startup span helper for duration, status, error, and slow-span
   threshold behavior with a fake clock.
2. Test plugin registry diagnostics with fake plugins:
   - successful core plugin
   - activation failure
   - auto-loaded skills
   - user plugin override
3. Test user plugin builder diagnostics:
   - fresh dist skip
   - stale dist rebuild
   - dependency install failure
4. Test manifest route diagnostics with fake registry snapshots and fake asset
   mtimes.
5. Test `PluginHost` browser diagnostics by mocking manifest fetch and dynamic
   import outcomes where practical.
6. Add a schedule test that proves expensive startup repair/sync work is either
   not awaited in `activate()` or is bounded and timed.
7. Add a benchmark script with stable JSON output that can be compared across
   runs.

## Local Diagnostics Contract

When verbose diagnostics are enabled, Bakin should emit:

- Plugin activation order with dependency order.
- User plugin build summary:
  - plugin id
  - skipped or rebuilt
  - dependency install duration
  - server bundle duration
  - client bundle duration
- Per-plugin server spans:
  - import/static resolve
  - migrations
  - context build
  - declarative route registration
  - `activate`
  - skill auto-load
  - audit activation
  - total
- Slow span warning when any plugin span exceeds a threshold, default 250ms.
- Search bootstrap timings:
  - table creation
  - pending reconcile
  - full reindex kickoff
- `onAllReady` timings per plugin.
- HTTP readiness timing from process boot to `server.listen`.
- `/api/plugins/manifest` total route timing. Per-plugin asset lookup spans
  should be slow-warning-only so normal page loads do not flood verbose logs.
- Browser plugin-host timings:
  - manifest fetch
  - per-plugin CSS injection
  - per-plugin client import
  - total browser plugin boot
  - compact startup resource summary with the slowest local resource requests
    observed while PluginHost was booting
  - in-memory DevTools buffer on `window.__bakinStartupSpans` for copying the
    latest spans as JSON

Normal file logs should not include startup spans unless diagnostics are enabled
through settings or one-off env vars. Pretty console should continue suppressing
noisy info unless `BAKIN_CONSOLE_FORMAT=verbose` or `BAKIN_LOG_LEVEL=debug` is
set.

## Benchmark Contract

Add `scripts/bench/plugin-startup.ts` with JSON output:

```json
{
  "runs": 5,
  "summary": {
    "serverPluginReadyMs": { "median": 2900, "p95": 3600 },
    "httpReadyMs": { "median": 3400, "p95": 4200 }
  },
  "slowestSpans": [
    { "span": "plugin.activate", "pluginId": "schedule", "medianMs": 1020 }
  ]
}
```

Initial budget proposal:

- Median server plugin ready under 3.5s on this development machine.
- P95 server plugin ready under 5.0s.
- No single plugin activation span over 500ms unless explicitly documented.
- Browser plugin-host boot under 1.0s for existing local plugin set after
  assets are cached.

Budgets should start as warning-only. Hard failures can come later after a few
baseline runs prove stability.

## Opt-In Metrics Direction

This is separate from local diagnostics and should ship later than the local
timing work.

Recommended model:

- Default: disabled.
- User opt-in: explicit setting and CLI/UI consent.
- Payloads: aggregate counters and coarse performance histograms only.
- Transport: HTTPS to a Bakin-owned endpoint, with upload retry/backoff and a
  local "last payload preview" for inspectability.
- Identity: random installation id generated locally; no usernames, hostnames,
  paths, agent ids, task ids, prompts, messages, file names, plugin settings, or
  raw error text.
- Plugin identity: core plugin ids can be reported. User plugin ids should be
  reported only as hashed ids by default, with an optional explicit "share
  installed plugin names" opt-in if we really need it.
- Metrics examples:
  - Bakin version
  - platform/arch
  - enabled core plugin ids
  - count of user plugins
  - startup timing histograms
  - route/tool latency histograms by route class or tool namespace
  - error counts by sanitized error code
  - feature usage counters

Never include:

- task titles/descriptions
- prompts or model responses
- agent names or personas
- file paths or file contents
- plugin settings
- secrets/tokens
- raw stack traces
- raw plugin errors
- IP addresses beyond what the receiving server inherently sees

The existing `src/core/usage.ts` should remain the local health source of
truth. Remote metrics should consume sanitized aggregate snapshots from that
source or a sibling metrics aggregator, not introduce another hidden tracking
path.

## Boundaries

Always:

- Measure before optimizing.
- Preserve existing plugin activation semantics unless the work is explicitly
  non-critical and safe to move after readiness.
- Keep diagnostics local by default.
- Keep remote metrics disabled by default.
- Redact aggressively before any metrics leave the machine.
- Update `.claude/knowledge` when contracts change.

Ask first:

- Enabling any remote metrics endpoint.
- Adding a dependency for metrics transport, tracing, or benchmarking.
- Moving schedule reconciliation/backfill behavior out of startup if it can
  change missed-run semantics.
- Adding hard CI performance gates instead of warning-only benchmark output.

Never:

- Send telemetry without explicit opt-in.
- Log or transmit user content, prompts, secrets, or full local paths.
- Use raw plugin exceptions as remote metric fields.
- Silence startup work instead of measuring it.
- Treat browser "Loading plugins" as proof that server plugin activation is the
  bottleneck without timing both sides.

## Implementation Plan

### Phase 1: Local Startup Timing Foundation

Add a small startup span helper and wire it into the server/plugin registry.

Acceptance criteria:

- Logs include structured duration events for plugin registry initialization,
  each plugin total, and `onAllReady`.
- Slow spans over the default threshold emit a warning with plugin id and span.
- Tests cover success, failure, and skipped span outcomes.

Verification:

```sh
bun test --isolate tests/core/plugin-startup-diagnostics.test.ts tests/core/plugin-registry.test.ts
```

Likely files:

- `src/core/startup-diagnostics.ts`
- `src/lib/plugin-registry.ts`
- `tests/core/plugin-startup-diagnostics.test.ts`
- `tests/core/plugin-registry.test.ts`

Commit checkpoint:

- Commit 1: `feat(core): add local startup span diagnostics`
- Rollback boundary: pure observability helper plus registry logs.

### Phase 2: User Plugin Build and Manifest Route Diagnostics

Time pre-registry user plugin rebuilds and browser manifest generation.

Acceptance criteria:

- User plugin build logs distinguish skipped, rebuilt, install failed, server
  build failed, and client build failed.
- `/api/plugins/manifest` debug logs show total duration, plugin count, and
  slow asset version lookups.
- Tests prove lockfile and asset lookup failures do not break diagnostics.

Verification:

```sh
bun test --isolate tests/api/plugin-manifest.test.ts tests/core/plugin-registry.test.ts
```

Likely files:

- `packages/host/src/plugin-host/user-plugin-builder.ts`
- `packages/host/src/api/plugins/manifest.ts`
- `tests/api/plugin-manifest.test.ts`

Commit checkpoint:

- Commit 2: `feat(plugins): diagnose user plugin build and manifest timing`
- Rollback boundary: server/browser manifest observability only.

### Phase 3: Browser PluginHost Diagnostics

Time the browser side of "Loading plugins".

Acceptance criteria:

- In dev/verbose mode, browser console shows manifest fetch duration, each
  client import duration, failure status, and total plugin-host boot duration.
- A failed plugin client import still lets the host become ready.
- Tests cover manifest failure, import failure, and success timing.

Verification:

```sh
bun test --isolate tests/components/plugin-host.test.tsx
```

Likely files:

- `packages/host/src/plugin-host/PluginHost.tsx`
- `tests/components/plugin-host.test.tsx`

Commit checkpoint:

- Commit 3: `feat(host): add browser plugin boot diagnostics`
- Rollback boundary: client-only diagnostics.

### Phase 4: Schedule Critical-Path Fix

Use the new timings to reduce or bound the repeated schedule startup cost.

Recommended approach:

- Keep route/tool registration in `activate()`.
- Move runtime cron sync/search indexing and legacy cron repair into
  post-ready/background work when safe.
- If missed-run semantics require startup sync before readiness, keep it
  blocking but add explicit timeout/budget logging and health follow-up on
  failure.
- Consider moving expensive schedule `onReady()` summary reads after
  `server.listen` or making `onAllReady` best-effort/non-blocking for plugins
  that do not need to gate HTTP readiness.

Acceptance criteria:

- Schedule activation no longer consistently consumes about one second unless a
  timed runtime call proves the runtime adapter is the dependency.
- Any moved work has failure logging and health-check visibility.
- Schedule behavior remains correct for listing jobs, bridge calls, and missed
  run backfill.

Verification:

```sh
bun test --isolate tests/plugins/schedule/routes.test.ts tests/plugins/schedule/health-checks.test.ts
bun run scripts/bench/plugin-startup.ts --home /tmp/bakin-plugin-startup-bench --runs 5
```

Likely files:

- `plugins/schedule/index.ts`
- `tests/plugins/schedule/routes.test.ts`
- `tests/plugins/schedule/health-checks.test.ts`

Commit checkpoint:

- Commit 4: `perf(schedule): remove noncritical cron work from plugin boot`
- Rollback boundary: schedule-only startup behavior.

### Phase 5: Benchmark Script and Docs

Add repeatable benchmark tooling and document how to use diagnostics.

Acceptance criteria:

- Benchmark script runs against a temp Bakin home and emits JSON.
- Script can parse startup timing logs from a controlled server process.
- Docs explain how to enable verbose diagnostics and interpret slow spans.

Verification:

```sh
bun run scripts/bench/plugin-startup.ts --home /tmp/bakin-plugin-startup-bench --runs 3
bun run typecheck
```

Likely files:

- `scripts/bench/plugin-startup.ts`
- `.claude/knowledge/plugin-system.md`
- `.claude/knowledge/usage-recording.md`
- `README.md` or relevant docs page if user-facing

Commit checkpoint:

- Commit 5: `chore(perf): add plugin startup benchmark`
- Rollback boundary: benchmark/docs only.

### Phase 6: Opt-In Metrics Product Spec

Do not implement remote metrics in the same pass. Write a separate spec after
the local data model is stable.

Acceptance criteria:

- Explicit opt-in UX and settings contract.
- Sanitized payload schema reviewed before code.
- Local preview endpoint or CLI command shows exactly what would be uploaded.
- Tests prove forbidden fields are dropped.

Verification:

```sh
bun test --isolate tests/core/metrics-sanitizer.test.ts
```

Commit checkpoint:

- Commit 6: separate branch/spec before implementation.
- Rollback boundary: no remote metrics code in the diagnostics branch.

## Open Questions

1. Should the first implementation move schedule runtime sync out of blocking
   startup immediately, or should it only add diagnostics first and wait for one
   benchmark run before changing behavior?

Recommended answer: add diagnostics first, then move schedule work only if the
new timings confirm it is still the dominant bottleneck. The local logs strongly
suggest schedule is involved, but the Antfly/runtime logs are interleaved enough
that measuring exact spans first is the cleaner move.

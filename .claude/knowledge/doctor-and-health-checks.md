# Doctor & Health Checks

## What this is

The "doctor" sweep — Bakin's periodic health audit — used to be a 1762-line monolith in `src/core/doctor.ts` with 18 builtin checks for everything from agent rosters to runtime skill sync. After #139, every check is **plugin-registered** via `ctx.registerHealthCheck`. `src/core/doctor.ts` is now ~170 lines: cron + cache + audit + notify, plus the `runPluginHealthChecks()` orchestrator.

The single canonical result type is `HealthCheckResult`, exported from `@bakin/core/plugin-types` (re-exported via `@bakin/sdk` for plugin authors).

Runtime/search provider health belongs to adapters. `src/core/app-services.ts`
collects adapter health checks through the shared health service, while
plugin-registered doctor checks remain the product-level checks surfaced by the
health plugin. A health check may call `ctx.runtime` or `ctx.search`, but it
must not import provider clients or provider path helpers directly.

## Architecture at a glance

```
server.ts boots
  ↓ doctor.start(contentDir, projectRoot)
src/core/doctor.ts
  ├─ start() / stop()           cron lifecycle (configurable interval)
  ├─ runDiagnostics()           gate + delegate + summarize + audit + notify + cache
  ├─ runPluginHealthChecks()    iterates registry, per-check try/catch isolation
  ├─ getLastResults()           cached lightweight reads (health page polls this)
  └─ notifyUnfixableIssues()    escalates warn/error+!autoFixable to main agent

src/core/health-check-registry.ts
  ├─ registerHealthCheck(def)   appends; throws on duplicate id
  ├─ listHealthChecks()         the orchestrator's source of truth
  └─ unregisterPluginHealthChecks(pluginId)   plugin teardown sweep
```

The orchestrator is intentionally trivial — it has no opinion about what's being checked, only that each registered check `run()` produces zero or more `HealthCheckResult` rows. A throwing handler becomes one synthetic error row, never crashing the sweep.

## Where every check lives now

### Plugin-owned (8 checks)

| Plugin | File | Registered ids |
|---|---|---|
| `team` | `plugins/team/lib/health-checks.ts` | `agent-roster`, `personas`, `agent-sync` |
| `tasks` | `plugins/tasks/lib/health-checks.ts` | `taskboard`, `task-consistency`, `order-integrity` |
| `assets` | `plugins/assets/lib/health-checks.ts` | `assets` |
| `schedule` | `plugins/schedule/lib/health-checks.ts` | `schedule-sync` |
| `memory` | `plugins/memory/lib/health-checks.ts` | `search-tables` |

(Plus 3 workflow checks already migrated under #137: `definitions`, `stale-instances`, `skills`.)

### System-owned (13 checks, registered by health plugin)

| File | Registered id |
|---|---|
| `plugins/health/lib/system-checks/content-dir.ts` | `content-dir` |
| `plugins/health/lib/system-checks/service.ts` | `service` |
| `plugins/health/lib/system-checks/mcporter.ts` | `mcporter` |
| `plugins/health/lib/system-checks/runtime.ts` | `runtime` |
| `plugins/health/lib/system-checks/session-store.ts` | `session-store` |
| `plugins/health/lib/system-checks/channel-aliases.ts` | `channel-aliases` |
| `plugins/health/lib/system-checks/restart-recovery.ts` | `restart-recovery` |
| `plugins/health/lib/system-checks/channel-approvals.ts` | `channel-approvals` |
| `plugins/health/lib/system-checks/search.ts` | `search` |
| `plugins/health/lib/system-checks/sync-skill.ts` | `skill` |
| `plugins/health/lib/system-checks/plugin-assets.ts` | `plugin-assets` |
| `plugins/health/index.ts` | `plugin-registry` |

Health plugin is the natural home for system-level checks because it already orchestrates the doctor UI (`/api/plugins/health/doctor` route + `bakin_exec_health_doctor` MCP tool) and imports `runDiagnostics` / `getLastResults`. The inversion is complete: health plugin both produces and consumes the doctor results.

The registry and managed-block mechanics are core-owned. The health plugin
registers/runs the checks, but CLI and plugin-host teardown import those shared
surfaces from `src/core/*`, not from `plugins/health/*`.

### Namespacing

The registry namespaces ids: a plugin with `id: 'team'` registering a check with `id: 'agent-roster'` produces a check named `team.agent-roster` in the registry / synthetic-error fallback. **Result rows themselves keep unprefixed ids** (`r.check === 'agent-roster'`) — the implementation emits whatever it likes.

## Authoring a new health check

1. Create `plugins/{your-plugin}/lib/health-checks.ts`. Inline the result constructors:
   ```ts
   import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'

   function ok(check: string, message: string): HealthCheckResult { ... }
   function warn(check: string, message: string, autoFixable = false): HealthCheckResult { ... }
   function error(check: string, message: string): HealthCheckResult { ... }
   function fixed(check: string, message: string): HealthCheckResult { ... }
   ```
2. Write the check function. Keep it report-only:
   ```ts
   export function checkMyThing(): HealthCheckResult[] {
     // ...
   }
   ```
3. Register in your plugin's `activate()`:
   ```ts
   ctx.registerHealthCheck({
     id: 'my-thing',
     name: 'Friendly description shown in admin UIs',
     run: () => Promise.resolve(checkMyThing()),
     repair: myThingRepair(), // optional; only called by explicit repair flows
   })
   ```
4. If the check is repairable, expose a `HealthRepairHandler` with `plan()` and `apply()`. Diagnostics must not mutate state; `bakin doctor --fix` and delegated repair flows are the only callers that apply repairs.
5. Don't catch your own errors — the orchestrator's try/catch handles them. Throw freely.

## Authoring a system check (in the health plugin)

Same pattern, lives at `plugins/health/lib/system-checks/{your-check}.ts`. Register inside `plugins/health/index.ts`'s `activate()`. Keep system checks thin — most are 25-110 lines.

## Managed-block infrastructure

The old `src/core/agent-rules/` managed-context system (orchestrator rules +
7 subagent sections injected by doctor) was deleted by the layered-context
work. Its successor: Bakin-shipped default rules live in the ROLE CONTEXT
FILES (`~/.bakin/team/context/roles/{orchestrator,subagent}.md`, defaults in
`src/core/team-context-defaults.ts`), composed into each agent's single
`bakin:managed` AGENTS.md block alongside global/team context and the package
template. The `team.agent-sync` check covers staleness end-to-end (with
per-layer attribution) and its repair handler runs a local sync; the old
`orchestrator-rules` / `managed-blocks` / `agent-assets` checks and the
`bakin agent-rules` CLI are gone.

The marker primitives (`extractBlock`, `getBlockState`, `injectBlock`,
`removeBlock`) live in `packages/core/src/agent-packages/managed-blocks.ts`
and are shared with the projector/composer. Don't reimplement them.
Malformed marker pairs are never repaired silently — the scanner reports
`block-broken` and refuses auto-fix until the pair is fixed by hand.

Deep reference: `.claude/knowledge/layered-context.md`.

## Settings

Doctor settings stay in core `~/.bakin/settings.json` under `settings.doctor.*`:
- `intervalMs` — cron period (default 30 minutes)
- `requireOnboard` — gate that returns a single `onboarded` error result when the machine isn't onboarded yet

These remain core settings (not per-plugin) because the doctor cron itself is core-owned and `requireOnboard` is a global gate.

## Audit & notify

- Every doctor sweep appends `doctor.run` to `~/.bakin/audit.jsonl` with `{total, errors, warnings, fixes}`.
- Unfixable issues (warn/error with `autoFixable: false`) get escalated to the main agent via `openclaw.sendMessage`. Dedup is key-based per cycle (`{check}:{status}` joined+sorted).
- The cron clears the dedup set every cycle so recurring issues re-notify across cycles, but not within a single cycle.

## Type contracts

Both exported from `@bakin/core/plugin-types` (and re-exported from `@bakin/sdk`):

```ts
export interface HealthCheckResult {
  check: string
  status: 'ok' | 'warn' | 'error' | 'fixed'
  message: string
  autoFixable: boolean
}

export interface PluginHealthCheckInput {
  id: string
  name: string
  run: () => Promise<HealthCheckResult[]>
  repair?: HealthRepairHandler
  autoFix?: boolean   // legacy metadata only; don't use for new checks
}
```

The orchestrator (`runPluginHealthChecks` in `src/core/doctor.ts`) wraps each `def.run()` call in try/catch. A throwing handler becomes:
```ts
{ check: def.id /* namespaced */, status: 'error', message: `Plugin health check threw: ${err.message}`, autoFixable: false }
```

## Test layout

- **Behavioral tests live with the plugin**: `tests/plugins/{owner}/health-checks.test.ts`. Pattern matches `tests/plugins/workflows/health-checks.test.ts`.
- **Orchestration tests live in core**: `tests/core/doctor.test.ts` covers the gate, the audit append, and the cache. `tests/core/doctor-plugin-checks.test.ts` covers the per-check try/catch isolation.
- **Test isolation is mandatory** (CLAUDE.md rule): every test that touches storage mocks both content-dir shims, runtime/home adapters as needed, and the logger. Verbatim copy the current plugin health-check scaffolds instead of adding new direct runtime-client mocks.

## Migration history

- **#137 (PR #138)**: First 3 checks moved out — workflow definitions, stale instances, skills. Established the registry + ctx.registerHealthCheck precedent.
- **#139**: Migrated the remaining 15 checks across 9 commits, collapsed `DiagnosticResult` → `HealthCheckResult` (one canonical type), relocated managed-block infrastructure out of the doctor monolith, swung CLI imports.
- **#174**: Moved health-check registry and managed-block infrastructure into `src/core/*`; health plugin now contributes checks without owning core doctor/CLI primitives.
- **#172**: Unified `bakin agent-rules` and health orchestrator-rules checks with the core managed-block engine.
- **#208**: Changed AGENTS.md projection from one physical marker pair per logical rule to one compact `managed-context` marker pair per agent, while keeping logical diagnostics and legacy-marker conversion.

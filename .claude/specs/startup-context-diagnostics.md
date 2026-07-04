# Startup Context Diagnostics & Overhead Reduction (Issue #357)

Make session-startup context deliberate, inspectable, and proportional — a
per-source diagnostic surface plus targeted reductions of the avoidable
overhead, without removing useful context.

Issue: https://github.com/markhayden/bakin/issues/357
Status: spec approved → planning
Prior art: #401 (layered context) already scoped agent rules by layer and
made managed-block bytes measurable in sync receipts.

## Objective

1. **Document** the full session-startup context pipeline (both halves: the
   dispatch prompt Bakin builds, and the workspace files OpenClaw loads).
2. **Measure** it: a safe diagnostic reporting per-source names + byte /
   approximate-token contribution — never raw content.
3. **Reduce** the top avoidable sources with settings-backed caps and
   boilerplate dedupe.
4. **Guard** it: a warn-only doctor check plus regression tests so overhead
   can't silently creep back.

## Decisions (interview record, 2026-07-03)

| # | Decision | Choice |
|---|---|---|
| 1 | Adapter-boundary scope | Measure BOTH zones (Bakin-owned + runtime-owned, read-only); change only Bakin-owned sources |
| 2 | Diagnostic surfaces | CLI + REST + doctor check (no dashboard UI view) |
| 3 | Measurement | Exact bytes + ~chars/4 token estimate (labeled approximate) + observed first-turn `tokensIn` from the cost ledger for grounding |
| 4 | Guardrail semantics | ONE total byte budget for Bakin-injected per-dispatch context; warn-only, never blocks dispatch |
| 5 | Session scope | Task-dispatch sessions only (fresh `task:<id>:d<seq>` sessions re-pay full context; default-session notification sends are documented, not modeled) |
| 6 | Reduction levers | (a) cap workflow prior-step dump, (b) trim static per-dispatch boilerplate, (c) propagate cache stats to usage feed. Task descriptions are measured, flagged when huge, but NEVER truncated |
| 7 | Placement | Measurement engine in core; doctor check registered by health plugin (system-level); CLI under `bakin agents context` |
| 8 | Workflow dump cap | Byte cap, default 16KB, most-recent-steps-first retention, whole outputs only (no mid-JSON truncation), visible omission marker pointing at `bakin_exec_workflows_get_instance` |
| 9 | Doctor budget default | 64KB (user choice; flags egregious cases only), configurable |

## Current state (explored 2026-07-03)

Two independent streams reach a fresh agent session:

**A. Dispatch prompt** — `buildDispatchMessage` (`src/core/dispatch-prompts.ts:131-210`):
corrective prefix (conditional) · task title + FULL description (unbounded) ·
continuation block · asset block · project block · lesson block (capped —
`agentPackages.lessonsRetrieval.maxCharacters`, default 8000, the ONLY capped
component) · PROGRESS LOGGING (static) · OUTPUT DISCIPLINE (static) ·
TASK COMMANDS mcporter block (static templated) · `sharedExecutionToolDocs`
(static). Workflow variant `buildWorkflowDispatchMessage`
(`src/core/dispatch-workflow.ts:164-353`) additionally injects a JSON dump of
ALL prior step outputs — **unbounded**, the largest uncapped contributor.

**B. Workspace bootstrap** — OpenClaw loads `CANONICAL_DURABLE_FILES`
(`packages/adapter-openclaw/src/memory.ts:46-57`: MEMORY/DREAMS/SOUL/
MEMORY-LOG/USER/IDENTITY/AGENTS/TOOLS/BOOTSTRAP/HEARTBEAT) + `skills/*/SKILL.md`
+ `memory/*.md`. Bakin authors only the managed blocks in four of these
(composer: `packages/core/src/agent-packages/composer.ts`). Sync receipts
record managed-block bytes (`src/core/agent-packages/receipts.ts`) but nothing
renders them, and full-file / non-composed-file sizes are unmeasured.

**Existing accounting:** `meterAgentTurn` (`src/core/agent-cost.ts`) records
real `inputTokens`/`outputTokens` per run; `cacheRead`/`cacheWrite` are
captured for pricing but **dropped** before the usage feed
(`src/core/usage.ts` has no cache fields). No doctor check, no CLI/REST view,
no per-source breakdown anywhere.

## Deliverables

### D1 — Context report engine (core)
`src/core/context-report.ts` — pure, side-effect-free measurement:

- **Dispatch-prompt estimate**: build (or introspect) the per-component
  sections of a representative dispatch for an agent and report
  `{ source, bytes, approxTokens }` per component. Components enumerated
  structurally from the builders — no duplicated string constants (builders
  are refactored to expose labeled sections; assembly behavior unchanged).
- **Workspace stats**: per-file `{ name, bytes, managedBlockBytes? }` for the
  agent's canonical files, skills, and memory notes, via a new read-only
  runtime-adapter capability (names + sizes only; NO content leaves the
  adapter). Managed-block bytes reuse receipt data where available.
- **Observed grounding**: recent first-turn `tokensIn` per agent from the
  cost ledger (last N runs), shown alongside estimates.
- Token estimate = `ceil(chars / 4)`, always labeled approximate.

### D2 — Surfaces
- **REST**: `GET /api/context-report` (all agents, summary) and
  `GET /api/context-report/:agentId` (full per-source breakdown). Names +
  numbers only — never content.
- **CLI**: `bakin agents context [agentId]` rendering the same data
  (per-source table, totals, observed-vs-estimated).
- **Doctor**: `context.startup-size` check registered by the health plugin's
  system checks — warns when an agent's estimated Bakin-injected per-dispatch
  context exceeds `dispatch.contextBudgetBytes` (default 65536). Warn-only;
  detail lists the top sources. Re-read from settings every cycle like the
  watchdog.

### D3 — Workflow prior-step dump cap
`settings.dispatch.maxWorkflowContextBytes` (default 16384, clamped sane
range). Retention: newest step outputs first, whole outputs only; omitted
steps produce a visible marker
(`(N earlier step outputs omitted — fetch via bakin_exec_workflows_get_instance)`).
Never silent, never mid-JSON truncation.

### D4 — Static boilerplate trim
Audit OUTPUT DISCIPLINE + TASK COMMANDS + `sharedExecutionToolDocs` against
the #401 role-layer catalog (`src/core/team-context-defaults.ts`). Anything
duplicated moves to (or already lives in) the subagent role layer; the
per-dispatch copy keeps ONLY taskId-templated invocations + a minimal
reminder. `buildDispatchMessage` and `buildWorkflowDispatchMessage` keep
sharing the section helpers so they cannot drift.

### D5 — Cache-stat propagation
Carry `cacheRead`/`cacheWrite` from `meterAgentTurn` into `UsageEntry`
(`src/core/usage.ts`) so the diagnostic and usage feed can show how much
startup context is cache-served vs re-billed. Additive fields; single
recorder invariant preserved (no parallel stat system).

### D6 — Documentation
- NEW `.claude/knowledge/startup-context.md` — the pipeline document
  (acceptance criterion 1): both streams, per-source inventory, caps and
  their settings, diagnostic surfaces, and the default-session-vs-fresh-
  session cost model.
- Update `.claude/knowledge/dispatch.md` (prompt-construction section),
  `CLAUDE.md` (Key Patterns pointer), and touched settings docs.
  README reviewed; updated only if the CLI surface listing there changes.

## Settings summary

| Setting | Default | Purpose |
|---|---|---|
| `dispatch.maxWorkflowContextBytes` | 16384 | Cap on injected prior-step-outputs block |
| `dispatch.contextBudgetBytes` | 65536 | Doctor warn threshold for total Bakin-injected per-dispatch context |
| `agentPackages.lessonsRetrieval.maxCharacters` | 8000 (existing) | Unchanged; reported by the diagnostic |

## Testing strategy

- Unit: report engine (component enumeration, byte/token math, ledger
  grounding), workflow-cap retention/marker logic, cache-stat propagation,
  doctor check thresholds, CLI/REST shapes.
- **Boilerplate budget regression test**: pins the combined size of the
  static dispatch sections; fails if they grow past a small threshold —
  the "can't silently creep back" guardrail.
- Workflow dispatch prompt test: over-cap instance → newest outputs whole,
  marker present, under-cap unchanged.
- All tests follow the mandatory content-dir/OpenClaw-home mocking rules.

## Boundaries

- **Always**: measure runtime-owned sources read-only through the adapter
  capability; visible omission markers for anything dropped; warn-only
  guardrails.
- **Ask first**: any change to what the *runtime* loads; any truncation of
  user-authored content.
- **Never**: truncate task descriptions; write runtime-owned content; expose
  raw prompt/file content through diagnostics; block dispatch on budget;
  add a parallel stats system; add a tokenizer dependency.

## Non-goals

Dashboard UI view · per-source budgets · hard dispatch gating · workflow
step input-declaration semantics · tokenizer-precise counts · changes to
OpenClaw's own bootstrap behavior.

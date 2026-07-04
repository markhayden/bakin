# Plan: Startup Context Diagnostics & Overhead Reduction (Issue #357)

Spec: `.claude/specs/startup-context-diagnostics.md` (approved). Validated by
design review 2026-07-03; all corrections folded in.

## Context

Every task dispatch opens a fresh provider session and re-pays the full
context loadout. #401 layered the agent rules and made managed-block bytes
measurable in sync receipts — but the rest of the pipeline is unmeasured,
receipt bytes are never rendered, the workflow prompt builder dumps ALL prior
step outputs unbounded, and cache-token counts are dropped before every
observability surface. This plan makes startup context deliberate,
inspectable, and guarded per the approved spec: measure both ownership zones,
change only Bakin-owned sources; CLI + REST + warn-only doctor check;
bytes + chars/4 estimates grounded by observed ledger tokens; descriptions
never truncated.

## Key design points (validated)

- **Byte-identity by construction (S1):** builders become
  `buildDispatchSections(...): Array<{source, text}>` where each section's
  text carries its exact separator prefix; `buildDispatchMessage` is literally
  `sections.map(s => s.text).join('')` (same for the workflow builder with
  line-group joins). Measurement path == production path; snapshots are
  secondary pins. Callers: `src/core/dispatch-prepare.ts:98`,
  `src/core/dispatch-workflow.ts:107`, re-export in `src/core/dispatch.ts:19`.
  All three `buildDispatchMessage` branches (triage/main/specialist) get
  sections; specialist is the representative for measurement. Export
  `buildWorkflowDispatchMessage` as `@internal` and replace the source-slicing
  test at `tests/core/dispatch-prompts.test.ts:85-91` with real assertions.
- **Cache stats are durable (user decision):** ledger migration **v4** adds
  `cache_read_tokens`/`cache_write_tokens` to `run_costs`; `RunCostInput` +
  `meterAgentTurn` thread them through; `UsageEntry` gains additive
  `tokensCacheRead`/`tokensCacheWrite`.
- **Workflow cap (S6):** extract `buildWorkflowContextSection(stepOutputs,
  priorStepOutput, maxBytes)`. Retention iterates entries in REVERSE
  definition order (newest-first; `__parentContext` is appended LAST by
  `plugins/workflows/lib/step-context.ts:189-200` — exclude it from the walk,
  always keep its title/description lines, budget only its `rest` JSON).
  Sizes measured against the RENDERED section (pretty JSON + fences +
  headers), not raw objects. Whole outputs only; omission marker names
  dropped step ids + points at `bakin_exec_workflows_get_instance`. The dead
  `priorStepOutput` branch routes through the same capped builder. Clamp:
  min 1024; 0/absent → default 16384. Under-cap output byte-identical to
  today (ordering preserved).
- **`previousOutput` (rejected-output revision block) is NOT capped** — out
  of spec scope, but the report engine measures it and
  `startup-context.md` documents it as a known uncapped source.
- **Adapter capability (S3):**
  `agents.workspaceFileStats?(agentId): Promise<Array<{name, bytes, mtimeMs,
  kind: 'canonical'|'skill'|'memory'}> | null>` — optional-method pattern
  mirroring `sessions.storeStats?` (concepts.ts:583; OpenClaw impl template
  runtime.ts:742-780). `kind` keeps `CANONICAL_DURABLE_FILES` knowledge inside
  the adapter. Names + sizes only — no content crosses the boundary. Absent
  method = "unavailable, skip, never error". No Imitation Crab change
  (adapter reads local FS).
- **Ledger verb (S4):** `recentRunsByAgent(agent, {sinceMs, limit})` in
  `packages/core/src/execution/ledger.ts` (`guard(...)`-wrapped, uses
  `run_costs_by_agent_time` index), **filtered to `run_id LIKE 'task:%'`** so
  watchdog/doctor/image sends don't pollute grounding; re-exported via the
  `src/core/execution-ledger.ts` facade. Report labels the number
  **"observed turn input"** (it includes the agentic loop, not just the
  injected prompt — honest labeling, validated risk #2).
- **Engine (S4)** `src/core/context-report.ts`, pure/read-only:
  `estimateAgentDispatchContext()` (sync section math; inputs: real agent
  name, contentDir, mainAgentId via `getRuntimeMainAgentId`, realistic
  synthetic taskId; roster only for triage variant — skipped),
  conditional components (project/continuation blocks) reported with
  representative sizes, lessons/assets/workflow-dump reported as configured
  caps; `workspaceStats()` via S3 + receipt `managedBlockBytes` join
  (`readReceipt`); `observedTokens()` via S4 verb. `Math.ceil(chars/4)`
  labeled approximate. Doctor/CLI/REST all call this one engine (anti-drift,
  same pattern as budget.ts reusing evaluateBudget).
- **Doctor check (S8):** `context.startup-size` in
  `plugins/health/lib/system-checks/context-report.ts` (template:
  `execution-safety.ts`), registered in `plugins/health/index.ts` activate().
  Iterates `ctx.runtime.agents.list()`; estimate = static sections +
  configured caps ONLY (no task/ledger/receipt reads in the cycle);
  `getSettings()` inside `run()` (watchdog-style re-read); warn-only vs
  `dispatch.contextBudgetBytes` (default 65536), message lists top sources.
  Docs must disambiguate from the existing `bakin diagnostics startup`
  (server boot timing — different concept).
- **Settings:** `dispatch.maxWorkflowContextBytes` (16384) +
  `dispatch.contextBudgetBytes` (65536) in `packages/core/src/settings.ts`
  interface + DEFAULT_SETTINGS (deepMerge auto-backfills) + two number fields
  in `SYSTEM_SETTINGS_SCHEMA` (`src/components/system-settings.ts`).
- **REST:** `GET /api/context-report[/:agentId]` — handler file modeled on
  `packages/host/src/api/agent-packages/dynamic.ts`, wired into the if-ladder
  in `src/core/server/request-handler.ts` (specific-before-catch-all
  ordering). No embedded-assets regen. **CLI:** `bakin agents context [id]`
  in `cli/bakin.ts` case 'agents' (:3936), `apiGet`, Ink report component in
  `src/core/cli/ui/reports/` via `readonly.ts` barrel, isTTY/`--json` triad.
- **Boilerplate trim (S7)** is SMALL (validated: the big trim already
  happened; `tests/core/dispatch-prompts.test.ts:70-82` pins it). Delta:
  comment lines + duplicate tool entries in TASK COMMANDS
  (dispatch-prompts.ts:184-207) and `sharedExecutionToolDocs` (:30-51), plus
  the workflow builder's verbose PROGRESS LOGGING bullets
  (dispatch-workflow.ts:310-319) duplicating role-layer prose
  (`team-context-defaults.ts:152-212`). Hundreds of bytes per dispatch, not
  KB. Note in commit: unmanaged agents lack the role-layer catalog —
  accepted tradeoff, precedent in dispatch-prompts.ts:54-61.
- **Architecture constraints:** engine uses AppServices runtime interface
  (never `@bakin/adapter-openclaw` import); sqlite only via db.ts handle;
  no error-message-text branching.

## Slices & commit strategy (one rollback checkpoint per slice)

Order per validation: refactor first, observability before behavior change,
budget test pins post-trim sizes last. Conventional commits; each slice
independently landable + revertable; full test suite green at every
checkpoint.

| # | Commit(s) | Content |
|---|---|---|
| S1 | `refactor(dispatch): assemble prompts from labeled sections` | Section refactor both builders, byte-identical; new section tests replace source-slicing hack |
| S2 | `feat(core): persist cache token stats through ledger and usage feed` | Ledger migration v4 + RunCostInput + meterAgentTurn + UsageEntry fields |
| S3 | `feat(core,adapter-openclaw): read-only workspaceFileStats capability` | Interface method + OpenClaw impl (getWorkspacePath/statSync/isSafeWorkspaceFile) |
| S4 | `feat(ledger): recentRunsByAgent domain verb` then `feat(core): context-report engine` | Verb + facade re-export; engine consuming S1 sections, S3 stats, receipts, verb |
| S5 | `feat(api,cli): context-report endpoint + bakin agents context` | REST handler + request-handler wiring + Ink report + CLI branch |
| S6 | `feat(dispatch): cap workflow prior-step context` | buildWorkflowContextSection + maxWorkflowContextBytes + clamp + marker |
| S7 | `refactor(dispatch): trim residual per-dispatch boilerplate` | The small validated delta; before/after sizes from S5's own diagnostic in commit body |
| S8 | `feat(health): context.startup-size doctor check` | Check + registration + contextBudgetBytes + settings UI fields |
| S9 | `test(core): pin static dispatch boilerplate budget` then `docs(knowledge): startup context pipeline` | Regression pin (post-S7 sizes + tolerance); new `.claude/knowledge/startup-context.md`, dispatch.md + CLAUDE.md updates, README check |

Also first action of build phase: copy this plan to
`.claude/specs/startup-context-diagnostics-plan.md` (repo convention:
companion plan next to spec).

## Testing strategy

- **Extend:** `tests/core/dispatch-prompts.test.ts` (S1 sections, S7
  sentinels, S9 budget pin), `tests/core/dispatch-assets.test.ts` (free S1
  regression pin — must pass untouched), `tests/core/usage.test.ts` +
  `agent-cost.test.ts` + `agent-usage.test.ts` (S2), 
  `tests/core/execution-ledger.test.ts` (S2 migration + S4 verb; `closeDb()`
  before rmSync), `tests/plugins/health/system-checks.test.ts` +
  `checks-route.test.ts` (S8 — watch pinned check rosters).
- **Create:** `tests/core/dispatch-workflow-context.test.ts` (S6: under-cap
  byte-identical, over-cap newest-first retention, parent-context lines kept,
  marker, clamp), `tests/core/context-report.test.ts` (S4: component
  enumeration, chars/4 math, caps reporting, absent-capability + empty-ledger
  degradation), health check test beside `execution-safety.test.ts` (S8),
  REST shape test (S5).
- All tests follow CLAUDE.md mandatory rules: dual content-dir mocks,
  OpenClaw-home mock, logger/watcher mocks, `getBakinPaths` incl. `db`,
  cleanup, `--isolate`.

## Verification (end-to-end)

1. `bun run test` green at every slice checkpoint.
2. After S5: run the server (`bun run dev:mock`), `bakin agents context
   <agent>` shows per-source table + totals + observed turn input;
   `curl /api/context-report/<agent>` returns names+numbers only (assert no
   content fields).
3. After S6: dispatch a mock workflow with oversized step outputs → prompt
   contains newest outputs whole + omission marker; under-cap workflow
   prompt byte-identical to pre-S6 fixture.
4. After S7: `bakin agents context` shows reduced static-section bytes
   (numbers recorded in commit body).
5. After S8: `bakin doctor` (or check run) shows `context.startup-size` ok;
   lower `dispatch.contextBudgetBytes` in settings → warn with top sources.
6. Docs: `.claude/knowledge/startup-context.md` cross-checked against final
   code; CLAUDE.md Key Patterns pointer added; README checked (CLI surface
   mention only if needed).

## Out of scope (documented, not built)

`previousOutput` revision-block cap · dashboard UI view · per-source budgets
· hard dispatch gating · tokenizer counts · runtime-owned content changes.

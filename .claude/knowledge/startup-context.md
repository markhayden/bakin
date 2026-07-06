# Startup Context — Deep Reference

What a FRESH agent session pays for in context, how to measure it, and what
bounds it. Issue #357; spec `.claude/specs/startup-context-diagnostics.md`
(+ companion plan). NOT to be confused with `bakin diagnostics startup` /
`src/core/startup-diagnostics.ts`, which measure SERVER BOOT timing — this
document is about what an agent SESSION costs at start.

## The cost model in one paragraph

Every task dispatch opens a fresh provider session
(`threadId = task:<id>:d<seq>` — deliberate, see
`.claude/knowledge/dispatch.md` § Per-dispatch sessions), so the full startup
loadout is re-paid on every dispatch: the runtime re-reads the agent's
workspace bootstrap files AND Bakin sends a freshly built dispatch prompt.
Notification sends (watchdog nudges, doctor alerts, orchestrator pings) ride
the agent's long-lived default session instead — they add incremental turns,
not startup reloads, and are visible in `run_costs` under `turn:<uuid>` ids.
Whether re-sent static context is actually re-billed depends on provider
caching — which is why cache read/write tokens are recorded end-to-end
(ledger migration v4, `UsageEntry.tokensCacheRead/Write`).

## The two context streams

**A. Bakin-owned: the dispatch prompt.** Built from labeled sections
(`Array<{source, text}>`) by `buildDispatchSections`
(`src/core/dispatch-prompts.ts`) and `buildWorkflowDispatchSections`
(`src/core/dispatch-workflow.ts`); the message IS the joined sections, so the
diagnostics measure exactly what production sends. Static sections
(post-#357-trim baselines): task dispatch ~2.3KB, workflow dispatch ~3.3KB —
pinned by the boilerplate budget test AND byte-exact fixtures
(`tests/fixtures/dispatch-prompts/`, regenerate deliberately with
`bun tests/fixtures/dispatch-prompts/generate.ts`; the fixture diff is the
review record of any prompt change). Dynamic blocks and their bounds:

| Block | Bound | Owner |
|---|---|---|
| task title + description | UNBOUNDED by design — user-authored work spec, measured/flagged, never truncated | task author |
| lessons | `agentPackages.lessonsRetrieval.maxCharacters` (default 8000; 0 when injection disabled) | settings |
| workflow prior-step outputs | `dispatch.maxWorkflowContextBytes` (default 16384, min 1024) — newest outputs kept whole, most recent ALWAYS kept, `__parentContext` title/description always survive, omissions are visible markers pointing at `bakin_exec_workflows_get_instance` | settings |
| assets block | one line per linked asset (naturally small) | task links |
| corrective / continuation / project blocks | conditional, representative sizes only | dispatch state |
| workflow `previousOutput` (rejected-output revision block) | **KNOWN UNCAPPED** — a huge rejected output re-dispatches with the same huge payload; out of #357 scope, capture in a follow-up if it bites | — |

The static half of the tool catalog lives in the role-layer "Bakin Execution
Tools" section (`src/core/team-context-defaults.ts`) composed into AGENTS.md
managed blocks — per-dispatch copies are taskId-templated invocations + short
reminders only. Unmanaged agents lack the role layer and rely on the inline
reminders (accepted tradeoff, `dispatch-prompts.ts` § outputDisciplineSection).

**B. Runtime-owned: workspace bootstrap.** OpenClaw loads the canonical
durable files (`packages/adapter-openclaw/src/memory.ts` —
MEMORY/DREAMS/SOUL/MEMORY-LOG/USER/IDENTITY/AGENTS/TOOLS/BOOTSTRAP/HEARTBEAT)
plus `skills/*/SKILL.md` and `memory/*.md` at session start. Bakin authors
ONLY the managed blocks in four of them (layered context — see
`.claude/knowledge/layered-context.md`); everything else is agent territory.
Per the adapter boundary these are MEASURED read-only (never tuned by Bakin)
via the optional `agents.workspaceFileStats?(agentId)` capability — names +
bytes + kind, content never crosses the adapter.

## Measuring: one engine, three surfaces

`src/core/context-report.ts` (`buildAgentContextReport`) is the single
measurement engine — CLI, REST, and doctor all consume it so the arithmetic
cannot drift (same pattern as budget.ts/evaluateBudget):

- **Static sections** — measured by running the real builders against a
  synthetic task (`id '00000000'`, empty title). Token numbers are
  `ceil(chars/4)`, ALWAYS labeled approximate.
- **Dynamic caps** — reported as configured maxima (`configuredDynamicCaps`),
  never fabricated sizes.
- **Workspace** — adapter stats joined with sync-receipt managed-block bytes
  (`readReceipt`). Absent capability → `available: false`, never an error.
- **Observed grounding** — `recentRunsByAgent` (ledger, `task:%` runs only)
  with cache read/write detail, labeled "observed turn input" because
  provider-reported input covers the whole agentic loop, not just the
  injected prompt. Estimates and observations are NOT directly comparable.

Surfaces: `GET /api/context-report[/:agentId]`
(`packages/host/src/api/context-report/index.ts`) · `bakin agents context
[id] [--json]` (Ink reports in `src/core/cli/ui/reports/context.tsx`) ·
doctor check `context.startup-size`
(`plugins/health/lib/system-checks/context-report.ts`) — warn-only vs
`dispatch.contextBudgetBytes` (default 65536), lists top sources, re-reads
settings every cycle, NEVER blocks dispatch. All surfaces ship source names
and numbers only — never prompt or file content.

## Guardrails (how this stays fixed)

1. **Boilerplate budget test** (`tests/core/dispatch-prompts.test.ts`): static
   sections must stay ≤2560B (task) / ≤3584B (workflow). Move prose to the
   role layer instead of inflating every dispatch — or raise the budget in
   the same commit that justifies it.
2. **Byte fixtures**: any prompt change shows up as a fixture diff.
3. **Doctor check**: `context.startup-size` warns on configuration-level
   creep (e.g. a lessons cap cranked to 50KB).
4. **Cap semantics tests**: `tests/core/dispatch-workflow-context.test.ts`
   pins retention order, whole-outputs-only, always-keep-newest, parent-meta
   survival, and visible markers.

## Where to look

- `src/core/dispatch-prompts.ts` / `src/core/dispatch-workflow.ts` — section builders + workflow cap
- `src/core/context-report.ts` — measurement engine
- `src/core/agent-cost.ts` → `src/core/usage.ts` + ledger `run_costs` — cache-token flow
- `.claude/knowledge/dispatch.md` — dispatch mechanics, prompt construction
- `.claude/knowledge/layered-context.md` — managed blocks / role layer
- `.claude/knowledge/usage-recording.md`, `.claude/knowledge/execution-ledger.md` — observability planes

## Web UI consumer (#385)

The context report finally has a web surface: the Team agent-detail
**Diagnostics tab** (`plugins/team/components/diagnostics-tab.tsx`) renders
`GET /api/context-report/{id}` — budget meter vs
`dispatch.contextBudgetBytes` (fetched from `/api/settings`), top static
sections, workspace files with managed-block bytes, and an observed-input
sparkline. `bakin agents doctor <id>` includes the summary numbers.
`context.startup-size` doctor rows now attach `data.agents` so the dashboard
attention chips can point at the over-budget agents without message parsing.

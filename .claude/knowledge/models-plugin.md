# Models Plugin — Deep Reference

Two layers fix the cold-start problem where `openclaw models list --all --json` takes 15–20 s and would otherwise force the UI to show fake data (issue #129).

## Layer 1: Persistent disk cache

Path: `~/.bakin/plugin-settings/models/available.json`. Owned by `plugins/models/lib/models-cache.ts`.

- Atomic tmp+rename writes
- Zod-validated reads; silent drop on corruption / schema drift
- Two-level read: in-memory hit → disk hydrate → live fetch → honest empty-with-error (**never** falls back to fabricated data)

`fetchAvailableModels` returns `{ models, stale: boolean, error? }`. The client surfaces cached data immediately and kicks off a background `POST /api/plugins/models/refresh` when `stale` is true.

`POST /api/plugins/models/runtime/restart` clears both cache layers (memory + disk).

## Layer 2: Curated catalog

Path: `plugins/models/data/known-models.ts`. Bakin-maintained lookup of ~22 popular models — frontier + OSS, LLM + image + video — with descriptions, tier, cost range, and brand-icon slugs.

Merged into each runtime-sourced `AvailableModel` server-side via `getKnownModel()` / `getKnownProvider()`. Unknown models render plain — **no fabrication**.

## Brand icons

`<BrandIcon>` inlines SVG paths from simple-icons.org (CC0) for the 5 brands we have logos for. Unknown slugs render a first-letter chip in the provider's brand color.

## Cost optimization (metering → routing → gating)

Issue #464, widened from budget gating to the full cost story. Deep spec/plan: `.claude/specs/models-cost-optimization.md` (+ `-plan.md`).

### Structured pricing

`KnownModel.pricing` (`{ inputPer1M, outputPer1M, cachedReadPer1M?, updatedAt }`) is the cost source of truth for cloud LLMs; the display string is **derived** via `formatCostRange`. `costRange` survives only as a literal for non-token models (image/video/local). `computeCostUsdMicros(usage, pricing)` returns **null** when pricing or token counts are absent — never a fabricated zero. Cached-token discounts aren't modeled, so estimates read slightly high.

### Metering

The OpenClaw adapter surfaces per-turn `usage` (from the trajectory `model.completed` event) on `MessageResult.usage`. **Every** Bakin-side agent send is metered through the shared `meterAgentTurn` (`src/core/agent-cost.ts`) — dispatch task turns (keyed by the ledger `run_id`) AND non-dispatch sends (watchdog/doctor/orchestrator/agent-to-agent, with a synthetic id + null `task_id`), so a budget cap bounds true total spend rather than dispatch-only. It writes a durable `run_costs` row (see `.claude/knowledge/execution-ledger.md`) and feeds the usage recorder (`tokensIn/tokensOut/costUsdMicros`). Pricing is delegated to the `models.priceTurn` hook (core stays pricing-agnostic); cost is attributed to the model the runtime *actually ran* (`usage.model`) before any requested override. `agent-cost` imports its ledger/usage/hook deps dynamically so metering doesn't drag the ledger into every caller's static graph. `GET /spend?window=24h|7d|30d|all` returns rollups (total/by-agent/by-model); the **Spend** tab renders them with an "estimated" caveat and "$ unavailable" for unmetered rows.

### Routing (per-turn model + thinking)

Bakin-owned policy resolved at dispatch (`src/core/model-routing.ts`); OpenClaw serves it (`model`/`thinking` on the gateway `agent` RPC). Routing key = dispatch **origin** (`scheduled|workflow|adhoc|recovery|decomposition`) + a per-task **tag override**. Cascade: tag → origin → inherit (nothing resolved = the agent's configured model, unchanged behavior). Stored in `settings.routing`, exposed via `models.getRoutingConfig`; the **Routing** tab edits it. Thinking levels include `inherit`.

### Budget gating (#464)

`settings.budget` (`BudgetPolicy`: global + per-agent daily/monthly USD caps + `warnPct`), exposed via `models.getBudgetPolicy`. `dispatch.budgetGate` consults it against ledger spend before claiming a run: **warn** at `warnPct` (default 0.8), **defer** at 100% (task stays in todo, resumes when the window rolls over — never pauses the agent, diverging from paperclip). **Fail-closed**: an unreadable ledger defers. Audits debounce per window. The health plugin's `budget` check surfaces utilization + deferred-run count; the Spend tab has a global-caps editor.

## How to extend

- **Add a model:** PR an entry in `known-models.ts` (include `pricing` for cloud LLMs; bump `PRICING_AS_OF` on price edits).
- **Add a brand logo:** inline the SVG path in `brand-icon.tsx`.
- **Never:** fabricate model metadata, pricing, or cost — render plain / "$ unavailable" instead.

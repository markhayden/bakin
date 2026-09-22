---
title: Models
description: "One model for your agents, a lighter one for the background chores — and every per-agent and per-job control when you want it."
---

Most people want to pick one model and get on with it. The Models page starts there: an **agent model** for chat, direct messages and every task your agents run, and a **background-chores model** for the small jobs Bakin does on its own (chat titles, asset enrichment, notifications, team routing, skill mapping). Advanced opens every per-agent and per-job control on the same page. Nothing is written until you save, and the page never picks a model you didn't approve.

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-models--overview.webp" alt="The Models page in Simple view: an agent-model lane and a background-chores lane, with the recommended plan below." loading="lazy">
</figure>

## Simple

Two lanes, one save.

<div class="table-light-full table-label-wrap">

| Lane | What it controls |
| --- | --- |
| **Agent model** | The runtime's default model — chat, direct messages, and every task your agents run. |
| **Background chores** | The five background jobs (titles, enrichment, relay notifications, team routing, skill mapping). Shows one value when all five use the same model; otherwise **Mixed (N models)** with a *Set all to…* picker that brings them back together without touching any thinking levels. |

</div>

Below the lanes, **Recommended plan** shows what Bakin would pick and why — the plain-words reason sits next to each pick ("included in your plan · lightest tier that can do these jobs", or "~$6 per 1M tokens vs ~$90 for …"). *Use recommended plan* opens the exact list of changes; confirming stages them into your draft, and the save bar writes them. Bakin never applies the recommendation on its own.

If anything is set that Simple can't show — an agent pinned to its own model, a per-job route, a tag override, fallbacks, aliases — a **customizations line** says so and links into Advanced. **Reset to this plan** clears all of it back to the two lanes: the dialog lists every change (and anything your runtime can't clear), asks you to type `reset`, saves a snapshot first, and tells you the `bakin models restore <file>` command that undoes it.

## Advanced

The same selections, every control, still one draft and one save bar — in three tabs:

- **Overview** — the default model next to the recommended plan, an "In use today" strip (how many agents run on the default vs their own model, what the background chores use, how many kinds of work are routed, tag overrides) with a bar of agents by model, and a *More defaults* panel for the default subagent model, fallbacks and aliases when your runtime supports them (Pi doesn't; the page says so in one line instead of showing disabled fields).
- **Agents** — one row per agent, grouped by team when you have teams: whether it runs on the default or its own model, an *Override* picker, and a subagents column where the runtime supports it. The tab opens with the things worth weighing before you pin anything — most agents should stay on the default; pin up for hard work, down for high-volume work; subagents are their own dial.
- **Work routing** — a model and thinking level per kind of work, grouped into *Agent work* (scheduled, workflow, ad-hoc, recovery, decomposition, direct send) and *Background chores* (the five chores). Blank routes use the agent model; **tag overrides** take priority over routes; *Use recommended routes* fills in the unrouted chores from the plan. Thinking dropdowns offer only the levels your runtime honors; a saved level it doesn't support shows as "unsupported by this runtime" rather than disappearing.

Switching between Simple and Advanced never changes anything — it's a view. Bakin opens Advanced on its own when customizations exist, and remembers where you left off.

## When a model can't run

Every persisted selection is checked against what can actually run here: does the provider have credentials, has your account rejected the model, is it still in the catalog. A selection that fails shows a red callout with the reason and, where Bakin has a safe replacement, one *Use <model>* button that stages it. Pickers list such models disabled with the reason, so you can't pick a dead model by accident. Tasks whose model can't run wait on the board with a "Model can't run" badge that links straight to the offending selection (`/models?ref=…`), and the doctor's `models.dead-selections` check offers the same repair. Missing evidence (the runtime couldn't say) is shown as *unverified*, never treated as broken.

If your runtime hasn't confirmed a write yet, the field carries a *saving…* chip until it settles; a write the runtime refused stays in your draft with a *Retry*.

## Model catalog

The read-only catalog sits under the lanes: every model your runtime reports, merged with a curated metadata layer (tier, best-for, cost summary, context window), with provider filters, search and sort. *Refresh* re-reads the runtime; *Verify availability* fires a tiny billed probe per model to confirm your account can call it — explicit only, never on a schedule.

<div class="table-light-fit table-label">

| Tier | Use it for |
| --- | --- |
| **Budget** | Heartbeats, status pings, simple parsing, anything high-volume and low-stakes. |
| **Standard** | Day-to-day agent work. Writing, planning, most tool use. |
| **Premium** | Hard problems. Long-context analysis, multi-step reasoning, work where the model's mistakes are expensive. |

</div>

## From the terminal and at first run

`bakin models plan` prints the current lanes, the recommended plan with its reasons, and the changes that would reach it; `bakin models plan --apply` applies them (the only way the CLI ever changes a model, and only on that flag). `bakin models restore <snapshot.json>` undoes a Reset. `bakin onboard` shows the recommended plan on a fresh install and applies it only when you confirm (or pass `--yes`); it never changes a plan you already have — a dead lane on an existing install becomes a warning that points you back here.

## Where it lives

```
~/.bakin/plugin-settings/
  models/
    available.json        # cached catalog from the runtime
    pending-writes.json   # adapter writes not yet confirmed
    snapshots/            # full-state snapshots written before each Reset
  models.json             # work routing (routes + tag overrides), page mode
```

The runtime owns the actual model assignments (default, fallbacks, aliases, per-agent pins) in its native store; Bakin reads and writes them through the runtime adapter and never copies state.

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#models).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents can introspect the catalog and per-agent config through MCP exec tools.

<!-- docs:exec-tools models -->
- `bakin_exec_models_get_config`: Get model configuration for all agents or a specific agent. Shows effective model (own override or default), subagent model, and system defaults.
- `bakin_exec_models_list`: List available AI models with tier classification (budget/standard/premium). Use this to discover what models are available for assignment.
<!-- /docs:exec-tools -->

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Team](/docs/using/team/): per-agent model assignment is read here
- [Settings](/docs/using/settings/): provider keys, allowlists, and blocklists
- [Health](/docs/using/health/): dead selections and routing checks

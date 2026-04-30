---
title: Models
description: "Pick the right model for each agent and each role. Live catalog from every provider, tier-based profiles, aliases, and subagent overrides."
---

Right model for the right job. Premium where the work earns it, budget where it doesn't. A heartbeat ping shouldn't run on GPT-5; a real strategy doc shouldn't run on Haiku. This is where you make sure each agent and each kind of work lands on a model that fits.

<figure class="screenshot-frame">
  <figcaption>The models view: agent config on top, with tabs for the available catalog, aliases, and task profiles.</figcaption>
</figure>

## Agent Config

One row per agent. Pick a concrete model, an alias, or a task profile. The dropdown shows the merged catalog (concrete ids, aliases, profiles) so you can route by capability or by name.

Two slots per agent:

<div class="table-light-full table-label-wrap">

| Slot | What it does |
| --- | --- |
| **Primary** | The model the agent itself runs on. |
| **Subagent** | The model used when this agent dispatches work to others. Set the orchestrator to premium and its helpers to budget here, instead of upgrading every agent. |

</div>

Defaults apply to anyone without an override. Fallback models cover provider outages: when the primary doesn't respond, the runtime walks the fallback list in order.

## Available Models

The catalog from every configured provider, merged with a curated metadata layer that adds what the APIs don't return: tier (budget / standard / premium), best-for hint, cost summary, context window. Refresh from the provider anytime; results cache to disk so the page loads instantly.

<div class="table-light-fit table-label">

| Tier | Use it for |
| --- | --- |
| **Budget** | Heartbeats, status pings, simple parsing, anything high-volume and low-stakes. |
| **Standard** | Day-to-day agent work. Writing, planning, most tool use. |
| **Premium** | Hard problems. Long-context analysis, multi-step reasoning, work where the model's mistakes are expensive. |

</div>

Configure provider keys in [Settings](/docs/using/settings/) and they show up here automatically.

## Aliases

Custom names mapped to model ids. Define `daily-driver` → `claude-sonnet-4-6` once, point your agents at `daily-driver`, swap the underlying id later in one place. Useful when the provider ships a new generation and you want to roll the team forward without touching every agent.

## Task Profiles

<figure class="screenshot-frame">
  <figcaption>Task profiles map a name to a concrete model, so agents can be configured by purpose instead of vendor id.</figcaption>
</figure>

Named presets that abstract away vendor naming entirely. `budget`, `standard`, `premium` ship by default; add your own from the Task Profiles tab. Configure an agent with a profile name and Bakin resolves it at dispatch time. Lets you reason about cost vs capability instead of model ids.

## Where it lives

```
~/.bakin/plugin-settings/
  models/
    available.json        # cached catalog from provider APIs
  models.json             # per-agent config, aliases, task profiles
```

The runtime owns the actual model assignment (it's what gets sent to the gateway on dispatch). Bakin reads and writes through the runtime adapter, never copies state.

## Settings

<!-- docs:settings models -->
<div class="table-light-full table-settings">

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| Show usage metrics | `boolean` | `true` | Display token usage and cost estimates |
| Default model | `select` | `openai-codex/gpt-5.4` | Default model for new agents |

</div>
<!-- /docs:settings -->

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#plugin-models).

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
- [Health](/docs/using/health/): dispatch usage broken down by model and agent

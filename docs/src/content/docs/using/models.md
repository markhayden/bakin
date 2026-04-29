---
title: Models
description: "Pick what model each agent runs. Manage aliases, task profiles, and the merged catalog from your providers."
---

Models is where you decide what runs each agent. Pick a concrete model id, an alias, or a tier-based profile. The plugin merges live API catalogs from your providers with a curated metadata layer (tier, brand, context window) the APIs don't expose, so you always see the full picture.

## The models view

<figure class="screenshot-frame">
  <figcaption>The models view with four tabs: Agent Config, Available Models, Aliases, and Task Profiles.</figcaption>
</figure>

Four tabs across the top, plus a header with a refresh-cache button and a gateway-status indicator that flags when changes haven't been picked up yet.

### Agent Config

<figure class="screenshot-frame">
  <figcaption>The agent config tab: per-agent model picker with current selection, context window, and rate limits.</figcaption>
</figure>

One row per agent. Pick a model from the merged dropdown — concrete model ids, aliases, and task profiles all show up. Context window and rate-limit info inline.

### Available Models

The full catalog from every provider you have configured (Anthropic, OpenAI, etc.), merged with the curated metadata layer. Refresh from the API anytime; results cache to disk so the page loads instantly.

### Aliases

Custom names that map to model ids. Define `daily-driver` → `claude-sonnet-4-5` once and use the alias everywhere. Swap the underlying model later in one place.

### Task Profiles

Named tier presets — `budget`, `standard`, `premium`. Each maps to a concrete model. Configure agents with a profile name and Bakin resolves it at dispatch time.

## Concepts

- **Cache plus catalog.** The provider API is the source of truth for what exists. The curated catalog at `plugins/models/data/known-models.ts` adds the metadata APIs don't return. Bakin merges both server-side, persistent disk cache at `~/.bakin/plugin-settings/models/available.json`. Never assumes data the provider didn't give you.
- **Three layers of indirection.** Concrete model id → alias → task profile. Configure agents at whichever layer fits the use case. Aliases let you swap models without touching every agent. Profiles let you reason about cost vs capability instead of vendor naming.
- **Gateway-restart awareness.** Some changes don't apply until the OpenClaw gateway reloads. The header surfaces a "config dirty" indicator until it's been restarted, so you know what's live and what isn't.

## Where it lives

```
~/.bakin/plugin-settings/
  models/
    available.json        # cached catalog from provider APIs
  models.json             # per-agent config, aliases, task profiles
```

## API routes

<!-- docs:api-routes models -->
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/aliases` | GET /aliases |
| `POST` | `/aliases` | POST /aliases |
| `GET` | `/available` | Bypass cache and fetch the model list fresh from the runtime adapter |
| `GET` | `/config` | GET /config |
| `POST` | `/config` | POST /config |
| `POST` | `/defaults` | POST /defaults |
| `GET` | `/profiles` | GET /profiles |
| `PUT` | `/profiles` | Check if runtime config is out of sync (needs restart) |
| `POST` | `/refresh` | Bypass cache and fetch the model list fresh from the runtime adapter |
| `POST` | `/runtime/restart` | List available AI models with tier classification (budget/standard/premium). Use this to discover what models are available for assignment. |
| `GET` | `/runtime/status` | Check if runtime config is out of sync (needs restart) |
<!-- /docs:api-routes -->

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
- [Health](/docs/using/health/): gateway status and dispatch usage by model

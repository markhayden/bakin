---
title: Extend Bakin
description: Choose the right extension surface for plugins, agent kits, SDK code, and Bakin core work.
---

:::note[Looking for official plugins and agent kits?]
The [Bakin' Bits](https://github.com/markhayden/bakin-bits-official) repo is the official source for supported plugins and agent kits. Install from there with `bakin plugins install github:markhayden/bakin-bits-official#<plugin-name>` or `bakin agents install github:markhayden/bakin-bits-official#<agent-name>`.
:::

Bakin is meant to be shaped by the people using it. Start here when you want to add a plugin, package an agent, share a workflow, expose a new tool for agents, or improve the core app without fighting the system.

## Surfaces

<div class="table-light-full table-label-wrap surface-picker-table">

| You want to... | Build this | Start here |
| --- | --- | --- |
| Add the missing piece your operation needs: an SDR pipeline that pulls leads from your CRM, a business intelligence view that explains what is working, a weird little launch tracker, or tools your agents can call when the built-in set is not enough. | Plugin | [Plugins](/docs/extending/plugins/overview/) |
| Add a teammate with a job to do: a researcher who knows your market, a producer who follows your launch playbook, or an operator that arrives with its own identity, workspace, skills, workflows, and lessons. | Agent Kit | [Agent Kits](/docs/extending/agents/overview/) |
| Expose a supported component, type, route helper, or plugin API that plugins need but cannot safely import today | @makinbakin/sdk | [SDK](/docs/extending/sdk/overview/) |
| Change the core product: tighten the shell, improve plugin loading, add a first-party capability, or fix the rough edge you keep tripping over. | @bakin/core | [Bakin' Core](/docs/extending/development-workflow/) |

</div>

## Ingredients

Most useful additions are a bundle of ingredients. A plugin might ship UI, routes, hooks, and an MCP tool. An agent kit might ship the teammate plus the skills, workflows, workspace files, and lessons that make them ready to work.

<div class="table-light-full table-label-wrap">

| Ingredient | Plugin | Agent Kit | Use it for |
| --- | --- | --- | --- |
| UI | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | <span class="layer-mark layer-mark--no" aria-label="Not applicable"></span> | Pages, panels, widgets, dashboards, task sidebars. |
| Routes | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | <span class="layer-mark layer-mark--no" aria-label="Not applicable"></span> | HTTP APIs, webhooks, sync endpoints, integration callbacks. |
| Hooks | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | <span class="layer-mark layer-mark--no" aria-label="Not applicable"></span> | Let plugins enrich, react to, or hand work to each other. |
| MCP tools | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | <span class="layer-mark layer-mark--no" aria-label="Not applicable"></span> | Give agents callable actions, such as scoring leads or creating records. |
| Settings | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | <span class="layer-mark layer-mark--no" aria-label="Not applicable"></span> | User-configurable plugin behavior. |
| Search | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | <span class="layer-mark layer-mark--no" aria-label="Not applicable"></span> | Index plugin-owned content so users and agents can find it. |
| Health checks | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | <span class="layer-mark layer-mark--no" aria-label="Not applicable"></span> | Surface diagnostics and repair hints in Health. |
| Skills | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | Plugin-owned procedures or reusable agent skills. |
| Workflows | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | Plugin-owned flows or reusable team playbooks. |
| Lesson blocks | <span class="layer-mark layer-mark--no" aria-label="Not applicable"></span> | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | Durable context an installed agent can toggle on and off. |
| Workspace files | <span class="layer-mark layer-mark--no" aria-label="Not applicable"></span> | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | Agent identity, tool rules, collaboration notes, and operating style. |
| Agent identity | <span class="layer-mark layer-mark--no" aria-label="Not applicable"></span> | <span class="layer-mark layer-mark--yes" aria-label="Available"></span> | Add a teammate to the roster. |

</div>

Use [Ingredients](/docs/extending/ingredients/) for deeper notes on why each ingredient exists and where it shows up in manifests or code.

## Related

- [Bakin' Core](/docs/extending/development-workflow/): source setup, local loops, docs checks, and PR shape
- [Quality Control](/docs/extending/quality-control/): review expectations, generated docs, examples, and source-link rules
- [Ingredients](/docs/extending/ingredients/): the parts a plugin or agent kit can ship
- [Plugin Manifest](/docs/extending/plugins/manifest/): the install-time contract for plugins
- [Server Contracts](/docs/extending/plugins/server-contracts/): server routes, exec tools, hooks, health checks, and cleanup
- [Client UI](/docs/extending/plugins/client-ui/): navigation, pages, routes, slots, and cleanup
- [Package Manifest](/docs/extending/agents/packages/): package schema and install behavior

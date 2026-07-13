---
title: Ingredients
description: Glossary of the parts plugins and agent kits can ship, what each one is for, and where it lives.
---

Plugins and agent kits are the surfaces. Ingredients are the parts you put inside them.

Use this as the glossary. When you are sketching an SDR pipeline, a launch producer, a BI board, or a weird little internal tool, this is the page that helps you name the parts before you reach for the deeper docs.

## UI

UI is anything a human sees or clicks inside Bakin: pages, panels, widgets, dashboards, modals, task sidebars, asset previews, and custom workflow views.

Use UI when the addition needs a place to work. An SDR plugin might need a lead board. A BI plugin might need a dashboard. A launch tracker might need a little status wall everyone keeps open.

UI belongs to plugins. Register plugin-owned pages from the client entry with `registerPlugin({ routes })`. Fill host-owned pages with slots such as `page:/tasks` or `task-sidebar`. Declare visible client routes in `bakin-plugin.json` under `contributes.clientRoutes`.

Start with [Client UI](/docs/extending/plugins/client-ui/).

## Routes

Routes are plugin-owned HTTP APIs. They let the plugin UI call server behavior, let another system send webhooks, or expose integration callbacks.

Use routes when work needs a server boundary: sync a CRM, receive a webhook, fetch records from plugin storage, update a plugin-owned object, or hand structured data to the UI.

Routes belong to plugins. New routes should use declarative `defineRoute()` definitions where possible. Plugin route paths are plugin-relative and mount under `/api/plugins/{pluginId}`. Public routes should be declared in `bakin-plugin.json` under `contributes.apiRoutes`.

Start with [Server Contracts](/docs/extending/plugins/server-contracts/).

## Hooks

Hooks are cross-plugin connection points. They let one plugin ask for help, enrich data, publish an event, or run a waterfall without importing another plugin's files.

Use hooks when the relationship should stay loose. A tasks plugin can ask for extra detail. A projects plugin can react when task status changes. A custom plugin can enrich a record before it appears in a dashboard.

Hooks belong to plugins. Register handlers with `ctx.hooks.register()`. Public hooks need metadata: summary, kind, visibility, stability, schemas when useful, and examples when practical.

Start with [Server Contracts](/docs/extending/plugins/server-contracts/) and the [Hooks reference](/docs/reference/generated/hooks/).

## MCP Tools

MCP tools are agent-callable actions. In code they are registered as exec tools, and Bakin exposes them through MCP so agents can use them during work.

Use MCP tools when an agent needs to do something, not just read instructions. Score a lead, create a record, attach an asset, start a workflow, lookup account context, or move a task.

MCP tools belong to plugins. Register them with `ctx.registerExecTool()`, keep parameter schemas strict, return boring result objects, and declare public tools in `bakin-plugin.json` under `contributes.execTools`.

User plugin tool names must stay inside the plugin namespace: `bakin_exec_{pluginId}_{action}`. Bakin rejects undeclared tools, duplicate tool names, and user plugin tools that try to register outside their own prefix.

Start with [Server Contracts](/docs/extending/plugins/server-contracts/) and the [Exec tools reference](/docs/reference/generated/exec-tools/).

## Settings

Settings are user-configurable plugin behavior. They keep a plugin flexible without making people edit files or fork code.

Use settings for API toggles, feature flags, default filters, thresholds, provider choices, channel IDs, sync cadence, or anything an operator should be able to adjust.

Settings belong to plugins. Define `settingsSchema` in the plugin, read values through `ctx.getSettings()`, update with `ctx.updateSettings()`, and react to changes with `onSettingsChange()` when runtime behavior should update live. Declare settings in `bakin-plugin.json` under `contributes.settings`.

Start with [Server Contracts](/docs/extending/plugins/server-contracts/).

## Search

Search ingredients make plugin-owned content findable by people and agents. Bakin can index text and structured fields, expose facets, and run retrieval across plugin data.

Use search when your plugin creates content worth finding later: leads, research notes, assets, campaign briefs, account records, decisions, or task-linked output.

Search belongs to plugins. File-backed content should use `ctx.search.registerFileBackedContentType()`. External or service-backed content should use `ctx.search.registerContentType()` with a complete `reindex()` generator and `verifyExists()` check.

Start with [Server Contracts](/docs/extending/plugins/server-contracts/) and [Search](/docs/using/essentials/#search).

## Health Checks

Health checks make plugin problems visible. They show up in Health and can explain what is broken, what is degraded, and what the user can do next.

Use health checks when a plugin depends on files, credentials, external services, adapters, background sync, or generated state that can drift.

Health checks belong to plugins. Register them with `ctx.registerHealthCheck()`. The registered ID is namespaced by plugin, and thrown errors become diagnostic results instead of crashing the sweep.

Start with [Server Contracts](/docs/extending/plugins/server-contracts/) and [Health](/docs/using/health/).

## Skills

Skills are reusable procedures. They tell agents how to do a specific kind of work: write a brief, review copy, inspect a source, prepare a handoff, or follow a domain playbook.

Use skills when instructions should be reusable and task-sized. If the same procedure will be invoked again and again, it probably wants to be a skill instead of buried in a long agent prompt.

Skills can belong to plugins or agent kits. Put a skill in a plugin when it belongs to a plugin-owned capability. Put it in an agent kit when it travels with a teammate or reusable team package.

Plugin skills are registered with `ctx.registerSkill()`. Agent kit skills live under `contributions.skills` in `bakin-package.json`, where each contribution points at a skill directory containing `SKILL.md`. They can be listed in `agent.allowedSkills`.

Start with [Server Contracts](/docs/extending/plugins/server-contracts/) or [Package Manifest](/docs/extending/agents/packages/).

## Workflows

Workflows are repeatable playbooks. They organize steps, gates, agent assignments, expected outputs, and handoffs.

Use workflows when the work has a shape that should be followed more than once: launch review, content production, lead qualification, asset creation, campaign QA, or any process with checkpoints.

Workflows can belong to plugins or agent kits. Put a workflow in a plugin when it is part of a plugin-owned product surface or runtime integration. Put it in an agent kit when it is part of how a teammate or team package operates.

Plugin workflows are registered with `ctx.registerWorkflow()`. Agent kit workflows live under `contributions.workflows`; workflow skills live under `contributions.workflowSkills`.

Start with [Workflows](/docs/using/workflows/), [Server Contracts](/docs/extending/plugins/server-contracts/), or [Package Manifest](/docs/extending/agents/packages/).

## Lesson Blocks

Lesson blocks are durable agent context. They are the things an installed teammate should know before work starts: voice, market rules, taxonomy, review standards, escalation rules, or domain-specific terminology.

Use lesson blocks when the information is reusable, stable, and agent-facing. Do not use them for secrets, one-off task notes, credentials, or live state.

Lesson blocks belong to agent kits. Declare files under `contributions.lessons`, enable defaults with `install.enableLessons`, and let users toggle them with `bakin agents lessons`.

Start with [Lesson Blocks](/docs/extending/agents/lessons/).

## Workspace Files

Workspace files are the durable operating files projected into an agent's runtime workspace. They define how the teammate should behave, what tools mean, and how collaboration should work.

Use workspace files when the agent needs standing instructions. Common files include `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, and `AGENTS.md`.

Workspace files belong to agent kits. Declare them under `contributions.workspaceFiles`. Install behavior is controlled by `install.writeWorkspaceFiles`.

Start with [Package Manifest](/docs/extending/agents/packages/).

## Agent Identity

Agent identity is the teammate record: name, role, default model, tags, dispatch rules, allowed tools, and allowed skills.

Use agent identity when you are adding a roster member, not just sharing a procedure. A research agent, launch producer, account explorer, QA reviewer, or content operator all need identity.

Agent identity belongs to agent kits with `kind: "agent"`. Define it in the `agent` stanza of `bakin-package.json`. Optional tool restrictions live in `agent.allowedTools`; skill access lives in `agent.allowedSkills`.

Start with [Agent Kits](/docs/extending/agents/overview/) and [Package Manifest](/docs/extending/agents/packages/).

## Assets

Assets are supporting files shipped with an agent kit: examples, templates, fixtures, prompt references, or files the package needs at install time.

Use assets when the kit needs more than Markdown instructions and YAML workflows. Keep them non-secret and portable.

Assets belong to agent kits through `contributions.assets`. Plugin runtime assets are a separate concern and should be handled by the plugin's own code and storage model.

Start with [Package Manifest](/docs/extending/agents/packages/).

## Manifest Shape

Plugins use `bakin-plugin.json`. The manifest declares identity, permissions, runtime capabilities, and public contributions. Entry points are fixed by convention: `index.ts` (server) and optional `client.tsx` at the plugin root.

```json
{
  "id": "lead-intel",
  "permissions": ["storage.read", "tasks.write"],
  "contributes": {
    "clientRoutes": [{ "path": "/lead-intel", "summary": "Lead intelligence view" }],
    "execTools": [{ "name": "bakin_exec_lead-intel_score", "summary": "Score a lead" }]
  }
}
```

Agent kits use `bakin-package.json`. The manifest declares package kind, agent identity, install behavior, contributed files, and dependencies.

```json
{
  "id": "launch-producer",
  "kind": "agent",
  "agent": {
    "identity": { "name": "Launch Producer" },
    "allowedTools": ["bakin_exec_tasks_list"]
  },
  "contributions": {
    "workspaceFiles": ["workspace/SOUL.md", "workspace/TOOLS.md"],
    "skills": ["skills/launch-review"],
    "workflows": ["workflows/launch.yaml"],
    "lessons": ["lessons/voice.md"]
  }
}
```

Omit `allowedTools` or set it to an empty array for unrestricted tool access. Add entries only when the agent package should be deliberately scoped down.

For exact fields, use [Plugin Manifest](/docs/extending/plugins/manifest/) and [Package Manifest](/docs/extending/agents/packages/).

## Related

- [Plugins](/docs/extending/plugins/overview/): build app and runtime functionality
- [Agent Kits](/docs/extending/agents/overview/): build installable teammates
- [Server Contracts](/docs/extending/plugins/server-contracts/): routes, tools, hooks, search, health checks, skills, and workflows
- [Lesson Blocks](/docs/extending/agents/lessons/): write toggleable context for agents

## Capability packs

Capability packs teach agents new tricks — web search, browser automation,
transcription. They are skill-packs (agent packages) that name a
`capability` and declare what they need: pinned binaries Bakin installs
into its own bin dir, and API keys collected through a guided step into the
masked secret store. Install one from Explore → Capabilities or
`bakin packages install <name>`; readiness (content ✓ / binary ✓ / key ✓)
shows on the Runtime page and in the doctor, with a remediation path for
every missing leg.

### Plugin, capability pack, or agent?

One rule: **who consumes it.**

| You are shipping | It is a | Because |
|---|---|---|
| UI, API routes, exec tools, health checks | Plugin | Bakin runs the code |
| A skill wrapping external tools (a CLI, a web API) | Capability pack | Agents consume the content; no code runs inside Bakin |
| A skill that teaches agents a plugin's own exec tools | Part of that plugin | It has no life without the plugin's code |
| An identity — soul, role, persona | Agent package (`kind: "agent"`) | It joins the team roster |

Capability packs never run code inside Bakin's process — their scripts
execute as agent shell commands. Something needing both governance UI and
agent content ships as a plugin plus a companion pack, never a hybrid.

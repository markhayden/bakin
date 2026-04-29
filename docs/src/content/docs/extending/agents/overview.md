---
title: Agent Authoring
description: Author agent packages and agent-facing instructions for Bakin runtime workflows.
---

Agent authoring docs explain the Bakin-specific contracts agents need: package structure, available tools, workflow handoffs, memory/context expectations, and how Bakin coordinates work through the runtime adapter.

When a package depends on runtime-specific behavior, keep that detail explicit in the package docs.

## Build Path

1. Decide whether you need an `agent`, `skill-pack`, `workflow-pack`, or `knowledge-pack`.
2. Define `bakin-package.json`.
3. Add workspace files, skills, workflows, and knowledge files.
4. Install locally with `bakin agents install`.
5. Test the agent against the tools and workflows it is allowed to use.

Use these pages for the details:

- [Agent Packages](/docs/extending/agents/packages/)
- [Agent Knowledge](/docs/extending/agents/knowledge/)

## For Coding Agents

When working in Bakin:

- prefer documented SDK and contract helpers
- read the targeted LLM bundle before editing plugin or agent contracts
- update examples and metadata with behavior changes
- avoid relying on internal implementation details unless the task is contributor-facing

Fetch this bundle directly:

```sh
curl -fsSL https://makinbakin.com/docs/llms/agent-authoring.md
```

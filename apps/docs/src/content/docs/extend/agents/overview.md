---
title: Agent Authoring
description: Author agent packages and agent-facing instructions for Bakin and OpenClaw workflows.
---

# Agent Authoring

Agent authoring docs explain the Bakin-specific contracts agents need: package structure, available tools, workflow handoffs, memory/context expectations, and how Bakin coordinates work through OpenClaw.

These docs explain only the OpenClaw concepts required to use Bakin. Deeper OpenClaw behavior belongs in OpenClaw documentation.

## For Coding Agents

When working in Bakin:

- prefer documented SDK and contract helpers
- read the targeted LLM bundle before editing plugin or agent contracts
- update examples and metadata with behavior changes
- avoid relying on internal implementation details unless the task is contributor-facing

Fetch this bundle directly:

```sh
curl -fsSL https://docs.makinbakin.com/llms/agent-authoring.md
```

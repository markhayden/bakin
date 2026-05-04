---
title: Agent Kits
description: Author installable agent kits with identity, workspace files, skills, workflows, lessons, and narrow tool access.
---

Agent kits are not just prompts. In Bakin, an agent kit is an installable contract for runtime-managed work: identity, permissions, reusable skills, workflows, lessons, and the workspace files that tell the agent how to operate.

Use agent kits when you want a teammate or team capability that can be installed, reviewed, updated, and removed cleanly.

## What an Agent Package Owns

<div class="table-light-full table-label-wrap">

| Piece | Purpose |
| --- | --- |
| `bakin-package.json` | Package identity, kind, install behavior, permissions, and contributed files. |
| `workspace/SOUL.md` | Durable operating style and judgment. |
| `workspace/IDENTITY.md` | Human-facing identity and role context. |
| `workspace/TOOLS.md` | Tool usage rules and boundaries. |
| `workspace/AGENTS.md` | Collaboration and handoff notes when the package needs them. |
| `skills/<name>/SKILL.md` | Reusable procedures the runtime can load as skills. |
| `workflows/*.yaml` | Repeatable task flows the agent can run or participate in. |
| `lessons/*.md` | Toggleable domain lessons. |

</div>

## Build Path

1. Decide whether you need an `agent`, `skill-pack`, `workflow-pack`, or `lesson-pack`.
2. Define `bakin-package.json`.
3. Add workspace files, skills, workflows, workflow skills, lessons, or assets.
4. Install locally with `bakin agents install`.
5. Test the agent against the workflows and MCP tools it is allowed to use.
6. Keep package docs focused on what the agent does, not how Bakin works internally.

Use these pages for the details:

- [Package Manifest](/docs/extending/agents/packages/)
- [Lesson Blocks](/docs/extending/agents/lessons/)

## Tool Access

Keep `allowedTools` narrow. The manifest is where reviewers can see what an agent may do before they install it. Start with read-only tools, add write tools only when the agent's job requires them, and prefer plugin-specific tools over broad runtime access.

`allowedSkills` is a declarative skill allow-list. It documents intent today and gives package authors a stable place to express skill boundaries as routing becomes stricter.

## Runtime-Specific Behavior

Bakin can run against different runtime adapters. If a package depends on adapter-specific behavior, say so in the package README or lessons. Do not hide runtime assumptions inside vague prose.

## For Coding Agents

When working in Bakin:

- read the targeted LLM bundle before editing plugin or agent contracts
- prefer documented SDK and contract helpers
- update examples and metadata with behavior changes
- avoid relying on internal implementation details unless the task is contributor-facing

Fetch this bundle directly:

```sh
curl -fsSL https://makinbakin.com/docs/llms/agent-authoring.md
```

## Related

- [Team](/docs/using/team/): how installed agents appear and operate in the app
- [Workflows](/docs/using/workflows/): how agents move through workflow steps
- [Exec tools reference](/docs/reference/generated/exec-tools/): MCP tools available to agents

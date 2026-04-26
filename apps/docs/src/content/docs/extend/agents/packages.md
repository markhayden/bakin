---
title: Agent Packages
description: Package reusable agents, skills, workflows, knowledge, and workspace files for Bakin.
---

Agent packages are installable bundles for Bakin and OpenClaw-managed agent state. They use `bakin-package.json`, not `bakin-plugin.json`.

The tested manifest fixture for these docs lives at `apps/docs/snippets/agent-package-basic/bakin-package.json`.

<!-- docs:snippet agent-package-basic-manifest -->
Source: `apps/docs/snippets/agent-package-basic/bakin-package.json`

```json
{
  "id": "content-planner",
  "name": "Content Planner",
  "version": "0.1.0",
  "kind": "agent",
  "description": "Minimal agent package used by the public Bakin docs.",
  "bakin": ">=0.1.0",
  "agent": {
    "identity": {
      "name": "Content Planner"
    },
    "role": "Plans and reviews short-form content workflows.",
    "defaultModel": "gpt-5.4",
    "dispatchableBy": [
      "main"
    ],
    "tags": [
      "content",
      "planning"
    ],
    "allowedTools": [
      "bakin_exec_tasks_list",
      "bakin_exec_workflows_run"
    ],
    "allowedSkills": [
      "content-brief"
    ]
  },
  "install": {
    "createIfMissing": true,
    "adoptIfExists": true,
    "writeWorkspaceFiles": true,
    "installSkills": true,
    "installWorkflows": true,
    "enableKnowledge": [
      "voice"
    ]
  },
  "contributions": {
    "workspaceFiles": [
      "workspace/SOUL.md",
      "workspace/IDENTITY.md",
      "workspace/TOOLS.md"
    ],
    "skills": [
      "skills/content-brief.md"
    ],
    "workflows": [
      "workflows/draft-review.yaml"
    ],
    "knowledge": [
      "knowledge/voice.md"
    ]
  }
}
```
<!-- /docs:snippet -->

## Package Kinds

| Kind | Purpose |
| --- | --- |
| `agent` | Install or adopt an agent and project its workspace files, skills, workflows, and knowledge. |
| `skill-pack` | Ship reusable skills without creating an agent. |
| `workflow-pack` | Ship workflows and workflow skills. |
| `knowledge-pack` | Ship reusable knowledge files. |

## Install Commands

Install from a local path:

```sh
bakin agents install ./content-planner --install-as content-planner
```

Install from GitHub:

```sh
bakin agents install github:markhayden/content-planner --install-as content-planner
```

Use `--adopt` when an existing OpenClaw agent should become managed by the package. Use `--replace` only when replacing an existing installed package intentionally.

## Source Dependencies

Package dependencies can point at GitHub or local sources. Pin refs for repeatable installs.

```json
{
  "dependencies": {
    "skills": [
      {
        "source": "github:markhayden/bakin-agent-skills",
        "ref": "v0.1.0",
        "items": ["content-brief"]
      }
    ]
  }
}
```

## Authoring Rules

- Keep package ids stable and short.
- Pin external refs when sharing packages.
- Keep `allowedTools` narrow enough for review.
- Put reusable behavior in skills and workflows, not only in prose.
- Use knowledge files for durable domain context, not one-off task state.

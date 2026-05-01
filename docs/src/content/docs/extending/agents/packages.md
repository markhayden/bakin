---
title: Package Manifest
description: Package reusable agents, skills, workflows, knowledge, workspace files, and assets for Bakin.
---

Agent packages are installable bundles for Bakin and runtime-managed agent state. They use `bakin-package.json`, not `bakin-plugin.json`. The manifest is parsed with a strict Zod schema before install.

The tested manifest fixture for these docs lives at `docs/snippets/agent-package-basic/bakin-package.json`.

<!-- docs:snippet agent-package-basic-manifest -->
Source: `docs/snippets/agent-package-basic/bakin-package.json`

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
      "bakin_exec_knowledge_search",
      "bakin_exec_workflows_start"
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

<div class="table-light-full table-label-wrap">

| Kind | Purpose |
| --- | --- |
| `agent` | Install or adopt an agent and project its workspace files, skills, workflows, knowledge, and assets. |
| `skill-pack` | Ship reusable skills without creating an agent. |
| `workflow-pack` | Ship workflows and workflow skills. |
| `knowledge-pack` | Ship reusable knowledge files. |

</div>

## Base Fields

Every package has `id`, `name`, `version`, `kind`, and optional `description`, `bakin`, and `author`.

Package IDs may contain letters, numbers, dashes, and underscores, up to 40 characters. Versions use `MAJOR.MINOR.PATCH` with an optional prerelease suffix.

## Agent Fields

`kind: "agent"` packages include `agent`, `install`, and `contributions`.

<div class="table-light-full table-label-wrap">

| Field | Meaning |
| --- | --- |
| `agent.identity.name` | Display name for the runtime agent. |
| `agent.identity.emoji` | Optional small visual marker. |
| `agent.role` | One-line role summary. |
| `agent.defaultModel` | Preferred model assignment. |
| `agent.dispatchableBy` | Agent IDs allowed to dispatch work to this agent. `main` is the normal human entry point. |
| `agent.tags` | Search and grouping metadata. |
| `agent.allowedTools` | MCP tool allow-list enforced by Bakin's MCP server for installed package manifests. |
| `agent.allowedSkills` | Declarative skill allow-list. |

</div>

## Install Behavior

<div class="table-light-full table-label-wrap">

| Field | Meaning |
| --- | --- |
| `createIfMissing` | Create the runtime agent if it does not exist. |
| `adoptIfExists` | Adopt an existing runtime agent instead of refusing install. |
| `writeWorkspaceFiles` | Write template workspace files on fresh install. |
| `installSkills` | Install contributed skills. |
| `installWorkflows` | Install contributed workflows and workflow skills. |
| `enableKnowledge` | Knowledge lesson IDs enabled by default. |

</div>

Use `--adopt` when an existing runtime agent should become managed by the package. Use `--replace` only when intentionally replacing an installed package.

## Contributions

Agent packages can contribute:

- `workspaceFiles`
- `skills`
- `workflows`
- `workflowSkills`
- `knowledge`
- `assets`

`skill-pack` packages must contribute at least one skill. `workflow-pack` packages must contribute at least one workflow or workflow skill. `knowledge-pack` packages must contribute at least one knowledge file.

## Install Commands

Install from a local path:

```sh
bakin agents install ./content-planner --install-as content-planner
```

Install from GitHub:

```sh
bakin agents install github:madeinwyo/content-planner --install-as content-planner
```

GitHub sources can include `@ref` for a tag, branch, or commit:

```sh
bakin agents install github:madeinwyo/content-planner@v0.1.0 --install-as content-planner
```

## Source Dependencies

Package dependencies can point at GitHub or local sources. Pin refs for repeatable installs.

```json
{
  "dependencies": {
    "skills": [
      {
        "source": "github:madeinwyo/bakin-agent-skills",
        "ref": "v0.1.0",
        "items": ["content-brief"]
      }
    ]
  }
}
```

Dependency sources may be `github:user/repo`, `./relative/path`, `../relative/path`, `/absolute/path`, or `~/path`. Each dependency requires `ref`; local sources can use a local marker such as `local` when the package is not meant to be reproduced remotely.

## Authoring Rules

- Keep package IDs stable and short.
- Pin external refs when sharing packages.
- Keep `allowedTools` narrow enough for review.
- Add `bakin_exec_knowledge_search` when the agent should be able to look up its enabled package lessons after dispatch.
- Put reusable behavior in skills and workflows, not only in prose.
- Use knowledge files for durable domain context, not one-off task state.
- Keep secrets out of packages.
- Test package install against a disposable local runtime before sharing.

## Knowledge Retrieval

Enabled agent-package lessons are selected at dispatch time from the `agent-knowledge` search index and injected into task prompts when relevant. Agents can also call `bakin_exec_knowledge_search` for follow-up lookup; the tool only searches the calling agent's enabled lessons.

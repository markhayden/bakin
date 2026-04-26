---
title: Agent Knowledge
description: Write agent-facing knowledge that Bakin can install, toggle, and keep separate from human docs.
---

# Agent Knowledge

Agent knowledge is operational context installed with an agent package. It is different from public docs: public docs teach people and coding agents how Bakin works; package knowledge teaches a specific runtime agent how to behave in a domain.

## What Belongs Here

Good knowledge files are stable, scoped, and reusable:

- brand voice
- account constraints
- content taxonomy
- review criteria
- escalation rules
- project-specific terminology

Do not use knowledge files for secrets, ephemeral task notes, or anything that should live in Bakin memory.

## File Shape

Knowledge files are Markdown. Keep headings direct and avoid clever structure. Agents should be able to scan the file and extract instructions without guessing.

```md
# Voice

Write with practical, specific language.

## Avoid

- empty hype
- invented metrics
- unsupported claims

## Prefer

- concrete examples
- short paragraphs
- clear next actions
```

## Toggles

Agent packages can enable knowledge during install:

```json
{
  "install": {
    "enableKnowledge": ["voice"]
  }
}
```

Users can list, enable, and disable package knowledge through the `bakin agents knowledge` commands.

```sh
bakin agents knowledge list content-planner
bakin agents knowledge enable content-planner voice
bakin agents knowledge disable content-planner voice
```

## Public Docs vs Agent Knowledge

Keep public Bakin docs in `apps/docs`. Keep internal coding helper material in `.claude/knowledge`. Keep installable agent runtime knowledge inside the package that owns it.

When the same concept appears in more than one place, write for the audience instead of copying prose. Public docs should explain the contract; agent knowledge should tell the agent what to do with that contract.

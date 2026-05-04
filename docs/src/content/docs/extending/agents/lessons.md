---
title: Lesson Blocks
description: Write agent-facing lessons that Bakin can install, toggle, and keep separate from human docs.
---

Agent lessons are operational context installed with an agent package. They are different from public docs: public docs teach people and coding agents how Bakin works; package lessons teach a specific runtime agent how to behave in a domain.

Good lesson files are stable, scoped, and reusable. They should help the agent make better decisions on many tasks, not capture a single task's current state.

## What Belongs Here

- brand voice
- account constraints
- content taxonomy
- review criteria
- escalation rules
- project-specific terminology that changes slowly
- examples of acceptable and unacceptable output

Do not use lesson files for secrets, ephemeral task notes, live credentials, personal data that does not belong in source control, or anything that should live in Bakin memory.

## File Shape

Lesson files are Markdown. Keep headings direct and avoid clever structure. Agents should be able to scan the file and extract instructions without guessing.

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

## Lesson IDs

Lesson toggles use lesson IDs. Keep them short and stable:

```json
{
  "install": {
    "enableLessons": ["voice"]
  },
  "contributions": {
    "lessons": ["lessons/voice.md"]
  }
}
```

If a file is renamed, preserve the lesson ID when users may already have it enabled.

## Toggles

Users can list, enable, and disable package lessons through the `bakin agents lessons` commands.

```sh
bakin agents lessons list content-planner
bakin agents lessons enable content-planner voice
bakin agents lessons disable content-planner voice
```

Enabled lessons are projected into the agent's managed context. Disabled lessons stay installed but are not injected by default.

## Writing Style

Write for action:

- say when the agent should use the lesson
- include constraints before examples
- prefer concrete examples over broad philosophy
- separate hard rules from preferences
- avoid copying public docs into runtime lessons

## Public Docs vs Agent Lessons

Keep public Bakin docs in `docs`. Keep internal coding-agent helper material in `.claude/knowledge`. Keep installable agent runtime lessons inside the package that owns it.

When the same concept appears in more than one place, write for the audience instead of copying prose. Public docs should explain the contract; agent lessons should tell the agent what to do with that contract.

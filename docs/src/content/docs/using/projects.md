---
title: Projects
description: "Markdown spec docs with checklists that can link to real tasks and attach assets. Durable context for multi-task work."
---

Some work needs more than a task can hold. Projects give you a spec, milestone tasks, pinned attachments, and a brainstorm panel where you and an agent shape the bigger picture. Tasks ship; projects orchestrate.

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-projects--grid.webp" alt="The projects grid with status tabs and per-card progress." loading="lazy">
</figure>

Start at the grid. Each card is a live read on how far along you and your agents are. Filter by status from the tabs, search by name or content, click in for the full spec. Hit `+ New Project` to start fresh: title, status, owner, body, done. Tasks and attachments show up once you save.

## Project Plan

The plan sits at the heart of every project. A markdown spec covering what you're doing, why, how it'll get done, and what done looks like. Starts rough, sharpens with each pass as you and your agents work through it.

### Brainstorm

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-projects--brainstorm-panel.webp" alt="The brainstorm panel inside a project: chat thread with an agent, reference material, and task suggestions in context." loading="lazy">
</figure>

Most of the work happens here. Open the panel, pick an agent, start the conversation. Talk through goals, constraints, the things you haven't figured out yet. With your pinned attachments on hand, the agent grounds every suggestion in what you've got. Bit by bit the plan sharpens, tasks surface, new attachments come in. The conversation stays put so you can come back tomorrow.

Hammer the plan out here before any real work starts.

Project brainstorm uses a stable runtime thread per project and agent, so a reopened project continues the same adapter-backed conversation instead of replaying the old transcript into every prompt. The project file still stores the visible chat timeline, including streamed tool/status activity, so you can see how the agent reached an answer after navigation or reload.

### Tasks

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-projects--tasks-panel.webp" alt="The tasks panel inside a project: plain checkboxes alongside linked board tasks with live status." loading="lazy">
</figure>

Project tasks are the plan in motion. Each one starts as a milestone in the spec, a checkbox sitting next to something that needs to happen. Small stuff you tick yourself and move on. When an item hardens into real work, promote it. One click spins up a task on the [board](/docs/using/tasks/) and wires the link back to the project.

From there the checkbox stops being yours to tick. It follows the task. Hits `Done` on the board, flips checked here. The progress bar tracks what actually shipped, not what you remembered to update.

### Attachments

Raw assets that give additional context or direction to the project. Customer feedback, a goals doc, some imagery, a PDF, whatever shapes the conversation. Pin anything from the [Assets](/docs/using/assets/) library and it's right there when you and your agents brainstorm. Attach yourself, or let your agent pull things in as you explore together.

## Where they live

```
~/.bakin/projects/
  <project-id>.md      # frontmatter + spec body + Checklist + Assets sections
```

Projects index into search (table `bakin_projects`) on `title` and `body`, faceted by `status`, with semantic chunking enabled for long specs.

## Settings

<!-- docs:settings projects -->
<div class="settings-table">

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| Default project status | `select` | `active` | Status assigned to new projects |
| Auto-promote threshold | `number` | `0` | Auto-promote checklist items to tasks when project has more than N unchecked items (0 = disabled) |

</div>
<!-- /docs:settings -->

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

<!-- docs:cli-commands projects -->
| Command | Purpose |
| --- | --- |
| `bakin projects list` | List projects |
| `bakin projects get <projectId>` | Get a project |
| `bakin projects create <title>` | Create a project |
| `bakin projects update <projectId>` | Update a project |
| `bakin projects apply-plan <projectId>` | Apply a confirmed project plan update |
| `bakin projects delete <projectId>` | Delete a project |
| `bakin projects add-item <projectId> <title>` | Add a checklist item |
| `bakin projects toggle-item <projectId> <itemId> <checked>` | Toggle a checklist item |
| `bakin projects update-item <projectId> <itemId>` | Update a checklist item |
| `bakin projects remove-item <projectId> <taskItemId>` | Remove a checklist item |
| `bakin projects link-item <projectId> <taskItemId> <taskId>` | Link a checklist item to a task |
| `bakin projects promote-item <projectId> <taskItemId>` | Promote a checklist item to a task |
| `bakin projects attach-asset <projectId> <filename>` | Attach an asset to a project |
| `bakin projects detach-asset <projectId> <filename>` | Detach an asset from a project |
| `bakin projects ask <projectId> <message>` | Ask an agent about a project |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/).

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#projects).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents drive projects through MCP exec tools. The full set covers create/update, checklist items, task linking, and asset attachments:



Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Tasks](/docs/using/tasks/): executable work; projects link to and promote from here
- [Assets](/docs/using/assets/): files attached to projects
- [Workflows](/docs/using/workflows/): multi-step recipes that can be applied to project tasks

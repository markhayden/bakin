---
title: Projects
description: "Markdown spec docs with checklists that can link to real tasks and attach assets. Durable context for multi-task work."
---

Some work needs more than a task can hold. Projects give you a spec, milestone tasks, pinned attachments, and a brainstorm panel where you and an agent shape the bigger picture. Tasks ship; projects orchestrate.

<figure class="screenshot-frame">
  <figcaption>The projects grid with status tabs and per-card progress.</figcaption>
</figure>

Start at the grid. Each card is a live read on how far along you and your agents are. Filter by status from the tabs, search by name or content, click in for the full spec. Hit `+ New Project` to start fresh: title, status, owner, body, done. Tasks and attachments show up once you save.

## Project Plan

The plan sits at the heart of every project. A markdown spec covering what you're doing, why, how it'll get done, and what done looks like. Starts rough, sharpens with each pass as you and your agents work through it.

### Brainstorm

<figure class="screenshot-frame">
  <figcaption>The brainstorm panel inside a project: chat thread with an agent, reference material, and task suggestions in context.</figcaption>
</figure>

Most of the work happens here. Open the panel, pick an agent, start the conversation. Talk through goals, constraints, the things you haven't figured out yet. With your pinned attachments on hand, the agent grounds every suggestion in what you've got. Bit by bit the plan sharpens, tasks surface, new attachments come in. The conversation stays put so you can come back tomorrow.

Hammer the plan out here before any real work starts.

### Tasks

<figure class="screenshot-frame">
  <figcaption>The tasks panel inside a project: plain checkboxes alongside linked board tasks with live status.</figcaption>
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

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

<!-- docs:cli-commands projects -->
| Command | Purpose |
| --- | --- |
| `bakin projects list` | List projects |
| `bakin projects get <projectId>` | Get a project |
| `bakin projects create <title>` | Create a project |
| `bakin projects update <projectId>` | Update a project |
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

## API routes

<!-- docs:api-routes projects -->
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | List projects |
| `GET` | `/:projectId` | Get a project |
| `POST` | `/` | Create a project |
| `PUT` | `/:projectId` | Update a project |
| `DELETE` | `/:projectId` | Delete a project |
| `POST` | `/:projectId/checklist` | Add a checklist item |
| `PUT` | `/:projectId/checklist/:itemId/toggle` | Toggle a checklist item |
| `PUT` | `/:projectId/checklist/:itemId` | Update a checklist item |
| `DELETE` | `/:projectId/checklist/:itemId` | Remove a checklist item |
| `POST` | `/:projectId/checklist/:itemId/link` | Link a checklist item to a task |
| `POST` | `/:projectId/checklist/:itemId/promote` | Promote a checklist item to a task |
| `POST` | `/:projectId/assets` | Attach an asset |
| `DELETE` | `/:projectId/assets/:filename` | Detach an asset |
| `POST` | `/:projectId/ask` | Ask an agent about a project |
| `GET` | `/search` | Search projects |
<!-- /docs:api-routes -->

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents drive projects through MCP exec tools. The full set covers create/update, checklist items, task linking, and asset attachments:

<!-- docs:exec-tools project -->
- `bakin_exec_project_add_item`: Add a new checklist item to a project.
- `bakin_exec_project_ask`: Ask an agent a question about a project. Sends the project context (spec, checklist, assets) along with the message to the agent for brainstorming.
- `bakin_exec_project_attach_asset`: Attach an existing asset to a project by filename. Assets provide additional context (specs, designs, docs) that agents can reference. Only summaries are included in project_get — use asset tools to read full content when needed.
- `bakin_exec_project_create`: Create a new project with title, markdown body, and optional initial checklist items. Returns project ID and generated task item IDs.
- `bakin_exec_project_delete`: Delete a project by ID.
- `bakin_exec_project_detach_asset`: Remove an asset reference from a project by filename. Does not delete the asset itself.
- `bakin_exec_project_get`: Get a project by ID including full spec, checklist, progress, and linked board task statuses.
- `bakin_exec_project_link_item`: Link an existing board task to a project checklist item. Use this when a task was created separately and should be associated with a project.
- `bakin_exec_project_list`: List all projects with optional status filter. Returns summaries with id, title, status, progress, taskCount.
- `bakin_exec_project_mark_item`: Mark a checklist item as checked (done) or unchecked. Returns updated progress percentage.
- `bakin_exec_project_promote_item`: Create a NEW board task from a project checklist item and automatically link it. The task appears on the task board with the item title and projectId set.
- `bakin_exec_project_remove_item`: Remove a checklist item from a project.
- `bakin_exec_project_toggle_item`: Toggle a checklist item checked/unchecked by item ID. Returns updated progress percentage.
- `bakin_exec_project_update`: Update a project's title, status, body, or owner. Cannot set status to "completed" if unchecked items remain.
- `bakin_exec_project_update_item`: Update a checklist item's title and/or description.
<!-- /docs:exec-tools -->

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Tasks](/docs/using/tasks/): executable work; projects link to and promote from here
- [Assets](/docs/using/assets/): files attached to projects
- [Workflows](/docs/using/workflows/): multi-step recipes that can be applied to project tasks

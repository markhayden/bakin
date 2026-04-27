---
title: Projects
description: "Markdown spec docs with checklists that can link to real tasks and attach assets. Durable context for multi-task work."
---

A project is a markdown document with a checklist that can link to real tasks. Use it when a single task is too small to hold the full picture, or when several tasks roll up to one outcome. Tasks are for executable work; projects are for the context around it.

## The projects view

<figure class="screenshot-frame">
  <figcaption>The projects grid with status tabs (All / Draft / Active / Completed / Archived) and search.</figcaption>
</figure>

Card grid sorted by status. Each card shows title, owner, progress, and last update. Click into the detail view for the full spec.

## The detail view

<figure class="screenshot-frame">
  <figcaption>Project detail: spec body on top, checklist with task links and asset attachments below, brainstorm panel on the right.</figcaption>
</figure>

Three blocks: the markdown spec body, the checklist (items can be plain or linked to a task), and the asset attachments. A brainstorm panel sits on the side for working with an agent on the project.

## Common actions

### Create a project

`+ New Project` opens an editor. Title, status, owner, progress, plus a free-form markdown body. The checklist and assets sections appear once saved.

### Manage checklist items

Three ways an item exists:

- **Plain** — a checkbox you toggle yourself.
- **Linked to a task** — auto-checks when the underlying task hits Done.
- **Promoted from a checklist** — a former plain item turned into a real task in one click. The item then becomes "linked."

### Attach assets

Pull anything from the [Assets](/docs/using/assets/) library into the project. Detach when no longer relevant.

### Filter and search

Status tabs filter the grid; search runs full-text across project bodies and titles.

## Concepts

- **Projects are markdown files with a checklist sidecar.** Each project is one file. Edit the spec freely; the checklist and assets sections are structured but live inside the same document.
- **Checklist items can shadow real tasks.** Linked items mirror task state, so a project's progress reflects what's actually shipped.
- **Promote, don't duplicate.** Turning a checklist item into a task creates the task and rewires the link automatically — the item doesn't get duplicated as a separate task.

## Where they live

```
~/.bakin/projects/
  <project-id>.md      # frontmatter + spec body + Checklist + Assets sections
```

Projects index into search (table `bakin_projects`) on `title` and `body`, faceted by `status`, with semantic chunking enabled for long specs.

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

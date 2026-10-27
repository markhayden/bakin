---
title: Projects
description: "Markdown spec docs with checklists that can link to real tasks and attach assets. Durable context for multi-task work."
---

Some work needs more than a task can hold. A project is a conversation with a lead agent that turns a rough idea into a plan, steps that run on the [board](/docs/using/tasks/), and the files the work produced. Tasks ship; projects orchestrate.

## Starting a project

Hit `New project` and Bakin asks one thing: what kind of project is on your mind? Pick a starter ("Clean up my email", "Plan a trip", …) or just type. A rough idea is enough. Choose a lead agent beside the box if you don't want your main agent on it.

Nothing exists until you send. Your first message creates the project and starts the conversation, and the lead names the project once it understands it. If the send fails, your text comes back so you can retry, and a retry never makes a second project.

## Shaping it with the lead

A new project opens on its **Conversation** tab. The lead plays brainstorm buddy: a short reflection on what you said, at most one challenge, and one question at a time as a card with options and a recommendation. Pick an option, write your own, or say you're not sure. Once the goal, the scope and what "done" means are settled, the lead drafts the plan and its steps and tells you it's ready in the Plan tab. Say "just write it" and it drafts right away.

When you're ready, **Start project**. That's a hand-off: the lead takes it from there, sends steps to the [board](/docs/using/tasks/), gives each to the right agent or keeps it, and checks in as work moves. With no steps yet, its first check-in breaks the plan down. A finished project gets **Mark complete**; you can reopen or archive it later. Status only changes because you said so. Agents can't start, complete or archive a project, can't rename one you named yourself, and can't delete steps or projects.

## Check-ins

Once a project is active, the lead looks in when something changed: a task got blocked, a review sat idle for a day, work finished, steps are waiting with nothing in flight, or nothing has moved at all. Progressing work and a situation it already handled create nothing. A quick scan runs every 15 minutes, and within about 30 seconds when a task reaches done, blocked or review. It costs no model call; only a real change creates a check-in.

A check-in is an ordinary board task ("Check in: Launch site", tagged `project-steward`), so budgets, the watchdog and spend reporting cover it like any task. A models tag route on `project-steward` can send check-ins to a cheaper model. There's at most one open per project and at most six a day. Past that, the list says "Check-ins paused for today".

On its own, the lead may send steps to the board, add steps that follow from the agreed plan, make small plan edits, and reassign or re-describe stuck work. Each check-in ends with a "Checked in: …" note in the conversation. Anything bigger comes to you:

- **A question** shows up as a card in the conversation, and the list says "Waiting for you". Check-ins pause until you answer.
- **A sign-off** (a deliverable, or completing the project) is a Bakin approval. Decide it from the "Needs approval" card on the board. Approving completion completes the project; rejecting sends your reason back to the lead and the work carries on. Agents can never decide one.

**Pause check-ins** (in the ⋯ menu) stops the loop without changing the status; the list shows "Paused". Completing or archiving a project closes its open check-in and any pending sign-offs. Settings → Projects tunes the scan interval, the stuck window and the daily cap.

## The project page

Four tabs, and the conversation follows you between them:

- **Conversation:** the full thread.
- **Plan:** the markdown plan. `Edit plan` edits it in place; History shows every earlier version with a diff and one-click restore. When the lead changes the plan, the tab gets a dot and the conversation shows "Plan updated · Review changes", compared against the version you last looked at.
- **Steps:** the checklist, with progress. `Send to board` turns a step into a real task; from then on the step says what the task is doing ("In progress · Roscoe") and checks itself when the task is done (and unchecks if it's reopened).
- **Files:** what the project's tasks produced, plus anything you attached from the [Assets](/docs/using/assets/) library or with the paperclip in the conversation.

On a wide screen the conversation docks beside Plan, Steps and Files; collapse it to a slim strip when you want the room. On a phone, the `Ask` button takes you back to the conversation.

The list shows each project's one most useful signal: needs approval, waiting for you, stuck, the lead is working, a new reply, the plan changed, check-ins paused for today, or how many steps are done. A project whose check-ins you paused carries a "Paused" badge. Archived projects stay out of the way until you filter for them.

## Where they live

```
~/.bakin/plugin-data/projects/projects/
  <project-id>.md                  # frontmatter + plan body
  <project-id>.brainstorm.json     # the conversation
  <project-id>.history.json        # earlier plan versions
```

Projects index into search (table `bakin_projects`) on `title` and `body`, faceted by `status`, with semantic chunking enabled for long plans.

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

<!-- docs:cli-commands projects -->
| Command | Purpose |
| --- | --- |
| `bakin projects list` | List projects |
| `bakin projects get <projectId>` | Get a project |
| `bakin projects create <title>` | Create a project |
| `bakin projects update <projectId>` | Update a project |
| `bakin projects apply-plan <projectId>` | Apply a confirmed project plan update |
| `bakin projects add-item <projectId> <title>` | Add a checklist item |
| `bakin projects toggle-item <projectId> <itemId> <checked>` | Toggle a checklist item |
| `bakin projects update-item <projectId> <itemId>` | Update a checklist item |
| `bakin projects link-item <projectId> <taskItemId> <taskId>` | Link a checklist item to a task |
| `bakin projects promote-item <projectId> <taskItemId>` | Promote a checklist item to a task |
| `bakin projects attach-asset <projectId> <assetId>` | Attach an asset to a project |
| `bakin projects relink-asset <projectId> <assetId> <newAssetId>` | Relink a project asset reference |
| `bakin projects detach-asset <projectId> <assetId>` | Detach an asset from a project |
| `bakin projects ask <projectId> <message>` | Ask an agent about a project |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/).

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#projects).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents work on projects through MCP exec tools: reading projects, updating the plan and its steps (`bakin_exec_projects_apply_plan`), task linking and asset attachments. In a project conversation the lead asks questions with `bakin_exec_ask_user`. A check-in task reports with `bakin_exec_projects_checkin`, asks with `bakin_exec_projects_request_input`, and asks for a sign-off with `bakin_exec_projects_request_signoff`; each takes the check-in's `taskId` and is refused for anyone but that check-in's assignee. Lifecycle status, a title the user typed, and deleting steps or projects stay with the user.



Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Tasks](/docs/using/tasks/): executable work; projects link to and promote from here
- [Assets](/docs/using/assets/): files attached to projects
- [Workflows](/docs/using/workflows/): multi-step recipes that can be applied to project tasks

---
title: Messaging
description: "Plan with agents, schedule on a calendar, publish to your channels. One pipeline from idea to delivered."
---

Time to get creative. Sit down with any of your agents and pound out bad ass content that connects with your audience: social posts, outreach, internal updates, all of it. You build the plan together: what to post, when, who runs it. Approve and the rest is automatic. Items become scheduled tasks, your agent army picks them up, content gets made and shipped to your channels.

## Calendar

<figure class="screenshot-frame">
  <figcaption>The content calendar in week view, with status, agent, type, and channel filters above.</figcaption>
</figure>

The canonical schedule. Three views from the header pill: `Month`, `Week`, `List`. Filters above the grid: agent, status, type, channel, plus search across title, brief, draft caption, and agent notes. Click any item to open the detail drawer with the full record and any draft media rendered inline.

Items in the calendar are color-coded by status; cells get a subtle tint of the assigned agent's color so a single glance shows who's on what. Today gets an accent ring.

### Item lifecycle

Items move through seven statuses:

<div class="table-light-fit table-label">

| Status | What it means |
| --- | --- |
| `draft` | Captured but not approved |
| `scheduled` | Approved and queued |
| `executing` | A workflow is running on it |
| `waiting` | Workflow paused (e.g., waiting on agent-generated media) |
| `review` | Work done, your sign-off needed before publish |
| `published` | Sent to the channel |
| `failed` | Something broke |

</div>

Approval flow: drafts approve to `scheduled`; review items approve to `published` (or reject back to `draft` with an optional note for the agent). Everything else is workflow-driven.

### What's on an item

<figure class="screenshot-frame">
  <figcaption>The item detail drawer showing fields, draft media, and the back-link to the originating brainstorm session.</figcaption>
</figure>

Each calendar item carries title, brief (what to say), tone (how to say it), scheduled date, owning agent, content type, and one or more channels. Once a workflow runs on it, a `draft` block fills in: caption, image prompt, video prompt, generated image filename, generated video filename, agent notes. Items also back-link to the brainstorm session that created them and the workflow task driving execution.

### Calendar Management

- `Create` an item from `+ New Item` with title, agent, scheduled date, and content type.
- `Approve` drafts to schedule them; approve review items to publish.
- `Reject` review items back to draft with an optional note.
- `Edit` any field inline from the detail drawer.
- `Delete` drafts that aren't going anywhere.

## Brainstorm

<figure class="screenshot-frame">
  <figcaption>A brainstorm session: chat thread on the left, proposal cards in the review panel on the right.</figcaption>
</figure>

Where the work starts. Open the brainstorm view, hit `New Session`, pick an agent. Name the session something you'll recognize ("Q4 launch posts", "weekly newsletter") and start the conversation. Talk through goals, audience, voice, what's on your mind. As ideas come together, the agent drops specific suggestions into the side panel: concrete items with title, date, content type, and brief.

### How it works

1. You and an agent open a brainstorm session.
2. The agent floats proposals as you work through the strategy.
3. You approve the keepers, edit the ones close to right, reject what misses.
4. Confirm the session. Approved proposals become calendar items.
5. Each item moves through draft, scheduled, executing, review, and published as it gets made.
6. When an item hits published, your channels deliver the content.

Every calendar item links back to the session it came from. You can always trace a published post to the conversation behind it.

### Session continuity and tool activity

Brainstorm sessions are durable. When you leave a session and come back, Bakin reloads the stored user, assistant, and tool-activity timeline from the session file. New messages also reuse the same adapter-neutral runtime thread key for that session and agent, so the active runtime adapter can continue the same underlying conversation instead of starting over.

Tool calls and runtime status updates stream into the chat while the agent is working. They render in the same assistant-style thread with compact summaries and expandable details. Those activity rows are persisted with the session so the "what happened behind the scenes" trail is still there after reload. Search indexes user/assistant planning text and proposal summaries, not raw tool output.

### What are proposals?

<figure class="screenshot-frame">
  <figcaption>A proposal card with title, scheduled date, content type, brief, and inline approve/reject/edit controls.</figcaption>
</figure>

Each suggestion the agent floats is a proposal: a complete content idea you can act on. Title, scheduled date, owning agent, content type, channels, brief, tone. Same shape as a calendar item, just not committed yet.

Ask the agent to revise something. Make it punchier, push the date, swap the angle. They update the existing proposal in place instead of starting a new one. Even rejected proposals can come back this way. The revision history stays attached so you can see how an idea evolved.

### Reviewing proposals

For each proposal you can:

- `Approve` to mark it ready for the calendar.
- `Reject` with an optional note so the agent learns what missed and iterates.
- `Edit` to take the wheel and manually tweak title, brief, scheduled date, type, or tone before approving.
- Or just leave it. Staying in `proposed` keeps the proposal on the table.

### Confirming the session plan

<figure class="screenshot-frame">
  <figcaption>The confirm dialog with the auto-approve toggle, summarizing how many proposals will land on the calendar.</figcaption>
</figure>

Once you've got the proposals you want, hit `Confirm`. Approved proposals graduate into calendar items and the session locks. Two modes:

- **Default**: each approved proposal becomes a `draft` calendar item. You approve again on the calendar to schedule it.
- **Auto-approve**: each approved proposal lands as `scheduled` directly.

Confirming flips the session to `completed` and disables further messages. Sessions stay searchable.

## Content types

Five seed by default: `post`, `article`, `video`, `image`, `announcement`. Add or rename in the messaging settings tab. The list drives the type facet on the calendar, the type select in the proposal editor, and the prompt fed to agents during brainstorm sessions.

## Channels

Channels are where published content lands. The registry lives in the [Workflows](/docs/using/workflows/) plugin and ships with Discord, Slack, email, Instagram, Twitter, YouTube, and TikTok by default. Plugins can register more.

Each calendar item picks one or more channels from that registry. Channels show up as a multi-select filter on the calendar and a dropdown in the proposal editor. Or leave channels blank and delegate the delivery decision downstream.

## Where it lives

```
~/.bakin/
  messaging.json                  # flat array of every calendar item
  messaging/
    sessions/<id>.json            # brainstorm messages, activity rows, and proposals
  plugin-settings/
    messaging.json                # content types, default view, etc.
```

Sessions index into search (table `bakin_messaging_brainstorm`) so they reach across-plugin queries. Calendar items filter locally on the page rather than indexing.

## Settings

<!-- docs:settings messaging -->
<div class="settings-table">

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| Default view | `select` | `month` | Default messaging view on page load |
| Show schedule jobs | `boolean` | `false` | Display recurring schedule jobs on the content calendar |
| Channels | `string` | `DEFAULT_CHANNEL` | Comma-separated runtime channel IDs available for distribution (e.g., general,announcements,email) |
| Content types | `list` |  | Categories used across the content calendar and brainstorm proposals. |

</div>
<!-- /docs:settings -->

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

<!-- docs:cli-commands messaging -->
| Command | Purpose |
| --- | --- |
| `bakin messaging list` | List messaging items |
| `bakin messaging get <itemId>` | Get a messaging item |
| `bakin messaging create <title> <agent> <scheduledAt>` | Create a messaging item |
| `bakin messaging update <itemId>` | Update a messaging item |
| `bakin messaging delete <itemId>` | Delete a messaging item |
| `bakin messaging approve <itemId>` | Approve a messaging item |
| `bakin messaging reject <itemId>` | Reject a messaging item |
| `bakin messaging sessions` | List planning sessions |
| `bakin messaging session <sessionId>` | Get a planning session |
| `bakin messaging session-create <agentId>` | Create a planning session |
| `bakin messaging session-update <sessionId>` | Update a planning session |
| `bakin messaging session-delete <sessionId>` | Delete a planning session |
| `bakin messaging message <sessionId> <message>` | Message a planning session |
| `bakin messaging confirm <sessionId>` | Confirm planning-session proposals |
| `bakin messaging proposal <sessionId> <proposalId>` | Update a planning-session proposal |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/).

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#messaging).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents drive both the calendar and brainstorm sessions through MCP exec tools.

<!-- docs:exec-tools messaging -->
- `bakin_exec_messaging_approve`: Approve a messaging item (draft → scheduled, review → published)
- `bakin_exec_messaging_create`: Create a new messaging item
- `bakin_exec_messaging_delete`: Delete a messaging item
- `bakin_exec_messaging_get`: Get details for a single messaging item
- `bakin_exec_messaging_list`: List messaging items with optional filters
- `bakin_exec_messaging_proposal_update`: Update a proposal status or fields (approve, reject, edit)
- `bakin_exec_messaging_reject`: Reject a messaging item back to draft status
- `bakin_exec_messaging_session_confirm`: Confirm a planning session — creates messaging items from approved proposals
- `bakin_exec_messaging_session_create`: Create a new planning session for an agent
- `bakin_exec_messaging_session_delete`: Delete a planning session
- `bakin_exec_messaging_session_get`: Get a planning session with full message history and proposals
- `bakin_exec_messaging_session_list`: List planning sessions with optional filters
- `bakin_exec_messaging_session_message`: Send a message in a planning session (non-streaming, returns full response)
- `bakin_exec_messaging_session_update`: Update a planning session title or status
- `bakin_exec_messaging_update`: Update a messaging item
<!-- /docs:exec-tools -->

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Team](/docs/using/team/): the agents you brainstorm with
- [Workflows](/docs/using/workflows/): the channel registry and the workflows that move items through `executing` and `review`
- [Tasks](/docs/using/tasks/): workflow execution on a calendar item creates a real task
- [Assets](/docs/using/assets/): draft images and videos live here, rendered in the detail drawer via stable filenames

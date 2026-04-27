---
title: Messaging
description: "Content calendar plus a multi-agent brainstorm surface that proposes scheduled posts and routes them through approval."
---

Messaging is two surfaces that work together. The Calendar holds scheduled content (posts, drafts, anything with a date and a channel). Brainstorm is a chat-style room where you and an agent (or several) plan what should land there. Approved proposals graduate from a session into real calendar items.

## Calendar

<figure class="screenshot-frame">
  <figcaption>The content calendar with day list and week grid views, filtered by agent, channel, and status.</figcaption>
</figure>

The calendar is the canonical source of scheduled content. Each item has a title, scheduled date, owning agent, content type, and one or more channels. Filter by agent, status, content type. Search across everything.

### Common actions

- **Create** an item from `+ New Item` with a date, agent, content type, and channels.
- **Approve** or **reject** items that came in via a brainstorm proposal — rejection captures a note for context.
- **Edit** any field inline; **delete** when the item should not ship.

## Brainstorm

<figure class="screenshot-frame">
  <figcaption>A brainstorm session: chat thread with the assigned agent, proposal cards, and a confirm-to-calendar action.</figcaption>
</figure>

A planning session is a stateful chat with one or more agents. The agent proposes content; you review and confirm proposals into the calendar.

### Common actions

- **Start a session** with an agent — usually scoped to a campaign or theme.
- **Send messages** back and forth; the agent emits proposals as it works.
- **Confirm a proposal** to promote it into a calendar item with everything filled in.
- **Reject** with a note so the agent learns what missed.

## Concepts

- **Calendar items, sessions, and proposals are three distinct shapes.** Calendar items are the canonical scheduled content. Sessions are stateful conversations. Proposals are a session's outputs that become calendar items only after confirmation.
- **Content types are configurable.** Defaults seed on first activate; add more in the messaging settings tab.
- **Channels** are the delivery surfaces (Slack, Discord, email, etc.) registered by the workflows plugin.

## Where it lives

```
~/.bakin/messaging.json              # array of all calendar items
~/.bakin/messaging/sessions/*.json   # one file per planning session
```

Sessions index into search (table `bakin_messaging_brainstorm`) for cross-table lookup. Calendar items filter locally rather than indexing.

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

<!-- docs:cli-commands messaging -->
| Command | Purpose |
| --- | --- |
| `bakin messaging <list\|get\|create\|update\|delete\|approve\|reject\|sessions\|session\|session-create\|session-update\|session-delete\|message\|confirm\|proposal> ...` | Manage messaging items and planning sessions. |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents drive messaging through MCP exec tools. The full set covers calendar items, sessions, messages, and proposals:

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

- [Team](/docs/using/team/): the agents that own and propose
- [Schedule](/docs/using/schedule/): for recurring content items
- [Assets](/docs/using/assets/): images and video attached to drafts render via the assets plugin

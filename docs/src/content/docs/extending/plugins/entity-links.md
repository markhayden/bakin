---
title: Entity Links, Cards and Hand-off
description: Declare the things your plugin owns so Bakin can link to them, show a card when an agent creates one, and carry a chat into its conversation.
---

Your plugin owns things with pages: a project, a session, a record. Declare each kind once, in the manifest, and Bakin does three jobs for you:

- **Links.** Every link to one is built from your declaration.
- **Cards.** When an agent's tool call creates or changes one, the reply shows a card linking to it.
- **Hand-off.** When a chat reply creates one that has its own conversation, the chat's history is carried there and the person follows it.

## Declare a kind

```json
{
  "id": "notes",
  "contributes": {
    "entities": [
      { "kind": "note", "label": "Note", "icon": "StickyNote", "href": "/notes/{id}" }
    ]
  }
}
```

| Field | Meaning |
| --- | --- |
| `kind` | Lowercase slug, unique in your plugin. The public id is `<pluginId>:<kind>`, here `notes:note`. |
| `label` | Singular display name, shown on cards. |
| `icon` | A Lucide icon name. |
| `href` | An in-app path. `{id}` is the entity id. Any other `{name}` is filled from the reference's `params`. Every value is URL-encoded. |
| `handoff` | `true` when the kind has a conversation that can receive a chat's history. |

The path must start with a single `/`. A kind is available while your plugin is loaded; if the plugin is removed, links to it stop resolving and existing cards render as plain text.

## Link to an entity

Never write the URL by hand. Ask for it by kind:

```ts
import { entityHref, PluginLink } from '@makinbakin/sdk/navigation'

const href = entityHref('notes:note', note.id)                        // "/notes/abc"
const tab = entityHref('team:agent', 'pixel', { query: { tab: 'diagnostics' } })
const doc = entityHref('brands:doc', id, { params: { brandId, kind, name } })

return href ? <PluginLink to={href}>{note.title}</PluginLink> : note.title
```

`entityHref` returns `null` when no loaded plugin declares the kind, or when the route needs a value you did not pass. Render no link, or fall back to a list page (`entityHref(...) ?? '/notes'`). Core kinds you can link to: `tasks:task`, `assets:asset`, `schedule:job`, `workflows:workflow`, `brands:brand`, `brands:doc`, `chat:chat`, `team:agent`.

## Show a card when a tool creates or changes something

Two parts: say in the manifest which kinds a tool may report, and return them from the handler.

```json
{
  "contributes": {
    "execTools": [
      { "name": "bakin_exec_notes_create", "summary": "Create a note", "reports": ["notes:note"] }
    ]
  }
}
```

```ts
ctx.registerExecTool({
  name: 'bakin_exec_notes_create',
  description: 'Create a note',
  parameters: { title: z.string() },
  handler: async ({ title }) => {
    const note = await createNote(title)
    return {
      ok: true,
      id: note.id,
      entities: [{ kind: 'notes:note', id: note.id, title: note.title, action: 'created' }],
    }
  },
})
```

- `action` is `'created'` or `'updated'`. Report from tools that create or edit. Tools that only read report nothing.
- `title` is a snapshot. The card shows it as it was; Bakin does not look it up again.
- For a route with more than `{id}`, add `params` with the other values.
- Bakin removes `entities` from what the agent reads, and shows one card per thing per reply.

**What a tool may report.** Its own plugin's kinds, or kinds owned by a plugin listed in your manifest's `dependencies`. Anything else is refused:

- at install and upgrade, when the manifest lists a kind you neither declare nor depend on;
- at activation, when a dependency does not actually declare the kind;
- on each call, when a handler returns a kind its manifest entry does not list. That reference is dropped and recorded in the audit log as `exec.entities.rejected`.

## Accept a chat hand-off

If a kind has its own conversation, mark it `"handoff": true` and register an acceptor in `activate()`. When a chat reply creates one, Bakin calls the acceptor with the chat's history.

```ts
import { handoffPreamble, writeHandoffBatch } from '@makinbakin/sdk/utils'

const turns = ctx.conversations.createTurnService({
  // ...
  appendRow: (key, row) => store.append(key, [row]),
  // One write for a whole batch: all of the rows land, or none.
  appendRows: (key, rows) => store.append(key, rows),
})

ctx.conversations.acceptHandoff('note', async (request) => {
  const noteId = request.target.id
  if (!store.exists(noteId)) throw new Error(`Note ${noteId} not found`)
  await writeHandoffBatch(turns, ctx, noteId, request, store.rows(noteId))
})
```

The acceptor must:

- throw when the target does not exist;
- write `request.rows` as one atomic batch, and finish only once it is saved, even when the target has a turn running;
- accept each `request.handoffId` once. A repeat does nothing.

`writeHandoffBatch` covers the last two, given a turn service with `appendRows`.

**What arrives.** `request.rows` starts with a marker row, `{ kind: 'handoff', direction: 'in', peers, carried }`, followed by `carried` rows of the chat's history, oldest first. Store them exactly as given: the conversation kit renders the marker as a "Carried over from the chat …" divider and the rest as ordinary turns. If your store has a row limit, keep the marker first, keep the most recent rows, and correct `carried` to match.

**Give the agent the history.** The receiving agent has a fresh session. Add the carried history to its next turn:

```ts
const carriedOver = handoffPreamble(store.rows(noteId), agentId)
await turns.start(ctx, noteId, message, {
  runtimeContent: carriedOver ? `${carriedOver}\n\n${context}` : context,
})
```

`handoffPreamble` returns the history until that agent has replied in your conversation, then `null`. It works from the stored rows, so a turn that failed before the agent replied gets the history again on retry.

**What the person sees.** The reply in the chat shows the card and a "continued here" marker. If the reply created exactly one such thing, the open chat moves to it. The original chat stays usable; later messages there are not carried. Nothing runs automatically when they arrive.

## Test it

Pass your manifest to the test harness. It checks the manifest the way install does, and fails a tool call that reports a kind its entry does not list.

```ts
import { activatePlugin, callTool, findTool } from '@makinbakin/sdk/testing'
import manifest from '../bakin-plugin.json'

const harness = await activatePlugin(plugin, { manifest })
const result = await callTool(findTool(harness.execTools, 'bakin_exec_notes_create')!, { title: 'Groceries' })
expect(result.entities).toEqual([{ kind: 'notes:note', id: result.id, title: 'Groceries', action: 'created' }])

// Hand a chat's history to your acceptor, as Bakin does.
await harness.handoffs.deliver({
  handoffId: 'chat-1:turn-1:note-1',
  target: { kind: 'notes:note', id: 'note-1' },
  source: { entity: 'chat:chat', id: 'chat-1', title: 'Morning chat' },
  carried: [{ kind: 'user', ts: new Date().toISOString(), content: 'start a note about the launch' }],
})
```

## Version requirement

Entity kinds, tool `reports` and `acceptHandoff` need Bakin `0.0.1-rc.50` or later. Older releases ignore the manifest fields and have no `acceptHandoff`, so raise your manifest's `bakin` range when you adopt them.

# Spec: Conversation entity links and hand-off

Status: DRAFT — awaiting approval. No code written.
Repos: `bakin` (core, SDK, chat, core plugins) and `bakin-bits-official` (Projects, Messaging).

## Objective

Two gaps make agent conversations feel disconnected from the things they produce:

1. **Nothing in a thread links to what the agent made.** A created task, project, asset or
   scheduled job is visible only as a collapsed tool row with no id and no link.
2. **A chat that turns into a project strands the user.** `bakin_exec_projects_create` writes a
   bare draft; the user is not taken to it and its Conversation tab is empty.

We are building:

- **Entity cards** — every thing an agent creates or changes in a conversation shows as a
  clickable card in the agent's turn, on every conversation surface (chat, project and Messaging
  brainstorms, brand doc brainstorms).
- **Hand-off** — when a general chat creates something that owns its own conversation, the chat
  history is carried into that conversation and the user is taken there.
- **One entity-link registry** — plugins declare their linkable kinds once; every link in the
  product resolves through it.

The user is the single operator of this install. Success is: starting to plan in chat ends with
the user inside the project, with the conversation intact and the agent remembering it, and
every created thing one click away.

## Decisions (from the interview)

| # | Decision |
|---|---|
| D1 | Hand-off model: history is carried into the target's conversation, the user is redirected, the chat keeps a "Continued in …" card. |
| D2 | The original chat stays open and usable. Later chat messages are not seen by the target. |
| D3 | Carry scope: the whole chat, verbatim, up to the target's 300-row cap (most recent kept), with a link back to the chat. |
| D4 | Redirect: automatic when the creating turn ends, only if that chat is on screen. Otherwise the card and the normal reply notification lead there. |
| D5 | Links render as cards in the agent's reply at the point of creation, produced by Bakin from the tool call, not by the agent's prose. Prose links are also fixed to navigate in-app. |
| D6 | Cards appear for created and changed things, one per thing per reply, labelled Created / Updated. Reads get no card. |
| D7 | One entity-link registry, and every existing hand-built entity link is migrated to it in this work. |
| D8 | Linkable kinds are declared in the plugin manifest. Enforced at install (schema), activation (a tool reporting an undeclared kind fails), and by the official Bits release guard. |
| D9 | Hand-off adopters: Projects (project) and Messaging (brainstorm session). Messaging plans and deliverables get cards only. Brands gets cards only. |
| D10 | Card titles are snapshots taken at creation. No live lookups. |
| D11 | Several targets from one chat: each receives the history as it stood; redirect only when a reply created exactly one. |
| D12 | On arrival nothing runs automatically. The user's next message goes to the target's agent session, primed with the carried history. |
| D13 | No new Home starter. Discord replies are out of scope. |

## Assumptions (correct these before approval)

1. Carried user attachments are not copied. Chat attachment files belong to the chat and are
   deleted with it; a carried row that had attachments shows a note pointing at the original chat.
2. The carried history is shown under a divider ("Carried over from chat", linking back), not
   mixed indistinguishably with native rows.
3. An image asset the agent already embeds inline in its reply does not also get a card.
4. Priming is one-time: the target's first turn after hand-off receives the carried history
   (byte-budgeted, with a visible omission marker when cut). After that the target's own runtime
   thread holds the context.
5. A project created from chat becomes a proper draft, equivalent to one from the Projects start
   screen (brief skeleton present), not today's empty shell.
6. Existing transcripts are not backfilled. Cards appear for turns recorded after this ships.
7. Task dispatch runs (non-conversation surfaces) are unchanged.
8. The spec lives here in `.claude/specs/` (repo convention) rather than a root `SPEC.md`.

## Design

### Entity declaration (manifest)

`bakin-plugin.json` gains `contributes.entities[]`:

```json
{ "kind": "project", "label": "Project", "icon": "FolderKanban",
  "href": "/projects/{id}", "handoff": true }
```

- `kind` is namespaced by the declaring plugin; the public identity is `<pluginId>:<kind>`.
- `href` is a template over `{id}` only. Path or query form both allowed
  (`/tasks?taskId={id}`).
- `handoff: true` states the kind owns a conversation and accepts a hand-off.
- Core plugins declare theirs the same way: task, asset, schedule job, workflow, brand, brand
  doc, chat, agent.

### Tool reporting

`ExecToolResult` gains a typed optional field:

```ts
interface EntityRef {
  kind: string            // declared by the reporting tool's own plugin
  id: string
  title: string           // snapshot (D10)
  action: 'created' | 'updated'
}
entities?: EntityRef[]
```

Tools declare the kinds they may report in the manifest's tool entries
(`reports: ['projects:project']`) so activation and the release guard can validate them
(D8). A plugin can report its own kinds, or kinds owned by a plugin it declares as a
dependency (approved 2026-11-14: Images creates assets, Workflows updates tasks).

### From tool result to card

The turn engine attaches reported entities to the tool row as `metadata.bakinEntities`,
generalising the existing `metadata.bakinQuestion` enrichment (currently hard-coded to
`bakin_exec_ask_user`) into one enrichment step. Both the live event and the persisted row carry
it. `foldConversation` derives a new `TurnItem` of type `entities`; `AgentTurn` renders the kit's
card component, resolving href/icon/label through the registry. Cards are deduped per entity per
turn; `created` wins over `updated`.

### Registry and link migration

- Server: built from manifests at plugin load; served on `/api/plugins/manifest`.
- Browser: `@makinbakin/sdk/navigation` exports `entityHref(kind, id)` and an `EntityLink`
  component built on `PluginLink`.
- Every hand-built entity href is replaced (Home activity, health incidents and resources,
  brands, approvals attention, scheduled-event deep links, search hit renderers). An
  architecture test bans new literal entity hrefs outside the declaring manifest.
- `MarkdownContent` in conversation surfaces is given `renderInternalLink`, so agent-written
  internal links navigate in-app.

### Hand-off contract

- A plugin whose kind has `handoff: true` registers an acceptor through `ctx.conversations`.
  The acceptor receives `{ entityId, rows, source: { kind: 'chat', id, title } }`, writes the
  rows into its own transcript, and records that priming is pending.
- Chat owns the trigger. When a chat turn settles and its rows report a `created` entity of a
  hand-off kind, chat invokes the acceptor once per entity with the transcript as it stands,
  then persists a hand-off row in the chat and emits `chat.handoff { chatId, targets[] }`.
- The chat client redirects when the event names exactly one target and that chat is on screen
  (D4, D11).
- A shared core helper builds the bounded "carried history" preamble for the target's first
  turn, so Projects and Messaging do not each write their own.
- Failure is visible and non-destructive: if an acceptor fails, the chat shows the card without
  the "Continued in" state, no redirect happens, and the failure is audited.

## Tech Stack

Unchanged: Bun 1.4.3, TypeScript strict, React 19, TanStack Router, zod at boundaries. No new
dependencies.

## Commands

```
Typecheck:        bun run typecheck
Lint:             bun run lint
Tests (local):    bun run test
One file:         bun test tests/path/to/foo.test.ts --isolate
UI conformance:   bun run ui:conformance --quick      (full mode before merge)
Stories:          bun run ui:test:stories
Full build:       bun run build
Plugin contract:  bun scripts/check-plugin-contract.ts
```

## Project Structure

```
packages/sdk/src/types/            EntityRef, manifest entity declaration, ExecToolResult.entities
packages/sdk/src/navigation/       entityHref, EntityLink
packages/core/src/conversation/    generic tool-row enrichment, hand-off acceptor API, carried-history preamble
packages/ui/src/conversation/      fold `entities` item, entity card, carried-history divider
src/core/exec-tools/               reported-kind validation, result capture
src/core/plugins/ (manifest check) contributes.entities schema + activation validation
plugins/chat/                      hand-off trigger, hand-off row, redirect, internal-link rendering
plugins/{tasks,assets,images,schedule,workflows,brands,team}/   declarations + tool reporting
plugins/{home,health,brands,…}/    link migration
scripts/check-plugin-contract.ts   publish guard
bakin-bits-official/plugins/projects    declaration, reporting, acceptor, proper draft on create
bakin-bits-official/plugins/messaging   declaration, reporting, session acceptor
tests/                             unit, plugin, architecture, conformance
.claude/knowledge/                 conversation-kit, chat-plugin, plugin-system, url-state-deep-linking, home
docs/src/content/docs/extending/plugins/   plugin-author documentation for entities + hand-off
```

## Code Style

Repo conventions apply (CLAUDE.md): zod at boundaries, pure functions, `createLogger`, no empty
catch, kebab-case files. Illustrative shape:

```ts
export const entityRefSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  action: z.enum(['created', 'updated']),
})
export type EntityRef = z.infer<typeof entityRefSchema>

export function entityHref(decl: EntityDeclaration, id: string): string {
  return decl.href.replace('{id}', encodeURIComponent(id))
}
```

UI work follows `.claude/skills/bakin-ui-conformance/SKILL.md`: the card and divider are kit
components with a `CanonicalUsage` story; any pattern deviation is raised for approval first.

## Testing Strategy

- **Unit:** manifest schema; href templating; enrichment (attach, dedupe, created-over-updated);
  fold to `entities` item; carried-history preamble budget and omission marker.
- **Plugin tests** (`tests/plugins/test-helpers.ts`): each creating/changing tool reports the
  right refs; activation rejects an undeclared kind; chat hand-off trigger (one target, several
  targets, acceptor failure, no hand-off kinds).
- **Conversation engine:** enrichment reaches both the emitted event and the persisted row on the
  mock runtime, Pi and the OpenClaw mock.
- **RTL / stories:** card rendering and in-app navigation; divider; redirect only when the chat
  is on screen; prose internal link does not reload.
- **Architecture:** no literal entity hrefs outside manifests; no-hard-navigation list updated.
- **Bits:** Projects and Messaging acceptors, row normalisation of carried rows, priming on the
  first turn only.
- **End to end** (`/verify`, isolated home): chat → create project → card, hand-off row, project
  transcript populated.
- All tests follow the content-dir / OpenClaw-home mocking rules and act discipline.

## Boundaries

- **Always:** resolve links through the registry; go through hooks/`ctx.conversations` between
  plugins; keep runtime specifics inside adapters; update knowledge docs with each change.
- **Ask first:** any UI pattern deviation; perf-ceiling increases beyond a few attributed KB;
  changing the SDK contract family (it gates official Bits publishing); adding a brand-creation
  tool or a brand-level conversation.
- **Never:** classify by tool-result message text; have core name an external plugin; write
  compatibility shims for old transcripts or old link helpers; touch `~/.bakin`, `~/.pi` or
  `~/.openclaw` in tests; auto-run an agent turn on hand-off.

## Success Criteria

1. In a chat, asking the agent to create a task, project, asset, scheduled job or Messaging
   session yields a card in that reply; clicking it opens the thing with no page reload.
2. Changing an existing thing yields an "Updated" card; reading one yields none.
3. A chat that creates one project: when the reply ends and the chat is on screen, the browser
   lands on the project, whose Conversation tab shows the chat history under a divider linking
   back.
4. The next message sent in that project is answered with knowledge of the chat (verified by a
   fact stated only in the chat).
5. The original chat shows "Continued in <project>" and still accepts messages.
6. A reply that creates two projects redirects nowhere and shows two cards; both projects hold
   the history.
7. A Messaging brainstorm session created from chat behaves as criterion 3–5; a plan created
   directly gets a card and no redirect.
8. A plugin whose tool reports an undeclared kind fails activation with a named error; the Bits
   release guard refuses to publish it.
9. No literal entity href remains outside manifests (architecture test green).
10. An internal link written by the agent in prose navigates in-app.
11. `bun run test`, `bun run lint`, `bun run typecheck` and `bun run ui:conformance` pass in
    `bakin`; the Bits suites pass against the new SDK.

## Open Questions (for the plan phase)

1. **Correlating a tool result with its tool row.** Tool handlers do not receive the runtime's
   tool-call id (Pi's bridge discards it; OpenClaw reaches tools over MCP with no id), and the
   persisted row on Pi holds only a one-line summary. The plan must pick the correlation
   mechanism and prove it on both runtimes, including the same agent running in two chats at
   once. This is the main technical risk.
2. **Cross-repo sequencing.** SDK contract first, then Bits adoption, then the Bits pin bump in
   `bakin`. The plan's commit strategy must keep both repos green at each checkpoint.
3. **Messaging row mapping.** Messaging stores its own message shape, not conversation rows; the
   acceptor needs a defined mapping for carried rows and an `appended` event it lacks today.
4. **Stale docs found on the way:** CLAUDE.md's description of how Bits brainstorms reach the
   turn engine, and a `/projects/[id]/edit` route listed in `url-state-deep-linking.md` that
   does not exist. Fix alongside.

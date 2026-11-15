# Entity links

One declaration per linkable thing. A plugin says, in its manifest, which
kinds of thing it owns and where each lives; Bakin builds every link to them
from that declaration. Spec: `.claude/specs/conversation-entity-links-and-handoff.md`
(plan beside it).

## Declaring a kind

`bakin-plugin.json`:

```json
"contributes": {
  "entities": [
    { "kind": "project", "label": "Project", "icon": "FolderKanban", "href": "/projects/{id}", "handoff": true }
  ],
  "execTools": [
    { "name": "bakin_exec_projects_create", "summary": "Create a project", "reports": ["projects:project"] }
  ]
}
```

- **Identity** is `<pluginId>:<kind>` (`projects:project`). `kind` is a
  lowercase slug, unique within the plugin.
- **`href`** is an in-app path template: one leading `/`, placeholders written
  `{name}`. `{id}` is the entity id; any other placeholder is filled from the
  reference's `params` (`/brands/{brandId}/docs/{kind}/{name}`). Every value is
  URL-encoded, so an id can never add a segment, a parameter or a fragment.
- **`icon`** is a Lucide icon name. **`handoff`** marks a kind that owns a
  conversation able to accept a chat hand-off.
- Parsed by `packages/core/src/plugins/manifest.ts` (`parseEntity`); types in
  `packages/sdk/src/types/manifest.ts` (`EntityContribution`). Both fields are
  optional, so older manifests still parse; older hosts ignore them.

Core kinds (pinned by `tests/plugins/core-entity-declarations.test.ts`):
`tasks:task`, `assets:asset`, `schedule:job`, `workflows:workflow`,
`brands:brand`, `brands:doc`, `chat:chat`, `team:agent`.

## Registries

| Where | Module | Filled by |
|---|---|---|
| Server | `packages/core/src/plugins/entity-registry.ts` (`getEntityRegistry`) | `pluginRegistry.publishEntities`, after a plugin activates |
| Browser | `packages/sdk/src/navigation/entities.ts` | `PluginHost.applyManifestMetadata`, from `/api/plugins/manifest` |

- The server registry is swept with the plugin's other registrations
  (`sweepPluginRegistrations`, `deactivatePlugin`): a failed, disabled, removed
  or reloading plugin leaves no kind behind.
- **Hot reload re-reads `bakin-plugin.json`** (`reload-pipeline.ts`, step 0)
  and re-validates it. An invalid manifest fails the reload (`failedAt:
  'manifest'`) before anything is torn down.
- The browser registry is replaced whole on every manifest refresh, from
  loadable plugins only.

## Resolving a link

`entityHref(kind, id, params?)` — `@makinbakin/sdk/navigation` in the browser,
`@bakin/core/plugins/entity-registry` on the server. Both fill the declared
template through the one pure function `fillEntityHref`
(`packages/core/src/plugins/entity-href.ts`). The result is `null` when the
kind is not declared by a loaded plugin or a placeholder has no value: render
no link. Never build an entity URL by hand.

## Reporting from a tool

A tool reports what it created or changed on its result:

```ts
return { ok: true, id, entities: [{ kind: 'projects:project', id, title, action: 'created' }] }
```

- `EntityRef` (`packages/sdk/src/types/registration.ts`):
  `{ kind, id, title, action: 'created' | 'updated', params? }`. `title` is a
  snapshot; nothing looks it up again.
- **Who may report what.** A tool may report its own plugin's declared kinds,
  or kinds owned by a plugin listed in `dependencies` (Images reports
  `assets:asset`). Enforced in three places:
  1. the manifest parser (install, upgrade, boot, the release guard) — an own
     kind must be in `contributes.entities`, another plugin's kind needs that
     plugin in `dependencies`;
  2. activation (`resolveToolReports` in `src/core/plugin-registry.ts`) — a
     dependency's kind must actually be declared, or the plugin fails to
     activate;
  3. each call (`sealExecToolResult`, `src/core/exec-tools/seal.ts`) — a
     malformed reference, or a kind outside the tool's `reports`, is dropped,
     logged and audited as `exec.entities.rejected`. It is never rendered.
- Bounds: 50 references per result, titles clipped at 200 characters
  (`ENTITY_REF_LIMITS`).
- Accepted references ride a host tool receipt (see `conversation-kit.md`,
  "Tool receipts"); `entities` is removed from what the agent reads, and the
  turn engine attaches them to the tool row as `metadata.bakinEntities`.
- **Testing.** `@makinbakin/sdk/testing` takes `{ manifest }` on
  `activatePlugin` / `createTestContext`, validates it as install does, and
  `callTool` throws when a tool reports a kind its entry does not list.

## Cards in a conversation

What a tool reports becomes a card in the agent's reply, at the point it
happened.

- **Fold** (`packages/ui/src/conversation/fold.ts`). A tool row's
  `metadata.bakinEntities` becomes a `{ type: 'entities', refs }` turn item.
  The tool call stays in its activity group; the cards collect directly after
  the group, and a trailing `entities` item does not end the group, so
  consecutive tool calls remain one collapsed group. Text between calls
  starts a new group and a new card item.
- **One card per thing per reply.** Identity is `kind` + `id`. `created`
  beats `updated` (the card is a snapshot of the creation, whatever changed
  after). The same thing in a later reply gets its own card.
- **Inline images.** An `assets:asset` reference whose id the reply's text
  already shows (`/api/assets/<id>…`) gets no card.
- **Reads get none.** Only what a tool reports renders; malformed references
  are ignored by the fold's structural guard (`isEntityRef`).
- **`EntityCard`** (`packages/ui/src/conversation/entity-card.tsx`, public on
  `@makinbakin/sdk/conversation`; story `Components/Conversation/Entity card`)
  composes the row `Card`: icon tile, title on one line (full text in
  `title`), and "Kind · Created|Updated". The whole card is one link through
  the Card's overlay contract; the accessible name is
  "Open <kind>: <title>".
- **Resolution stays out of the UI package.** `EntityCards` reads
  `EntityKindResolverContext`. The host mounts ONE provider
  (`packages/host/src/plugin-host/entity-cards-provider.tsx`, around the
  shell in `PluginHost`) that resolves a reference through the browser entity
  registry to its label, icon (the sidebar's `NavIcon` map) and a
  `PluginLink`. Every conversation surface — chat, brands, the Bits
  brainstorms — gets linked cards with no wiring of its own.
- **Unknown kind.** No declaration (the plugin was removed or disabled) means
  no icon and no link: a plain card named after the kind, never a dead link.
- `TurnOutputView` (single-turn embeds) shows no cards; the tool chips stand
  for the work.

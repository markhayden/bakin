# Messaging Plugin Refactor — Remove Hardcoded Unions

**Status:** Implemented (commits `4a6fa3e..61d9342` on `issue-118-messaging-refactor`)
**Tracking issue:** [#118](https://github.com/madeinwyo/bakin/issues/118)
**Gates:** Plugin-system spec (`docs/ideas/plugin-system.md`)

## Problem Statement

The messaging plugin hardcodes user-specific agents, channels, and content types as TypeScript string-literal unions. This makes messaging non-reusable by anyone but the current installation, and blocks the broader plugin-system work that requires core plugins to be neutral reference implementations.

Current offenders (`plugins/messaging/types.ts:1-4, 78`):

```ts
export type ContentAgent = 'basil' | 'scout' | 'nemo' | 'zen'
export type ContentChannel = 'discord' | 'instagram' | 'email' | 'twitter' | 'youtube' | 'tiktok'
export type ContentType = 'recipe' | 'tip' | 'motivation' | 'workout' | 'outdoor' | 'video' | 'image-post'

export const AGENT_INFO: Record<ContentAgent, { name: string; emoji: string; color: string }> = { /* 4 entries */ }
```

## Goals

- Remove all type-level enumeration of agents, channels, and content types from `plugins/messaging/`.
- Drive agent display (name, emoji, color) from the live OpenClaw roster via existing `team.*` hooks — no new `ctx.agents.*` surface in this refactor.
- Make content types user-configurable from the messaging plugin settings page. Ship **generic defaults** (Post / Article / Video / Image / Announcement); users add their own from settings.
- Add first-class list-of-rows field support to `PluginSettingsRenderer` so the content-types editor is a real UI, not a JSON textarea. Any future plugin with a taxonomy setting reuses this primitive.
- Preserve end-to-end calendar + brainstorm **behavior** — no crashes, no feature regressions. Existing local messaging data on the maintainer's machine is treated as disposable and wiped manually; this is a single-user self-hosted tool, no external installations exist yet.
- Leave a clean seam where the future `workflows.notificationChannels` registry can plug into the channel field without touching messaging internals again.

## Non-Goals

- Building the `workflows.notificationChannels` registry (owned by plugin-system spec).
- Introducing a new `ctx.agents.*` namespace (owned by plugin-system spec; team hooks are sufficient today).
- Changing `ContentTone` or `ContentStatus` — these are generic (tone) or state-machine (status) and don't block plugin-system neutrality.
- Rewriting existing `~/.bakin/messaging/*.md` frontmatter (additive changes only; orphan references render degraded, never corrupt).
- Building a per-channel icon/initials registry — `CHANNEL_LABELS` and `CHANNEL_INITIALS` in `constants.ts` stay as-is until the real registry lands.

## Design

### Type changes (`plugins/messaging/types.ts`)

```ts
// BEFORE (removed):
export type ContentAgent = 'basil' | 'scout' | 'nemo' | 'zen'
export type ContentChannel = 'discord' | 'instagram' | ...
export type ContentType = 'recipe' | 'tip' | ...
export const AGENT_INFO: Record<ContentAgent, ...> = { ... }

// AFTER:
/** Agent id — resolved against the OpenClaw roster via team.* hooks. */
export type ContentAgent = string

/** Channel id — free string today; constrained by the future notificationChannels registry. */
export type ContentChannel = string

/** Content type id — resolved against user-configured taxonomy in messaging settings. */
export type ContentType = string
```

`AGENT_INFO` and `AGENT_INFO[agent].color` references get replaced at each call site.

### Agent resolution

**Client components (8 files currently importing `AGENT_INFO`):** switch to the existing `useAgentStore()` hook from `@bakin/team/hooks/use-agent-store`. It already provides `agents: AgentMeta[]`, `getAgent(id)`, and `getAgentColor(id)`. Replacement pattern:

```ts
// BEFORE
import { AGENT_INFO } from '../types'
const info = AGENT_INFO[agentId]
<span className={info.color}>{info.emoji} {info.name}</span>

// AFTER
import { useAgentStore, getAgentColor } from '@bakin/team/hooks/use-agent-store'
const agent = useAgentStore((s) => s.getAgent(agentId))
const color = useAgentStore((s) => getAgentColor(s, agentId))
// render agent?.emoji / agent?.name / color — handle null (orphaned) gracefully
```

**Server (`plugins/messaging/lib/prompt-builder.ts`):** use `ctx.hooks.invoke<AgentMeta>('team.getAgent', { agentId })`. Prompt-builder already takes a `ctx`-like object (or can be wired to); confirm during build that the call site has access to hooks. If not, lift the agent lookup to the caller and pass `AgentMeta` in as a parameter.

### Content-type resolution

Add to `plugin-settings/messaging.json` (owned by existing plugin-settings infrastructure):

```ts
interface MessagingSettings {
  contentTypes: Array<{ id: string; label: string }>
  // (existing messaging settings, if any, unchanged)
}
```

#### Generic defaults (shipped in code)

These are broadly applicable to any content calendar user, not tied to a specific brand:

```ts
const DEFAULT_CONTENT_TYPES: MessagingSettings['contentTypes'] = [
  { id: 'post',         label: 'Post' },
  { id: 'article',      label: 'Article' },
  { id: 'video',        label: 'Video' },
  { id: 'image',        label: 'Image' },
  { id: 'announcement', label: 'Announcement' },
]
```

Deliberately short and neutral — real users add their own categories from the settings page.

#### Initialization

On plugin `activate()`: if `MessagingSettings.contentTypes` is missing, seed with `DEFAULT_CONTENT_TYPES` and persist. Idempotent — no-op on subsequent activations. No migration from existing frontmatter — the maintainer will manually wipe `~/.bakin/messaging/` before deploy (this is a single-user self-hosted tool pre-public).

#### Settings page — new `list` field in `PluginSettingsRenderer`

The existing renderer (`src/components/plugin-settings-renderer.tsx` or wherever it lives) supports scalar field types only. This refactor adds a first-class `list` type to the renderer — scoped creep, but the primitive is reusable by any plugin with a taxonomy setting.

Field schema shape:

```ts
interface ListSettingsField {
  type: 'list'
  label: string
  description?: string
  itemShape: Record<string, SettingsField>  // shape of each row
  addLabel?: string                          // button text: "Add content type"
  minItems?: number
  maxItems?: number
}
```

For messaging content-types, the schema is:

```ts
{
  contentTypes: {
    type: 'list',
    label: 'Content Types',
    description: 'Categories used across the content calendar and brainstorm sessions.',
    itemShape: {
      id:    { type: 'string', label: 'ID',    required: true },
      label: { type: 'string', label: 'Label', required: true },
    },
    addLabel: 'Add content type',
  }
}
```

Renderer responsibilities: add-row button, per-row delete, inline edit of each field, basic validation (`required`, `minItems`, `maxItems`, unique `id` within the list). No reordering in v1.

#### Label lookup

`CONTENT_TYPE_LABELS` lookup in `constants.ts` becomes a runtime read from settings:

```ts
// BEFORE
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = { recipe: 'Recipe', ... }

// AFTER
export function getContentTypeLabel(typeId: string, contentTypes: MessagingSettings['contentTypes']): string {
  return contentTypes.find(t => t.id === typeId)?.label ?? typeId  // fallback: raw id for orphans
}
```

### Channel handling

**This refactor:** `ContentChannel` becomes `string`. `CHANNEL_LABELS` and `CHANNEL_INITIALS` in `constants.ts` keep their hardcoded map. `getChannelLabel(id)` returns the mapped label or `id` as fallback. No new abstraction.

**Future (plugin-system spec):** `workflows.notificationChannels` registry replaces `CHANNEL_LABELS` with a runtime lookup. Messaging becomes a consumer — no internal refactor needed because the type is already `string`.

### Orphan references

Calendar items with frontmatter referencing a removed agent id or a removed content-type id must:

1. Parse successfully — `ContentAgent` and `ContentType` are just strings.
2. Render with degraded display — raw id shown, no emoji/color, fallback neutral styling.
3. **Not be auto-rewritten** — data stays as the user left it.

A follow-up issue can add a "cleanup orphans" action later; out of scope here.

### Files touched (estimated)

- `plugins/messaging/types.ts` — remove unions + AGENT_INFO; keep interfaces
- `plugins/messaging/constants.ts` — remove `CONTENT_AGENTS`, make `CONTENT_TYPE_LABELS` dynamic, keep channel maps as-is for now
- `plugins/messaging/index.ts` — register `settingsSchema` with the new `list` field; seed defaults on first activate
- `plugins/messaging/lib/prompt-builder.ts` — swap AGENT_INFO for `team.getAgent` hook call
- `plugins/messaging/components/*.tsx` (8 files) — swap `AGENT_INFO[id]` for `useAgentStore()`
- `src/components/plugin-settings-renderer.tsx` (or wherever the renderer lives) — add `list` field type
- Tests — add/update (see Testing)

## Data Handling

- **Existing frontmatter with legacy values** (`agent: 'basil'`, `contentType: 'recipe'`, etc.): parses fine because types widen to strings. Renders degraded (raw id, no emoji). Maintainer wipes `~/.bakin/messaging/` manually before deploying this change — no migration code to maintain.
- **In-flight workflow instances referencing `agent: 'basil'`:** unchanged — workflows reference agent ids as strings already. No impact.

## Testing

Follows project test rules (CLAUDE.md): every test file MUST mock `src/core/content-dir`, logger, watcher, and `openclaw-client`. Never touch `~/.bakin/`.

- **Unit:** `getContentTypeLabel` fallback behavior, default-seeding on first activate (idempotent no-op on second activate), prompt-builder agent resolution with mocked `team.getAgent` hook, `PluginSettingsRenderer` `list` field behavior (add/edit/delete rows, validation).
- **Integration:** existing calendar and brainstorm tests updated to drive agents through the mocked team hook instead of `AGENT_INFO`.
- **Regression guard:** fixture test — a `messaging.md` with `agent: 'basil'` and `contentType: 'recipe'` parses, and the client-side lookup renders sensibly whether the team hook mock returns an agent or `null`.

## Acceptance Criteria

Mirrors issue #118 with refinements:

- [ ] No string-literal unions in `plugins/messaging/types.ts` for agents, channels, or content types
- [ ] `AGENT_INFO` removed; no file under `plugins/messaging/` imports it
- [ ] No string literals like `'basil' | 'scout' | 'nemo' | 'zen'` or `'recipe' | 'tip' | ...` anywhere under `plugins/messaging/`
- [ ] Server-side agent resolution goes through `ctx.hooks.invoke('team.getAgent', ...)`
- [ ] Client-side agent resolution goes through `useAgentStore()` from the team plugin
- [ ] `MessagingSettings.contentTypes` exists; seeded with `DEFAULT_CONTENT_TYPES` on first activate (idempotent on re-activate)
- [ ] `PluginSettingsRenderer` supports a `list` field type with add/edit/delete and per-field validation; messaging uses it for content types
- [ ] Generic `DEFAULT_CONTENT_TYPES` (Post / Article / Video / Image / Announcement) is the only hardcoded content-type list in the codebase, and it lives in messaging code — not in types
- [ ] `CHANNEL_LABELS` / `CHANNEL_INITIALS` left intact — channel registry phasing is an explicit deferral
- [ ] Existing calendar + brainstorm functionality passes manual smoke test: create item, edit item, view drawer, run brainstorm session end-to-end
- [ ] Fixture-based regression test for orphaned agent id (returns degraded UI, doesn't crash)
- [ ] `grep -r AGENT_INFO plugins/messaging/` returns zero hits
- [ ] Issue #118 closed; plugin-system spec unblocked

## Sequencing / Dependency Note

- **Agents + content-types ship in this refactor.** Both depend only on infrastructure that exists today (team hooks, plugin settings renderer).
- **Channels stay hardcoded in `constants.ts`** until the `workflows.notificationChannels` registry is introduced by the plugin-system spec. The only channel-related change here is dropping the type-level union to `string`. This is the smallest change that unblocks plugin-system work without over-committing the channel design.
- When the channel registry lands, the migration is a one-file swap in `constants.ts` (replace hardcoded maps with registry reads). Messaging internals won't need revisiting.

## Open Questions

- None at spec time. Two items to verify during build:
  - Exact file path / export shape of `PluginSettingsRenderer` (surveyed briefly; confirm before extending).
  - Whether `useAgentStore` is client-only or also has a server-safe variant for anywhere prompt-builder might end up running outside a React tree (prompt-builder is server-side; it'll use the `team.getAgent` hook, not the store).

## Not Doing (and Why)

- **New `ctx.agents.*` namespace** — `team.*` hooks already work; introducing ctx agents now duplicates the surface. Plugin-system spec owns that consolidation.
- **Channel registry** — out of scope; owned by plugin-system spec.
- **`ContentTone` / `ContentStatus` refactor** — not user-specific, not blocking neutrality.
- **Orphan-cleanup UI** — data stays where the user put it; no auto-rewrite, no magic.
- **Migration code from legacy frontmatter** — maintainer wipes local data manually; no other installations exist. Migration code costs complexity we don't need.
- **Hardcoding user-brand-specific content types (recipe / tip / motivation / etc.) as defaults** — those are your taxonomy, not a neutral default set.
- **Row reordering in the settings `list` field** — can add later; cut from v1.

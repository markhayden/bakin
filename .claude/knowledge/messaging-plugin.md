# Messaging Plugin

The messaging plugin (formerly "calendar") handles content planning and scheduling across runtime channel IDs such as `general`, `announcements`, or `email`. It has two sub-pages accessed via sidebar sub-navigation.

## Sub-Pages

- **Calendar** (`/messaging/calendar`) — Month/week/list views of scheduled content items. Uses `ContentCalendar` component.
- **Brainstorm** (`/messaging/brainstorm`) — AI-powered planning sessions with agents. Uses `BrainstormView` component.

The parent `/messaging` route redirects to `/messaging/calendar`.

## Client Entry

`plugins/messaging/client.tsx` calls `registerPlugin({ id: 'messaging', navItems, slots: { 'page:/messaging/calendar': ContentCalendar, 'page:/messaging/brainstorm': BrainstormView } })`. The shell's TanStack routes render `<Slot name="page:/messaging/calendar" />` (etc.) so the plugin's components mount at those URLs. Server-side routes are plain Bun-shape handlers exposed via `ctx.registerRoute(...)` in `plugins/messaging/index.ts`.

## Sidebar Sub-Navigation

The messaging plugin uses `NavItem.children` (added in `packages/core/src/plugin-types.ts`) for sub-nav. It also sets `NavItem.alwaysExpanded: true` so the chevron toggle is hidden and children are always visible under the parent in the expanded sidebar. In the collapsed sidebar (icon-only mode), hovering the messaging icon opens a Base UI Popover flyout containing the sub-nav links — so the children remain reachable without expanding the whole sidebar. The flyout uses `openOnHover` with a 120ms delay, and `nativeButton={false}` on the trigger so Base UI accepts the `<Link>` render.

## Planning Sessions (Brainstorm)

### Architecture

Sessions are JSON files stored at `~/.bakin/messaging/sessions/{id}.json`. Each session contains:
- `messages[]` — chat history (user + assistant)
- `proposals[]` — proposed calendar items with status (proposed/approved/rejected/revised)
- `agentId` — which content agent is planning
- `status` — active or completed

### Streaming Chat with Incremental Proposals

The brainstorm chat uses SSE streaming (`POST /api/plugins/messaging/sessions/:id/messages`):

1. **Prompt format** (`lib/prompt-builder.ts`): Agents output each proposal as its own fenced ` ```json ``` ` block (one object per block, NOT an array). Text between blocks provides context.

2. **Server streaming** (`index.ts`): During SSE streaming, the server watches for completed ` ```json ``` ` blocks. Each time one closes, it's immediately parsed, upserted via `upsertProposals()`, and emitted as a `proposal` SSE event.

3. **Client rendering** (`session-chat.tsx`): The component is a thin adapter around `<IntegratedBrainstorm>` from `@bakin/sdk/components` (see `.claude/knowledge/shared-ui-patterns.md` → IntegratedBrainstorm). SessionChat converts `SessionMessage[]` to `BrainstormMessage[]`, opens the SSE stream, forwards tokens via `ctx.onToken`, and when it sees a `proposal` event it calls `onProposalsReceived` (the callback `PlanningLayout` uses to populate the review panel). A `transformAssistantReply` function strips complete/partial ` ```json ``` ` blocks from the assistant text before rendering and surfaces the extracted count as an "N items proposed" badge below the bubble.

4. **Message splitting**: The server still returns a `segments` array in the `done` event, but the client now collapses the full assistant reply into a single bubble — `transformAssistantReply` handles the visual cleanup. If you want multi-bubble rendering back, revisit.

### SSE Events

| Event | Payload | When |
|-------|---------|------|
| `token` | `{ text }` | Each streaming token |
| `proposal` | `{ proposal }` | Single proposal parsed during streaming |
| `proposals` | `{ proposals, messageId }` | Legacy batch (non-streaming fallback) |
| `done` | `{ messageId, content, segments }` | Stream complete |
| `error` | `{ message }` | Error occurred |

### Proposal Upsert Logic

`upsertProposals()` in `lib/sessions.ts` handles both new proposals and revisions:
- Matches by `id` first (agent includes it when revising)
- Falls back to title matching (case-insensitive, only non-approved)
- Updates in place: increments revision, updates fields, sets status to `revised` if previously rejected
- Creates new proposal only when no match found

### Confirm Flow

When user clicks "Confirm Plan":
1. A dialog prompts for auto-approval: **Add as drafts** or **Auto-approve & schedule**
2. `POST /sessions/:id/confirm` with `{ autoApprove: boolean }` creates calendar items from approved proposals. `autoApprove: true` lands items in `status: 'scheduled'`; false lands them in `status: 'draft'` (same path as the agent-tool `bakin_exec_messaging_session_confirm`, which also accepts `autoApprove`).
3. Toast shows "X items scheduled on calendar" or "X items added as drafts"
4. Auto-navigates back to session list after brief delay

### Calendar Item Lifecycle

Calendar items have `ContentStatus = 'draft' | 'scheduled' | 'executing' | 'waiting' | 'review' | 'published' | 'failed'`. Human-driven state transitions:

| From | Action | To | Route |
|------|--------|-----|-------|
| `draft` | Approve (Schedule) | `scheduled` | `POST /:itemId/approve` |
| `scheduled` | **Unapprove** | `draft` | `POST /:itemId/unapprove` |
| `review` | Approve & Publish | `published` (posts through the active runtime channel adapter) | `POST /:itemId/approve` |
| `review` | Reject | `draft` (with note) | `POST /:itemId/reject` |

The unapprove action is surfaced as a button in `ItemDetailDrawer` when `status === 'scheduled'`. Delete is confirmed via a proper `<Dialog>` — not an in-menu two-click pattern (the earlier pattern broke because `DropdownMenu.onOpenChange` reset the confirm state when the menu closed).

### Security: agentId validation

Every messaging path that accepts an `agentId` from a request body validates it
before touching the filesystem. Validation is two-stage, inside `validateAgentId`
in `plugins/messaging/index.ts`:

1. **Shape guard** — `/^[a-z0-9-]+$/`. Load-bearing. Blocks path-traversal
   primitives (`../`, `/etc/passwd`, URL-encoded dots, null bytes, Unicode, etc.).
   A request whose `agentId` fails the regex returns `400 { error: 'invalid agentId' }`
   without any read.
2. **Roster check** — `team.getAgentIds` hook. Defense-in-depth. Rejects
   shape-valid ids that aren't in the current runtime roster (orphan refs).
   When the team plugin is unavailable or the hook throws, the shape guard
   alone gates the request and messaging stays functional.

Persona files (`~/.bakin/team/personas/{agentId}.md`) are loaded inside
`resolvePromptOptions`, *after* validation. `prompt-builder.ts` is pure —
`persona` is a required caller-supplied string on `PromptBuilderOptions`, not
a side-effect read. The regression suite is `tests/plugins/messaging/agentid-validation.test.ts`.

### List View Scope

`ContentCalendar`'s month/week views fetch only the current month (`?month=YYYY-MM`). The list view fetches **all** items and supports column sorting via `SortableHead` (date, agent, type, title, status). The view toggle drives the fetch scope in `fetchItems`.

### Brainstorm Search

The plugin registers a file-backed Antfly content type for brainstorm sessions (spec §5.1d, issue #67):

- **Glob:** `messaging/sessions/*.json` (relative to `getContentDir()`)
- **Key prefix:** `brainstorm-{sessionId}` — the client strips the prefix before looking up scores
- **Fields indexed:** `session_id`, `title`, `status`, `agent_id`, `message_body` (all messages concatenated), `proposal_summaries` (titles + briefs), plus `created_at` / `updated_at` (omitted when missing — Antfly rejects `''` for `datetime` types)
- **Helper:** `plugins/messaging/lib/brainstorm-search.ts` exposes `buildDoc(session)`, `parseSessionFile(absPath)`, and `sessionKey(id)`. `parseSessionFile` returns `null` on any failure so a single bad file can't break the reindex.
- **Consumer:** `BrainstormView` calls `useSearch({ plugin: 'messaging', facets: ['status', 'agent_id'], debounce: 300 })` and forwards `results` + `loading` into `SessionList`. Calendar items are out of scope and use a local substring filter instead.

## Data Migration

Plugin `activate()` auto-migrates legacy paths:
- `~/.bakin/calendar.json` → `~/.bakin/messaging.json`
- `~/.bakin/calendar/sessions/` → `~/.bakin/messaging/sessions/`

## Key Components

| Component | Purpose |
|-----------|---------|
| `BrainstormView` | Session list + PluginHeader with agent picker dropdown and URL-backed `AgentFilter` pill strip (`?agent=`) |
| `SessionList` | Sortable `<Table>` of sessions (Title / Agent / Threads / Status / Updated). Manual sort is disabled while a search is active so Antfly relevance order wins. Filters by `agentFilter` prop and by `searchResults` from the parent's `useSearch` hook. Preserves the full list during the search debounce via `searchLoading` to avoid a "no matches" flash. Delete via triple-dot menu. |
| `PlanningLayout` | Split layout: chat left, review panel right |
| `SessionChat` | Streaming chat with JSON-stripped bubbles |
| `ReviewPanel` | Proposal cards grouped by date, edit drawer, confirm button |
| `ProposalCard` | Individual proposal with approve/reject/edit actions |
| `NewSessionDialog` | Name prompt when creating a session |
| `DeleteSessionDialog` | Confirmation dialog for session deletion |
| `ContentCalendar` | Month/week/list calendar views |

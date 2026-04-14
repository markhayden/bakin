# Messaging Plugin

The messaging plugin (formerly "calendar") handles content planning and scheduling across channels (Discord, Instagram, email, etc.). It has two sub-pages accessed via sidebar sub-navigation.

## Sub-Pages

- **Calendar** (`/messaging/calendar`) — Month/week/list views of scheduled content items. Uses `ContentCalendar` component.
- **Brainstorm** (`/messaging/brainstorm`) — AI-powered planning sessions with agents. Uses `BrainstormView` component.

The parent `/messaging` route redirects to `/messaging/calendar`.

## Sidebar Sub-Navigation

The messaging plugin uses `NavItem.children` (added in `packages/core/src/plugin-types.ts`) for sub-nav. The sidebar renders children indented under the parent, with a chevron toggle for expand/collapse. Auto-expands when navigating to a child route.

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

3. **Client rendering** (`session-chat.tsx`): The `stripAndSplit()` function splits streaming text at JSON block boundaries into separate segments. Each segment renders as its own chat bubble during streaming, giving visual feedback as the agent works through each proposal.

4. **Message splitting**: When the stream completes, the server saves each text segment between JSON blocks as a separate assistant message. The `done` SSE event includes a `segments` array so the client renders them as individual bubbles.

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
1. `POST /sessions/:id/confirm` creates calendar items from approved proposals
2. Toast shows "X items added to calendar"
3. Auto-navigates back to session list after brief delay

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

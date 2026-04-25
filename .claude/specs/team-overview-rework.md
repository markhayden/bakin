# Spec — Team Agent Detail Overview Rework

> **Post-merge note (scope grew during build):** the spec below targets 9 tabs.
> Shipped result is **10 tabs** — `Identity` was added mid-stream so users can
> edit `IDENTITY.md` from the UI (the file the role parser reads). Final tab
> order: `Overview | Identity | Soul | Memory | Heartbeat | Rules | Tools |
> Skills | Knowledge | Active Context`. See `.claude/knowledge/team-plugin.md`
> for the canonical landed state.



Restructures `/team/:id` (`agent-detail.tsx`) around a new "Overview" tab and rationalizes the entire tab list. New tabs: Heartbeat (read-only) and Active Context (read-only session transcript). Existing markdown tabs (Soul / Rules / Tools) get an Assets-style view-then-edit pattern with full-width layout.

## Problem

The current agent-detail Profile tab regurgitates content already shown on dedicated tabs (Soul, Rules, Tools, Heartbeat), the Stats tab is a sparse standalone surface that would be more valuable folded in, and there's no UI surface for "what does this agent actually see when dispatched?" The model picker and team selector also crowd the header instead of living in their natural home (settings on Overview).

## Locked Decisions

1. **Final tab list (9 tabs):**
   `Overview | Memory | Heartbeat | Soul | Rules | Tools | Skills | Knowledge | Active Context`
2. **Stats tab killed** — its content folds into Overview.
3. **Profile renamed → Overview.**
4. **Overview removes** the redundant Soul / Rules / Tools / Heartbeat content (each has its own tab).
5. **Overview adds:**
   - **Summary counts** (skills total, knowledge lessons total + enabled count)
   - **Latest session stats** (model, messages, total tokens, total cost — same data as old Stats tab, condensed)
   - **Recent activity** (5m / 1h / 24h dispatch counts via `getStatsByMs`, framed as "since server start")
   - **Model selector** (moved from header)
   - **Team selector** (moved from header)
   - **Workspace path** (already on Profile today; stays)
   - **Identity** (already on Profile today; stays — IDENTITY.md is structured metadata, not a redundant file editor)
6. **Header becomes leaner** — back arrow, avatar, name, role, status, gateway-restart banner, delete button. No model picker, no team selector, no subagent perms badge (move to Overview if useful).
7. **Heartbeat tab — view-only** rendered markdown. No edit affordance. "Last updated <time ago>" header.
8. **Active Context tab — read-only session transcript.** Shows the most recent session JSONL parsed into a message list (system / user / assistant / tool entries) with role badges and content. No filtering, no per-turn drill-down, no editing. Empty state when no sessions exist.
9. **Markdown tabs (Soul / Rules / Tools) get the Assets pattern:**
   - Default: rendered markdown (read mode), full-width
   - Top-right corner button: pencil → enter edit mode
   - Edit mode: textarea raw markdown editor, Save (green check) + Cancel (X) replace the pencil
   - `Cmd+S` saves while in edit mode
   - Save success surfaces a transient "saved" indicator
10. **Full-width layout:**
   - Markdown tabs span the full page width (current `max-w-2xl` removed)
   - Markdown tabs use min-height that fills the viewport less header (CSS `min-h-[calc(100vh-220px)]` or similar — settle visually)
   - Non-markdown tabs (Overview, Memory, Heartbeat, Skills, Knowledge, Active Context) also use the full width with grid/column layouts where it improves density
11. **Branch:** `feat/team-overview-rework`. Single PR.
12. **Closes** the rework agreed in the conversation. Active Context ships as session-level transcript view; per-turn drill-down (showing the exact reconstructed input window per assistant turn) is a deferred follow-up.

## Acceptance Criteria

A user opening `/team/:agent-id` after this work can:

- ✅ See a single Overview tab containing identity, package state (still present from #158), model selector, team selector, workspace path, summary counts (skills + knowledge), latest session stats (model + messages + tokens + cost), and recent activity (5m/1h/24h counts) — without scrolling past redundant SOUL/AGENTS/TOOLS/HEARTBEAT walls of text
- ✅ Switch to Soul / Rules / Tools and see rendered markdown by default (full-width, full-height) — click pencil → edit raw → save
- ✅ Switch to Heartbeat and see the rendered heartbeat markdown view-only with a "last updated" indicator — no edit affordance
- ✅ Switch to Active Context and see the most recent session's message stream (system, user, assistant, tool messages) in read-only form
- ✅ Tab order is `Overview | Memory | Heartbeat | Soul | Rules | Tools | Skills | Knowledge | Active Context` — left to right
- ✅ Header above the tabs no longer contains the model picker, team selector, or subagent perms badge
- ✅ The deleted Stats tab is gone; its content lives on Overview as a condensed panel

## Out of Scope (Tracked As Follow-Ups)

- Per-turn Active Context drill-down (reconstruct input window per assistant message)
- Lifetime aggregate stats (total messages / cost since install — would require persistence beyond `recordUsage`'s in-memory store)
- Heartbeat edit mode (deferred forever — agent-authored, not user-editable)
- "Active Context" preview while a dispatch is in-flight (live streaming) — out of scope, would need SSE wiring
- Identity editing on Overview — IDENTITY.md edit goes through `PUT /api/plugins/team/:id/identity` which exists but is structured fields, not a markdown editor; current edit-via-form (when the agent is created) is acceptable
- Stats tab restoration — explicitly killed; if folded-in summary turns out insufficient in real use we'll revisit, not pre-empt

## In Scope (Files Touched)

| Path | Change |
|---|---|
| `plugins/team/components/agent-detail.tsx` | Major restructure. Tab list updated. Header trimmed. New `<OverviewTab>`, `<HeartbeatTab>`, `<ActiveContextTab>` components. `<FileEditorTab>` becomes `<MarkdownEditTab>` with view/edit toggle. |
| `plugins/team/components/markdown-edit-tab.tsx` | **New.** Extracted reusable component for the Assets-style markdown view/edit pattern (used by Soul / Rules / Tools tabs). |
| `plugins/team/components/heartbeat-tab.tsx` | **New.** View-only markdown render with "last updated" badge. |
| `plugins/team/components/active-context-tab.tsx` | **New.** Reads the most recent session JSONL for the agent and renders messages with role badges. |
| `plugins/team/components/overview-tab.tsx` | **New.** The new consolidated Overview content — splits the existing `ProfileTab` into something more useful. |
| `packages/host/src/api/plugins/[pluginId]/[[...path]].ts` | No change — uses existing routes. |
| `plugins/team/index.ts` | Add new REST routes: `GET /:agentId/heartbeat` (raw heartbeat markdown + lastUpdated metadata), `GET /:agentId/active-context` (parsed messages from latest session JSONL). Add `GET /:agentId/recent-activity` (returns 5m/1h/24h counts via `getStatsByMs`). |
| `plugins/team/lib/openclaw-adapter.ts` | Add `readHeartbeatRaw(agentId)` that returns `{ content, lastUpdated }` from the heartbeat file (currently the adapter only computes the merged status; the raw markdown isn't surfaced). |
| `plugins/team/lib/session-reader.ts` | **New.** Wraps `agent-usage.ts` style JSONL parsing but returns the structured *message stream* (role, content, model, ts) instead of summed-up usage stats. Distinct concern from `agent-usage.ts`. |
| `plugins/team/types.ts` | Add `SessionMessage` type and `RecentActivity` type for the new endpoints. |
| `tests/plugins/team/overview-tab.test.tsx` | **New.** Renders OverviewTab; asserts summary counts, model selector, team selector, condensed stats, recent activity panel all appear. |
| `tests/plugins/team/markdown-edit-tab.test.tsx` | **New.** Verifies view→edit toggle, save POSTs to the right endpoint, Cancel resets state, dirty indicator. |
| `tests/plugins/team/heartbeat-tab.test.tsx` | **New.** Heartbeat renders markdown, no edit button, shows last-updated. |
| `tests/plugins/team/active-context-tab.test.tsx` | **New.** Loads session messages, renders system/user/assistant/tool roles, empty state. |
| `tests/plugins/team/session-reader.test.ts` | **New.** Pure-function tests for the JSONL → message stream parser. |
| `tests/plugins/team/agent-detail-tabs.test.tsx` | Update — TABS constant changed; adjust to assert against the new list. |
| `.claude/knowledge/team-plugin.md` | Document the new tab structure, OverviewTab layout, MarkdownEditTab pattern, ActiveContext data source. |
| `docs/plugin-authoring.md` | Reference MarkdownEditTab as a reusable pattern other plugins can adopt for view/edit markdown tabs (if it makes sense to lift to SDK in a future iteration). |

**Not touched:**

- `plugins/team/components/team-grid.tsx` — grid is fine as-is
- `plugins/team/components/agent-form.tsx` — agent creation flow unchanged
- `plugins/team/components/team-manager.tsx` — team management drawer unchanged
- `plugins/team/components/package-state-badge.tsx` — used by Overview but unchanged
- `plugins/team/components/knowledge-toggle-list.tsx` — Knowledge tab still renders this
- `plugins/team/hooks/use-agent-store.ts` — no new fields needed; existing data sufficient

## Commands (Verification Surfaces)

```bash
# Tests during dev (every commit must keep these green)
bun test --watch --isolate tests/plugins/team

# Full suite (pre-merge)
bun test --isolate

# Build verification
bun run build:plugins

# Visual verification (REQUIRED — this is UI work)
bun run dev:mock
# Open http://localhost:3737/team/main and verify:
#   - Tabs in order: Overview | Memory | Heartbeat | Soul | Rules | Tools | Skills | Knowledge | Active Context
#   - Overview shows: identity, package card, model select, team select, workspace path, summary counts, latest session, recent activity
#   - Header has no model picker, no team selector
#   - Soul/Rules/Tools default to rendered markdown, pencil button toggles edit
#   - Heartbeat is view-only, no pencil
#   - Active Context shows messages from the seeded session JSONL
```

## Code Style

Inherits from CLAUDE.md. Component-specific:

- Tab content components live in their own files when over ~80 lines (extract liberally to keep agent-detail.tsx readable)
- Use existing `MarkdownContent` from `@bakin/sdk/components` for rendered markdown
- Use existing `useAgentStore` and `usePackageState` for store access
- Keep `agent-detail.tsx` as the orchestrator — it owns the header + tab bar + tab dispatch only after this rework

## Testing Strategy

Mandatory mock setup per CLAUDE.md (content-dir x2, openclaw-home, logger, watcher, openclaw-client) on every test file.

Per-component coverage requirements:

- **OverviewTab:** counts, panels, model save round-trip, team save round-trip
- **MarkdownEditTab:** view/edit toggle, save round-trip, dirty/saved indicators, Cmd+S, Cancel reverts
- **HeartbeatTab:** markdown rendering, last-updated formatting, absence of edit button
- **ActiveContextTab:** message rendering for each role, empty state, loading state, error fallback
- **session-reader (lib):** JSONL parsing, malformed line tolerance, missing-file behavior

Existing `agent-detail-tabs.test.tsx` updates: adjust the asserted TABS list, keep the URL contract assertion.

## Boundaries

**Always do:**

- Maintain CLAUDE.md test isolation rules — no leak to `~/.bakin/` or `~/.openclaw/`
- Use existing API endpoints where they suffice; only add new ones for genuinely new data needs (heartbeat raw, active context messages, recent activity)
- Keep the new tab components self-contained (own file, own tests)
- Preserve the URL state pattern (`?tab=...`) for all new tabs
- Preserve every existing endpoint shape — adding new endpoints, not modifying existing ones

**Ask first about:**

- Lifting MarkdownEditTab to `@bakin/sdk/components` (shared markdown view/edit primitive other plugins might adopt) — likely defer to a follow-up iteration once the pattern proves itself
- Surfacing live Active Context (mid-dispatch streaming) — would require SSE wiring; ask before scope-creeping
- Persisting session-message rendering preferences (collapsed vs expanded) — defer until the user asks

**Never do:**

- Add an edit button to Heartbeat tab — explicitly forbidden by the spec
- Reintroduce Stats as a separate tab unless the Overview-condensed view proves insufficient (ask first)
- Truncate or pre-process active-context messages on the server beyond JSONL parsing — show the user what was actually sent
- Persist anything new to `~/.bakin/` for this rework — every data source is an existing file
- Skip the `useGatewayStatus` hook on model change — model swaps trigger a gateway-restart-needed signal that the header banner depends on

## Risks

| Risk | Mitigation |
|---|---|
| Active Context renders huge sessions (10k+ messages) — DOM bloat | Cap initial render to N most recent messages with a "show all" affordance. Set N=200 as a starting point. |
| Heartbeat file may not exist for fresh agents | Empty state: "No heartbeat reported yet. Heartbeats appear after the agent runs its first task." |
| Recent activity counts are session-only (reset on server restart) per CLAUDE.md | Frame the panel as "Since server start (5m / 1h / 24h)" — honest about the constraint. Do not invent persistence to fix this. |
| Markdown render of arbitrary user content (XSS surface) | `MarkdownContent` already used elsewhere — assume it's safe. If not, that's a separate hardening issue, not this one. |
| Removing model picker from header changes muscle memory | Acceptable — Overview is the natural home and the user explicitly asked for the move. Document in changelog. |
| Tab count grew from 8 to 9 — UI density concern on narrow screens | Tab bar already wraps with hover scroll; acceptable. Future polish: collapse to dropdown under N px width. |

## Definition of Done

- All commits land on `feat/team-overview-rework`
- `bun test --isolate` passes (zero regressions)
- `bun run dev:mock` visual verification of all 6 acceptance criteria
- PR opened against `main` with summary referencing the rework
- `.claude/knowledge/team-plugin.md` updated with the new tab map and component contracts
- The killed Stats tab content visibly accessible on Overview (no data loss)
- Follow-up issues filed for: per-turn Active Context drill-down, MarkdownEditTab → SDK lift (if/when reused)

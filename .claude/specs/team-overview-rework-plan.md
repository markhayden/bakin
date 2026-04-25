# Execution Plan — Team Overview Rework

> **Post-merge note:** this plan targeted 9 tabs and assumed Heartbeat reads
> from `~/.bakin/heartbeats/{id}.json`. Both shifted during build:
> - Shipped 10 tabs (Identity added mid-stream).
> - Heartbeat tab reads `<workspace>/HEARTBEAT.md` instead — the agent-authored
>   markdown narrative, not the JSON status signal. The two surfaces were
>   conflated in this plan; the knowledge doc + landed code disambiguate.



Companion to `.claude/specs/team-overview-rework.md`. Read the spec first for the *what* and *why*; this is the *how* — exact files, line numbers, dependency graph, per-checkpoint verification, rollback story.

## Refresher

9-tab restructure of `agent-detail.tsx`:
- Rename Profile → Overview, kill Stats (fold in)
- Add Heartbeat (view-only) and Active Context (read-only session transcript)
- Apply Assets-style view/edit pattern to Soul / Rules / Tools markdown tabs
- Move model selector + team selector from header into Overview
- Full-width layout for markdown tabs

**State of main on branch creation:** #161 already merged. PackageCard, KnowledgeTab, usePackageState, PackageStateRow type, and the Adopt-flow wiring are all present in main. This rework leaves the `Knowledge` tab + Package card as-is (they're already correct) and focuses on Overview / Heartbeat / Active Context / markdown view/edit pattern.

**Per-commit verification adds `bunx tsc --noEmit -p tsconfig.app.json`** alongside `bun test --isolate` — Bun's runtime test runner doesn't catch TS-only errors that CI does.

## Critical Files

| # | Path | Role | Rough edit surface |
|---|---|---|---|
| 1 | `plugins/team/types.ts` | Add `SessionMessage` (role, content, model, ts) and `RecentActivity` (5m / 1h / 24h dispatch + error counts) types. Add `HeartbeatRaw` (content, lastUpdated). | Append at end of file. |
| 2 | `plugins/team/lib/session-reader.ts` | **New.** JSONL parser that returns the message stream from the agent's most recent session — sibling to `agent-usage.ts` but returns messages, not summed usage. Tolerates malformed lines. | ~120 lines. Reuses `getOpenClawPath('agents')` + `getLatestSession()` style discovery. |
| 3 | `plugins/team/lib/openclaw-adapter.ts` | Add `readHeartbeatRaw(agentId)` that returns `{ content, lastUpdated }` from `~/.bakin/heartbeats/{agentId}.json` (parse the JSON, extract the markdown body + mtime). | New function ~25 lines, slot before line 290 (`getAgentModel`). |
| 4 | `plugins/team/index.ts` | Add 3 new REST handlers: `GET /:agentId/heartbeat`, `GET /:agentId/active-context`, `GET /:agentId/recent-activity`. | New routes appended after the existing `/:agentId/stats` handler (~lines 1022-1036). Recent-activity reads `getStatsByMs` from `src/core/usage`. |
| 5 | `plugins/team/components/markdown-edit-tab.tsx` | **New.** Reusable view/edit component with the Assets pattern — pencil corner button → toggles to textarea, Save (green check) + Cancel (X) replace pencil. Cmd+S in edit mode. Save POSTs to a configurable endpoint. | ~120 lines. Props: `agentId`, `filename`, `initialContent`. |
| 6 | `plugins/team/components/heartbeat-tab.tsx` | **New.** View-only: `<MarkdownContent>` with a "Last updated <relative time>" badge in the top-right corner. Empty state for missing heartbeat. | ~70 lines. Fetches `/api/plugins/team/:id/heartbeat`. |
| 7 | `plugins/team/components/active-context-tab.tsx` | **New.** Loads session messages, renders one row per message with role-colored badge + content preview (markdown for text, JSON pretty-print for tool calls). Shows latest 200 messages with "show all" affordance. | ~150 lines. |
| 8 | `plugins/team/components/overview-tab.tsx` | **New.** The consolidated Overview content: Identity card, Package card (reused from #158), Settings (model + team selectors), Workspace path, Summary counts (skills, knowledge), Latest session stats, Recent activity. | ~250 lines. Composed of small sub-components for each panel. |
| 9 | `plugins/team/components/agent-detail.tsx` | Major restructure. Trim header (remove model picker, team selector, subagent perms badge — those move to Overview). Update `Tab` union + `TABS` array. Replace `<FileEditorTab>` callsites with `<MarkdownEditTab>`. Add `<HeartbeatTab>`, `<ActiveContextTab>`, `<OverviewTab>` to dispatch. Delete `<StatsTab>` + `<Row>` (folds into Overview). Delete `<ProfileTab>` + helpers (replaced by `<OverviewTab>`). | (a) Tab union (line 25) + TABS (27-35) updated. (b) Header (160-232) trimmed. (c) Tab dispatch (272-278) rewired. (d) ProfileTab helpers + StatsTab deleted (313-374, 727-799). (e) FileEditorTab kept temporarily then deleted in favor of MarkdownEditTab. |
| 10 | `tests/plugins/team/agent-detail-tabs.test.tsx` | Adjust TABS assertion to match the new 9-tab list and order. | ~5 line edit. |
| 11 | `tests/plugins/team/session-reader.test.ts` | **New.** Pure-function tests for the JSONL parser. | ~80 lines. |
| 12 | `tests/plugins/team/markdown-edit-tab.test.tsx` | **New.** View/edit toggle, save POST shape, dirty/saved indicators, Cmd+S, Cancel. | ~120 lines. |
| 13 | `tests/plugins/team/heartbeat-tab.test.tsx` | **New.** Markdown render, last-updated formatting, no edit button, empty state. | ~80 lines. |
| 14 | `tests/plugins/team/active-context-tab.test.tsx` | **New.** Message rendering per role, empty state, message cap behavior. | ~120 lines. |
| 15 | `tests/plugins/team/overview-tab.test.tsx` | **New.** Identity, package card, settings panels, summary counts, recent activity all render. | ~150 lines. |
| 16 | `tests/plugins/team/routes.test.ts` | Extend with coverage for the 3 new REST handlers. | ~80 line addition. |
| 17 | `.claude/knowledge/team-plugin.md` | Add "Agent Detail Tab Architecture" section documenting the new tab structure, MarkdownEditTab pattern, OverviewTab composition, ActiveContext data source. | ~80 line addition. |

**Not touched:**

- `plugins/team/components/team-grid.tsx` — grid is fine
- `plugins/team/components/agent-form.tsx` — agent creation flow unchanged
- `plugins/team/components/team-manager.tsx` — drawer unchanged
- `plugins/team/components/package-state-badge.tsx` — used by Overview, no change
- `plugins/team/components/knowledge-toggle-list.tsx` — Knowledge tab still renders this
- `plugins/team/hooks/use-agent-store.ts` — no new fields needed
- `packages/host/src/api/*` — REST handlers added inside the team plugin, not at host level
- `CLAUDE.md` — no architectural shifts requiring doc updates
- `README.md` — no user-facing CLI surface changes

## Dependency Graph

```
C1 (types)            ─┬─▶ C2 (session-reader lib)  ─┐
                       │                              │
                       ├─▶ C3 (heartbeat reader)  ──┐ │
                       │                              │ │
                       └─▶ C4 (REST endpoints)  ◀─┴─┘
                                                      │
                                                      ▼
                                       ┌─ C5 (MarkdownEditTab)
                                       │
                                       ├─ C6 (HeartbeatTab)
                                       │
                                       ├─ C7 (ActiveContextTab)
                                       │
                                       └─ C8 (OverviewTab)
                                                      │
                                                      ▼
                                       C9 (agent-detail integration)
                                                      │
                                                      ▼
                                       C10 (docs)
```

- **C1 (types) gates everything** — but is trivial.
- **C2 + C3 are pure-function additions** with no consumers yet — both safe to land before C4.
- **C4 (REST) gates the visual tabs (C6, C7, C8)** because they fetch from those endpoints.
- **C5 (MarkdownEditTab) is independent** — extracted from the existing FileEditorTab pattern; no upstream dep.
- **C9 (agent-detail integration) gates revealing all the new tabs in the live UI.** Until C9 lands, the new tab components exist but aren't wired into the tab bar — every prior commit ships dead-but-tested code.
- **C10 (docs) ships last** so the knowledge file reflects the landed state.

## Per-Commit Plan

### C1 — `feat(team): add session and activity types`

**Files:** `plugins/team/types.ts`

**Changes:** Append three new exported types:
```ts
export interface SessionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  model?: string
  ts?: string
  toolName?: string
}

export interface SessionTranscript {
  sessionId: string
  sessionStarted: string | null
  messages: SessionMessage[]
  truncated: boolean
}

export interface RecentActivity {
  windowMs: Record<'5m' | '1h' | '24h', number>
  errors: Record<'5m' | '1h' | '24h', number>
  sinceServerStart: string
}

export interface HeartbeatRaw {
  content: string
  lastUpdated: string | null
}
```

**Tests:** None (type-only commit; consumers test the shape).

**Verification:** `bun build` succeeds (type-check clean).

**Rollback:** Trivial — revert one file.

---

### C2 — `feat(team): add session-reader for active-context tab`

**Files:** `plugins/team/lib/session-reader.ts` (new), `tests/plugins/team/session-reader.test.ts` (new)

**Changes:** Pure-function module mirroring `src/core/agent-usage.ts` discovery (latest session JSONL via first-line timestamp). Parses each line: skips `type !== 'message'` entries (system/session/etc), maps assistant/user/tool messages into `SessionMessage`. Returns `SessionTranscript` with truncation flag (cap = 200 by default, configurable param).

Key shape:
```ts
export function readLatestSessionTranscript(
  agentId: string,
  opts?: { maxMessages?: number },
): SessionTranscript | null
```

**Tests:** 6-8 cases — happy path with mixed roles, malformed line skipped, missing-file returns null, truncation flag correct, system message included, tool message includes `toolName`.

**Verification:** `bun test --isolate tests/plugins/team/session-reader.test.ts` green.

**Rollback:** Two files revert; no consumers yet.

---

### C3 — `feat(team): add heartbeat raw reader to adapter`

**Files:** `plugins/team/lib/openclaw-adapter.ts`

**Changes:** Add `readHeartbeatRaw(agentId): HeartbeatRaw | null` before `getAgentModel` (line 290). Reads `~/.bakin/heartbeats/{agentId}.json`, parses JSON, returns `{ content: parsed.markdown ?? parsed.message ?? '', lastUpdated: parsed.timestamp ?? null }`. Returns `null` on missing file.

**Tests:** Existing `tests/plugins/team/openclaw-adapter.test.ts` extended with one happy-path case + one missing-file case.

**Verification:** `bun test --isolate tests/plugins/team/openclaw-adapter.test.ts`.

**Rollback:** Single function removed.

---

### C4 — `feat(team): add REST endpoints for new tabs`

**Files:** `plugins/team/index.ts`, `tests/plugins/team/routes.test.ts`

**Changes:** Three new routes:

- `GET /:agentId/heartbeat` → calls `readHeartbeatRaw(agentId)`, returns `{ ok, heartbeat: HeartbeatRaw | null }`
- `GET /:agentId/active-context?max=200` → calls `readLatestSessionTranscript(agentId, { maxMessages })`, returns `{ ok, transcript: SessionTranscript | null }`
- `GET /:agentId/recent-activity` → calls `getStatsByMs` for each window (5m, 1h, 24h) with `agent: agentId`, returns `{ ok, activity: RecentActivity }`. `sinceServerStart` is the process-start ISO timestamp.

Each handler follows the existing pattern (try/catch + `Response.json`). Append after the `/:agentId/stats` handler (~line 1036).

**Tests:** 6-8 new cases in `routes.test.ts` — happy path + missing-data path for each handler. Use the existing test setup.

**Verification:** `bun test --isolate tests/plugins/team/routes.test.ts`.

**Rollback:** Three handlers removed; type imports stay (used by C5+).

---

### C5 — `feat(team): extract MarkdownEditTab reusable component`

**Files:** `plugins/team/components/markdown-edit-tab.tsx` (new), `tests/plugins/team/markdown-edit-tab.test.tsx` (new)

**Changes:** Brand-new component with the Assets-style view/edit toggle:

- Props: `agentId`, `filename`, `initialContent: string | null`
- Default state: rendered markdown via `<MarkdownContent>`. Pencil icon (top-right, absolute corner button matching Assets pattern).
- Edit state: textarea (full-width, fills available height). Top-right shows green check (Save) + zinc X (Cancel). Cmd+S triggers save. Save POSTs to `/api/plugins/team/:agentId/files/:filename` (existing endpoint, no server change needed).
- Indicators: `dirty` badge while editing with unsaved changes, `saved` badge for ~2s after save.
- Cancel exits edit mode and discards local changes.

Layout: full-width container, no `max-w-2xl`. Min-height fills viewport (`min-h-[calc(100vh-260px)]` initial guess; settle visually in C9).

**Tests:** Toggle to edit, dirty indicator after typing, save POST shape correct, Cancel reverts content, Cmd+S triggers save when dirty, ignores when clean, missing initialContent shows "does not exist" empty state.

**Verification:** `bun test --isolate tests/plugins/team/markdown-edit-tab.test.tsx`. Visual: not yet wired into the live UI; manual stub render to verify pattern feels right.

**Rollback:** Two files revert. agent-detail.tsx still uses old `<FileEditorTab>`.

---

### C6 — `feat(team): add Heartbeat tab component`

**Files:** `plugins/team/components/heartbeat-tab.tsx` (new), `tests/plugins/team/heartbeat-tab.test.tsx` (new)

**Changes:** View-only tab. Fetches `GET /api/plugins/team/:agentId/heartbeat`. Renders `<MarkdownContent>` with the body. Top-right: small "Last updated <relative time>" using a relative-time helper (e.g., `Intl.RelativeTimeFormat`). Empty state when `heartbeat === null`: centered "No heartbeat reported yet."

No edit button anywhere — explicitly forbidden by the spec.

**Tests:** Renders markdown, shows last-updated, no pencil/edit button present (assertion query for absence), shows empty state when API returns null.

**Verification:** `bun test --isolate tests/plugins/team/heartbeat-tab.test.tsx`.

**Rollback:** Two files revert.

---

### C7 — `feat(team): add ActiveContext tab component`

**Files:** `plugins/team/components/active-context-tab.tsx` (new), `tests/plugins/team/active-context-tab.test.tsx` (new)

**Changes:** Read-only transcript view. Fetches `GET /api/plugins/team/:agentId/active-context`. Renders one row per message — role badge (system: gray, user: blue, assistant: green, tool: amber) + content (markdown for text bodies, `<pre>` JSON for tool calls/results). Truncation banner at top when `transcript.truncated === true`: "Showing latest 200 of N messages. Older messages omitted."

Layout: full-width, scrollable container with bottom-anchored scroll position so users land at the most recent message (the typical interesting one).

**Tests:** Each role renders with the correct badge, empty state when API returns null transcript, truncation banner appears when flag set, message count matches API response, content displays correctly for text vs tool entries.

**Verification:** `bun test --isolate tests/plugins/team/active-context-tab.test.tsx`.

**Rollback:** Two files revert.

---

### C8 — `feat(team): add Overview tab component`

**Files:** `plugins/team/components/overview-tab.tsx` (new), `plugins/team/components/agent-detail.tsx` (export PackageCard so OverviewTab can import it), `tests/plugins/team/overview-tab.test.tsx` (new)

**Changes:** Composed component with these panels:

- **Identity card** — agent name, role, emoji, dispatchableBy badge (preserves what's currently in the header)
- **Package card** — directly reuses the existing `<PackageCard>` from `agent-detail.tsx` (#161 has merged, so it's now in main). Add `export` to the existing `function PackageCard(...)` declaration in agent-detail.tsx so OverviewTab can import it. No code duplication.
- **Settings panel** — model selector (existing `ModelSelect`), team selector (existing `<select>` from header). On change, the existing handler fires.
- **Workspace path** — `<code>` with the path
- **Summary counts** — fetches `/api/plugins/team/:agentId/skills` (count) and `/api/agent-packages/:agentId/knowledge` (count + enabled count). Renders 3-column grid: Skills | Knowledge total | Knowledge enabled
- **Latest session** — fetches `/api/plugins/team/:agentId/stats` (existing endpoint — no change needed). Renders condensed: Model, Messages, Tokens (total), Cost (total). Folds in the killed Stats tab content.
- **Recent activity** — fetches `/api/plugins/team/:agentId/recent-activity`. Renders 3-column: 5m | 1h | 24h with errors below each. Footer text: "Since server start (<sinceServerStart>)."

Layout: full-width grid with sensible column counts at responsive breakpoints (likely `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`).

**Tests:** All panels render with mocked fetches, model/team save round-trips, empty/loading states for each fetched data source.

**Verification:** `bun test --isolate tests/plugins/team/overview-tab.test.tsx`.

**Rollback:** Two files revert. agent-detail.tsx still shows old Profile tab.

---

### C9 — `feat(team): integrate new tabs into agent-detail`

**Files:** `plugins/team/components/agent-detail.tsx`, `tests/plugins/team/agent-detail-tabs.test.tsx`

**Changes:** The big swap — wires all C5-C8 components into the live UI:

1. **Tab union** (line 25): `'overview' | 'memory' | 'heartbeat' | 'soul' | 'rules' | 'tools' | 'skills' | 'knowledge' | 'active-context'`
2. **TABS array** (27-35): reorder to spec list. Default tab from `?tab=` falls back to `'overview'`.
3. **Header** (160-232): remove model picker (194-204), team selector (213-224), subagent perms badge (208-212), saving spinner (203). Keep: back arrow, avatar, name, role, gateway-restart banner, delete button.
4. **Tab dispatch** (272-278): replace with the new mapping. `<FileEditorTab>` callsites for SOUL/AGENTS/TOOLS swap to `<MarkdownEditTab>`. Add `<OverviewTab>`, `<HeartbeatTab>`, `<ActiveContextTab>` rows.
5. **Delete** `<ProfileTab>` (313-374), `<StatsTab>` + `<Row>` (727-799), `<ProfileSection>` + `<ProfileMarkdown>` (315-328) — all subsumed by the new components.
6. **Delete** `<FileEditorTab>` (376-445) — replaced by `<MarkdownEditTab>`.
7. **`agent-detail-tabs.test.tsx`** — adjust the asserted TABS list.

**Tests:** Verify all 9 tabs render, URL state survives, default tab is Overview, removed surfaces (model picker, team selector) are absent from the header.

**Verification:** `bun test --isolate tests/plugins/team` — full suite green. `bun run dev:mock` — manually verify all 6 acceptance criteria from the spec.

**Rollback:** Single file revert. Prior commits' new components stay (dead but tested).

---

### C10 — `docs: document Team Overview rework`

**Files:** `.claude/knowledge/team-plugin.md`, `docs/plugin-authoring.md`

**Changes:** Append "Agent Detail Tab Architecture" section to team-plugin.md:
- Tab map (9 tabs with one-line description each)
- MarkdownEditTab contract — view/edit toggle, save endpoint
- OverviewTab composition (panel list)
- Heartbeat / ActiveContext data sources
- Recent-activity caveat: "Since server start" framing

Add a brief callout in `docs/plugin-authoring.md` about the markdown view/edit pattern in case other plugins adopt it (no SDK lift yet — flag as a future iteration).

**Tests:** None.

**Verification:** Read both files end-to-end. Confirm accuracy vs landed code.

**Rollback:** Two files revert.

---

## Verification Across All Commits

After each commit:
```bash
bun test --isolate tests/plugins/team
bun test --isolate                       # full suite, no regressions
```

Before opening the PR:
```bash
bun run typecheck     # confirm exact name in package.json
bun run build:plugins # full plugin build clean
bun run dev:mock      # full visual sweep
```

PR checklist (mirrors spec's "Definition of Done"):
- [ ] All 10 commits on `feat/team-overview-rework`
- [ ] Full test suite passes
- [ ] Visual verification of all 6 acceptance criteria
- [ ] `.claude/knowledge/team-plugin.md` updated
- [ ] PR body lists what changed from the user's perspective + the killed Stats tab note
- [ ] Follow-ups filed: per-turn Active Context drill-down; potential MarkdownEditTab → SDK lift

## Rollback Story

| Revert | Result |
|---|---|
| Just C10 | Code identical; only the new doc sections disappear. |
| Just C9 | All new tab components stay built but unwired; agent-detail returns to its pre-rework tab list. The new REST endpoints stay. |
| Just C8 | OverviewTab vanishes; agent-detail's C9 dispatch fails to render Overview content (would need agent-detail to also revert that switch case). Treat C8/C9 as a paired revert pair. |
| Just C7 | ActiveContext tab content disappears. C9's dispatch line falls back to a "tab content unavailable" — also paired with C9 revert. |
| Just C6 | Same shape as C7 — Heartbeat content absent. |
| Just C5 | Soul/Rules/Tools tabs lose the new pattern. C9 imports MarkdownEditTab — paired revert. |
| Just C4 | The 3 new endpoints disappear. C6/C7/C8 fetches start failing — empty states everywhere. Paired revert with the consuming commits. |
| Just C3 | `readHeartbeatRaw` removed. C4's heartbeat handler fails — paired revert. |
| Just C2 | session-reader removed. C4's active-context handler fails — paired revert. |
| Just C1 | Type imports break across C2-C9. Full chain revert needed. |
| Full revert (C1-C10) | Codebase identical to pre-rework state — agent-detail.tsx as it was on `main` (or the post-#158 state if those merged first). |

**No destructive operations** in any commit:
- No file deletions outside the dead-after-replace components inside agent-detail.tsx
- No schema migrations
- No env var additions
- No new dependencies
- No build pipeline changes

## Open Micro-Decisions (settle during build)

1. **Recent-activity panel framing copy** — "Last 24h" vs "Past 24h" vs "24h activity"
2. **Active-context message cap default** (200 chosen; tune if testing reveals heavy sessions render slowly)
3. **OverviewTab grid breakpoints** — start with `md:grid-cols-2 xl:grid-cols-3`, adjust if panels look cramped
4. **MarkdownEditTab corner button styling** — match Assets exactly (rounded backdrop pill) vs simpler ghost button. Match Assets for consistency.
5. **ActiveContext role badge colors** — settle on a palette during build; system=zinc, user=blue, assistant=accent, tool=amber is the proposed start.

None block C1.

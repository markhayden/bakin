# Tasks Plugin — Kanban Board Spec

> **Status:** Draft
> **Author:** Mark + Claude
> **Date:** 2026-04-08
> **Scope:** Tasks plugin kanban board — ordering, permissions, DnD UX, API contracts, test strategy

---

## 1. Objective

The tasks plugin gives a single user real-time visibility and control over what their AI agents are doing. The kanban board is the primary interface. It must:

- **Feel familiar** — behave like Trello, GitHub Projects, Linear. No surprises.
- **Show automation** — agents move cards through columns automatically via MCP/API.
- **Allow human override** — the user can drag any card to any column, overriding the automated flow.
- **Be crisp** — drag-and-drop must be precise. Cards land where you drop them. Invalid targets are visually disabled. Feedback is immediate.

### Target Users

- **Human (UI):** The single Bakin operator, interacting via the browser dashboard.
- **Agent (API/MCP):** AI agents communicating through MCP exec tools or REST API.

### Installability Constraint

Bakin is a CLI tool installable on any user's OpenClaw system. All schema changes, data migrations, and fixes must be programmatic — run automatically via `bakin start` (plugin activation migrations) and verifiable via `bakin doctor`. No manual database edits. No backwards compatibility hacks — there is one system today, but the codebase must be install-ready for any new user.

---

## 2. Columns & State Machine

### 2.1 Columns (unchanged)

| Order | Column | Label | Purpose |
|-------|--------|-------|---------|
| 0 | `backlog` | Backlog | Unscheduled ideas |
| 1 | `todo` | Todo | Queued for dispatch |
| 2 | `blocked` | Blocked | Cannot proceed (has reason) |
| 3 | `inProgress` | In Progress | Agent actively working |
| 4 | `review` | Review | Awaiting gate approval |
| 5 | `done` | Done | Completed |
| 6 | `archived` | Archived | Archived (hidden from board, visible in list) |

### 2.2 Two-Tier Transition Rules

**Agent transitions** (channel: `mcp`, `cli`, `system`) — strict path enforcement:

```
backlog    → [todo]
todo       → [inProgress, blocked, done, backlog]
inProgress → [review, done, blocked, todo]
blocked    → [todo, inProgress, backlog]
review     → [done, inProgress, todo]
done       → [archived, todo, inProgress]
archived   → [done, todo]
```

**Human transitions** (channel: `human`) — unrestricted:

```
Any column → Any column
```

The human is the operator. They can force any state. The system trusts explicit human intent over automated guardrails.

### 2.3 Guards

| Guard | Agent | Human | Rationale |
|-------|-------|-------|-----------|
| Transition map | Enforced | **Bypassed** | Human override is the whole point |
| Log entries required for done | Enforced | **Bypassed** | Human may have context outside the system |
| Workflow done-guard | Enforced | **Bypassed** | Human can override stuck workflows |
| Blocked requires reason | Enforced | **Prompted in UI** | Reason is useful for both, but UI prompts interactively |
| Agent field required for audit | Enforced (`agent` param) | Auto-set to `"human"` | Clean audit trail |

### 2.4 Channel Detection

Every mutation carries a `channel` field: `'human' | 'mcp' | 'rest' | 'cli' | 'system'`.

- **UI moves** set `channel: 'human'` and `agent: 'human'`. This is the signal that bypasses transition guards.
- **API/MCP moves** continue to enforce the strict transition map.
- The `channel` field is persisted in audit events for traceability.

**Implementation:** The `/move` API route accepts an optional `channel` field. When `channel === 'human'`, the flow-store skips transition validation and the log-entry guard. The workflow done-guard in `task-service.ts` also checks channel before blocking. MCP tool handlers always force `channel: 'mcp'` server-side — agents cannot impersonate human.

---

## 3. Position & Ordering

### 3.1 Problem

Current ordering uses `updated_at DESC` with millisecond offsets (`now - i`). This is fragile:

- `moveTask` sets `updated_at = now` → card jumps to top of target column.
- Any other mutation (assign, log, update) also sets `updated_at = now` → scrambles order.
- The two-step move-then-reorder causes a visible flicker (SSE broadcast between steps).
- Millisecond offsets have collision risk with many tasks.

### 3.2 Solution: Weight-Based Positioning via `state_json`

Store a `position` integer inside each task's `state_json` blob. Bakin does not own the `flow_runs` table (OpenClaw does), so we must not `ALTER TABLE` to add columns. All Bakin-specific task metadata already lives in `state_json` — position follows the same pattern.

**Constants:**

```typescript
const POSITION_GAP = 1_000_000  // Gap between positions
```

**Initial assignment:** New tasks get `position = (last position in column) + POSITION_GAP`. If column is empty, start at `POSITION_GAP`.

**Insert between two tasks:** `position = Math.floor((before + after) / 2)`. With a gap of 1M, you can split ~50 times before positions become adjacent (2^50 > 10^15).

**Rebalance:** If a gap becomes < 1 (extremely unlikely), rebalance the entire column by reassigning positions at `POSITION_GAP` intervals. This is a rare O(n) operation.

### 3.3 Query Change

```sql
-- Before
SELECT * FROM flow_runs WHERE owner_key LIKE 'bakin:task:%' ORDER BY updated_at DESC

-- After
SELECT * FROM flow_runs WHERE owner_key LIKE 'bakin:task:%'
ORDER BY json_extract(state_json, '$.position') ASC
```

Tasks with lower position values appear first (top of column). `json_extract` is well-supported in SQLite for ORDER BY.

### 3.4 Migration

**File:** `plugins/tasks/migrations/X.Y.Z.ts` (version TBD based on current plugin version)

The migration runs automatically during plugin activation (existing `runMigrations()` system in `src/core/migrations.ts`, tracked in `~/.bakin/.bakin/plugin-versions.json`).

**Migration logic:**
1. Open the OpenClaw `flow_runs` database.
2. Read all Bakin task rows (`owner_key LIKE 'bakin:task:%'`).
3. Group by column (using existing `getColumn()` logic).
4. Within each column, sort by `updated_at DESC` (preserves current visual order).
5. Assign `position = i * POSITION_GAP` to each task's `state_json`.
6. Write updated `state_json` back in a single transaction.

This is safe: it only touches `state_json` (Bakin's data), not OpenClaw schema.

### 3.5 Doctor Check

**Add to `bakin doctor`:** A diagnostic that verifies all Bakin tasks have a `position` field in `state_json`. If any are missing, auto-fix by assigning positions based on `updated_at` order (same logic as migration). Status: `fixed` if repaired, `ok` if all good.

This handles edge cases: tasks created by older Bakin versions, data corruption, manual DB edits.

### 3.6 Mutation Changes

| Operation | Position behavior |
|-----------|------------------|
| Create task | Append: `position = max(column positions) + POSITION_GAP` |
| Move to column (drop on column) | Append: same as create |
| Move to column (drop on/between tasks) | Insert: midpoint of neighbors |
| Same-column reorder | Recalculate dropped card's position based on new neighbors |
| Assign, log, update (non-move) | **Position unchanged** — no longer affects ordering |
| Rebalance (gap < 1) | Reassign all positions in column at `i * POSITION_GAP` |

### 3.7 Atomic Move + Position

The current two-step move-then-reorder becomes a **single API call**. The `/move` endpoint accepts optional position hints:

```typescript
POST /api/plugins/tasks/:taskId/move
{
  from?: string,         // Source column (for audit)
  to: string,            // Target column (required)
  agent: string,         // "human" for UI moves (required)
  channel?: Channel,     // 'human' | 'mcp' | 'rest' | 'cli' | 'system'
  reason?: string,       // Required when to === 'blocked'
  afterTaskId?: string,  // Position: insert after this task
  beforeTaskId?: string, // Position: insert before this task
  // If neither afterTaskId nor beforeTaskId: append to end of column
}
```

The backend computes position from the neighbors in a single transaction. One SSE broadcast. No flicker.

### 3.8 Reorder Endpoint (simplified)

The `/reorder` endpoint remains for bulk operations but is no longer needed for individual drag-and-drop. Implementation switches from `updated_at` hacking to `position` reassignment:

```typescript
POST /api/plugins/tasks/reorder
{
  columnId: string,
  orderedIds: string[]  // Full ordered list of task IDs
}
// Assigns position = i * POSITION_GAP for each ID in state_json
```

---

## 4. Drag & Drop UX

### 4.1 Guiding Principles

1. **You always know where the card will land.** The insertion point is visible before release.
2. **Invalid targets are obviously disabled.** You can't accidentally drop somewhere that will fail.
3. **Feedback is immediate.** No post-drop error toasts for preventable mistakes.
4. **It feels like Trello.** Familiar patterns, no learning curve.

### 4.2 Drag Feedback

| Element | During drag |
|---------|------------|
| **Dragged card** | Lifted overlay at 105% scale with shadow (current behavior — keep) |
| **Source placeholder** | Dashed border placeholder at original position (current behavior — keep) |
| **Valid drop columns** | Normal appearance. Cards shift apart to show insertion gap at pointer position. |
| **Insertion indicator** | A horizontal line (2px, `border-primary`) between cards at the computed drop position. This is the key signal — the user sees exactly where the card will land. |

### 4.3 Human Channel: All Columns Valid

When the human drags a card, **every column is a valid drop target**. No columns are dimmed or disabled. This is the simplification that eliminates most edge cases.

### 4.4 Archived Column: Drop Zone Behavior

The archived column is special:

- **During drag:** Shows a drop zone indicator (the column header area accepts drops).
- **On drop:** The task moves to archived state. The card does **not** appear in the archived column on the board. Instead, the archived count badge on the column header increments.
- **Viewing archived tasks:** Click the archived column header or count badge to open the table/list view filtered to archived.

**Implementation:** After a successful move to archived, the kanban view always filters archived tasks out of the column card list. The column header shows `Archived (N)` count badge.

### 4.5 Blocked Column: Reason Prompt

When a card is dropped on the blocked column:

1. The drop completes visually (card appears in blocked column optimistically).
2. A dialog immediately opens asking for a block reason.
3. The dialog's confirm handler fires the `/move` API call with the reason.
4. If the user cancels the dialog, the optimistic state reverts (card returns to source column). No API call is made.

### 4.6 Insertion Point Indicator

When dragging over a column, a **2px horizontal line** appears between the two cards where the dragged card will be inserted. Cards above and below shift apart by ~8px.

This should come from `@dnd-kit/sortable`'s built-in transform behavior when `SortableContext` uses `verticalListSortingStrategy`. If the current implementation isn't producing visible shifts, debug the CSS transforms on sortable items. If dnd-kit's built-in shifting is insufficient, add a custom `<InsertionIndicator />` component rendered conditionally based on active drag-over position.

---

## 5. API Contract Changes

### 5.1 Move Task (updated)

```
POST /api/plugins/tasks/:taskId/move
```

**Request body:**

```typescript
{
  from?: string         // Source column (for audit, optional)
  to: string            // Target column (required)
  agent: string         // Who is moving: agent name or "human" (required)
  channel?: Channel     // 'human' | 'mcp' | 'rest' | 'cli' | 'system' (default: 'rest')
  reason?: string       // Required when to === 'blocked'
  afterTaskId?: string  // Insert after this task in target column
  beforeTaskId?: string // Insert before this task in target column
}
```

**Behavior:**

- When `channel === 'human'`: skip transition validation, skip log-entry guard, skip workflow done-guard.
- Position computed from `afterTaskId`/`beforeTaskId` neighbors. If neither provided, append to end.
- When `to === 'blocked'` and no `reason`: return 400 with `"reason required when moving to blocked"`.
- Single transaction: state change + position update + broadcast. No second reorder call needed.

### 5.2 Create Task (updated)

```
POST /api/plugins/tasks/
```

**New optional fields:**

```typescript
{
  // ...existing fields...
  afterTaskId?: string  // Insert after this task in the target column
}
```

If omitted, appends to end of column (default behavior).

### 5.3 Reorder (simplified)

```
POST /api/plugins/tasks/reorder
```

Unchanged contract. Implementation switches from `updated_at` hacking to `state_json.position` reassignment:

```typescript
{
  columnId: string,
  orderedIds: string[]
}
// Each ID gets position = i * POSITION_GAP in state_json
```

### 5.4 MCP Tools

MCP exec tools continue to use `channel: 'mcp'` (set automatically server-side). No changes to MCP tool parameters. Agents cannot set `channel: 'human'` — this is enforced in the MCP tool handlers which always override channel.

---

## 6. Frontend Changes

### 6.1 `handleDragEnd` Simplification

The two-step move+reorder becomes a single `/move` call with position data:

```typescript
// Before (two calls, race condition, hardcoded main-operator):
await apiFetch('/move', { from, to, agent: 'main-operator' })
await apiFetch('/reorder', { columnId, orderedIds })

// After (single call, atomic):
await apiFetch('/move', {
  from: fromCol,
  to: targetCol,
  agent: 'human',
  channel: 'human',
  afterTaskId: prevTask?.id,
  beforeTaskId: nextTask?.id,
})
```

### 6.2 Agent Field Fix

All UI-initiated moves use `agent: 'human'` and `channel: 'human'`. The hardcoded `'main-operator'` on line 335 of kanban-board.tsx is removed.

### 6.3 Blocked Reason Dialog

New component or reuse existing dialog pattern:

- Opens automatically when a drag-to-blocked completes.
- Text input for reason. Placeholder: "Why is this blocked?"
- Confirm → fires move API with reason. Cancel → reverts optimistic state.

### 6.4 Archived Column Display

In kanban view, the archived column renders as a **compact drop target**: column header with count badge, no card list. Clicking it navigates to the table view filtered to archived status.

### 6.5 Same-Column Reorder

Same-column reorder uses the same position logic: compute new position from neighbors, single `/move` call (or a lightweight `/reorder` with just the two affected IDs). No full-column reorder needed.

---

## 7. Startup & Migration

### 7.1 Plugin Migration

**File:** `plugins/tasks/migrations/{version}.ts`

Runs automatically during plugin activation via the existing `runMigrations()` system.

**Migration:**
1. Open OpenClaw `flow_runs` database.
2. Read all `bakin:task:*` rows.
3. Group by column, sort by `updated_at DESC` within each column.
4. Assign `state_json.position = i * POSITION_GAP` for each task.
5. Write back in a single SQLite transaction.
6. Log migration result via `createLogger('tasks:migration')`.

Only touches `state_json` — never modifies the OpenClaw schema.

### 7.2 Doctor Check

**Add diagnostic:** `tasks.position_integrity`

- Reads all Bakin tasks.
- Checks: every task has a numeric `position` in `state_json`.
- Checks: no two tasks in the same column share the same position.
- **Auto-fix:** If positions are missing or duplicated, reassign based on `updated_at` order.
- Status: `ok` (all good), `fixed` (repaired), `error` (repair failed).

### 7.3 Imitation Crab Seed

Update `dev/imitation-crab/fixtures/seed.sql` to include `position` values in `state_json` for all seeded tasks. This ensures `npm run dev:mock` produces a board with correct ordering out of the box.

### 7.4 Fresh Install Path

```
User runs `bakin init` → creates ~/.bakin/ directory structure
User runs `bakin start` → server boots → plugin registry activates tasks plugin
  → runMigrations() checks plugin-versions.json
  → If first run: records version, no migration needed (no existing tasks)
  → New tasks created via UI/API get position automatically
```

No special handling needed for fresh installs — position is assigned on task creation.

---

## 8. Testing Strategy

### 8.1 Backend: Position System

**File:** `tests/plugins/tasks/flow-store.test.ts` (extend)

| Test | Description |
|------|-------------|
| New task gets correct position | `position = max + GAP` in target column |
| New task in empty column | `position = POSITION_GAP` |
| Insert between two tasks | `position = midpoint(before, after)` |
| Insert at start of column | `position < first.position` |
| Insert at end of column | `position = last.position + GAP` |
| Position preserved on non-move mutations | assign, log, update don't change position |
| Rebalance on gap exhaustion | When gap < 1, all positions reset to `i * GAP` |
| Tasks returned in position order | `readTaskboard()` returns tasks sorted by position ASC |
| Reorder endpoint assigns clean positions | `orderedIds` → `i * GAP` |

### 8.2 Backend: Two-Tier Transitions

**File:** `tests/plugins/tasks/flow-store.test.ts` (extend)

| Test | Description |
|------|-------------|
| Agent: valid transition succeeds | `channel: 'mcp'`, todo → inProgress |
| Agent: invalid transition rejected | `channel: 'mcp'`, backlog → done → error |
| Agent: log entries required for done | `channel: 'mcp'`, no logs → error |
| Agent: workflow done-guard enforced | `channel: 'mcp'`, workflow task → done → error |
| Human: any transition succeeds | `channel: 'human'`, backlog → done → success |
| Human: no log entries needed for done | `channel: 'human'`, no logs → success |
| Human: workflow done-guard bypassed | `channel: 'human'`, workflow task → done → success |
| Human: blocked requires reason | `channel: 'human'`, → blocked without reason → error |
| MCP tools cannot set channel to human | Tool handler overrides to 'mcp' |

### 8.3 Backend: API Routes

**File:** `tests/plugins/tasks/routes.test.ts` (extend)

| Test | Description |
|------|-------------|
| Move with afterTaskId positions correctly | Card lands between specified neighbors |
| Move with channel=human bypasses guards | 200 for any transition |
| Move without channel enforces guards | 400 for invalid transition |
| Move to blocked without reason → 400 | Error message specifies reason required |
| Move to archived returns success | Task state updated correctly |
| Create with afterTaskId positions correctly | Card inserted at specified position |
| Reorder assigns clean positions | Positions are `i * GAP` after reorder |

### 8.4 Backend: Migration & Doctor

**File:** `tests/plugins/tasks/migration.test.ts` (new)

| Test | Description |
|------|-------------|
| Migration assigns positions to existing tasks | Tasks without position get `i * GAP` |
| Migration preserves column grouping | Each column's tasks get independent position sequences |
| Migration preserves existing order | `updated_at DESC` order becomes position order |
| Migration is idempotent | Running twice doesn't corrupt positions |
| Doctor detects missing positions | Tasks without position flagged |
| Doctor auto-fixes missing positions | Positions assigned, status = 'fixed' |
| Doctor detects duplicate positions | Two tasks same column same position flagged |
| Doctor auto-fixes duplicates | Positions reassigned, status = 'fixed' |

### 8.5 Frontend: DnD Behavior

**File:** `tests/components/kanban-dnd.test.tsx` (extend)

| Test | Description |
|------|-------------|
| Cross-column drop sends single /move call | No follow-up /reorder call |
| Move call includes afterTaskId/beforeTaskId | Position data derived from drop target |
| Move call uses agent='human', channel='human' | Not hardcoded 'main-operator' |
| Drop on blocked column opens reason dialog | Dialog renders after optimistic update |
| Blocked dialog confirm fires move with reason | API call includes reason field |
| Blocked dialog cancel reverts optimistic state | Card returns to source, no API call |
| Drop on archived hides card from board | Card filtered from kanban column, count increments |
| Same-column reorder sends correct position data | Single call with neighbor IDs |

### 8.6 Integration: End-to-End Flows

**File:** `tests/plugins/tasks/integration.test.ts` (new)

| Test | Description |
|------|-------------|
| Human drags backlog → done (full bypass) | Position correct, audit has channel=human |
| Agent moves backlog → done (rejected) | Error, task stays in backlog |
| Agent moves todo → inProgress → done | Happy path, positions maintained |
| Create 5 tasks, reorder, verify positions | Bulk ordering works |
| Move task between columns preserves other positions | Non-moved tasks unchanged |
| Concurrent creates don't collide positions | Two creates in same column get distinct positions |

---

## 9. Acceptance Criteria

### Must Have (P0)

- [ ] Weight-based `position` in `state_json` replaces `updated_at` ordering
- [ ] Cards land exactly where dropped — no jumping to top
- [ ] Single atomic move API call (no two-step move+reorder)
- [ ] `channel: 'human'` bypasses all transition guards
- [ ] UI sends `agent: 'human'` and `channel: 'human'` (not hardcoded 'main-operator')
- [ ] Drop on blocked prompts for reason via dialog
- [ ] Archived column: drop zone visible, card hidden from board, count incremented
- [ ] Plugin migration assigns positions to existing tasks on upgrade
- [ ] Doctor check verifies and auto-fixes position integrity
- [ ] Imitation Crab seed includes position data
- [ ] All existing backend tests pass with position system
- [ ] New tests for two-tier permissions (human vs agent)
- [ ] New tests for position insert/append/rebalance
- [ ] New tests for migration and doctor check

### Should Have (P1)

- [ ] Insertion line indicator between cards during drag
- [ ] Integration tests for end-to-end flows
- [ ] Same-column reorder via single atomic call (not full /reorder)

### Nice to Have (P2)

- [ ] Keyboard-accessible drag-and-drop (already wired with KeyboardSensor)
- [ ] Animated card insertion (smooth spring transitions)
- [ ] Undo last move (toast with undo button)

---

## 10. Out of Scope

- Changing the column set (7 columns stay as-is)
- Multi-user support (single operator system)
- Agent-facing UI (agents use MCP/API only)
- Task creation UX (separate spec)
- Workflow engine changes (only the done-guard bypass is in scope)
- Mobile-specific DnD optimizations
- Modifying OpenClaw's `flow_runs` schema (we only write to `state_json`)

---

## 11. Implementation Order

1. **Position in `state_json` + migration** — add position field, write migration, update queries to sort by `json_extract`
2. **Doctor check** — add `tasks.position_integrity` diagnostic with auto-fix
3. **Atomic move API** — single endpoint with `afterTaskId`/`beforeTaskId`, channel-based guard bypass
4. **Frontend: single move call** — remove two-step flow, fix agent field to 'human'
5. **Frontend: blocked reason dialog** — prompt on drop-to-blocked
6. **Frontend: archived column behavior** — compact display, count badge, filter from kanban
7. **Frontend: insertion indicator** — verify dnd-kit shifting or add custom indicator
8. **Update Imitation Crab seed** — add position values to fixture data
9. **Tests** — position tests, two-tier permission tests, migration tests, DnD tests, integration tests

---

## 12. Key Files

| Area | File | Changes |
|------|------|---------|
| Types | `plugins/tasks/types.ts` | Add `position?: number` to Task interface |
| Constants | `plugins/tasks/constants.ts` | Add `POSITION_GAP` constant |
| Store | `plugins/tasks/lib/flow-store.ts` | Position in state_json, json_extract ordering, channel-based guards, atomic move with position |
| Service | `src/core/task-service.ts` | Pass channel through, bypass workflow guard for human |
| Routes | `plugins/tasks/index.ts` | Accept channel + afterTaskId/beforeTaskId in /move |
| Migration | `plugins/tasks/migrations/{ver}.ts` | Backfill positions for existing tasks |
| Doctor | `src/core/doctor.ts` or health plugin | `tasks.position_integrity` check |
| Board | `plugins/tasks/components/kanban-board.tsx` | Single move call, agent='human', blocked dialog, archived behavior |
| Column | `plugins/tasks/components/kanban-column.tsx` | Archived compact mode, insertion indicator |
| Seed | `dev/imitation-crab/fixtures/seed.sql` | Add position to state_json in fixture data |
| Tests | `tests/plugins/tasks/flow-store.test.ts` | Position + permission tests |
| Tests | `tests/plugins/tasks/routes.test.ts` | API contract tests |
| Tests | `tests/plugins/tasks/migration.test.ts` | Migration + doctor tests |
| Tests | `tests/components/kanban-dnd.test.tsx` | DnD behavior tests |
| Tests | `tests/plugins/tasks/integration.test.ts` | End-to-end flow tests |

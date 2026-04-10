# Tasks Ordering v2 — Array Index = Order

> **Status:** Draft
> **Date:** 2026-04-09
> **Replaces:** Sparse integer position system (midpoint insertion)

---

## Problem

The midpoint position system (`POSITION_GAP = 1,000,000`, `computeInsertPosition`, `afterTaskId`/`beforeTaskId`) doesn't work for cross-column drag-and-drop. The fundamental issue: dnd-kit reports the dragged task itself as the `over` target after `handleDragOver` moves it into the target column, making it impossible to reliably determine where the user dropped the card relative to existing cards. Multiple attempted fixes (optimistic refs, pointer midpoint heuristics, within-column arrayMove) all failed or regressed same-column behavior.

## Solution

**Array index = order.** After every drop, snapshot the new array state and bulk-write it back. Zero-indexed, per-column, always contiguous.

### Data Shape

`state_json.order` — integer, per-column, zero-indexed:

```
backlog: [{ id: "t1", order: 0 }, { id: "t2", order: 1 }]
todo:    [{ id: "t3", order: 0 }]
```

Replaces `state_json.position` (sparse integers). The field name changes to `order` to make the semantic shift clear.

---

## Backend Changes

### `flow-store.ts`

**Remove entirely:**
- `POSITION_GAP` import/re-export
- `getColumnWhereClause()` 
- `getMaxPositionInColumn()`
- `getTaskPosition()`
- `getColumnPositions()`
- `computeInsertPosition()`
- `rebalanceColumn()`
- All `state.position = computeInsertPosition(...)` calls in `createTask`, `moveTask`, `blockTask`, `updateTask`, `moveTaskToInProgress`, `autoArchiveDoneTasks`

**Change `BakinTaskState`:**
```typescript
// Remove: position?: number
// Add:    order?: number
```

**Change `flowToTask`:**
```typescript
// Remove: position: state.position
// Add:    order: state.order
```

**Change `SELECT_ALL`:**
```sql
-- From:
ORDER BY json_extract(state_json, '$.position') ASC, updated_at DESC
-- To:
ORDER BY json_extract(state_json, '$.order') ASC, updated_at DESC
```

**Change `createTask`:**
- Remove `afterTaskId` parameter
- Set `state.order` to the count of existing tasks in the target column (appends to end)
- Simple: `state.order = getColumnTaskCount(db, colId)`

**New helper `getColumnTaskCount`:**
```typescript
function getColumnTaskCount(db: Database.Database, col: ColumnId): number {
  const where = getColumnWhereClause(col) // keep this one helper
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM flow_runs WHERE ${where}`).get()
  return (row as { cnt: number }).cnt
}
```

**Change `moveTask`:**
- Remove `afterTaskId`, `beforeTaskId` parameters
- Set `state.order` to `getColumnTaskCount(db, toCol)` (append to end of target column)
- Agent moves always append — the UI reorder call handles precise positioning

**Change `blockTask`:**
- Same: `state.order = getColumnTaskCount(db, 'blocked')`

**Change `reorderTasks`:**
```typescript
export function reorderTasks(columnId: ColumnId, orderedIds: string[]): Promise<void> {
  withDb(db => {
    const stmt = db.prepare(
      `UPDATE flow_runs SET state_json = json_set(state_json, '$.order', ?), revision = revision + 1, updated_at = ? WHERE flow_id = ?`
    )
    const now = Date.now()
    const reorder = db.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        stmt.run(i, now, orderedIds[i])
      }
    })
    reorder()
  })
  broadcastChange()
}
```

Zero-indexed. `orderedIds[0]` gets `order: 0`, etc.

**Keep `getColumnWhereClause`** — still needed for `getColumnTaskCount`.

### `constants.ts`

Remove `POSITION_GAP`.

### `types.ts`

```typescript
// Remove: position?: number
// Add:    order?: number
```

### `task-service.ts`

- Remove `afterTaskId`, `beforeTaskId` from `moveTaskWithEffects` opts
- Remove `reason` from `moveTaskWithEffects` opts (move it back to only being on blockTaskWithEffects)

### `index.ts` (routes)

**`POST /:taskId/move`:**
- Remove `afterTaskId`, `beforeTaskId` from body extraction
- For `to === 'blocked'` with reason: call `blockTaskWithEffects` (not `moveTaskWithEffects`)
- Simplify back to the original two-path approach

**`POST /reorder`:**
- No changes needed — same contract: `{ columnId, orderedIds }`
- Implementation writes `order: i` instead of `position: i * POSITION_GAP`

**Hook handlers:**
- `tasks.moveTask`: remove `afterTaskId`, `beforeTaskId`, `reason` params
- `tasks.createTask`: remove `afterTaskId` param

### Migration `2.1.0.ts`

Update to write `order` instead of `position`. Same logic: group by column, sort by `updated_at DESC`, assign `order: i`.

### Doctor check

Update to check `order` instead of `position`. Same logic.

### Seed data

Replace `"position": N` with `"order": N` (zero-indexed per column).

---

## Frontend Changes

### `kanban-board.tsx` — `handleDragEnd`

**Same-column reorder (already works, keep as-is):**
```typescript
const reordered = arrayMove(colTasks, oldIndex, newIndex)
await apiFetch('/reorder', { columnId, orderedIds: reordered.map(t => t.id) })
```

**Cross-column move (the broken part — simplify completely):**

```typescript
// 1. Remove task from source column
const sourceTasks = originalColumns[fromCol].filter(t => t.id !== task.id)

// 2. Build target column — find drop index from overId
const destTasks = [...originalColumns[targetCol]]
let dropIndex = destTasks.length // default: append

if (!COLUMN_ORDER.includes(overId as ColumnId)) {
  const idx = destTasks.findIndex(t => t.id === overId)
  if (idx !== -1) {
    // Use pointer position to determine before/after
    const pointerY = (event.activatorEvent as PointerEvent).clientY + event.delta.y
    const midY = over.rect.top + over.rect.height / 2
    dropIndex = pointerY > midY ? idx + 1 : idx
  }
}

// 3. Insert task at drop position
destTasks.splice(dropIndex, 0, movedTask)

// 4. Optimistic update
setOptimistic({ columns: { ...originalColumns, [fromCol]: sourceTasks, [targetCol]: destTasks } })

// 5. Move task to new column (appends to end on backend)
await apiFetch('/move', { from, to, agent: 'human', channel: 'human' })

// 6. Reorder BOTH columns to persist correct order
await apiFetch('/reorder', { columnId: fromCol, orderedIds: sourceTasks.map(t => t.id) })
await apiFetch('/reorder', { columnId: targetCol, orderedIds: destTasks.map(t => t.id) })

// 7. Refresh
await refreshTaskboard()
setOptimistic(null)
```

**Key difference from current approach:** We DON'T use `dragOptimisticRef` or `handleDragOver`'s state for the drop position. We compute it fresh in `handleDragEnd` from `originalColumns` + the pointer midpoint heuristic.

**When `overId === task.id`** (the common problem case): `destTasks.findIndex(t => t.id === overId)` returns -1 because the dragged task isn't in `originalColumns[targetCol]`. We fall through to `dropIndex = destTasks.length` (append). This is imperfect but acceptable — the task lands at the end of the column instead of exactly where dropped. The user can then same-column reorder (which works perfectly) to fine-tune.

**Better alternative for `overId === task.id`:** Check `event.collisions` for the next-closest card that ISN'T the dragged task:

```typescript
if (overId === task.id && event.collisions) {
  const other = event.collisions.find(c => String(c.id) !== task.id && !COLUMN_ORDER.includes(String(c.id) as ColumnId))
  if (other) {
    const idx = destTasks.findIndex(t => t.id === String(other.id))
    if (idx !== -1) {
      // use pointer midpoint against this card's rect
    }
  }
}
```

### `handleDragOver` — no changes

Keep the existing cross-column move logic (visual displacement). The `currentCol === targetCol` bail-out stays. `handleDragOver` is only for visual feedback, not for computing the final order.

### Remove `dragOptimisticRef`

It's dead code. Remove the ref declaration, all assignments, and all reads.

### Blocked dialog

The blocked dialog flow stays. On drop to blocked: set optimistic state, open dialog. On confirm: call `/move` with reason, then `/reorder` for both columns. On cancel: revert.

---

## What Stays the Same

- Two-tier permissions (`channel: 'human'` bypasses guards) — fully working, no changes
- `agent: 'human'` on all UI moves — no changes
- Blocked reason dialog — no changes (just update the API calls inside it)
- Archived compact column — no changes
- Same-column reorder — already works, no changes
- All backend permission/guard logic — no changes
- Migration system — update existing migration
- Doctor check — update field name

## What Gets Simpler

- No `computeInsertPosition`, no midpoint math, no rebalancing
- No `afterTaskId`/`beforeTaskId` params anywhere
- No `dragOptimisticRef`
- `reorderTasks` writes `order: i` (contiguous integers) instead of `position: i * 1M`
- `createTask`/`moveTask`/`blockTask` just append (`order = count`)
- Cross-column DnD: `arrayMove`-style splice + bulk reorder, same pattern as same-column

---

## Acceptance Criteria

- [ ] Same-column reorder works (already does — don't break it)
- [ ] Cross-column to empty column works (append)
- [ ] Cross-column to populated column: card lands at or near drop position
- [ ] Blocked dialog flow works
- [ ] Agent moves via MCP append to end of target column
- [ ] All existing permission tests pass
- [ ] Migration updates existing data from `position` to `order`
- [ ] `order` field visible on cards (temporarily, for verification)

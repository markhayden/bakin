# Activity Feed Fix Plan

**Two problems:** (1) live updates don't show until manual browser refresh, (2) the entries that do show are too coarse — just "Dispatched" / "Moved to Done" with no visibility into what agents are actually doing.

---

## Problem 1: Live Updates Not Arriving

### Root Cause

The `ActivityFeed` component (`src/components/tasks/activity-feed.tsx`) opens **its own** `EventSource` connection to `/api/events` (line ~155). Meanwhile, the app-level `useSSE` hook (`src/hooks/use-sse.ts`) opens a **separate** `EventSource` that feeds into the Zustand `useContentStore`.

The activity feed **does not read from the content store** — it manages its own local `events` state array. This means:

- The activity feed's SSE connection is completely independent from the app's SSE
- If the activity feed's SSE connection drops or fails, it has no fallback
- But the bigger issue: **the SSE broadcast IS working** (the server-side code in `sse.ts` and `audit.ts` is correct — `appendAudit()` calls `broadcastAuditEvent()` which calls `broadcast()` to all connected clients)

**So why no live updates?** Look at what the activity feed listens for in its `onmessage`:

```typescript
// It handles: data.type === 'activity'
// It handles: data.type === 'audit' && data.entry
// It handles: data.type === 'plugin-event' (workflow events)
// It handles: data.type === 'alert'
```

And what the server broadcasts:
- `appendAudit()` → `broadcastAuditEvent()` → broadcasts `{ type: 'audit', entry, timestamp }` ✅
- `/api/activity/emit` → broadcasts `{ type: 'activity', agent, message, ts }` ✅
- Watcher → broadcasts `{ file, content, event, timestamp }` — **no type field** ❌ (but this isn't activity data)

The types look correct. The most likely issue is that **the activity feed's EventSource connects to the Next.js API route**, while the **real SSE clients set is on the custom server**. Let me verify:

The custom server at `server.ts:105-106` intercepts `/api/events` and calls `handleSSE()` from `src/core/sse.ts`. This runs on the raw Node HTTP server **before** Next.js handles the request. So the EventSource SHOULD hit the custom server handler.

**But wait** — the activity feed component creates `new EventSource('/api/events')`. If Next.js has its own route for `/api/events`, it could be intercepting this. Check if `src/app/api/events/route.ts` exists — if so, Next.js middleware or the dev server could be routing the request differently than the production custom server.

### Investigation Steps (for the dev doing this)

1. **Check if `/api/events` has a Next.js route file:**
   ```bash
   find src/app/api/events -type f 2>/dev/null
   ```
   If this exists, it could be competing with the custom server's handler.

2. **Verify the EventSource is actually connecting** — open browser DevTools → Network → filter "events" → check if the SSE connection is open and receiving messages. If you see `:ping` keepalives, the connection is live.

3. **Check for duplicate EventSource connections** — the `useSSE` hook AND `ActivityFeed` both open EventSources. That's 2 connections per browser tab. The SSE server has a `maxClients` limit. Not likely the issue but worth noting.

### Fix

**Option A (recommended): Unify SSE consumption.** Remove the independent EventSource from `ActivityFeed`. Instead:

1. Add an `activityEvents` array to the Zustand `useContentStore`
2. In `use-sse.ts`, when receiving `type: 'audit'`, `type: 'activity'`, or `type: 'plugin-event'`, append to the store's `activityEvents`
3. In `ActivityFeed`, consume from the store instead of running its own EventSource
4. Keep the initial `fetchEvents()` call for hydration on mount

This eliminates the duplicate connection and ensures the activity feed uses the same SSE pipe that's already proven to work for file updates.

**Option B (quick fix):** Debug why the ActivityFeed's EventSource isn't receiving. Add `console.log` in the `onmessage` handler to verify events arrive. If they don't, the custom server might not be intercepting the second connection properly.

---

## Problem 2: Activity Feed Granularity

### Root Cause

The activity feed has exactly **two data sources**:

1. **`audit.jsonl`** — system-level events: `task.created`, `task.moved`, `task.dispatched`, `workflow.gate_approved`, etc. These are infrastructure events, not agent narration.

2. **Task log entries** — agents post these via `POST /api/plugins/tasks/:taskId/log`. But agents currently barely use this. Looking at the dispatch message in `dispatch.ts`, agents are *told* to log:

   > "Log your progress at EVERY major step — not just start and done."

   But the instructions are buried in a wall of text, and agents typically only log at the very start and very end (e.g., Pixel logs "Starting Pop-Tart image generation" and "Image generated successfully" — nothing in between).

### What's Missing

When Pixel runs, the actual flow is:
1. Receives dispatch message
2. Reads skill file, plans approach
3. Crafts an image prompt
4. Calls Gemini/Nano Banana API
5. Reviews the result
6. Maybe iterates
7. Saves the asset
8. Submits workflow output

Of those 8 steps, only 1 and 8 produce log entries. Steps 2-7 are invisible.

### Fix: Two-Part Approach

#### Part A: New `/api/activity/emit` endpoint for lightweight agent narration

This endpoint already exists (handled in `server.ts:190-196`) and broadcasts `{ type: 'activity' }` events. The task log API (`/api/plugins/tasks/:taskId/log`) also fire-and-forgets to `/api/activity/emit`. So the plumbing is there.

**What's needed:** A simpler, lower-friction logging endpoint that agents can call frequently without it being persisted to the task database. Think of it as "ephemeral narration" vs "permanent log."

The current `/api/activity/emit` is perfect for this but it's **not in any agent's dispatch instructions**. Agents only know about `/api/plugins/tasks/:taskId/log`.

**Action items:**

1. **Add the activity emit URL to dispatch messages.** In `dispatch.ts`, in both `buildDispatchMessage()` and `buildWorkflowDispatchMessage()`, add:
   ```
   **Narrate progress (live feed, not persisted):**
   curl -s -X POST http://localhost:${port}/api/activity/emit \
     -H 'Content-Type: application/json' \
     -d '{"agent":"${agentName}","message":"your narration","taskId":"${task.id}"}'
   ```

2. **Add `taskId` to the activity broadcast** so the feed can associate narration with tasks. Update `server.ts` activity emit handler:
   ```typescript
   broadcast({
     type: 'activity',
     agent: payload.agent,
     message: payload.message,
     taskId: payload.taskId,  // ADD THIS
     ts: payload.ts
   })
   ```

3. **Update dispatch instructions to be explicit about WHAT to narrate.** Replace the current vague "log at every major step" with specific guidance per agent type:

   For **Pixel** (image generation):
   ```
   Narrate: "Reading creative brief", "Crafting image prompt: [summary]",
   "Requesting generation from Gemini (1024x1024)", "Image received, reviewing quality",
   "Saving asset to [path]", "Submitting workflow output"
   ```

   For **Chef** (copy/strategy):
   ```
   Narrate: "Reviewing content calendar", "Researching topic: [topic]",
   "Writing first draft", "Refining caption and hashtags",
   "Assembling final copy package", "Submitting for review"
   ```

   For **Patch** (dev):
   ```
   Narrate: "Reading codebase", "Planning approach: [summary]",
   "Spawning Claude Code for implementation", "Claude Code working on [file]",
   "Build/test complete", "Submitting output"
   ```

   Put these in the dispatch message as **required narration points**, not suggestions.

#### Part B: Update ActivityFeed component to handle the richer data

1. **Show `taskId` context** — when an activity event has a `taskId`, show the task title as a subtitle (the component already does this for `type: 'log'` events but not for `type: 'activity'`).

2. **Add the `activity` type to `mapAuditMessage`** — or better, just pass through the message directly since activity events are already human-readable.

3. **Consider grouping by task** — when the feed gets busy, group consecutive events from the same task together with a collapsible section.

---

## Implementation Order

1. **Fix live updates first** (Problem 1, Option A) — unify SSE into the content store. This is the highest-impact fix because without it, nothing else matters.

2. **Add `taskId` to activity emit broadcast** — one-line change in `server.ts`.

3. **Add narration endpoint to dispatch messages** — update both `buildDispatchMessage()` and `buildWorkflowDispatchMessage()` in `dispatch.ts`.

4. **Add per-agent narration guidance** — update dispatch message builders with specific narration points.

5. **Update ActivityFeed to show task context for activity events** — small component tweak.

---

## Files to Touch

| File | Change |
|------|--------|
| `src/hooks/use-content-store.ts` | Add `activityEvents` array + `appendActivityEvent` + `setActivityEvents` |
| `src/hooks/use-sse.ts` | Route `audit`, `activity`, `plugin-event` into store's activity events |
| `src/components/tasks/activity-feed.tsx` | Remove own EventSource, consume from store, handle `taskId` on activity events |
| `server.ts` (line ~192) | Add `taskId` to activity broadcast payload |
| `src/core/dispatch.ts` | Add narration endpoint URL to both dispatch message builders; add per-agent narration guidance |

---

## Testing

After implementing:
1. Open Beacon dashboard, verify the green SSE dot is connected
2. Create a test task assigned to Pixel
3. Watch the activity feed — you should see Pixel's narration appear in real time without refreshing
4. Verify audit events (task.created, task.moved, task.dispatched) also appear live
5. Check browser DevTools Network tab — should only see ONE EventSource connection, not two

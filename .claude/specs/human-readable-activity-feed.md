# Spec: Human-Readable Activity Feed

## Objective

The activity feed currently displays raw event/command names like `exec.bakin_exec_workflows_get_definition.ok` as the primary text. These are cryptic and meaningless to a human operator. This spec defines the work to give **every** activity event a human-readable label as the primary display text, with the raw command name shown as secondary muted text underneath.

**Target user:** Single operator (main-operator) monitoring agent activity from the dashboard.

**Desired outcome:** Glance at the activity feed and immediately understand what each agent is doing without mentally parsing `exec.bakin_exec_*` strings.

## Current State

### What exists
- `mapAuditMessage()` in `src/lib/map-audit-message.ts` handles ~16 domain events (`task.created`, `workflow.step_complete`, etc.) with good human-readable text
- For `exec.*` events (all MCP tool calls), the function falls through to `default: return event` — returning the raw event name as the message
- The `ActivityEvent` type already has an `eventName` field, but it's only set for audit events
- The UI (`activity-feed.tsx`) renders `evt.message` as the sole text line with no distinction between human label and raw command

### What's broken
- 77 exec tools generate audit events like `exec.bakin_exec_tasks_create.ok` with no human-readable mapping
- All `exec.*` events show as raw strings in the feed (see screenshot)
- No way to toggle verbosity — the raw command names are useful for debugging but shouldn't be the primary display

## Design

### 1. Add `label` and `activityDuplicate` to `ExecToolDefinition`

Add optional fields to the `ExecToolDefinition` interface in `packages/core/src/plugin-types.ts`:

```typescript
export interface ExecToolDefinition {
  name: string
  description: string
  label?: string              // Short human-readable action phrase for activity feed (e.g., "Created a task")
  activityDuplicate?: boolean // Handler already emits a domain audit event — auto-audit tagged duplicate
  parameters: Record<string, unknown>
  handler: (params: Record<string, unknown>, agent: string, ctx?: PluginToolContext) => Promise<ExecToolResult>
  source?: string
}
```

Labels are co-located with each tool definition — plugins own their labels, no separate map needed.

### 2. Add `label` to Every `registerExecTool()` Call

Update all 77 `registerExecTool()` calls across plugins and script tools to include a `label` field. Examples:

```typescript
// plugins/tasks/index.ts
ctx.registerExecTool({
  name: 'bakin_exec_tasks_create',
  label: 'Created a task',                    // NEW
  description: 'Create a new task on the board...',
  ...
})

// plugins/workflows/index.ts
ctx.registerExecTool({
  name: 'bakin_exec_workflows_complete_step',
  label: 'Completed workflow step',           // NEW
  description: 'Mark a workflow step as complete...',
  ...
})

// scripts/lib/heartbeat.ts
addExecTool({
  name: 'bakin_exec_heartbeat',
  label: 'Sent heartbeat',                    // NEW
  description: '...',
  ...
})
```

Full label list for all 77 tools (grouped by plugin):

**Tasks (11):** Listed tasks, Read task details, Created a task, Updated a task, Deleted a task, Moved a task, Completed a task, Blocked a task, Assigned a task, Logged progress, Set task dependency

**Workflows (10):** Listed workflows, Listed workflow runs, Read workflow definition, Read workflow instance, Started a workflow, Read workflow step, Completed workflow step, Submitted workflow step, Checked workflow gates, Read workflow step

**Assets (10):** Listed assets, Read asset details, Saved an asset, Deleted an asset, Linked an asset, Audited assets, Emptied asset trash, Listed trashed assets, Restored an asset, Permanently deleted an asset

**Projects (15):** Listed projects, Read project details, Created a project, Updated a project, Deleted a project, Added project item, Marked project item, Removed project item, Linked project item, Updated project item, Promoted project item, Toggled project item, Attached asset to project, Detached asset from project, Asked project question

**Schedule (10):** Listed scheduled jobs, Read schedule details, Created a scheduled job, Updated a scheduled job, Deleted a scheduled job, Paused a scheduled job, Triggered scheduled job, Listed schedule runs, Parsed cron expression, Generated schedule briefing

**Messaging (15):** Listed messages, Read message details, Created a message, Updated a message, Deleted a message, Approved a message, Rejected a message, Listed brainstorm sessions, Read brainstorm session, Created brainstorm session, Updated brainstorm session, Deleted brainstorm session, Sent brainstorm message, Confirmed brainstorm proposal, Updated brainstorm proposal

**Team (8):** Listed team, Listed team members, Read own team, Read organization, Read agent profile, Checked agent status, Read agent file, Sent a message

**Models (2):** Listed models, Read model config

**Health (2):** Checked system health, Ran diagnostics

**Scripts (5):** Logged message, Sent heartbeat, Resolved paths, Generated an image, Posted to Discord

### 3. Flow the Label Through Audit Data

In `src/core/mcp-server.ts`, include `tool.label` in the audit data so it reaches the client via SSE:

```typescript
appendAudit(
  getContentDir(),
  result.ok ? `exec.${tool.name}.ok` : `exec.${tool.name}.fail`,
  agent,
  { taskId, label: tool.label, ...(result.ok ? {} : { error: result.error }) },  // label added
  'mcp',
)
```

This way `mapAuditMessage()` on the client can read `data.label` — no server-only registry lookup needed.

### 4. Update `mapAuditMessage()`

Extend `src/lib/map-audit-message.ts` to handle `exec.*` events using the label from data:

```typescript
// Before the default case, add:
if (event.startsWith('exec.')) {
  const suffix = event.endsWith('.fail') ? ' (failed)' : event.endsWith('.error') ? ' (error)' : ''
  if (data.label) return `${data.label}${suffix}`
  // Fallback for tools without a label: humanize the name
  const toolName = event.replace(/^exec\./, '').replace(/\.(ok|fail|error)$/, '')
  return humanizeExecName(toolName) + suffix
}
```

Add a `humanizeExecName()` fallback that converts `bakin_exec_foo_bar` → `"Foo bar"` so any future tools registered without a label still render readably.

### 5. Preserve Raw Event Name for Display

The `eventName` field on `ActivityEvent` already exists and is set for audit events in `use-sse.ts:82`. No type changes needed — the field is already there. Just ensure it's always populated (it already is for audit events, which is the path exec events take).

### 4. UI Changes — `activity-feed.tsx`

Update the event rendering to show:
1. **Primary line:** Human-readable message (already in `evt.message` after map-audit-message changes)
2. **Secondary line:** Raw event name in small muted text (from `evt.eventName`)

```tsx
{/* Human-readable message — primary */}
<p className="text-[12px] leading-snug break-words text-foreground/80">
  {evt.message}
</p>
{/* Raw command name — secondary, muted, only when verbose + eventName exists */}
{verbose && evt.eventName && (
  <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate font-mono">
    {evt.eventName}
  </p>
)}
```

### 5. Verbose Toggle

Add a toggle button in the activity feed header bar (next to "Live Activity" text):

- Label: "Verbose" (or just a code icon toggle)
- State persisted to `localStorage` key `bakin-activity-verbose`
- Default: **on** (show raw command names)
- When off: hides the secondary `eventName` line from all events

Implementation in `activity-feed.tsx`:
```tsx
const [verbose, setVerbose] = useState(() => {
  if (typeof window === 'undefined') return true
  return localStorage.getItem('bakin-activity-verbose') !== 'false'
})
```

Toggle button in header alongside the close chevron.

### 6. Activity API Hydration

Update `src/app/api/activity/route.ts` to ensure the `eventName` field is included in the response for audit events (it already maps through `mapAuditMessage`, just verify `eventName` is passed through).

### 7. Duplicate Event Filtering (`activityDuplicate`)

Many exec tool handlers emit domain audit events (e.g., `task.created`, `asset.deleted`) via `ctx.activity.audit()` — then the auto-audit from `mcp-server.ts` adds a second event for the same action (`exec.bakin_exec_tasks_create.ok`). This creates noisy duplication in the feed.

**Solution:** Add `activityDuplicate?: boolean` to `ExecToolDefinition`. When set, `mcp-server.ts` tags the auto-audit with `duplicate: true`. The activity feed hides duplicates by default, with a Bug icon toggle to show them.

```typescript
ctx.registerExecTool({
  name: 'bakin_exec_tasks_create',
  label: 'Created a task',
  activityDuplicate: true,  // handler calls createTaskWithEffects → appendAudit('task.created')
  ...
})
```

**Rules for `activityDuplicate`:**
- Set `true` only when the handler or its effect functions emit a domain audit event
- Do NOT set on tools where the auto-audit is the only activity event (e.g., read-only tools, tools with no domain event)
- When set, the manual `ctx.activity.log()` call in the handler should be removed — the domain event + label cover the same information

**UI:** Bug icon toggle in the feed header. Off by default (hides duplicates). State persisted to `localStorage` key `bakin-activity-show-duplicates`. Raw event names (`evt.eventName`) always shown for all visible events regardless of toggle state.

## Acceptance Criteria

1. Every exec tool call shows a human-readable label as the primary text (e.g., "Completed workflow step" instead of `exec.bakin_exec_workflows_complete_step.ok`)
2. Failed/errored exec calls append "(failed)" or "(error)" to the label
3. Raw event name shown as small muted mono text below the message for all events
4. Duplicate events (from tools with `activityDuplicate: true`) hidden by default
5. Bug icon toggle in header to show/hide duplicates, persisted to localStorage
6. Existing domain events (task.created, workflow.gate_reached, etc.) continue working unchanged
7. Unknown future exec tools get a reasonable auto-humanized fallback
8. The `/api/activity` hydration endpoint returns the same human-readable text as real-time SSE events
9. No manual `ctx.activity.log()` calls in exec tool handlers that have `activityDuplicate: true`

## Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/plugin-types.ts` | Add optional `label?: string` to `ExecToolDefinition` |
| `plugins/tasks/index.ts` | Add `label` to all 11 `registerExecTool()` calls |
| `plugins/workflows/index.ts` | Add `label` to all 10 `registerExecTool()` calls |
| `plugins/assets/index.ts` | Add `label` to all 10 `registerExecTool()` calls |
| `plugins/projects/index.ts` | Add `label` to all 15 `registerExecTool()` calls |
| `plugins/schedule/index.ts` | Add `label` to all 10 `registerExecTool()` calls |
| `plugins/messaging/index.ts` | Add `label` to all 15 `registerExecTool()` calls |
| `plugins/team/index.ts` | Add `label` to all 8 `registerExecTool()` calls |
| `plugins/models/index.ts` | Add `label` to all 2 `registerExecTool()` calls |
| `plugins/health/index.ts` | Add `label` to all 2 `registerExecTool()` calls |
| `scripts/lib/*.ts` | Add `label` to all 5 script `addExecTool()` calls |
| `src/core/mcp-server.ts` | Include `tool.label` in `appendAudit()` data |
| `src/lib/map-audit-message.ts` | Add `exec.*` handling using `data.label` + `humanizeExecName()` fallback |
| `src/components/tasks/activity-feed.tsx` | Two-line rendering (message + eventName) + verbose toggle |
| `src/app/api/activity/route.ts` | Verify `eventName` in hydrated responses (likely already works) |

## Files Also Modified

- `src/types/index.ts` — added `duplicate?: boolean` to `ActivityEvent`
- `src/hooks/use-sse.ts` — propagates `duplicate` from audit entry data
- `src/app/api/activity/route.ts` — propagates `duplicate` in hydration endpoint

## Testing Strategy

- **Unit test** `mapAuditMessage()`: verify exec event mapping (ok, fail, error suffixes), fallback humanization, and that existing domain events still pass (14 tests in `tests/lib/map-audit-message.test.ts`)
- **Manual verification**: run the app, trigger agent activity, confirm the feed shows human-readable text with raw names underneath, verify duplicate toggle works

## Boundaries

### Always
- Labels live on the `ExecToolDefinition` — plugins own their labels
- Include a humanized fallback for tools without explicit labels
- Preserve the raw event name for debugging (always visible as muted mono text)

### Never
- Create a centralized label map file — labels are co-located with tool registrations
- Add `ctx.activity.log()` to exec tool handlers that have `activityDuplicate: true`
- Add new dependencies

### Ask first
- If a tool's label is ambiguous or could be interpreted multiple ways

## Commit Strategy

1. **Commit 1:** `feat(core): add label field to ExecToolDefinition` — type change in `packages/core/src/plugin-types.ts`
2. **Commit 2:** `feat(plugins): add labels to all exec tool registrations` — all 77 `registerExecTool()`/`addExecTool()` calls across 10 plugins + scripts
3. **Commit 3:** `feat(activity): flow labels through audit and map to display text` — `mcp-server.ts` passes `tool.label` in audit data, `map-audit-message.ts` reads it with `humanizeExecName()` fallback
4. **Commit 4:** `feat(activity): show human-readable labels with verbose toggle` — UI changes in `activity-feed.tsx` (two-line rendering + header toggle)
5. **Commit 5:** `test(activity): add exec tool label and message mapping tests` — unit tests for mapAuditMessage exec handling
6. **Commit 6:** `feat(activity): add duplicate filtering to reduce feed noise` — `activityDuplicate` field, duplicate tag in auto-audit, UI toggle with Bug icon
7. **Commit 7:** `refactor(plugins): remove duplicate ctx.activity.log from exec handlers` — remove manual log calls where domain events + labels cover the same info
8. **Commit 8:** `docs(knowledge): document exec tool label and duplicate patterns` — update plugin-system.md and spec

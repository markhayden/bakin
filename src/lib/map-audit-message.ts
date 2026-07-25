import type { ActivityEvent } from '@/types'

/** Map an audit event name + data into a human-readable message */
export function mapAuditMessage(event: string, data: Record<string, unknown>): string {
  switch (event) {
    case 'task.dispatched': return `Dispatched: ${data.title}`
    case 'task.triaged': return `Triaged: ${data.title}`
    case 'task.created': return `Created task: ${data.title}`
    case 'task.deleted': return `Deleted task: ${data.title}`
    case 'task.moved': return `Moved "${data.title}" → ${data.to}`
    case 'task.assigned': return `Assigned "${data.title}" to ${data.assignee}`
    case 'task.blocked': return `Blocked: ${data.title} — ${data.reason || 'no reason'}`
    case 'task.dispatch_failed': {
      if (data.category === 'model_provider_unavailable') return 'Dispatch failed: model provider unavailable'
      if (typeof data.summary === 'string') return data.summary
      if (typeof data.error === 'string' && data.error.startsWith('Dispatch failed:')) return data.error
      return `Dispatch failed: ${data.error || 'unknown error'}`
    }
    case 'task.updated': return `Updated: ${data.title}`
    // Route receipt (work-class routing): what the matrix chose and why.
    case 'task.routed': {
      const parts = [data.model, data.thinking ? `thinking ${data.thinking}` : null].filter(Boolean)
      const via = typeof data.source === 'string' && data.source !== 'inherit'
        ? ` via ${data.source === 'class' ? 'class route' : String(data.source).replace(/^tag:/, 'tag "') + '"'}`
        : ''
      return `Routed to ${parts.join(', ') || 'override'}${via}`
    }
    // Ledger-suppression events fire exactly when the user is most confused —
    // explain the system behaved correctly instead of echoing the event name.
    case 'task.completion_suppressed':
      return `Ignored a duplicate completion${data.title ? ` of "${data.title}"` : ''} — ${data.firstAgent || 'another run'} had already completed this task${data.firstChannel ? ` via ${data.firstChannel}` : ''}.`
    case 'task.dispatch_failure_ignored':
      return `A session error arrived after "${data.title || data.id}" had already moved to ${data.column || 'done'} — no action needed.`
    case 'team.message_blocked':
      return `Blocked a message to ${data.agentId} — they are already running task ${data.taskId}.`
    // Brands (#419)
    case 'brand.injected': return `Brand '${data.brandId}' injected into dispatch${data.cardBytes ? ` (${data.cardBytes} B card)` : ''}`
    case 'brand.dispatch_blocked': return typeof data.message === 'string' ? data.message : `Task waiting on missing brand '${data.brandId}'`
    case 'brand.asset_missing': return `Brand '${data.brandId}' has missing asset references`
    case 'brand.created': return `Created brand '${data.brandId}'`
    case 'brand.updated': return `Updated brand '${data.brandId}'`
    case 'brand.deleted': return `Deleted brand '${data.brandId}'`
    // Same-agent concurrency: these fire exactly when behavior looks odd —
    // explain what the system did instead of echoing raw event keys.
    case 'task.worktree_materialized':
      return `Working in an isolated worktree of ${typeof data.repoPath === 'string' ? data.repoPath.split('/').pop() : 'the bound repo'} on branch ${data.branch} — the branch survives after the task settles`
    case 'task.turn_aborted':
      return data.reason === 'superseded'
        ? `Stopped a stale attempt on "${data.title || data.id}" — a fresh attempt takes over`
        : `Stopped the in-flight attempt on "${data.title || data.id}"${data.reason ? ` (${data.reason})` : ''}`
    case 'task.turn_force_released':
      return `Released a hung attempt on task ${data.id} — its dispatch slot is free again`
    case 'task.run_superseded':
      return `Superseded a stalled attempt on "${data.title || data.id}" — it will be re-dispatched`
    case 'task.repo_binding_blocked':
      return typeof data.error === 'string' ? `Task blocked: ${data.error}` : `Task blocked: repo binding failed`
    case 'dispatch.concurrency_clamped':
      return `Per-agent parallelism clamped to 1: the active runtime cannot isolate same-agent turns (requested ${data.requested})`
    case 'asset.stale_run_write_suppressed':
      return `Recorded a late save from a superseded run as version ${data.version} of ${data.assetId} WITHOUT promoting it — the current deliverable is unchanged`
    case 'system.init': return 'Bakin started'
    case 'system.dispatch_error': return `Dispatch failed: ${data.error || 'unknown error'}`
    case 'workflow.step_dispatched': return `Step "${data.label || 'unknown'}" dispatched to ${data.agent || 'agent'}`
    case 'workflow.step_complete': return `Step "${data.label || 'unknown'}" completed`
    case 'workflow.gate_reached': return `Awaiting approval: ${data.label || 'gate'}`
    case 'workflow.gate_approved': return `Approved: ${data.label || 'gate'}`
    case 'workflow.gate_rejected': return `Rejected: ${data.label || 'gate'}${data.reason ? ` — ${data.reason}` : ''}`
    case 'workflow.complete': return `Workflow complete${data.workflowId ? ` (${data.workflowId})` : ''}`
    default: {
      // Plugin audit events may carry their own human-readable line — honor
      // it instead of echoing the raw event name (e.g. assets.asset.enriched).
      if (typeof data.message === 'string' && data.message.trim()) return data.message
      // Exec tool events: use label from audit data, fall back to humanized name
      if (event.startsWith('exec.')) {
        const suffix = event.endsWith('.fail') ? ' (failed)' : event.endsWith('.error') ? ' (error)' : ''
        if (data.label) return `${data.label}${suffix}`
        const toolName = event.replace(/^exec\./, '').replace(/\.(ok|fail|error)$/, '')
        return humanizeExecName(toolName) + suffix
      }
      return event
    }
  }
}

/** Convert an exec tool name like "bakin_exec_foo_bar" into "Foo bar" */
export function humanizeExecName(name: string): string {
  const stripped = name.replace(/^bakin_exec_/, '')
  const words = stripped.split('_')
  if (words.length === 0) return name
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1)
  return words.join(' ')
}

/** Filter out infrastructure noise that isn't useful in the user-facing feed */
export function isNoisyEvent(evt: ActivityEvent): boolean {
  if (evt.agent === 'system' && evt.message.startsWith('Dispatch failed')) return true
  if (evt.eventName && isReadOnlyExecOk(evt.eventName)) return true
  // Internal invariant-violation breadcrumb (dispatch debugging) — belongs in
  // audit.jsonl and logs, not the user-facing feed.
  if (evt.eventName === 'dispatch.registry_clobber') return true
  return false
}

function isReadOnlyExecOk(eventName: string): boolean {
  if (!eventName.startsWith('exec.') || !eventName.endsWith('.ok')) return false
  const toolName = eventName.replace(/^exec\./, '').replace(/\.ok$/, '')
  if (toolName === 'bakin_exec_get_paths' || toolName === 'bakin_exec_heartbeat') return true
  return /_(list|get|query|search)$/.test(toolName)
}

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
    case 'task.updated': return `Updated: ${data.title}`
    case 'system.init': return 'Bakin started'
    case 'system.dispatch_error': return `Dispatch failed: ${data.error || 'unknown error'}`
    case 'workflow.step_dispatched': return `Step "${data.label || 'unknown'}" dispatched to ${data.agent || 'agent'}`
    case 'workflow.step_complete': return `Step "${data.label || 'unknown'}" completed`
    case 'workflow.gate_reached': return `Awaiting approval: ${data.label || 'gate'}`
    case 'workflow.gate_approved': return `Approved: ${data.label || 'gate'}`
    case 'workflow.gate_rejected': return `Rejected: ${data.label || 'gate'}${data.reason ? ` — ${data.reason}` : ''}`
    case 'workflow.complete': return `Workflow complete${data.workflowId ? ` (${data.workflowId})` : ''}`
    default: {
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
  return false
}

/**
 * Runtime-management page reducers (P3.3) — pure transforms from the
 * /api/runtime/capabilities payload and the runtime:switch SSE stream into
 * renderable rows. Kept free of React so the matrix/report logic is
 * unit-testable.
 */

export interface CapabilityRow {
  key: string
  label: string
  /** 'native' | 'shimmed' | 'unavailable' (+ the tool-access style detail). */
  mode: string
  detail?: string
}

const CAPABILITY_LABELS: Record<string, string> = {
  toolCalling: 'Tool calling',
  delivery: 'Channel delivery',
  imageGen: 'Image generation',
  memory: 'Memory',
  sessions: 'Sessions',
  workspaceFiles: 'Workspace files',
}

export interface CapabilitiesPayload {
  toolCalling?: { mode?: string; access?: { style?: string } }
  input?: { imageInput?: boolean; audioInput?: boolean }
  [key: string]: unknown
}

/** Flatten a CapabilitySet into ordered matrix rows (input modality last). */
export function capabilityRows(capabilities: CapabilitiesPayload | null | undefined): CapabilityRow[] {
  if (!capabilities) return []
  const rows: CapabilityRow[] = []

  const toolCalling = capabilities.toolCalling
  if (toolCalling) {
    rows.push({
      key: 'toolCalling',
      label: CAPABILITY_LABELS.toolCalling,
      mode: toolCalling.mode ?? 'native',
      detail: toolCalling.access?.style,
    })
  }

  for (const [key, label] of Object.entries(CAPABILITY_LABELS)) {
    if (key === 'toolCalling') continue
    const value = capabilities[key]
    if (value && typeof value === 'object' && 'mode' in (value as Record<string, unknown>)) {
      rows.push({ key, label, mode: String((value as { mode: unknown }).mode) })
    }
  }

  const input = capabilities.input
  if (input) {
    const modalities = [
      ...(input.imageInput ? ['image'] : []),
      ...(input.audioInput ? ['audio'] : []),
    ]
    rows.push({
      key: 'input',
      label: 'Model input',
      mode: modalities.length > 0 ? 'native' : 'unavailable',
      detail: modalities.length > 0 ? modalities.join(' + ') : 'text only',
    })
  }

  return rows
}

// ─── Switch progress stream ─────────────────────────────────────────────────

export interface SwitchProgressEventPayload {
  type?: string
  phase?: string
  status?: 'start' | 'ok' | 'skip' | 'error'
  detail?: string
}

export interface SwitchStepRow {
  phase: string
  status: 'running' | 'ok' | 'skip' | 'error'
  detail?: string
}

export const SWITCH_PHASE_LABELS: Record<string, string> = {
  validate: 'Validate target',
  backup: 'Back up settings',
  'snapshot-roster': 'Snapshot roster',
  deprovision: 'Deprovision old tool access',
  flip: 'Flip runtime setting',
  initialize: 'Initialize target runtime',
  provision: 'Provision tool access',
  'reconcile-roster': 'Carry roster over',
  'adopt-cron': 'Adopt cron jobs',
  'carry-workspaces': 'Carry workspace content',
  'sync-agents': 'Re-project agents',
  'validate-capabilities': 'Validate capabilities',
  restore: 'Restore previous runtime',
}

/**
 * Fold a runtime:switch SSE event into the ordered step list: 'start'
 * appends/marks running; a terminal status resolves the step in place.
 */
export function reduceSwitchProgress(steps: SwitchStepRow[], event: SwitchProgressEventPayload): SwitchStepRow[] {
  if (event.type !== 'runtime:switch' || !event.phase || !event.status) return steps
  const existing = steps.findIndex((step) => step.phase === event.phase)
  if (event.status === 'start') {
    if (existing >= 0) return steps
    return [...steps, { phase: event.phase, status: 'running' }]
  }
  const resolved: SwitchStepRow = { phase: event.phase, status: event.status, ...(event.detail ? { detail: event.detail } : {}) }
  if (existing >= 0) {
    const next = [...steps]
    next[existing] = resolved
    return next
  }
  return [...steps, resolved]
}

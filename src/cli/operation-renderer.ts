/**
 * CLI operation renderer (#895 D11) — the terminal face of `OperationProgress`.
 *
 * - `tty`: a live frame redrawn in place (plan with marks, the active stage's
 *   bar, items, children nested under the first stage, quiet/stuck from
 *   progress alone with the last output as liveness, attempts, waiting).
 * - `plain` (pipes, logs, CI): append-only lines, one per transition.
 * - `json`: nothing while running; one document at the end.
 *
 * `followAndRender` wires `followOperation` to a renderer and owns Ctrl-C:
 * the first press cancels when cancel is allowed (otherwise says why), the
 * second detaches — the operation keeps running on the server.
 */
import { isOperationFinished, operationQuietState, type OperationStageView, type OperationView } from '@makinbakin/sdk/types'

import { cancelOperationRemote, followOperation, type OperationFollowResult } from './http'

export type OperationRenderMode = 'tty' | 'plain' | 'json'

const MARK: Record<OperationStageView['status'], string> = {
  pending: '·',
  active: '▸',
  done: '✓',
  failed: '✗',
  skipped: '–',
}

const ATTEMPT_REASON: Record<string, string> = {
  stalled: 'the transfer stalled',
  deadline: 'it ran past its deadline',
  http: 'the server answered with an error',
  network: 'the connection failed',
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

function measure(stage: OperationStageView): { fraction: number | null; text: string } {
  if (stage.bytes) {
    const { received, total } = stage.bytes
    return total && total > 0
      ? { fraction: Math.min(1, received / total), text: `${formatSize(received)} of ${formatSize(total)}` }
      : { fraction: null, text: `${formatSize(received)} · size unknown` }
  }
  const items = stage.items ?? []
  if (items.length > 0) {
    const finished = items.filter((i) => i.status === 'done' || i.status === 'skipped').length
    return { fraction: finished / items.length, text: `${finished} of ${items.length}` }
  }
  return { fraction: null, text: 'working' }
}

function bar(fraction: number | null, width = 20): string {
  if (fraction === null) return `[${'░'.repeat(width)}]`
  const filled = Math.round(fraction * width)
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`
}

function stageDuration(stage: OperationStageView, now: number): string {
  if (!stage.startedAt) return ''
  const end = stage.endedAt ? Date.parse(stage.endedAt) : now
  return ` (${formatDuration(end - Date.parse(stage.startedAt))})`
}

function statusWord(view: OperationView): string {
  if (view.waitingFor && view.status === 'running') return 'waiting'
  return view.status
}

function childLines(child: OperationView, now: number, indent: string): string[] {
  const active = child.stages.find((s) => s.status === 'active')
  const mark = child.status === 'succeeded' ? '✓' : child.status === 'failed' ? '✗' : child.status === 'cancelled' ? '–' : '▸'
  const lines = [`${indent}${mark} ${child.title} · ${statusWord(child)}`]
  if (active && !isOperationFinished(child.status)) {
    const m = measure(active)
    lines.push(`${indent}    ${active.label} ${bar(m.fraction, 12)} ${m.text}`)
  }
  if (child.status === 'failed') {
    const reason = child.outcome?.message ?? child.stages.find((s) => s.status === 'failed')?.message
    if (reason) lines.push(`${indent}    ${reason}`)
  }
  if (child.waitingFor && child.status === 'running') {
    lines.push(`${indent}    Waiting for ${child.waitingFor.holderTitle} · ${formatDuration(now - Date.parse(child.waitingFor.since))}`)
  }
  return lines
}

/** The live frame for one operation (pure). */
export function renderOperationFrame(view: OperationView, children: readonly OperationView[], now: number): string[] {
  const elapsed = formatDuration((view.endedAt ? Date.parse(view.endedAt) : now) - Date.parse(view.startedAt))
  const lines = [`${view.title} · ${statusWord(view)} · ${elapsed}`]
  const live = !isOperationFinished(view.status)

  if (view.waitingFor && live) {
    const waited = formatDuration(now - Date.parse(view.waitingFor.since))
    lines.push(view.waitingFor.stale
      ? `  ! ${view.waitingFor.holderTitle} stopped responding — reclaiming its lock (${waited})`
      : `  … Waiting for ${view.waitingFor.holderTitle} (${waited}); this starts when it finishes`)
  }
  const quiet = live ? operationQuietState(view, now) : null

  view.stages.forEach((stage, index) => {
    lines.push(`  ${MARK[stage.status]} ${stage.label}${stage.status === 'pending' ? '' : stageDuration(stage, now)}`)
    if (stage.status === 'skipped' && stage.skippedReason) lines.push(`      skipped: ${stage.skippedReason}`)
    if (stage.status === 'failed' && stage.message) lines.push(`      ${stage.message}`)
    if (stage.status === 'active' && live) {
      if (stage.message) lines.push(`      ${stage.message}`)
      const m = measure(stage)
      lines.push(`      ${bar(m.fraction)} ${m.text}`)
      if (stage.attempt) {
        lines.push(`      ↻ Attempt ${stage.attempt.n} of ${stage.attempt.of} — ${ATTEMPT_REASON[stage.attempt.reason] ?? stage.attempt.reason}${stage.attempt.detail ? ` (${stage.attempt.detail})` : ''}`)
      }
      if (quiet?.state === 'quiet' && quiet.stageId === stage.id) {
        lines.push(`      No measurable progress for ${formatDuration(quiet.sinceProgressMs)} — still working`)
      }
      if (quiet?.state === 'stuck' && quiet.stageId === stage.id) {
        lines.push(`      ⚠ No progress for ${formatDuration(quiet.sinceProgressMs)} — this step may be stuck; nothing has been stopped`)
      }
      if (view.lastOutput) lines.push(`      > ${view.lastOutput} (${formatDuration(now - Date.parse(view.lastLivenessAt))} ago)`)
    }
    for (const item of stage.items ?? []) {
      const bytes = item.bytes ? ` ${item.bytes.total ? `${formatSize(item.bytes.received)} of ${formatSize(item.bytes.total)}` : formatSize(item.bytes.received)}` : ''
      lines.push(`      ${MARK[item.status]} ${item.label}${bytes}${item.message ? ` — ${item.message}` : ''}`)
    }
    if (index === 0) for (const child of children) lines.push(...childLines(child, now, '      '))
  })

  if (view.status === 'cancelling') lines.push('  Cancelling — stopping after the current step settles')
  else if (live && !view.cancellable) {
    lines.push(view.plan.pointOfNoReturn === 'start' ? "  Can't be cancelled" : '  Past the point of no return — it will finish')
  }
  return lines
}

/** Append-only lines describing what changed between two views (pure). */
export function describeTransitions(
  prev: { view: OperationView; children: readonly OperationView[] } | null,
  next: { view: OperationView; children: readonly OperationView[] },
): string[] {
  const out: string[] = []
  const { view } = next
  if (!prev) out.push(`${view.title}`)
  const before = new Map((prev?.view.stages ?? []).map((s) => [s.id, s]))
  for (const stage of view.stages) {
    const old = before.get(stage.id)
    if (old?.status !== stage.status && stage.status !== 'pending') {
      if (stage.status === 'active') out.push(`  ${MARK.active} ${stage.label}${stage.message ? `: ${stage.message}` : ''}`)
      else if (stage.status === 'done') out.push(`  ${MARK.done} ${stage.label}${stageDuration(stage, Date.parse(stage.endedAt ?? view.lastProgressAt))}`)
      else if (stage.status === 'failed') out.push(`  ${MARK.failed} ${stage.label}${stage.message ? `: ${stage.message}` : ''}`)
      else out.push(`  ${MARK.skipped} ${stage.label} skipped${stage.skippedReason ? ` (${stage.skippedReason})` : ''}`)
    }
    if (stage.attempt && (old?.attempt?.n !== stage.attempt.n)) {
      out.push(`    ↻ Attempt ${stage.attempt.n} of ${stage.attempt.of} — ${ATTEMPT_REASON[stage.attempt.reason] ?? stage.attempt.reason}${stage.attempt.detail ? ` (${stage.attempt.detail})` : ''}`)
    }
    const oldItems = new Map((old?.items ?? []).map((i) => [i.id, i.status]))
    for (const item of stage.items ?? []) {
      if (oldItems.get(item.id) !== item.status && item.status !== 'pending') {
        out.push(`    ${MARK[item.status]} ${item.label}${item.message ? ` — ${item.message}` : ''}`)
      }
    }
    // Byte progress in quarters, so a pipe sees movement without a flood.
    if (stage.bytes?.total) {
      const quarter = (b?: { received: number; total: number | null }) => (b?.total ? Math.floor((b.received / b.total) * 4) : -1)
      if (quarter(stage.bytes) > Math.max(quarter(old?.bytes), 0) && quarter(stage.bytes) < 4) {
        out.push(`    ${formatSize(stage.bytes.received)} of ${formatSize(stage.bytes.total)}`)
      }
    }
  }
  const prevChildren = new Map((prev?.children ?? []).map((c) => [c.id, c.status]))
  for (const child of next.children) {
    const was = prevChildren.get(child.id)
    if (was === child.status) continue
    if (was === undefined) out.push(`  ${MARK.active} ${child.title}`)
    if (isOperationFinished(child.status)) {
      const mark = child.status === 'succeeded' ? MARK.done : child.status === 'failed' ? MARK.failed : MARK.skipped
      out.push(`  ${mark} ${child.title}: ${child.status}${child.outcome?.message ? ` — ${child.outcome.message}` : ''}`)
    }
  }
  if (view.waitingFor && !prev?.view.waitingFor) out.push(`  … Waiting for ${view.waitingFor.holderTitle}`)
  if (view.waitingFor?.stale && !prev?.view.waitingFor?.stale) out.push(`  ! ${view.waitingFor.holderTitle} stopped responding — reclaiming its lock`)
  if (prev?.view.waitingFor && !view.waitingFor) out.push('  Resources acquired — starting')
  if (view.status === 'cancelling' && prev?.view.status !== 'cancelling') out.push('  Cancelling…')
  return out
}

/** The closing line for a follow result (pure). */
export function describeResult(result: OperationFollowResult): string {
  const op = result.operation
  switch (result.phase) {
    case 'restarted':
      return 'Bakin restarted while this was running — the outcome is unknown. Re-check the state before retrying.'
    case 'expired':
      return 'The operation record has expired — re-check the state to see what was applied.'
    case 'detached':
      return 'Stopped watching — it keeps running on the server (see the operations tray in Bakin).'
    case 'finished': {
      if (!op) return 'Finished.'
      const message = op.outcome?.message ? ` — ${op.outcome.message}` : ''
      if (op.status === 'succeeded') return `✓ ${op.title} finished${message}`
      if (op.status === 'cancelled') return `– ${op.title} was cancelled${message || ' before anything changed'}`
      const label = op.outcome?.code === 'partially_applied' ? 'partially applied' : op.outcome?.code === 'verification_failed' ? 'failed verification' : 'failed'
      return `✗ ${op.title} ${label}${message}`
    }
  }
}

/** 0 succeeded, 130 cancelled or detached, 1 for everything else. */
export function operationExitCode(result: OperationFollowResult): number {
  if (result.phase === 'detached') return 130
  if (result.phase !== 'finished' || !result.operation) return 1
  if (result.operation.status === 'succeeded') return 0
  return result.operation.status === 'cancelled' ? 130 : 1
}

export interface OperationRenderer {
  update(view: OperationView, children: readonly OperationView[]): void
  note(text: string): void
  finish(result: OperationFollowResult): void
}

export function createOperationRenderer(opts: {
  mode: OperationRenderMode
  write: (text: string) => void
  now?: () => number
  /** Redraw cadence for clocks in tty mode; 0 disables (tests). */
  tickMs?: number
}): OperationRenderer {
  const now = opts.now ?? Date.now
  let last: { view: OperationView; children: readonly OperationView[] } | null = null
  let drawn = 0
  const notes: string[] = []
  let timer: ReturnType<typeof setInterval> | undefined

  const draw = () => {
    if (!last) return
    const frame = [...renderOperationFrame(last.view, last.children, now()), ...notes]
    const clear = drawn > 0 ? `\x1b[${drawn}F\x1b[J` : ''
    opts.write(`${clear}${frame.join('\n')}\n`)
    drawn = frame.length
  }

  if (opts.mode === 'tty' && (opts.tickMs ?? 1_000) > 0) {
    timer = setInterval(draw, opts.tickMs ?? 1_000)
    timer.unref?.()
  }

  return {
    update(view, children) {
      const next = { view, children }
      if (opts.mode === 'plain') {
        const lines = describeTransitions(last, next)
        if (lines.length > 0) opts.write(`${lines.join('\n')}\n`)
      }
      last = next
      if (opts.mode === 'tty') draw()
    },
    note(text) {
      if (opts.mode === 'json') return
      if (opts.mode === 'plain') return opts.write(`${text}\n`)
      notes.splice(0, notes.length, text)
      draw()
    },
    finish(result) {
      if (timer) clearInterval(timer)
      if (opts.mode === 'json') {
        opts.write(`${JSON.stringify({ phase: result.phase, operation: result.operation, children: result.children }, null, 2)}\n`)
        return
      }
      if (opts.mode === 'tty' && result.operation) {
        notes.length = 0
        last = { view: result.operation, children: result.children }
        draw()
      }
      opts.write(`${describeResult(result)}\n`)
    },
  }
}

export function detectRenderMode(json: boolean, stream: { isTTY?: boolean } = process.stdout): OperationRenderMode {
  if (json) return 'json'
  return stream.isTTY ? 'tty' : 'plain'
}

/**
 * Follows a started operation and renders it until it settles. Ctrl-C once
 * cancels (when allowed), twice detaches.
 */
export async function followAndRender(
  start: { operationId: string; bootId: string },
  opts: { json?: boolean; write?: (text: string) => void; mode?: OperationRenderMode; signals?: Pick<NodeJS.Process, 'on' | 'off'>; baseUrl?: string } = {},
): Promise<OperationFollowResult> {
  const write = opts.write ?? ((text: string) => { process.stdout.write(text) })
  const renderer = createOperationRenderer({ mode: opts.mode ?? detectRenderMode(Boolean(opts.json)), write })
  const detach = new AbortController()
  let latest: OperationView | null = null
  let presses = 0
  const signals = opts.signals ?? process
  const onInterrupt = () => {
    presses += 1
    if (presses > 1 || !latest || isOperationFinished(latest.status)) {
      detach.abort()
      return
    }
    if (latest.cancellable) {
      renderer.note('Cancelling… press Ctrl-C again to stop watching')
      void cancelOperationRemote(start.operationId, opts.baseUrl).then((answer) => {
        if (answer !== 'cancelling') renderer.note(`Cancel was refused (${answer}) — press Ctrl-C again to stop watching`)
      })
    } else {
      renderer.note(latest.plan.pointOfNoReturn === 'start'
        ? "This can't be cancelled — press Ctrl-C again to stop watching (it keeps running)"
        : 'Past the point of no return — press Ctrl-C again to stop watching (it keeps running)')
    }
  }
  signals.on('SIGINT', onInterrupt)
  try {
    const result = await followOperation(start, {
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      signal: detach.signal,
      onUpdate: ({ operation, children }) => {
        latest = operation
        renderer.update(operation, children)
      },
    })
    renderer.finish(result)
    return result
  } finally {
    signals.off('SIGINT', onInterrupt)
  }
}

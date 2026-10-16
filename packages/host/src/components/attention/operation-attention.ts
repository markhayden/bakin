/**
 * Pure attention rules for operations (#895 D14, D17). One announcement per
 * transition: finished or failed once per operation, stuck once per stage.
 * Only work a person started (web, CLI, Discord) announces; system work and
 * child operations stay in the tray. Nothing announces while the person is
 * already on the operation's own page.
 */
import { isOperationFinished, operationQuietState, type OperationView } from '@makinbakin/sdk/types'

const ANNOUNCED_ORIGINS = new Set(['web', 'cli', 'discord'])

export interface OperationAttentionMemo {
  finished: boolean
  stuckStages: readonly string[]
}

export interface OperationNotice {
  kind: 'finished' | 'failed' | 'stuck'
  title: string
  body: string
  url?: string
}

export const EMPTY_ATTENTION_MEMO: OperationAttentionMemo = { finished: false, stuckStages: [] }

function viewingHref(href: string | undefined, location: { pathname: string; search: string }): boolean {
  if (!href) return false
  const target = new URL(href, 'http://bakin.local')
  return target.pathname === location.pathname && (target.search === '' || target.search === location.search)
}

function formatSeconds(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 120 ? `${s}s` : `${Math.round(s / 60)}m`
}

/** Decides what (if anything) to announce for this update, and the memo to keep. */
export function nextOperationAttention(
  view: OperationView,
  memo: OperationAttentionMemo = EMPTY_ATTENTION_MEMO,
  now: number,
  location: { pathname: string; search: string },
): { notice: OperationNotice | null; memo: OperationAttentionMemo } {
  if (view.parentId || memo.finished) return { notice: null, memo }
  const announce = ANNOUNCED_ORIGINS.has(view.origin) && !viewingHref(view.href, location)

  if (isOperationFinished(view.status)) {
    const next = { ...memo, finished: true }
    if (!announce || view.status === 'cancelled') return { notice: null, memo: next }
    return view.status === 'succeeded'
      ? { notice: { kind: 'finished', title: `${view.title} finished`, body: view.outcome?.message ?? 'Done.', url: view.href }, memo: next }
      : { notice: { kind: 'failed', title: `${view.title} failed`, body: view.outcome?.message ?? 'Open it for details.', url: view.href }, memo: next }
  }

  const quiet = operationQuietState(view, now)
  if (quiet.state !== 'stuck' || !quiet.stageId || memo.stuckStages.includes(quiet.stageId)) return { notice: null, memo }
  const next = { ...memo, stuckStages: [...memo.stuckStages, quiet.stageId] }
  if (!announce) return { notice: null, memo: next }
  const stage = view.stages.find((s) => s.id === quiet.stageId)
  return {
    notice: {
      kind: 'stuck',
      title: `${view.title} looks stuck`,
      body: `${stage?.label ?? 'A step'} has made no progress for ${formatSeconds(quiet.sinceProgressMs)}.`,
      url: view.href,
    },
    memo: next,
  }
}

'use client'

/**
 * MemoryDetailDrawer — full-row detail view for /memory results.
 *
 * Reuses the shared BakinDrawer (same slideover used by schedule, workflows,
 * messaging). The header shows tier/agent badges + title; the body shows
 * timestamps, source ref, and renders `content` through MemoryContentRenderer
 * so JSON / markdown / plain text each get the right formatting.
 *
 * For turn rows we also parse `meta.eventType` to force the JSON renderer on
 * `tool_call` rows — their content is a JSON-stringified toolCall block and
 * the heuristic would otherwise mis-classify it when the argument payload
 * itself contains markdown.
 */
import { useMemo } from 'react'
import { BakinDrawer } from "@bakin/sdk/components"
import { Badge } from "@bakin/sdk/ui"
import type { SearchResult } from "@bakin/sdk/hooks"
import { MemoryContentRenderer, type ContentFormat } from './memory-content-renderer'
import { tierStyle } from './tier-colors'

interface Props {
  result: SearchResult | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MemoryDetailDrawer({ result, open, onOpenChange }: Props) {
  const parsedMeta = useMemo(() => {
    if (!result) return null
    const raw = result.fields.meta
    if (typeof raw !== 'string' || !raw) return null
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return null
    }
  }, [result])

  // Caller already guards with `open={selected !== null}`; when there's no
  // result there's nothing to render. Mounting an empty BakinDrawer here
  // would keep the slideover portal in the tree with stale props.
  if (!result) return null

  const tier = str(result.fields.tier)
  const agent = str(result.fields.agent)
  const title = str(result.fields.title) || result.id
  const content = str(result.fields.content) || str(result.fields.snippet)
  const sourcePath = str(result.fields.source_path)
  const sourceBackend = str(result.fields.source_backend)
  const updatedAt = num(result.fields.updated_at)
  const createdAt = num(result.fields.created_at)
  const style = tierStyle(tier)

  const forcedFormat = resolveFormat(tier, parsedMeta)

  return (
    <BakinDrawer
      open={open}
      onOpenChange={onOpenChange}
      storageKey="memory"
      title={
        <span className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className={`text-[10px] uppercase tracking-wide shrink-0 ${style.badge}`}>
            {style.label}
          </Badge>
          {agent && <Badge variant="secondary" className="text-[10px] shrink-0">{agent}</Badge>}
          <span className="truncate">{title}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-5">
        <MetaGrid
          createdAt={createdAt}
          updatedAt={updatedAt}
          sourceBackend={sourceBackend}
          sourcePath={sourcePath}
          score={result.score}
          rowId={result.id}
        />

        {content ? (
          <section className="flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Content</div>
            <MemoryContentRenderer content={content} format={forcedFormat} />
          </section>
        ) : (
          <div className="text-sm text-muted-foreground italic">No content body.</div>
        )}

        {parsedMeta && (
          <section className="flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Meta</div>
            <MemoryContentRenderer content={JSON.stringify(parsedMeta, null, 2)} format="json" />
          </section>
        )}
      </div>
    </BakinDrawer>
  )
}

function MetaGrid({
  createdAt,
  updatedAt,
  sourceBackend,
  sourcePath,
  score,
  rowId,
}: {
  createdAt: number
  updatedAt: number
  sourceBackend: string
  sourcePath: string
  score: number
  rowId: string
}) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Row ID</dt>
      <dd className="font-mono truncate">{rowId}</dd>

      <dt className="text-muted-foreground">Updated</dt>
      <dd>{formatTs(updatedAt)}</dd>

      {createdAt > 0 && createdAt !== updatedAt && (
        <>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{formatTs(createdAt)}</dd>
        </>
      )}

      {sourceBackend && (
        <>
          <dt className="text-muted-foreground">Backend</dt>
          <dd>{sourceBackend}</dd>
        </>
      )}

      {sourcePath && (
        <>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="font-mono break-all">{sourcePath}</dd>
        </>
      )}

      {Number.isFinite(score) && (
        <>
          <dt className="text-muted-foreground">Score</dt>
          <dd className="font-mono">{score.toFixed(3)}</dd>
        </>
      )}
    </dl>
  )
}

function resolveFormat(tier: string, meta: Record<string, unknown> | null): ContentFormat | undefined {
  if (tier === 'turn' && meta && typeof meta.eventType === 'string') {
    if (meta.eventType === 'tool_call') return 'json'
  }
  if (tier === 'daily_note' || tier === 'durable' || tier === 'dream') return 'markdown'
  return undefined
}

function formatTs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

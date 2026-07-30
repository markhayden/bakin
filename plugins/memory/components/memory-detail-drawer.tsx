'use client'

/**
 * MemoryDetailDrawer — full-row detail view for /memory results.
 *
 * Reuses the shared Drawer (same slideover used by schedule, workflows,
 * messaging). The header names the record and its owning agent; the body keeps
 * readable record facts, content, database identifiers, and raw metadata in
 * consistently labeled drawer sections.
 *
 * For turn rows we also parse `meta.eventType` to force the JSON renderer on
 * `tool_call` rows — their content is a JSON-stringified toolCall block and
 * the heuristic would otherwise mis-classify it when the argument payload
 * itself contains markdown.
 */
import { useMemo } from 'react'
import {
  Drawer,
  DrawerSection,
} from '@makinbakin/sdk/ui'
import {
  AgentAvatar,
  StatusBadge,
  type AgentIdentity,
} from '@makinbakin/sdk/patterns'
import type { SearchResult } from '@makinbakin/sdk/hooks'
import { MemoryContentRenderer, type ContentFormat } from './memory-content-renderer'
import { tierStyle } from './tier-colors'

interface Props {
  result: SearchResult | null
  agents?: readonly AgentIdentity[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MemoryDetailDrawer({ result, agents = [], open, onOpenChange }: Props) {
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
  // result there's nothing to render. Mounting an empty Drawer here
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
  const agentIdentity = agent
    ? agents.find((candidate) => candidate.id === agent) ?? { id: agent, name: agent }
    : null

  const forcedFormat = resolveFormat(tier, parsedMeta)

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      storageKey="memory"
      title={title}
      description={
        <span className="flex min-w-0 flex-wrap items-center gap-bakin-2">
          <StatusBadge
            tone="neutral"
            variant="soft"
            size="xs"
            className={`shrink-0 ${style.badge}`}
          >
            {style.label}
          </StatusBadge>
          {agentIdentity ? (
            <span className="flex min-w-0 items-center gap-bakin-1">
              <AgentAvatar agent={agentIdentity} size="xs" decorative />
              <span className="truncate">{agentIdentity.name}</span>
            </span>
          ) : null}
        </span>
      }
    >
      <div className="flex min-w-0 flex-col gap-bakin-6">
        <DrawerSection title="Source">
          <SourceDetails
            createdAt={createdAt}
            updatedAt={updatedAt}
            sourcePath={sourcePath}
          />
        </DrawerSection>

        <DrawerSection title="Content">
          {content ? (
            <MemoryContentRenderer content={content} format={forcedFormat} />
          ) : (
            <p className="m-0 text-bakin-typography-size-body text-bakin-text-muted">
              No content body.
            </p>
          )}
        </DrawerSection>

        <DrawerSection title="Index metadata">
          <div className="grid min-w-0 gap-bakin-4">
            <IndexMetadata
              sourceBackend={sourceBackend}
              score={result.score}
              rowId={result.id}
            />
            {parsedMeta ? (
              <MemoryContentRenderer
                content={JSON.stringify(parsedMeta, null, 2)}
                format="json"
              />
            ) : null}
          </div>
        </DrawerSection>
      </div>
    </Drawer>
  )
}

function SourceDetails({
  createdAt,
  updatedAt,
  sourcePath,
}: {
  createdAt: number
  updatedAt: number
  sourcePath: string
}) {
  return (
    <dl
      data-memory-record-details=""
      className="m-0 grid min-w-0 text-bakin-typography-size-body"
    >
      <DetailRow label="Updated" value={formatTs(updatedAt)} />
      {createdAt > 0 && createdAt !== updatedAt ? (
        <DetailRow label="Created" value={formatTs(createdAt)} />
      ) : null}
      {sourcePath ? (
        <DetailRow label="Source" value={sourcePath} mono />
      ) : null}
    </dl>
  )
}

function IndexMetadata({
  sourceBackend,
  score,
  rowId,
}: {
  sourceBackend: string
  score: number
  rowId: string
}) {
  return (
    <dl className="m-0 grid min-w-0 text-bakin-typography-size-meta">
      <DetailRow label="Row ID" value={rowId} mono />
      {sourceBackend ? <DetailRow label="Backend" value={sourceBackend} /> : null}
      {Number.isFinite(score) ? (
        <DetailRow label="Score" value={score.toFixed(3)} mono />
      ) : null}
    </dl>
  )
}

function DetailRow({
  label,
  mono = false,
  value,
}: {
  label: string
  mono?: boolean
  value: string
}) {
  return (
    <div
      data-memory-record-detail=""
      className="grid min-w-0 gap-bakin-1 border-t border-bakin-border-subtle py-bakin-3 sm:grid-cols-[minmax(7rem,0.45fr)_minmax(0,1fr)] sm:gap-bakin-4"
    >
      <dt className="text-bakin-typography-size-meta text-bakin-text-muted">{label}</dt>
      <dd
        className={`m-0 min-w-0 [overflow-wrap:anywhere] text-bakin-text-primary ${
          mono ? 'font-bakin-typography-family-mono' : ''
        }`}
      >
        {value}
      </dd>
    </div>
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

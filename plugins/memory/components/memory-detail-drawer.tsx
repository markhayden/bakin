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
  SystemState,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import {
  AgentAvatar,
  CopyButton,
  KeyValue,
  StatusBadge,
  type AgentIdentity,
  type KeyValueItem,
} from '@makinbakin/sdk/patterns'
import { CodeBlock } from '@makinbakin/sdk/content'
import { Inline, Stack } from '@makinbakin/sdk/layout'
import type { SearchResult } from '@makinbakin/sdk/hooks'
import { MemoryContentRenderer, type ContentFormat } from './memory-content-renderer'
import { tierDisplayName } from './tier-labels'

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
  const agentIdentity = agent
    ? agents.find((candidate) => candidate.id === agent) ?? { id: agent, name: agent }
    : null

  const forcedFormat = resolveFormat(tier, parsedMeta)

  const sourceItems: KeyValueItem[] = [
    { label: 'Updated', value: formatTs(updatedAt) },
  ]
  if (createdAt > 0 && createdAt !== updatedAt) {
    sourceItems.push({ label: 'Created', value: formatTs(createdAt) })
  }
  if (sourcePath) {
    sourceItems.push({
      label: 'Source',
      // A source path is the identifier you paste into an editor or a shell,
      // so it carries its own copy action rather than forcing a hand-selection
      // of a mid-word-broken string.
      value: <CopyableIdentifier text={sourcePath} label="Copy source path" />,
      mono: true,
      breakValue: true,
    })
  }

  const metadataItems: KeyValueItem[] = [
    {
      label: 'Row ID',
      value: <CopyableIdentifier text={result.id} label="Copy row ID" />,
      mono: true,
      breakValue: true,
    },
  ]
  if (sourceBackend) metadataItems.push({ label: 'Backend', value: sourceBackend })
  if (Number.isFinite(result.score)) {
    metadataItems.push({ label: 'Score', value: result.score.toFixed(3), mono: true, numeric: true })
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      storageKey="memory"
      title={title}
      description={
        <span className="flex min-w-0 flex-wrap items-center gap-bakin-2">
          <StatusBadge tone="neutral" variant="soft" size="xs" className="shrink-0">
            {tierDisplayName(tier)}
          </StatusBadge>
          {agentIdentity ? (
            <span className="flex min-w-0 items-center gap-bakin-1">
              <AgentAvatar agent={agentIdentity} size="xs" decorative />
              {/* The name truncates in a narrow drawer header; the tooltip is
                  the only place the full name stays reachable. */}
              <Tooltip>
                <TooltipTrigger render={<span />} className="min-w-0 truncate">
                  {agentIdentity.name}
                </TooltipTrigger>
                <TooltipContent>{agentIdentity.name}</TooltipContent>
              </Tooltip>
            </span>
          ) : null}
        </span>
      }
    >
      <Stack gap="section">
        <DrawerSection title="Source">
          <KeyValue
            data-memory-record-details=""
            layout="columns"
            items={sourceItems}
          />
        </DrawerSection>

        <DrawerSection title="Content">
          {content ? (
            <MemoryContentRenderer content={content} format={forcedFormat} />
          ) : (
            <SystemState
              kind="initial-empty"
              scope="inline"
              title="No content body"
              description="This row was indexed without a body — only its metadata is available."
            />
          )}
        </DrawerSection>

        <DrawerSection title="Index metadata">
          <Stack gap="item">
            <KeyValue layout="columns" items={metadataItems} />
            {parsedMeta ? (
              <CodeBlock
                code={JSON.stringify(parsedMeta, null, 2)}
                language="json"
                label="Raw metadata"
                wrap
                copyable
              />
            ) : null}
          </Stack>
        </DrawerSection>
      </Stack>
    </Drawer>
  )
}

/** An identifier value plus the copy action that makes it usable elsewhere. */
function CopyableIdentifier({ text, label }: { text: string; label: string }) {
  return (
    <Inline gap="dense" align="baseline" wrap={false}>
      <span className="min-w-0">{text}</span>
      <CopyButton text={text} label={label} />
    </Inline>
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

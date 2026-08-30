'use client'

import { TurnOutputView } from '@makinbakin/sdk/conversation'
import { Panel } from '@makinbakin/sdk/layout'
import { KeyValue, type KeyValueItem } from '@makinbakin/sdk/patterns'
import { humanizeKey } from '@makinbakin/sdk/utils'
import { Text } from '@makinbakin/sdk/ui'
import { isRenderableAssetRef } from '../lib/output-assets'

/** Normalize step output — handles string (possibly JSON), object, or unexpected types. */
function normalizeOutput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object') return parsed } catch {
      // Plain text output is expected here.
    }
    return { output: raw }
  }
  return { output: String(raw ?? '') }
}

/** Render a single output value in human-readable form. */
function OutputValue({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    if (isRenderableAssetRef(value)) {
      const ref = value
      return (
        <div className="grid min-w-0 gap-bakin-1">
          <Text size="meta" tone="muted" mono as="p" className="break-all">{ref}</Text>
          <img
            src={`/api/assets/${encodeURIComponent(ref)}`}
            alt={ref}
            className="max-h-48 max-w-full rounded-bakin-surface border border-bakin-border-subtle object-contain"
            onError={(event) => { event.currentTarget.hidden = true }}
          />
        </div>
      )
    }
    const str = value as string
    if (str.includes('\n') || str.length > 120) {
      // Step output is a key/value tree, not chunk-shaped — but its prose
      // leaves ARE turn output, so they render through the single chunk
      // renderer (markdown default) instead of a local format heuristic.
      return (
        <Text size="body" as="div">
          <TurnOutputView chunks={[{ type: 'text', content: str }]} />
        </Text>
      )
    }
    return <Text size="body" as="p" className="break-words">{str}</Text>
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return <Text size="body" as="p">{String(value)}</Text>
  }
  if (value && typeof value === 'object') {
    return (
      <KeyValue
        layout="columns"
        className="border-s border-bakin-border-subtle ps-bakin-3"
        items={outputItems(value as Record<string, unknown>)}
      />
    )
  }
  return <Text size="body" tone="muted" as="p">{String(value ?? '—')}</Text>
}

function outputItems(record: Record<string, unknown>): KeyValueItem[] {
  return Object.entries(record).map(([key, value]) => ({
    label: humanizeKey(key),
    value: <OutputValue value={value} />,
  }))
}

/** Render prior step output in a human-readable layout. */
export function StepOutputViewer({ output }: { output: Record<string, unknown> | string | unknown }) {
  const data = normalizeOutput(output)
  return (
    <Panel scroll padding="compact" aria-label="Step output" data-step-output="" className="max-h-80">
      <KeyValue layout="columns" items={outputItems(data)} />
    </Panel>
  )
}

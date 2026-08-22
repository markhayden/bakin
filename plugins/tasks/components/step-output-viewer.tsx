'use client'

import { TurnOutputView } from '@makinbakin/sdk/conversation'
import { Panel } from '@makinbakin/sdk/layout'
import { KeyValue, type KeyValueItem } from '@makinbakin/sdk/patterns'
import { humanizeKey } from '@makinbakin/sdk/utils'
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
          <p className="m-0 break-all font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">{ref}</p>
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
        <div className="text-bakin-typography-size-body text-bakin-text-primary">
          <TurnOutputView chunks={[{ type: 'text', content: str }]} />
        </div>
      )
    }
    return <p className="m-0 break-words text-bakin-typography-size-body text-bakin-text-primary">{str}</p>
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return <p className="m-0 text-bakin-typography-size-body text-bakin-text-primary">{String(value)}</p>
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
  return <p className="m-0 text-bakin-typography-size-body text-bakin-text-muted">{String(value ?? '—')}</p>
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

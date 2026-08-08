'use client'

import { TurnOutputView } from '@makinbakin/sdk/conversation'
import { Panel } from '@makinbakin/sdk/layout'
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

/** Pretty-print a label from a camelCase/snake_case key. */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/** Render a single output value in human-readable form. */
function OutputValue({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    if (isRenderableAssetRef(value)) {
      const ref = value
      return (
        <div className="mt-bakin-1 grid min-w-0 gap-bakin-1">
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
        <div className="mt-bakin-1 text-bakin-typography-size-body text-bakin-text-primary">
          <TurnOutputView chunks={[{ type: 'text', content: str }]} />
        </div>
      )
    }
    return <p className="m-0 mt-bakin-1 break-words text-bakin-typography-size-body text-bakin-text-primary">{str}</p>
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return <p className="m-0 mt-bakin-1 text-bakin-typography-size-body text-bakin-text-primary">{String(value)}</p>
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return (
      <dl className="m-0 mt-bakin-2 grid min-w-0 gap-bakin-3 border-s border-bakin-border-subtle ps-bakin-3">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className="text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wider text-bakin-text-muted">
              {humanizeKey(k)}
            </dt>
            <dd className="m-0"><OutputValue value={v} /></dd>
          </div>
        ))}
      </dl>
    )
  }
  return <p className="m-0 mt-bakin-1 text-bakin-typography-size-body text-bakin-text-muted">{String(value ?? '—')}</p>
}

/** Render prior step output in a human-readable layout. */
export function StepOutputViewer({ output }: { output: Record<string, unknown> | string | unknown }) {
  const data = normalizeOutput(output)
  return (
    <Panel scroll padding="compact" aria-label="Step output" data-step-output="" className="max-h-80">
      <dl className="m-0 grid min-w-0 gap-bakin-3">
        {Object.entries(data).map(([key, value]) => (
          <div key={key}>
            <dt className="text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wider text-bakin-text-muted">
              {humanizeKey(key)}
            </dt>
            <dd className="m-0"><OutputValue value={value} /></dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

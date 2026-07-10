'use client'

import { TurnOutputView } from "@makinbakin/sdk/components"
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
        <div className="mt-0.5">
          <p className="text-xs text-zinc-400 break-all">{ref}</p>
          <img src={`/api/assets/${encodeURIComponent(ref)}`} alt={ref} className="mt-1 max-h-48 rounded border border-border object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        </div>
      )
    }
    const str = value as string
    if (str.includes('\n') || str.length > 120) {
      // Step output is a key/value tree, not chunk-shaped — but its prose
      // leaves ARE turn output, so they render through the single chunk
      // renderer (markdown default) instead of a local format heuristic.
      return (
        <div className="text-xs text-zinc-300 mt-0.5">
          <TurnOutputView chunks={[{ type: 'text', content: str }]} />
        </div>
      )
    }
    return <p className="text-xs text-zinc-300 mt-0.5">{str}</p>
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return <p className="text-xs text-zinc-300 mt-0.5">{String(value)}</p>
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return (
      <div className="mt-1 pl-3 border-l border-zinc-700 space-y-2">
        {entries.map(([k, v]) => (
          <div key={k}>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{humanizeKey(k)}</p>
            <OutputValue value={v} />
          </div>
        ))}
      </div>
    )
  }
  return <p className="text-xs text-zinc-400 mt-0.5">{String(value ?? '—')}</p>
}

/** Render prior step output in a human-readable layout. */
export function StepOutputViewer({ output }: { output: Record<string, unknown> | string | unknown }) {
  const data = normalizeOutput(output)
  return (
    <div className="rounded-md border border-border bg-zinc-900 px-3 py-2 max-h-80 overflow-y-auto space-y-3">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{humanizeKey(key)}</p>
          <OutputValue value={value} />
        </div>
      ))}
    </div>
  )
}

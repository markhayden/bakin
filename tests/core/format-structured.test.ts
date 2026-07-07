/**
 * Shared structured-value formatter (#608): labeled prose, one-line
 * summary, and tool-result-envelope unwrapping. Pure — no mocks needed.
 */
import { describe, test, expect } from 'bun:test'
import {
  humanizeKey,
  formatStructured,
  summarizeStructured,
  unwrapToolResult,
} from '../../packages/core/src/format/structured'

describe('humanizeKey', () => {
  test('snake, kebab, and camel case → Title-ish prose', () => {
    expect(humanizeKey('targetPlatform')).toBe('Target platform')
    expect(humanizeKey('asset_id')).toBe('Asset id')
    expect(humanizeKey('open-graph')).toBe('Open graph')
  })
})

describe('formatStructured', () => {
  test('labeled prose; nested objects indent; empty fields drop', () => {
    const out = formatStructured({ ok: true, caption: 'A pie', meta: { width: 1080, note: '' } })
    expect(out).toContain('Ok: true')
    expect(out).toContain('Caption: A pie')
    expect(out).toContain('Meta:')
    expect(out).toContain('  Width: 1080')
    expect(out).not.toContain('Note') // empty string dropped
  })

  test('markdown mode bolds labels', () => {
    expect(formatStructured({ status: 'done' }, { markdown: true })).toBe('**Status:** done')
  })

  test('scalar renders as itself; empty object renders empty (never "{}")', () => {
    expect(formatStructured('hello')).toBe('hello')
    expect(formatStructured({})).toBe('')
    expect(formatStructured({ blank: '', nothing: null })).toBe('')
  })

  test('scalar array joins; heading + cap honored', () => {
    expect(formatStructured({ tags: ['a', 'b', 'c'] })).toBe('Tags: a, b, c')
    const capped = formatStructured({ big: 'x'.repeat(100) }, { cap: 20 })
    expect(capped).toContain('[truncated]')
  })
})

describe('summarizeStructured', () => {
  test('prefers a meaningful field; flags errors', () => {
    expect(summarizeStructured({ ok: true, assetId: '20260707-abc' })).toBe('20260707-abc')
    expect(summarizeStructured({ ok: false, error: 'boom' })).toBe('error: boom')
  })

  test('falls back to scalar key/value join then key list', () => {
    expect(summarizeStructured({ width: 1080, height: 1350 })).toBe('Width: 1080, Height: 1350')
    expect(summarizeStructured({ nested: { a: 1 } })).toBe('{ nested }')
  })

  test('caps long output with an ellipsis', () => {
    expect(summarizeStructured({ message: 'y'.repeat(200) }, 20).length).toBeLessThanOrEqual(20)
  })
})

describe('unwrapToolResult', () => {
  test('peels the Pi content envelope and parses inner JSON', () => {
    const envelope = { content: [{ type: 'text', text: '{"ok":true,"assetId":"20260707-x"}' }] }
    expect(unwrapToolResult(envelope)).toEqual({ ok: true, assetId: '20260707-x' })
  })

  test('plain JSON string parses; plain text passes through; non-envelope passes through', () => {
    expect(unwrapToolResult('{"a":1}')).toEqual({ a: 1 })
    expect(unwrapToolResult('just text')).toBe('just text')
    expect(unwrapToolResult({ ok: true })).toEqual({ ok: true })
  })

  test('malformed inner JSON degrades to the raw text, never throws', () => {
    const envelope = { content: [{ type: 'text', text: '{not valid' }] }
    expect(unwrapToolResult(envelope)).toBe('{not valid')
  })

  test('end-to-end: ugly tool dump → clean chip summary', () => {
    const ugly = { content: [{ type: 'text', text: '{"ok":true,"assetId":"20260707-instagram-square-image-b8cd5674","version":1}' }] }
    expect(summarizeStructured(unwrapToolResult(ugly))).toBe('20260707-instagram-square-image-b8cd5674')
  })
})

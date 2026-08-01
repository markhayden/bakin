/**
 * EnrichmentCard (D8/T10): renders derived metadata, edit locks the field
 * (PATCH → userEdited), re-run forces a billed call, failed shows retry.
 * Fetch is stubbed; no engine, no billing.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-enrich-card-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { EnrichmentCard } from '@bakin/assets/components/versioned/EnrichmentCard'

const calls: Array<{ url: string; method: string; body: unknown }> = []
const realFetch = globalThis.fetch

function manifest(enrichment: Record<string, unknown> | undefined) {
  return {
    assetId: '20260703-test-abcd1234',
    type: 'images',
    description: 'd',
    tags: [],
    currentVersion: 1,
    versions: [],
    exports: [],
    enrichment,
  } as never
}

beforeEach(() => {
  calls.length = 0
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
})

describe('EnrichmentCard', () => {
  it('renders caption, tags, OCR, and provenance for a done record', () => {
    render(<EnrichmentCard manifest={manifest({
      status: 'done', caption: 'a red square', ocrText: 'TOTAL $42',
      suggestedTags: ['red', 'square'], model: 'anthropic/claude-haiku-4-5', at: new Date().toISOString(),
    })} onChanged={() => {}} />)
    expect(screen.getByTestId('enrichment-caption').textContent).toContain('a red square')
    expect(screen.getByTestId('enrichment-tags').textContent).toContain('red')
    expect(screen.getByTestId('enrichment-ocr').textContent).toContain('TOTAL $42')
    expect(screen.getByText('done').textContent).toBe('done')
    expect(screen.getByRole('heading', { level: 3, name: 'Enrichment' })).toBeTruthy()
  })

  it('nothing renders without an enrichment record', () => {
    const { container } = render(<EnrichmentCard manifest={manifest(undefined)} onChanged={() => {}} />)
    expect(container.querySelector('[data-testid="enrichment-card"]')).toBeNull()
  })

  it('failed state shows the error and re-run forces a billed call', async () => {
    const onChanged = mock(() => {})
    render(<EnrichmentCard manifest={manifest({ status: 'failed', error: 'provider down' })} onChanged={onChanged} />)
    expect(screen.getByTestId('enrichment-error').textContent).toContain('provider down')
    fireEvent.click(screen.getByTestId('enrichment-rerun'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const call = calls.find((c) => c.url.endsWith('/enrich'))
    expect(call?.method).toBe('POST')
    expect(call?.body).toEqual({ assetId: '20260703-test-abcd1234', force: true })
  })

  it('caption edit PATCHes the enrichment endpoint (locks the field)', async () => {
    const onChanged = mock(() => {})
    render(<EnrichmentCard manifest={manifest({ status: 'done', caption: 'machine words' })} onChanged={onChanged} />)
    fireEvent.click(screen.getByTestId('enrichment-caption-edit'))
    fireEvent.change(screen.getByTestId('enrichment-caption-input'), { target: { value: 'my words' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const call = calls.find((c) => c.url.includes('/enrichment') && c.method === 'PATCH')
    expect(call?.body).toEqual({ caption: 'my words' })
  })

  it('apply sends the suggested tags to tags/apply', async () => {
    const onChanged = mock(() => {})
    render(<EnrichmentCard manifest={manifest({ status: 'done', caption: 'c', suggestedTags: ['a', 'b'] })} onChanged={onChanged} />)
    fireEvent.click(screen.getByText('Apply'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const call = calls.find((c) => c.url.endsWith('/tags/apply'))
    expect(call?.body).toEqual({ assetIds: ['20260703-test-abcd1234'], add: ['a', 'b'] })
  })
})

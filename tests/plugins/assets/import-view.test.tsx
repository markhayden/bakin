/**
 * ImportView (D7): scan-on-open, per-file import with type override,
 * import-all, honest empty state. Fetch is stubbed; no engine involved.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-import-view-${Date.now()}`)
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

import { ImportView } from '@bakin/assets/components/versioned/ImportView'

const FILES = [
  { relPath: 'assets/inbox/pic.png', name: 'pic.png', size: 2048, mtimeMs: Date.now() - 60_000, suggestedType: 'images' },
  { relPath: 'assets/legacy.pdf', name: 'legacy.pdf', size: 999, mtimeMs: Date.now() - 3_600_000, suggestedType: 'pdf' },
]

let scanResponses: Array<typeof FILES>
let importCalls: Array<Record<string, unknown>>

beforeEach(() => {
  scanResponses = [FILES]
  importCalls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/import/scan')) {
      const files = scanResponses.length > 1 ? scanResponses.shift()! : scanResponses[0]
      return Response.json({ files, count: files.length })
    }
    if (url.endsWith('/import') && init?.method === 'POST') {
      importCalls.push(JSON.parse(String(init.body)))
      scanResponses = [[]]
      return Response.json({ ok: true, imported: 1, failed: 0, results: [] })
    }
    throw new Error(`unrouted: ${url}`)
  }) as typeof fetch
})


describe('ImportView', () => {
  it('lists scan results with suggested types', async () => {
    render(<ImportView />)
    await waitFor(() => expect(screen.getByTestId('import-list')).toBeTruthy())
    expect(screen.getByTestId('import-row-pic.png')).toBeTruthy()
    // Kit Select (refit T6.5): the trigger surfaces the suggested type as its value text.
    expect(screen.getByTestId('import-type-pic.png').textContent).toContain('images')
    expect(screen.getByTestId('import-all').textContent).toContain('Import all (2)')
  })

  it('imports one file with its type override', async () => {
    render(<ImportView />)
    await waitFor(() => expect(screen.getByTestId('import-list')).toBeTruthy())
    // Kit Select (refit T6.5): open the trigger, pick the option.
    const user = userEvent.setup()
    await user.click(screen.getByTestId('import-type-pic.png'))
    await user.click(await screen.findByRole('option', { name: 'research' }))
    fireEvent.click(screen.getByTestId('import-pic.png'))
    await waitFor(() => expect(importCalls.length).toBe(1))
    expect(importCalls[0]).toEqual({ paths: ['assets/inbox/pic.png'], type: 'research' })
    await waitFor(() => expect(screen.getByTestId('import-empty')).toBeTruthy())
  })

  it('import-all posts all:true and empties the view', async () => {
    const onImported = mock()
    render(<ImportView onImported={onImported} />)
    await waitFor(() => expect(screen.getByTestId('import-list')).toBeTruthy())
    fireEvent.click(screen.getByTestId('import-all'))
    await waitFor(() => expect(importCalls.length).toBe(1))
    expect(importCalls[0]).toEqual({ all: true })
    await waitFor(() => expect(screen.getByTestId('import-empty')).toBeTruthy())
    expect(onImported).toHaveBeenCalled()
  })

  it('shows the honest empty state when nothing is unmanaged', async () => {
    scanResponses = [[]]
    render(<ImportView />)
    await waitFor(() => expect(screen.getByTestId('import-empty')).toBeTruthy())
  })
})

/**
 * A brand deleted underneath staged edits (Codex review, #758 guard work):
 * the not-found screen has no decision dialog, so the guard must stop being
 * dirty there — a navigation already waiting on the decision goes through
 * instead of hanging invisibly.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { settleReact } from '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-brand-detail-deleted-guard')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

type Blocker = (args: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) => Promise<boolean>
let blockers: Blocker[] = []
const router = {
  history: { block: ({ blockerFn }: { blockerFn: Blocker }) => { blockers.push(blockerFn); return () => { blockers = blockers.filter((b) => b !== blockerFn) } } },
  parseLocation: (location: unknown) => location,
}
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => mock(),
  useParams: () => ({ brandId: 'acme' }),
  useRouter: () => router,
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))
mock.module('../../../packages/sdk/src/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
}))
mock.module('@/components/markdown-editor', () => ({
  MarkdownEditor: ({ content }: { content: string }) => <textarea defaultValue={content} />,
}))

import { emitPluginEvent } from '@makinbakin/sdk/hooks'
import { BrandDetail } from '../../../plugins/brands/components/brand-detail'

const BRAND = {
  id: 'acme', name: 'Acme', description: 'Developer tools.', palette: [], rules: [], terminology: [],
  logos: [], assetGroups: [], createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
}
let deleted = false
beforeEach(() => {
  deleted = false
  blockers = []
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/plugins/brands/acme')) {
      return deleted
        ? new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
        : new Response(JSON.stringify({ brand: BRAND, guidelines: [], lessons: [], fingerprint: 'sha256:x' }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
})
afterEach(async () => {
  await settleReact()
  cleanup()
})

describe('BrandDetail — brand deleted under staged edits', () => {
  it('a navigation waiting on the decision goes through once the brand is gone', async () => {
    await act(async () => { render(<BrandDetail brandId="acme" onBack={() => {}} />) })
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Identity' })) })
    await act(async () => { fireEvent.change(screen.getByLabelText('Brand name'), { target: { value: 'Acme Inc' } }) })
    await waitFor(() => expect(blockers).toHaveLength(1))

    const outcome: { value: boolean | 'pending' } = { value: 'pending' }
    await act(async () => {
      void blockers[0]!({ currentLocation: { pathname: '/brands/acme' }, nextLocation: { pathname: '/tasks' } }).then((v) => { outcome.value = v })
    })
    await settleReact()
    expect(outcome.value).toBe('pending')

    deleted = true
    await act(async () => { emitPluginEvent({ event: 'brand.changed', brandId: 'acme' }) })
    await waitFor(() => expect(document.querySelector('[data-brand-detail-not-found]')).not.toBeNull())
    await settleReact()
    expect(outcome.value).toBe(false) // false = not blocked: it went through
  })
})

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { readFileSync } from 'node:fs'

import '../../rtl-settle'

const goBack = mock()
const push = mock()

mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to, ...props }: {
    children: ReactNode
    to: string
    [key: string]: unknown
  }) => <a href={to} {...props}>{children}</a>,
  useHistoryBack: () => goBack,
  useParams: () => ({ assetId: '20260704-gourmet-popcorn-f1a2b3c4' }),
  useRouter: () => ({
    back: mock(),
    forward: mock(),
    prefetch: mock(),
    push,
    refresh: mock(),
    replace: mock(),
  }),
}))

mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (agentId: string) => ({ id: agentId, name: agentId }),
  useAgentColor: () => 'var(--bakin-color-signal-accent)',
  useAgentDisplayName: (agentId: string) => agentId,
  usePluginEvent: () => {},
}))

mock.module('@makinbakin/sdk/components', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span>{agentId}</span>,
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}))

const manifest = {
  assetId: '20260704-gourmet-popcorn-f1a2b3c4',
  type: 'images',
  source: { kind: 'generated', path: null },
  agent: 'pixel',
  taskId: 'task-launch',
  created: '2026-07-04T16:00:00.000Z',
  updated: '2026-07-04T16:00:00.000Z',
  currentVersion: 2,
  description: 'Gourmet seasoned popcorn with rosemary and parmesan',
  tags: ['food', 'popcorn', 'snack'],
  versions: [
    {
      version: 2,
      file: 'popcorn-v2.jpg',
      thumb: 'popcorn-v2-thumb.jpg',
      mimeType: 'image/jpeg',
      size: 2048,
      width: 1200,
      height: 1600,
      created: '2026-07-04T16:00:00.000Z',
      description: 'Final crop',
      tags: ['food'],
      op: 'edit',
      parentVersion: 1,
      tool: null,
      prompt: null,
      promptHash: null,
      generation: null,
    },
    {
      version: 1,
      file: 'popcorn-v1.jpg',
      thumb: 'popcorn-v1-thumb.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      width: 1200,
      height: 1600,
      created: '2026-07-03T16:00:00.000Z',
      description: 'Initial render',
      tags: ['food'],
      op: 'generate',
      parentVersion: null,
      tool: null,
      prompt: null,
      promptHash: null,
      generation: null,
    },
  ],
  exports: [
    {
      name: 'instagram',
      surface: 'instagram',
      format: 'jpg',
      file: 'instagram.jpg',
      width: 1080,
      height: 1080,
      fromVersion: 2,
      created: '2026-07-04T16:00:00.000Z',
    },
  ],
  enrichment: {
    status: 'done',
    caption: 'A bowl of seasoned popcorn on a wooden table.',
    suggestedTags: ['snack', 'food'],
    model: 'anthropic/claude-haiku-4-5',
    at: '2026-07-04T16:30:00.000Z',
  },
}

const realFetch = globalThis.fetch

beforeEach(() => {
  goBack.mockClear()
  push.mockClear()
  globalThis.fetch = (async () => Response.json({ asset: manifest })) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
})

describe('VersionedAssetDetail', () => {
  it('uses focused navigation and the shared detail-page contract', async () => {
    const source = readFileSync(
      new URL('../../../plugins/assets/components/versioned/VersionedAssetDetail.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('@makinbakin/sdk/navigation')
    expect(source).toContain('@makinbakin/sdk/patterns')
    expect(source).not.toContain('@tanstack/react-router')
    expect(source).not.toContain('@makinbakin/sdk/components')
    expect(source).toContain('actionsLabel="Asset actions"')
    expect(source).toContain('Edit asset')
    expect(source).toContain('Add version')
    expect(source).toContain('Delete asset')
    expect(source).toContain('size="icon-sm"')
    expect(source).toContain('className="rounded-bakin-pill"')
    expect(source).toContain('<DetailPageAside label="Asset context">')
    expect(source).toContain('<DetailPage width="full"')

    const { VersionedAssetDetail } = await import(
      '../../../plugins/assets/components/versioned/VersionedAssetDetail'
    )
    const { container } = render(<VersionedAssetDetail />)

    await waitFor(() => {
      expect(screen.getByRole('heading', {
        level: 1,
        name: 'Gourmet seasoned popcorn with rosemary and parmesan',
      })).toBeTruthy()
    })

    expect(container.querySelector('[data-archetype="detail"]')?.getAttribute('data-width')).toBe('full')
    const back = screen.getByRole('button', { name: 'Back to assets' })
    expect(back.textContent).toBe('')
    expect(back.getAttribute('data-size')).toBe('icon-sm')
    expect(back.className).toContain('rounded-bakin-pill')
    expect(screen.queryByText('Review the current preview, asset context, downloads, and immutable version history.')).toBeNull()
    const aside = screen.getByRole('complementary', { name: 'Asset context' })
    expect(aside).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Preview' })).toBeTruthy()
    expect(within(aside).getByRole('heading', { level: 3, name: 'Enrichment' })).toBeTruthy()
    expect(within(aside).getByRole('heading', { level: 2, name: 'Downloads' })).toBeTruthy()
    expect(within(aside).getByRole('heading', { level: 2, name: 'Version history' })).toBeTruthy()
    expect(within(aside).getAllByRole('heading').map((heading) => heading.textContent?.trim())).toEqual([
      'Asset context',
      'Enrichment',
      'Downloads',
      'Version history',
    ])
  })

  it('retains page identity while the detail body is loading', async () => {
    globalThis.fetch = (async () => new Promise<Response>(() => {})) as unknown as typeof fetch
    const { VersionedAssetDetail } = await import(
      '../../../plugins/assets/components/versioned/VersionedAssetDetail'
    )

    render(<VersionedAssetDetail />)

    expect(screen.getByRole('heading', { level: 1, name: 'Asset detail' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Loading asset' })).toBeTruthy()
  })
})

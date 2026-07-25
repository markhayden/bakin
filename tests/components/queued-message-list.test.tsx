// @vitest-environment jsdom
/**
 * QueuedMessageList (#729/#732) — queued follow-ups render as user-style
 * bubbles with a Queued badge and a per-item remove ×; remove hands the
 * WHOLE item back so the surface can restore its text into the composer.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-queued-list-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { fireEvent, render } from '@testing-library/react'
import '../rtl-settle'

import { QueuedMessageList, type ConversationQueuedItem } from '@makinbakin/sdk/components'

const ITEMS: ConversationQueuedItem[] = [
  { id: 'q1', ts: '2026-07-25T00:00:00Z', content: 'first correction' },
  {
    id: 'q2',
    ts: '2026-07-25T00:00:01Z',
    content: 'with a picture',
    attachments: [{ name: 'shot.png', mimeType: 'image/png', url: 'blob:thumb' }],
  },
]

describe('QueuedMessageList', () => {
  it('renders queued bubbles in order with a Queued badge and attachment thumbnails', () => {
    const { container } = render(<QueuedMessageList items={ITEMS} />)
    const list = container.querySelector('[data-queued-list]')
    expect(list).not.toBeNull()
    expect(list!.textContent).toContain('first correction')
    expect(list!.textContent).toContain('with a picture')
    expect(list!.textContent).toContain('Queued')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:thumb')
    // FIFO order preserved in the DOM.
    const bubbles = [...container.querySelectorAll('[data-queued-item]')]
    expect(bubbles.map((b) => b.getAttribute('data-queued-item'))).toEqual(['q1', 'q2'])
  })

  it('remove × hands back the full item', () => {
    const removed: ConversationQueuedItem[] = []
    const { container } = render(<QueuedMessageList items={ITEMS} onRemove={(item) => removed.push(item)} />)
    const removes = container.querySelectorAll('[data-queued-remove]')
    expect(removes).toHaveLength(2)
    fireEvent.click(removes[0])
    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatchObject({ id: 'q1', content: 'first correction' })
  })

  it('renders nothing when empty', () => {
    const { container } = render(<QueuedMessageList items={[]} />)
    expect(container.querySelector('[data-queued-list]')).toBeNull()
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/navigation', () => ({ PluginLink: ({ to, children, ...props }: { to: string; children?: ReactNode }) => <a href={to} {...props}>{children}</a> }))
mock.module('@makinbakin/sdk/hooks', () => ({ usePluginEvent: () => {} }))
import { TaskAssets } from '../../../plugins/assets/components/task-assets'

const originalFetch = globalThis.fetch
afterEach(() => { cleanup(); globalThis.fetch = originalFetch })
const asset = { assetId: 'asset-one', description: 'Publication cover', type: 'images', currentVersion: 2, versionCount: 2, hasThumb: false }
describe('TaskAssets collection', () => {
  it('keeps links and unlink actions independent and retains rows after failure', async () => {
    const posts: unknown[] = []
    globalThis.fetch = mock(async (_input, init) => {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return new Response('{}', { status: 503 }) }
      return Response.json({ assets: [asset] })
    }) as unknown as typeof fetch
    render(<TaskAssets taskId="task-one" />)
    const link = await screen.findByRole('link', { name: 'Open Publication cover' })
    expect(link.getAttribute('href')).toBe('/assets/asset-one')
    expect(screen.getByRole('list', { name: 'Task assets' }).getAttribute('data-variant')).toBe('separated')
    const remove = screen.getByRole('button', { name: 'Remove Publication cover from task' })
    expect(remove.closest('a')).toBeNull()
    fireEvent.click(remove)
    await screen.findByText('Asset was not removed')
    expect(posts).toEqual([{ taskId: null }])
    expect(screen.getByRole('link', { name: 'Open Publication cover' })).toBeTruthy()
  })
  it('reports load failure, retries, and keeps read-only rows free of mutation controls', async () => {
    let failed = true
    globalThis.fetch = mock(async () => failed ? new Response('{}', { status: 503 }) : Response.json({ assets: [asset] })) as unknown as typeof fetch
    render(<TaskAssets taskId="task-one" readOnly />)
    await screen.findByText('Task assets could not be loaded')
    failed = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('link', { name: 'Open Publication cover' })
    await waitFor(() => expect(screen.queryByText('Task assets could not be loaded')).toBeNull())
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Add' })).toBeNull()
  })
  it('locks every unlink while a request is pending and unlocks after rejection', async () => {
    let rejectPost!: (reason: Error) => void
    const posts: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = mock(async (input, init) => {
      if (init?.method === 'POST') {
        posts.push({ url: String(input), init })
        return await new Promise<Response>((_resolve, reject) => { rejectPost = reject })
      }
      return Response.json({ assets: [asset, { ...asset, assetId: 'asset-two', description: 'Second cover' }] })
    }) as unknown as typeof fetch
    render(<TaskAssets taskId="task-one" />)
    const remove = await screen.findByRole('button', { name: 'Remove Publication cover from task' })
    const second = screen.getByRole('button', { name: 'Remove Second cover from task' })
    fireEvent.click(remove)
    fireEvent.click(remove)
    fireEvent.click(second)
    expect(posts).toHaveLength(1)
    expect(posts[0]!.url).toBe('/api/plugins/assets/versioned/asset-one/relink')
    expect(posts[0]!.init.signal).toBeInstanceOf(AbortSignal)
    expect((remove as HTMLButtonElement).disabled).toBe(true)
    expect((second as HTMLButtonElement).disabled).toBe(true)
    rejectPost(new Error('Connection interrupted'))
    await screen.findByText('Connection interrupted')
    await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(false))
    expect((second as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(2)
  })
})

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'

import '../../rtl-settle'
import { AssetEditDrawer } from '../../../plugins/assets/components/versioned/AssetEditDrawer'

const realFetch = globalThis.fetch
const requests: Array<{ url: string; method: string; body: unknown }> = []

beforeEach(() => {
  requests.length = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    return Response.json({ ok: true })
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
})

describe('AssetEditDrawer', () => {
  it('uses the focused UI contract and canonical drawer form composition', async () => {
    const source = readFileSync(
      new URL('../../../plugins/assets/components/versioned/AssetEditDrawer.tsx', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain('@makinbakin/sdk/components')

    render(
      <AssetEditDrawer
        assetId="asset-launch-hero"
        initialDescription="Launch hero"
        initialTags={['launch']}
        suggestions={['launch', 'approved']}
        open
        onOpenChange={() => {}}
      />,
    )

    expect(screen.getByRole('form', { name: 'Edit asset metadata' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Metadata' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Tags' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save asset' }).getAttribute('type')).toBe('submit')
  })

  it('submits changed description and tags through the existing metadata endpoint', async () => {
    const onSaved = mock()
    const onOpenChange = mock()

    render(
      <AssetEditDrawer
        assetId="asset-launch-hero"
        initialDescription="Launch hero"
        initialTags={['launch']}
        suggestions={['launch', 'approved']}
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: 'Approved launch hero' },
    })
    fireEvent.submit(screen.getByRole('form', { name: 'Edit asset metadata' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(requests).toContainEqual({
      url: '/api/plugins/assets/versioned/asset-launch-hero/metadata',
      method: 'PATCH',
      body: {
        description: 'Approved launch hero',
        tags: ['launch'],
      },
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

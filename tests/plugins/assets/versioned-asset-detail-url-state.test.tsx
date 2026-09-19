// @vitest-environment jsdom
/**
 * `?version=` selects the previewed version on /assets/$assetId (spec
 * settings-url-state, Phase 2 rules 1 + 4).
 *
 * The current version is the default and is omitted from the URL; picking
 * another version writes it (replace-mode — an in-page selection, not an
 * overlay); picking the current version drops it; a version the manifest
 * does not carry previews the current one WITHOUT rewriting the URL.
 *
 * Runs the real page over the router shim with a stable spy navigate and a
 * `useParams` override supplying the asset id (the shim's returns `{}`).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { settleFor } from '../../helpers/wait'

const testDir = join(tmpdir(), `bakin-test-asset-detail-url-state-${Date.now()}`)
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (agentId: string) => ({ id: agentId, name: agentId }),
  useAgentColor: () => 'var(--bakin-color-signal-accent)',
  useAgentDisplayName: (agentId: string) => agentId,
  usePluginEvent: () => {},
}))

const ASSET_ID = '20260704-gourmet-popcorn-f1a2b3c4'
// Router shim + a STABLE spy navigate; the real navigation hooks run over it.
const navigations: Array<Record<string, unknown>> = []
const navigate = (opts: Record<string, unknown>) => navigations.push(opts)
mock.module('@tanstack/react-router', () => ({
  ...require('../../shims/tanstack-router'),
  useNavigate: () => navigate,
  useParams: () => ({ assetId: ASSET_ID }),
}))

import { VersionedAssetDetail } from '../../../plugins/assets/components/versioned/VersionedAssetDetail'

function setURL(url: string) {
  const happy = (window as unknown as { happyDOM?: { setURL: (u: string) => void } }).happyDOM
  happy?.setURL(url)
}

const version = (n: number, op: 'generate' | 'edit', parentVersion: number | null) => ({
  version: n, file: `popcorn-v${n}.jpg`, thumb: `popcorn-v${n}-thumb.jpg`, mimeType: 'image/jpeg',
  size: 1024 * n, width: 1200, height: 1600, created: `2026-07-0${2 + n}T16:00:00.000Z`,
  description: n === 1 ? 'Initial render' : 'Final crop', tags: ['food'], op, parentVersion,
  tool: null, prompt: null, promptHash: null, generation: null,
})
const manifest = {
  assetId: ASSET_ID,
  type: 'images',
  source: { kind: 'generated', path: null },
  agent: 'pixel',
  taskId: 'task-launch',
  created: '2026-07-04T16:00:00.000Z',
  updated: '2026-07-04T16:00:00.000Z',
  currentVersion: 2,
  description: 'Gourmet seasoned popcorn with rosemary and parmesan',
  tags: ['food', 'popcorn', 'snack'],
  versions: [version(2, 'edit', 1), version(1, 'generate', null)],
  exports: [],
  enrichment: { status: 'done', caption: 'A bowl of seasoned popcorn.', suggestedTags: ['snack'], model: 'm', at: '2026-07-04T16:30:00.000Z' },
}

const realFetch = globalThis.fetch
async function mountAt(url: string) {
  setURL(`http://localhost${url}`)
  globalThis.fetch = (async () => Response.json({ asset: manifest })) as unknown as typeof fetch
  await act(async () => { render(<VersionedAssetDetail />) })
  await waitFor(() => screen.getByRole('button', { name: 'Preview version 1' }))
}
const badge = () => screen.getByText(/^v\d · (current|selected)$/).textContent

beforeEach(() => { navigations.length = 0 })
afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
  setURL('http://localhost/')
})

describe('VersionedAssetDetail — ?version=', () => {
  it('cold-loads the version named by ?version= without navigating', async () => {
    await mountAt(`/assets/${ASSET_ID}?version=1`)
    expect(badge()).toBe('v1 · selected')
    expect(screen.getByRole('button', { name: 'Preview version 1' }).getAttribute('aria-pressed')).toBe('true')
    await settleFor(50, 'an inbound deep link must not be rewritten')
    expect(navigations).toHaveLength(0)
  })

  it('defaults to the current version with a clean URL', async () => {
    await mountAt(`/assets/${ASSET_ID}`)
    expect(badge()).toBe('v2 · current')
    await settleFor(50, 'the default must not write itself into the URL')
    expect(navigations).toHaveLength(0)
  })

  it('selecting another version writes ?version= in one replace navigation', async () => {
    await mountAt(`/assets/${ASSET_ID}`)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' })) })
    await waitFor(() => expect(navigations).toHaveLength(1))
    expect(navigations[0]).toMatchObject({ to: `/assets/${ASSET_ID}`, search: { version: '1' }, replace: true })
  })

  it('selecting the current version drops ?version=', async () => {
    await mountAt(`/assets/${ASSET_ID}?version=1`)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview version 2' })) })
    await waitFor(() => expect(navigations).toHaveLength(1))
    expect(navigations[0]).toMatchObject({ to: `/assets/${ASSET_ID}`, search: {}, replace: true })
  })

  it('a version the manifest does not carry previews the current one without rewriting the URL', async () => {
    await mountAt(`/assets/${ASSET_ID}?version=9`)
    expect(badge()).toBe('v2 · current')
    await settleFor(50, 'a stale in-page selection shows the default; nothing to normalize')
    expect(navigations).toHaveLength(0)
  })
})

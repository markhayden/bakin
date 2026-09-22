// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import '../../rtl-settle'
import { CatalogTable } from '../../../plugins/explore/components/catalog-table'
import { entryStatusBadge } from '../../../plugins/explore/components/catalog-entry'
import type { ExploreCatalogEntry } from '../../../plugins/explore/types'

const contentDirMock = () => ({ getContentDir: () => '/tmp/bakin-test-catalog-table-unused', getBakinPaths: () => ({}) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@makinbakin/sdk/navigation', () => ({
  useQueryState: (_key: string, initial = '') => {
    const { useState } = require('react') as typeof import('react')
    return useState(initial)
  },
}))

const entry = (over: Partial<ExploreCatalogEntry> = {}): ExploreCatalogEntry => ({
  id: 'pixel', kind: 'agent', name: 'Pixel', emoji: '🎨', description: 'Image artist agent.',
  category: 'Creative', tags: [], runtimes: ['*'], useCases: ['Generate on-brand social images'],
  source: 'github:markhayden/bakin-bits-official#agents/pixel', ref: null, trust: 'official',
  builtin: false, dependencies: [], defaultSelected: false, screenshots: [],
  installed: false, updateAvailable: null, installedVersion: null, ...over,
})
afterEach(cleanup)

describe('catalog status precedence', () => {
  it('keeps builtin, update, installed and available distinct', () => {
    expect(entryStatusBadge(entry({ builtin: true, installed: true, updateAvailable: true }))?.label).toBe('Built in')
    expect(entryStatusBadge(entry({ installed: true, updateAvailable: true }))?.label).toBe('Update available')
    expect(entryStatusBadge(entry({ installed: true, updateAvailable: false }))?.label).toBe('Installed')
    expect(entryStatusBadge(entry())).toBeNull()
  })
})

describe('CatalogTable', () => {
  it('shares sorted records and metadata between wide and narrow renders', async () => {
    render(<CatalogTable entries={[entry(), entry({ id: 'alpha', name: 'Alpha' })]} onSelect={mock()} />)
    const table = screen.getByRole('table', { name: 'Catalog items' })
    const list = screen.getByRole('list', { name: 'Catalog items' })
    expect(list.getAttribute('data-variant')).toBe('separated')
    expect(within(table).getAllByRole('row')[1].textContent).toContain('Alpha')
    expect(within(list).getAllByRole('listitem')[0].textContent).toContain('Alpha')
    expect(within(table).getAllByText('Creative')).toHaveLength(2)
    expect(within(table).getAllByText('Image artist agent.')).toHaveLength(2)
    await act(async () => { fireEvent.click(within(table).getByRole('button', { name: 'Name' })) })
    expect(within(table).getAllByRole('row')[1].textContent).toContain('Pixel')
    expect(within(list).getAllByRole('listitem')[0].textContent).toContain('Pixel')
    expect(screen.queryByRole('combobox', { name: 'Sort catalog' })).toBeNull()
  })

  it('keeps Details and Install independent in both renders', () => {
    const onSelect = mock(), onInstall = mock()
    const target = entry()
    render(<CatalogTable entries={[target]} onSelect={onSelect} onInstall={onInstall} />)
    for (const region of [screen.getByRole('table'), screen.getByRole('list')]) {
      fireEvent.click(within(region).getByRole('button', { name: 'Install Pixel' }))
      expect(onInstall).toHaveBeenLastCalledWith(target)
      expect(onSelect).not.toHaveBeenCalled()
    }
    fireEvent.click(within(screen.getByRole('list')).getByRole('button', { name: 'View Pixel details' }))
    expect(onSelect).toHaveBeenCalledWith(target)
  })

  it('does not offer installation for installed, builtin or incompatible records', () => {
    render(<CatalogTable entries={[
      entry({ id: 'installed', name: 'Installed agent', installed: true, installedVersion: '1.2.0' }),
      entry({ id: 'builtin', name: 'Builtin agent', builtin: true }),
      entry({ id: 'incompatible', name: 'Other runtime', runtimes: ['openclaw'] }),
    ]} activeAdapter="pi" onSelect={mock()} onInstall={mock()} />)
    const table = within(screen.getByRole('table'))
    expect(table.queryByRole('button', { name: /^Install / })).toBeNull()
    expect(table.getByText('v1.2.0')).toBeDefined()
    expect(table.getByText('Built in')).toBeDefined()
    expect(table.getByText('Installed')).toBeDefined()
    expect(table.getByText('Installed').closest('[data-slot="badge"]')?.getAttribute('data-variant')).toBe('soft')
    expect(table.getByText('Built in').closest('[data-slot="badge"]')?.getAttribute('data-variant')).toBe('solid')
    expect(table.getByText('Not for pi — requires openclaw')).toBeDefined()
    expect(table.getAllByRole('button', { name: /^View .* details$/ })).toHaveLength(3)
  })

  it('uses the catalog icon with emoji fallback before install and agent identity after install', () => {
    render(<CatalogTable entries={[
      entry({ iconUrl: 'https://example.com/pixel.png' }),
      entry({ id: 'installed', name: 'Installed agent', installed: true }),
    ]} onSelect={mock()} />)
    const table = screen.getByRole('table')
    expect(within(table).getByTestId('icon-agent-pixel').getAttribute('data-slot')).toBe('avatar')
    expect(within(table).getByTestId('icon-agent-pixel').textContent).toContain('🎨')
    expect(table.querySelector('[data-agent-id="installed"]')).not.toBeNull()
  })
})

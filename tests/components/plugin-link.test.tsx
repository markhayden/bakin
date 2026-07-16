// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../rtl-settle'

// Pure SDK client components — no storage — but the content-dir resolvers
// are mocked defensively per the repo-wide test isolation rule.
const testDir = join(tmpdir(), `bakin-test-plugin-link-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const navigate = mock(() => undefined)

mock.module('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

import { PluginLink } from '../../packages/sdk/src/components/plugin-link'
import { toNavigationOptions, useRouter } from '../../packages/sdk/src/hooks/router'

function ReplaceProbe() {
  const router = useRouter()
  return <button type="button" onClick={() => router.replace('/memory?debug=1&enabled=true')}>Replace</button>
}

afterEach(() => {
  cleanup()
  navigate.mockClear()
})

describe('PluginLink', () => {
  it('keeps a real href while routing an unmodified primary click in the client', () => {
    render(<PluginLink to="/team/main?tab=diagnostics">Diagnostics</PluginLink>)
    const link = screen.getByRole('link', { name: 'Diagnostics' })

    expect(link.getAttribute('href')).toBe('/team/main?tab=diagnostics')
    fireEvent.click(link)

    expect(navigate).toHaveBeenCalledWith({
      to: '/team/main',
      search: { tab: 'diagnostics' },
      hash: '',
    })
  })

  it('leaves modified and new-tab clicks to the browser', () => {
    const view = render(<PluginLink to="/health?tab=agents">Agents</PluginLink>)
    fireEvent.click(screen.getByRole('link', { name: 'Agents' }), { ctrlKey: true })
    expect(navigate).not.toHaveBeenCalled()

    view.rerender(<PluginLink to="/health?tab=agents" target="_blank">Agents</PluginLink>)
    fireEvent.click(screen.getByRole('link', { name: 'Agents' }))
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('string router URL parsing', () => {
  it('keeps every value a plain string (PR3 3.1 — no JSON coercion); last duplicate wins', () => {
    expect(toNavigationOptions('/health?agent=main&agent=pixel&debug=1&enabled=true#details')).toEqual({
      to: '/health',
      search: { agent: 'pixel', debug: '1', enabled: 'true' },
      hash: 'details',
    })
  })

  it('passes flag-like values through replace as strings', () => {
    render(<ReplaceProbe />)
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/memory',
      search: { debug: '1', enabled: 'true' },
      hash: '',
      replace: true,
      // replace = state tweak: never resets scroll (PR3 3.3)
      resetScroll: false,
    })
  })

  it('clears omitted search and hash state', () => {
    expect(toNavigationOptions('/health')).toEqual({
      to: '/health',
      search: {},
      hash: '',
    })
  })
})

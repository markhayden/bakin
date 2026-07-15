// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../rtl-settle'

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
  it('uses router-native value types for repeated values, flags, and a hash', () => {
    expect(toNavigationOptions('/health?agent=main&agent=pixel&debug=1&enabled=true#details')).toEqual({
      to: '/health',
      search: { agent: ['main', 'pixel'], debug: 1, enabled: true },
      hash: 'details',
    })
  })

  it('keeps numeric and boolean query values unquoted through replace', () => {
    render(<ReplaceProbe />)
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/memory',
      search: { debug: 1, enabled: true },
      hash: '',
      replace: true,
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

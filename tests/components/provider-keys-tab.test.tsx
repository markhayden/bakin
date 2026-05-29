// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProviderKeysTab } from '../../src/components/provider-keys-tab'

const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

function mockFetch(stored: string[] = []) {
  return spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.includes('/api/plugins/images/providers')) {
      return json({
        ok: true,
        readiness: [
          { id: 'openai', label: 'OpenAI', servedBy: 'shim', source: 'native', configuredEnvVars: [] },
          { id: 'google', label: 'Google Gemini', servedBy: 'runtime', source: 'native+runtime', configuredEnvVars: [] },
          { id: 'openrouter', label: 'OpenRouter', servedBy: 'runtime', source: 'runtime' },
        ],
      })
    }
    if (url.includes('/api/secrets')) {
      if (init?.method === 'POST' || init?.method === 'DELETE') return json({ ok: true })
      return json({ stored })
    }
    return json({})
  }) as typeof fetch)
}

afterEach(() => {
  cleanup()
  mock.restore()
})

describe('ProviderKeysTab', () => {
  it('renders provider rows and marks runtime-only providers read-only', async () => {
    mockFetch(['openai'])
    render(<ProviderKeysTab />)

    await waitFor(() => screen.getByText('OpenAI'))
    expect(screen.getByText('Google Gemini')).toBeTruthy()
    expect(screen.getByText('OpenRouter')).toBeTruthy()
    // Runtime-configured providers show read-only status…
    expect(screen.getAllByText(/Configured in the runtime/i).length).toBeGreaterThan(0)
    // …and only the two native (shim-capable) providers expose a key input —
    // the runtime-only provider (OpenRouter) is read-only.
    expect(screen.getAllByPlaceholderText(/API key|Replace stored key/i)).toHaveLength(2)
  })

  it('stores a key via POST /api/secrets', async () => {
    const fetchSpy = mockFetch([])
    render(<ProviderKeysTab />)

    await waitFor(() => screen.getByText('OpenAI'))
    fireEvent.change(screen.getAllByPlaceholderText(/Enter API key/i)[0], { target: { value: 'sk-new' } })
    fireEvent.click(screen.getAllByText('Save')[0])

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith('/api/secrets', expect.objectContaining({ method: 'POST' })),
    )
  })
})

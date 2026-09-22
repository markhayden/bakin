// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import '../rtl-settle'
import { ProviderKeysTab } from '../../src/components/provider-keys-tab'

const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

function mockFetch(stored: string[] = [], secrets: Record<string, string[]> = {}) {
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
      return json({ stored, secrets })
    }
    return json({})
  }) as typeof fetch)
}

afterEach(() => {
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

  it('surfaces a failed save instead of silently succeeding', async () => {
    spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      if (url.includes('/api/plugins/images/providers')) {
        return json({ ok: true, readiness: [{ id: 'openai', label: 'OpenAI', servedBy: 'unconfigured', source: 'native', configuredEnvVars: [] }] })
      }
      if (url.includes('/api/secrets')) {
        if (init?.method === 'POST') return { ok: false, status: 400, json: async () => ({ ok: false, error: 'invalid provider id' }) } as unknown as Response
        return json({ stored: [] })
      }
      return json({})
    }) as typeof fetch)

    render(<ProviderKeysTab />)
    await waitFor(() => screen.getByText('OpenAI'))
    fireEvent.change(screen.getByPlaceholderText(/Enter API key/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => screen.getByRole('alert'))
    expect(screen.getByRole('alert').textContent).toContain('invalid provider id')
    expect((screen.getByPlaceholderText(/Enter API key/i) as HTMLInputElement).value).toBe('x')
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

  describe('integration secrets section', () => {
    it('locks concurrent mutations and retains a rejected add draft', async () => {
      let rejectWrite!: (value: Response) => void
      const pending = new Promise<Response>(resolve => { rejectWrite = resolve })
      const request = mockFetch(['openai'], { discord: ['botToken'] })
      const original = request.getMockImplementation()!
      request.mockImplementation(((input, init) => init?.method === 'POST' ? pending : original(input, init)) as typeof fetch)
      render(<ProviderKeysTab />)
      const add = await screen.findByRole('button', { name: 'Add secret' })
      fireEvent.change(screen.getByLabelText('Integration'), { target: { value: 'brave' } })
      fireEvent.change(screen.getByLabelText('Secret name'), { target: { value: 'apiKey' } })
      fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'fixture-only-key' } })
      fireEvent.click(add)
      expect(add.hasAttribute('disabled')).toBe(true)
      expect(screen.getByLabelText('Integration').hasAttribute('disabled')).toBe(true)
      expect(screen.getAllByRole('button', { name: 'Remove discord botToken' }).every(button => button.hasAttribute('disabled'))).toBe(true)
      fireEvent.submit(screen.getByRole('form', { name: 'Add integration secret' }))
      expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
      await act(async () => { rejectWrite({ ok: false, status: 403, json: async () => ({ error: 'not permitted' }) } as Response) })
      expect((screen.getByLabelText('Value') as HTMLInputElement).value).toBe('fixture-only-key')
      expect((screen.getByLabelText('Integration') as HTMLInputElement).value).toBe('brave')
      expect((screen.getByLabelText('Secret name') as HTMLInputElement).value).toBe('apiKey')
      expect(screen.getByRole('alert').textContent).toContain('not permitted')
    })

    it('keeps integration secrets available when the optional images plugin is absent', async () => {
      spyOn(globalThis, 'fetch').mockImplementation((async input => String(input).includes('/images/providers')
        ? { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as Response
        : json({ stored: [], secrets: { brave: ['apiKey'] } })) as typeof fetch)
      render(<ProviderKeysTab />)
      await screen.findByRole('table', { name: 'Integration secrets' })
      expect(screen.getByRole('button', { name: 'Add secret' })).toBeDefined()
    })
    it('does not present a failed secrets read as an empty editable collection', async () => {
      const request = spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response)
      render(<ProviderKeysTab />)
      await screen.findByRole('button', { name: 'Try again' })
      expect(screen.queryByRole('button', { name: 'Add secret' })).toBeNull()
      request.mockResolvedValue(json({ stored: [], secrets: {}, readiness: [] }))
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await screen.findByRole('button', { name: 'Add secret' })
    })

    it('renders secrets as a table and separated narrow records with named actions', async () => {
      mockFetch([], { discord: ['botToken'] })
      render(<ProviderKeysTab />)
      const table = await screen.findByRole('table', { name: 'Integration secrets' })
      expect(table.textContent).toContain('Integration')
      const list = screen.getByRole('list', { name: 'Integration secrets' })
      expect(list.getAttribute('data-variant')).toBe('separated')
      expect(list.querySelector('button[aria-label="Remove discord botToken"]')).not.toBeNull()
    })
    it('lists stored named secrets grouped by provider, values never shown', async () => {
      mockFetch([], { discord: ['appId', 'botToken'], brave: ['apiKey'] })
      render(<ProviderKeysTab />)

      await waitFor(() => screen.getByText('Integration secrets'))
      const table = within(screen.getByRole('table', { name: 'Integration secrets' }))
      expect(table.getAllByText('discord')).toHaveLength(2)
      expect(table.getByText('botToken')).toBeTruthy()
      expect(table.getByText('appId')).toBeTruthy()
      expect(table.getByText('brave')).toBeTruthy()
    })

    it('removes a named secret via DELETE with provider and name', async () => {
      const fetchSpy = mockFetch([], { discord: ['botToken'] })
      render(<ProviderKeysTab />)

      const table = await screen.findByRole('table', { name: 'Integration secrets' })
      fireEvent.click(within(table).getByLabelText('Remove discord botToken'))
      await waitFor(() =>
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/secrets?provider=discord&name=botToken',
          expect.objectContaining({ method: 'DELETE' }),
        ),
      )
    })

    it('adds a named secret via the add form', async () => {
      const fetchSpy = mockFetch([], {})
      render(<ProviderKeysTab />)

      await waitFor(() => screen.getByText('Integration secrets'))
      fireEvent.change(screen.getByPlaceholderText('integration (e.g. brave)'), { target: { value: 'brave' } })
      fireEvent.change(screen.getByPlaceholderText('secret name (e.g. apiKey)'), { target: { value: 'apiKey' } })
      fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'bsk-1' } })
      fireEvent.click(screen.getByText('Add secret'))

      await waitFor(() => {
        const post = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
        expect(post).toBeTruthy()
        expect(String((post![1] as RequestInit).body)).toContain('"name":"apiKey"')
        expect(String((post![1] as RequestInit).body)).toContain('"provider":"brave"')
      })
    })
  })
})

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

// Pure client-component test (stubbed global fetch) — isolation mocks are
// belt-and-braces per the repo's test rules.
const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-install-dialog-unused',
  getBakinPaths: () => ({}),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('@makinbakin/sdk/ui', () => ({
  Alert: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div role="alert" {...props}>{children}</div>,
  AlertTitle: ({ children }: { children: ReactNode }) => <strong>{children}</strong>,
  AlertDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: InputHTMLAttributes<HTMLInputElement> & { onCheckedChange?: (checked: boolean) => void }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Dialog: ({ children, open, busy }: { children: ReactNode; open?: boolean; busy?: boolean }) => (
    open ? <div role="dialog" aria-busy={busy || undefined}>{children}</div> : null
  ),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Field: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  FieldGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldLabel: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label>,
  Form: ({
    children,
    busy: _busy,
    ...props
  }: React.FormHTMLAttributes<HTMLFormElement> & { busy?: boolean }) => <form {...props}>{children}</form>,
  FormActions: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  SelectValue: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  SubmitButton: ({
    children,
    busyLabel: _busyLabel,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { busyLabel?: ReactNode }) => <button type="submit" {...props}>{children}</button>,
}))

import { InstallDialog, inferSourceType } from '../../../plugins/explore/components/install-dialog'
import type { ExploreCatalogEntry } from '../../../plugins/explore/types'

const agentEntry: ExploreCatalogEntry = {
  id: 'pixel',
  kind: 'agent',
  name: 'Pixel',
  description: 'Images',
  category: 'Creative',
  tags: [],
  useCases: [],
  runtimes: ['*'],
  source: 'github:markhayden/bakin-bits-official#agents/pixel',
  ref: null,
  trust: 'official',
  builtin: false,
  dependencies: [],
  defaultSelected: false,
  screenshots: [],
  installed: false,
  updateAvailable: null,
  installedVersion: null,
}

const pluginEntry: ExploreCatalogEntry = {
  ...agentEntry,
  id: 'messaging',
  kind: 'plugin',
  name: 'Messaging',
  source: 'github:markhayden/bakin-bits-official#plugins/messaging',
}

const packEntry: ExploreCatalogEntry = {
  ...agentEntry,
  id: 'writing',
  kind: 'lesson-pack',
  name: 'Writing',
  source: 'github:markhayden/bakin-bits-official#packs/writing',
}

let fetchMock: ReturnType<typeof mock>
const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  fetchMock = mock(() => Promise.resolve(jsonResponse({ ok: true })))
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function lastCall(): { url: string; body: Record<string, unknown> } {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url: call[0], body: JSON.parse(String(call[1].body)) }
}

describe('inferSourceType', () => {
  it('classifies sources like the CLI does', () => {
    expect(inferSourceType('github:user/repo')).toBe('github')
    expect(inferSourceType('user/repo')).toBe('github')
    expect(inferSourceType('./local/path')).toBe('local')
    expect(inferSourceType('/abs/path')).toBe('local')
    expect(inferSourceType('~/home/path')).toBe('local')
  })
})

describe('InstallDialog', () => {
  it('curated agent install posts to /api/agent-packages/install', async () => {
    const onInstalled = mock()
    render(<InstallDialog open onOpenChange={mock()} entry={agentEntry} onInstalled={onInstalled} />)
    fireEvent.click(screen.getByTestId('install-submit'))
    await waitFor(() => expect(onInstalled).toHaveBeenCalled())
    const { url, body } = lastCall()
    expect(url).toBe('/api/agent-packages/install')
    expect(body.source).toBe(agentEntry.source)
    expect(body.adopt).toBeUndefined()
  })

  it('curated pack install posts to /api/packages/install', async () => {
    const onInstalled = mock()
    render(<InstallDialog open onOpenChange={mock()} entry={packEntry} onInstalled={onInstalled} />)
    fireEvent.click(screen.getByTestId('install-submit'))
    await waitFor(() => expect(onInstalled).toHaveBeenCalled())
    expect(lastCall().url).toBe('/api/packages/install')
  })

  it('renders server errors human-readable and does not close', async () => {
    fetchMock = mock(() => Promise.resolve(jsonResponse({ ok: false, error: 'source failed validation' }, 400)))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const onInstalled = mock()
    render(<InstallDialog open onOpenChange={mock()} entry={agentEntry} onInstalled={onInstalled} />)
    fireEvent.click(screen.getByTestId('install-submit'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('source failed validation'))
    expect(onInstalled).not.toHaveBeenCalled()
  })

  it('plugin install runs the two-phase consent flow', async () => {
    const consentToken = 'token-1'
    fetchMock = mock((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { accepted?: boolean; consentToken?: string }
      if (body.accepted !== true) {
        return Promise.resolve(jsonResponse({
          ok: false,
          awaitingConsent: true,
          id: 'messaging',
          version: '1.0.0',
          permissions: ['storage.read', 'events.emit'],
          consentToken,
        }))
      }
      return Promise.resolve(jsonResponse({ ok: true, id: 'messaging' }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const onInstalled = mock()
    render(<InstallDialog open onOpenChange={mock()} entry={pluginEntry} onInstalled={onInstalled} />)
    fireEvent.click(screen.getByTestId('install-submit'))

    // Consent dialog appears with the permission list
    await waitFor(() => expect(screen.getByTestId('consent-permission-list')).toBeTruthy())
    expect(screen.getByText('storage.read')).toBeTruthy()

    fireEvent.click(screen.getByTestId('consent-accept'))
    await waitFor(() => expect(onInstalled).toHaveBeenCalled())

    const { body } = lastCall()
    expect(body.accepted).toBe(true)
    expect(body.consentToken).toBe(consentToken)
    expect(body.type).toBe('github')
  })

  it('declining consent installs nothing — no second POST', async () => {
    fetchMock = mock(() => Promise.resolve(jsonResponse({
      ok: false,
      awaitingConsent: true,
      id: 'messaging',
      version: '1.0.0',
      permissions: ['storage.write'],
      consentToken: 'token-2',
    })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const onInstalled = mock()
    render(<InstallDialog open onOpenChange={mock()} entry={pluginEntry} onInstalled={onInstalled} />)
    fireEvent.click(screen.getByTestId('install-submit'))
    await waitFor(() => expect(screen.getByTestId('consent-permission-list')).toBeTruthy())

    fireEvent.click(screen.getByText('Decline'))
    await waitFor(() => expect(screen.queryByTestId('consent-permission-list')).toBeNull())
    expect(fetchMock.mock.calls.length).toBe(1)
    expect(onInstalled).not.toHaveBeenCalled()
  })

  it('manifestChanged bounce re-prompts with the fresh token and notice', async () => {
    let commits = 0
    fetchMock = mock((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { accepted?: boolean; consentToken?: string }
      if (body.accepted !== true) {
        return Promise.resolve(jsonResponse({
          ok: false, awaitingConsent: true, id: 'messaging', version: '1.0.0',
          permissions: ['storage.read'], consentToken: 'token-old',
        }))
      }
      commits += 1
      if (commits === 1) {
        // Manifest drifted between preflight and commit — fresh token + new list.
        return Promise.resolve(jsonResponse({
          ok: false, awaitingConsent: true, manifestChanged: true, id: 'messaging', version: '1.1.0',
          permissions: ['storage.read', 'runtime.messaging'], consentToken: 'token-fresh',
        }))
      }
      return Promise.resolve(jsonResponse({ ok: true, id: 'messaging' }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const onInstalled = mock()
    render(<InstallDialog open onOpenChange={mock()} entry={pluginEntry} onInstalled={onInstalled} />)
    fireEvent.click(screen.getByTestId('install-submit'))
    await waitFor(() => expect(screen.getByTestId('consent-permission-list')).toBeTruthy())

    fireEvent.click(screen.getByTestId('consent-accept'))

    // Bounce: notice + the NEW permission appears
    await waitFor(() => expect(screen.getByTestId('manifest-changed-notice')).toBeTruthy())
    expect(screen.getByText('runtime.messaging')).toBeTruthy()

    fireEvent.click(screen.getByTestId('consent-accept'))
    await waitFor(() => expect(onInstalled).toHaveBeenCalled())
    expect(lastCall().body.consentToken).toBe('token-fresh')
  })

  it('curated agent installs embed the catalog ref pin into the source', async () => {
    const onInstalled = mock()
    render(<InstallDialog open onOpenChange={mock()} entry={{ ...agentEntry, ref: 'v1.2.0' }} onInstalled={onInstalled} />)
    fireEvent.click(screen.getByTestId('install-submit'))
    await waitFor(() => expect(onInstalled).toHaveBeenCalled())
    expect(lastCall().body.source).toBe('github:markhayden/bakin-bits-official@v1.2.0#agents/pixel')
  })

  it('curated plugin installs carry the ref pin on preflight AND consent commit', async () => {
    fetchMock = mock((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { accepted?: boolean; ref?: string }
      expect(body.ref).toBe('v2.0.0')
      if (body.accepted !== true) {
        return Promise.resolve(jsonResponse({
          ok: false, awaitingConsent: true, id: 'messaging', version: '2.0.0',
          permissions: ['storage.read'], consentToken: 'token-ref',
        }))
      }
      return Promise.resolve(jsonResponse({ ok: true, id: 'messaging' }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const onInstalled = mock()
    render(<InstallDialog open onOpenChange={mock()} entry={{ ...pluginEntry, ref: 'v2.0.0' }} onInstalled={onInstalled} />)
    fireEvent.click(screen.getByTestId('install-submit'))
    await waitFor(() => expect(screen.getByTestId('consent-permission-list')).toBeTruthy())
    fireEvent.click(screen.getByTestId('consent-accept'))
    await waitFor(() => expect(onInstalled).toHaveBeenCalled())
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it('custom source mode sends adopt with the chosen alias', async () => {
    const onInstalled = mock()
    render(<InstallDialog open onOpenChange={mock()} entry={null} onInstalled={onInstalled} />)
    fireEvent.change(screen.getByPlaceholderText(/github:user\/repo/), { target: { value: 'github:me/custom#agents/foo' } })
    fireEvent.change(screen.getByPlaceholderText('alt-pixel'), { target: { value: 'foo-two' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Adopt existing agent' }))
    fireEvent.click(screen.getByTestId('install-submit'))
    await waitFor(() => expect(onInstalled).toHaveBeenCalled())
    const { url, body } = lastCall()
    expect(url).toBe('/api/agent-packages/install')
    expect(body.adopt).toBe('foo-two')
    expect(body.installAs).toBe('foo-two')
  })

  it('capability-pack installs with a missing key show the guided key step, store, and finish', async () => {
    const capEntry: ExploreCatalogEntry = {
      ...agentEntry,
      id: 'web-search-brave',
      kind: 'skill-pack',
      name: 'Web Search (Brave)',
      capability: 'web-search',
      source: 'github:markhayden/bakin-bits-official#packs/web-search-brave',
    }
    fetchMock = mock((url: string) => {
      if (url === '/api/packages/install') {
        return Promise.resolve(jsonResponse({
          ok: true,
          result: { packageId: 'web-search-brave' },
          capability: {
            capability: 'web-search',
            name: 'Web Search (Brave)',
            ready: false,
            missing: ['BRAVE_SEARCH_API_KEY is not configured'],
            secrets: [{ name: 'BRAVE_SEARCH_API_KEY', secretSlot: 'brave.apiKey', help: 'https://api-dashboard.search.brave.com', status: 'missing', required: true }],
          },
        }))
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const onInstalled = mock()
    const onOpenChange = mock()
    render(<InstallDialog open onOpenChange={onOpenChange} entry={capEntry} onInstalled={onInstalled} />)
    fireEvent.click(screen.getByTestId('install-submit'))

    await waitFor(() => screen.getByTestId('capability-key-step'))
    expect(onInstalled).toHaveBeenCalled() // install itself already succeeded
    expect(screen.getByText(/api-dashboard\.search\.brave\.com/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('BRAVE_SEARCH_API_KEY'), { target: { value: 'bsk-1' } })
    fireEvent.click(screen.getByTestId('capability-key-save'))

    await waitFor(() => {
      const secretsPost = fetchMock.mock.calls.find(([u]) => u === '/api/secrets')
      expect(secretsPost).toBeTruthy()
      expect(JSON.parse(String((secretsPost![1] as RequestInit).body))).toEqual({ provider: 'brave', name: 'apiKey', value: 'bsk-1' })
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('the key step can be skipped — dialog closes, install stands', async () => {
    const capEntry: ExploreCatalogEntry = {
      ...agentEntry, id: 'web-search-brave', kind: 'skill-pack', name: 'Web Search (Brave)',
      capability: 'web-search', source: 'github:x/y#packs/web-search-brave',
    }
    fetchMock = mock(() => Promise.resolve(jsonResponse({
      ok: true,
      result: { packageId: 'web-search-brave' },
      capability: {
        capability: 'web-search', name: 'Web Search (Brave)', ready: false, missing: ['key'],
        secrets: [{ name: 'BRAVE_SEARCH_API_KEY', secretSlot: 'brave.apiKey', status: 'missing', required: true }],
      },
    })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const onOpenChange = mock()
    render(<InstallDialog open onOpenChange={onOpenChange} entry={capEntry} onInstalled={mock()} />)
    fireEvent.click(screen.getByTestId('install-submit'))
    await waitFor(() => screen.getByTestId('capability-key-step'))
    fireEvent.click(screen.getByText('Skip for now'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/secrets')).toHaveLength(0)
  })
})

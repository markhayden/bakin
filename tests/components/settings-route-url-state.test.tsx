// @vitest-environment jsdom
/**
 * /settings URL state (spec `.claude/specs/settings-url-state.md`, D1–D3).
 *
 * The active category rides `?tab=` (`system` | `integrations` | `<pluginId>`)
 * and the optional field highlight rides `?field=`. These tests mount the real
 * route component under the router shim with a spy navigate and pin: cold-boot
 * from the URL, the clean default, unknown-tab normalization (once, only after
 * schemas load, only on /settings), category selection composing `tab` + a
 * cleared `field` into ONE replace navigation, the built-in id collision guard,
 * and the saved-values cache never leaking across categories on history
 * navigation.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { actRender } from '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { settleFor } from '../helpers/wait'

const testDir = join(tmpdir(), `bakin-test-settings-url-state-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

const toastAdd = mock()
mock.module('@/hooks/use-toast', () => ({
  useToastStore: (selector: (s: { add: typeof toastAdd }) => unknown) => selector({ add: toastAdd }),
}))

// Router shim (house convention) + a spy navigate so URL writes are
// assertable. useLocation reads happy-dom's real window.location.
const navigations: Array<Record<string, unknown>> = []
// Stable identity, like the real hook: a fresh function per render would
// churn the SDK setters and re-fire URL effects the product never sees.
const navigate = (opts: Record<string, unknown>) => navigations.push(opts)
mock.module('@tanstack/react-router', () => ({
  ...require('../shims/tanstack-router'),
  useNavigate: () => navigate,
}))

import { Route } from '../../packages/host/src/routes/settings'
import { PROVIDER_KEYS_TAB_ID } from '@/components/provider-keys-tab'
import { SYSTEM_SETTINGS_TAB_ID } from '@/components/system-settings'

const SettingsPage = (Route as unknown as { component: () => React.ReactElement }).component

// happy-dom: history.replaceState doesn't sync window.location — use setURL.
function setURL(url: string) {
  const happy = (window as unknown as { happyDOM?: { setURL: (u: string) => void } }).happyDOM
  happy?.setURL(url)
}

// The demo plugin deliberately shares a field key with System & Alerts so a
// saved-values leak across categories is observable (a leaked `true` would
// flip the demo switch ON).
const DEMO_SCHEMAS = [{
  id: 'demo',
  name: 'Demo',
  source: 'built-in',
  schema: { fields: [{ key: 'dispatch.paused', type: 'boolean', label: 'Demo paused', default: false }] },
}]

let schemas: unknown[]
let releaseSchemas: (() => void) | null
let systemSaves: string[]

function installFetch() {
  systemSaves = []
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/api/plugin-settings/schemas')) {
      if (releaseSchemas === null) {
        await new Promise<void>((resolve) => { releaseSchemas = resolve })
      }
      return new Response(JSON.stringify(schemas), { status: 200 })
    }
    if (url.endsWith('/api/plugin-settings/demo')) {
      return new Response(JSON.stringify({ 'dispatch.paused': false }), { status: 200 })
    }
    if (url.endsWith('/api/settings')) {
      if (method === 'POST') {
        systemSaves.push(String(init?.body))
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
}

function relaxNumberSteps() {
  for (const input of Array.from(document.querySelectorAll('input[type=number]'))) {
    input.setAttribute('step', 'any')
  }
}

async function renderAt(url: string) {
  setURL(`http://localhost${url}`)
  let utils!: ReturnType<typeof render>
  await actRender(() => { utils = render(<SettingsPage />) })
  return utils
}

function activeHeading(): string | null {
  return document.getElementById('active-settings-heading')?.textContent ?? null
}

beforeEach(() => {
  navigations.length = 0
  schemas = DEMO_SCHEMAS
  releaseSchemas = () => {}
  toastAdd.mockClear()
  installFetch()
})

afterEach(() => {
  cleanup()
  setURL('http://localhost/')
})

describe('/settings ?tab= category', () => {
  it('uses plain ids for the built-in categories', () => {
    expect(SYSTEM_SETTINGS_TAB_ID).toBe('system')
    expect(PROVIDER_KEYS_TAB_ID).toBe('integrations')
  })

  it('cold-boots into the category named by ?tab= without navigating', async () => {
    await renderAt('/settings?tab=demo')
    await waitFor(() => expect(activeHeading()).toBe('Demo'))
    expect(screen.getByRole('button', { name: 'Demo' }).getAttribute('aria-current')).toBe('true')
    expect(navigations).toHaveLength(0)
  })

  it('lands on System & Alerts with a clean URL when ?tab= is absent', async () => {
    await renderAt('/settings')
    await waitFor(() => expect(activeHeading()).toBe('System & Alerts'))
    await settleFor(50, 'the default category must not write itself into the URL')
    expect(navigations).toHaveLength(0)
  })

  it('normalizes an unknown ?tab= to the default exactly once, only after schemas load', async () => {
    releaseSchemas = null
    await renderAt('/settings?tab=nope')
    await settleFor(50, 'unknown cannot be judged before the schema list exists')
    expect(navigations).toHaveLength(0)

    await act(async () => { releaseSchemas?.() })
    await waitFor(() => expect(activeHeading()).toBe('System & Alerts'))
    await waitFor(() => expect(navigations).toHaveLength(1))
    expect(navigations[0]).toMatchObject({ to: '/settings', search: {}, replace: true })
    await settleFor(50, 'normalization must not loop')
    expect(navigations).toHaveLength(1)
  })

  it('never normalizes params that belong to another route', async () => {
    await renderAt('/health?tab=nope')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Demo' })).toBeTruthy())
    await settleFor(50, 'the outgoing page must not rewrite the next route’s params')
    expect(navigations).toHaveLength(0)
  })

  it('selecting a category writes tab and drops field in one replace navigation', async () => {
    await renderAt('/settings?tab=demo&field=dispatch.paused')
    await waitFor(() => expect(activeHeading()).toBe('Demo'))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'System & Alerts' })) })

    await waitFor(() => expect(navigations).toHaveLength(1))
    // System is the default (param omitted) and field is cleared — one URL.
    expect(navigations[0]).toMatchObject({ to: '/settings', search: {}, replace: true })
  })

  it('re-selecting the active category does not navigate', async () => {
    await renderAt('/settings?tab=demo')
    await waitFor(() => expect(activeHeading()).toBe('Demo'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Demo' })) })
    await settleFor(50, 'a same-id click has nothing to write')
    expect(navigations).toHaveLength(0)
  })

  it('refuses a plugin whose id collides with a built-in category', async () => {
    const warn = mock()
    const realWarn = console.warn
    console.warn = warn
    try {
      schemas = [
        ...DEMO_SCHEMAS,
        { id: 'system', name: 'Impostor', source: 'user', schema: { fields: [] } },
        { id: 'integrations', name: 'Impostor Two', source: 'user', schema: { fields: [] } },
      ]
      await renderAt('/settings')
      await waitFor(() => expect(activeHeading()).toBe('System & Alerts'))
      expect(screen.queryByRole('button', { name: 'Impostor' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Impostor Two' })).toBeNull()
      expect(warn).toHaveBeenCalledTimes(2)
      expect(String(warn.mock.calls[0]?.[0])).toContain('system')
    } finally {
      console.warn = realWarn
    }
  })

  it('never shows one category’s just-saved values under another after history navigation', async () => {
    const utils = await renderAt('/settings')
    const killSwitch = await waitFor(() => screen.getByRole('switch', { name: /pause all dispatch/i }))
    await act(async () => { fireEvent.click(killSwitch) })
    relaxNumberSteps()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^save$/i })) })
    await waitFor(() => expect(systemSaves).toHaveLength(1))
    expect(screen.getByRole('switch', { name: /pause all dispatch/i }).getAttribute('aria-checked')).toBe('true')

    // Back/Forward: the URL changes without a category click.
    setURL('http://localhost/settings?tab=demo')
    await act(async () => { utils.rerender(<SettingsPage />) })

    const demoSwitch = await waitFor(() => screen.getByRole('switch', { name: /demo paused/i }))
    expect(demoSwitch.getAttribute('aria-checked')).toBe('false')
  })

  it('?field= highlights the named field on a schema-rendered category', async () => {
    await renderAt('/settings?tab=demo&field=dispatch.paused')
    await waitFor(() => expect(activeHeading()).toBe('Demo'))
    const marked = await waitFor(() => {
      const el = document.querySelector('[data-highlighted="true"]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(marked.textContent).toContain('Demo paused')
    expect(navigations).toHaveLength(0)
  })

  it('?field= is inert on Integrations & Keys and for unknown keys', async () => {
    await renderAt('/settings?tab=integrations&field=dispatch.paused')
    await waitFor(() => expect(activeHeading()).toBe('Integrations & Keys'))
    await settleFor(50, 'a bespoke category has no schema fields to highlight')
    expect(document.querySelector('[data-highlighted]')).toBeNull()
    expect(navigations).toHaveLength(0)

    cleanup()
    await renderAt('/settings?tab=demo&field=nope')
    await waitFor(() => expect(activeHeading()).toBe('Demo'))
    await settleFor(50, 'an unknown field key highlights nothing and is not an error')
    expect(document.querySelector('[data-highlighted]')).toBeNull()
    expect(navigations).toHaveLength(0)
  })
})

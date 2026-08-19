/**
 * /settings honesty regressions.
 *
 * The bug this file exists for: `handleSave` returned normally on a non-2xx
 * response, so the renderer's success path fired and every settings form —
 * including the System & Alerts kill switch — reported "settings saved" over a
 * write the server had rejected. A failed save must reject, carry the server's
 * own reason, and stay parked next to the form. Load failures are pinned here
 * too: a failed fetch must never render as "nothing is configured" or as an
 * empty form the user can save over.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { actRender } from '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), `bakin-test-settings-route-${Date.now()}`)
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

import { Route } from '../../packages/host/src/routes/settings'

const SettingsPage = (Route as unknown as { component: () => React.ReactElement }).component

const DEMO_SCHEMAS = [{
  id: 'demo',
  name: 'Demo',
  source: 'built-in',
  schema: { fields: [{ key: 'enabled', type: 'boolean', label: 'Demo enabled', default: false }] },
}]

interface FetchPlan {
  schemas?: () => Response
  systemValues?: () => Response
  systemSave?: () => Response
  pluginValues?: () => Response
  pluginSave?: () => Response
}

let plan: FetchPlan
let systemSaves: string[]

function installFetch() {
  systemSaves = []
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/api/plugin-settings/schemas')) {
      return plan.schemas?.() ?? new Response(JSON.stringify(DEMO_SCHEMAS), { status: 200 })
    }
    if (url.endsWith('/api/plugin-settings/demo')) {
      return method === 'PUT'
        ? plan.pluginSave?.() ?? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : plan.pluginValues?.() ?? new Response(JSON.stringify({ enabled: false }), { status: 200 })
    }
    if (url.endsWith('/api/settings')) {
      if (method === 'POST') {
        systemSaves.push(String(init?.body))
        return plan.systemSave?.() ?? new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return plan.systemValues?.() ?? new Response('{}', { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
}

/**
 * happy-dom enforces native constraint validation on a click-submit even though
 * the form carries `noValidate` (real browsers do not), and two System & Alerts
 * numbers default to 0.5 against an implicit step of 1. Relax the step so the
 * submit under test is the one a browser actually performs.
 */
function relaxNumberSteps() {
  for (const input of Array.from(document.querySelectorAll('input[type=number]'))) {
    input.setAttribute('step', 'any')
  }
}

async function renderSettings() {
  await actRender(() => render(<SettingsPage />))
}

async function saveSystemChange() {
  const killSwitch = await waitFor(() => screen.getByRole('switch', { name: /pause all dispatch/i }))
  await act(async () => { fireEvent.click(killSwitch) })
  relaxNumberSteps()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^save$/i })) })
}

beforeEach(() => {
  plan = {}
  toastAdd.mockClear()
  installFetch()
})

afterEach(() => cleanup())

describe('/settings save honesty', () => {
  it('does NOT report success when the system settings write is rejected', async () => {
    plan.systemSave = () => new Response(
      JSON.stringify({ error: 'settings.json is not writable' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
    await renderSettings()
    await saveSystemChange()

    await waitFor(() => {
      expect(toastAdd).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'settings.json is not writable' }),
      )
    })
    // The exact shipped bug: a success report over a rejected write.
    expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    // And the failure outlives the toast, parked next to the form.
    expect(screen.getByText('Settings were not saved')).toBeTruthy()
    expect(screen.getByText('settings.json is not writable')).toBeTruthy()
  })

  it('falls back to the status line when the error body carries no reason', async () => {
    plan.systemSave = () => new Response('<html>gateway</html>', { status: 502 })
    await renderSettings()
    await saveSystemChange()

    await waitFor(() => {
      expect(toastAdd).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: expect.stringMatching(/HTTP 502/) }),
      )
    })
    expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
  })

  it('keeps a saved kill switch ON when its own category is re-selected', async () => {
    // The GET is the PRE-save state and never refetches (same id => same url),
    // so falling back to it silently reverts the switch — and the next save
    // then writes that stale `false` back, un-pausing dispatch.
    await renderSettings()
    await saveSystemChange()
    const killSwitch = screen.getByRole('switch', { name: /pause all dispatch/i })
    expect(killSwitch.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'System & Alerts' }))
    })

    expect(screen.getByRole('switch', { name: /pause all dispatch/i }).getAttribute('aria-checked'))
      .toBe('true')

    // The dangerous half: editing some OTHER field and saving must not carry a
    // stale `paused: false` along with it.
    const current = screen.getByRole('switch', { name: /pause all dispatch/i })
    const others = screen.getAllByRole('switch').filter((el) => el !== current)
    expect(others.length).toBeGreaterThan(0)
    await act(async () => { fireEvent.click(others[0]!) })
    relaxNumberSteps()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^save$/i })) })
    await waitFor(() => expect(systemSaves.length).toBe(2))
    expect(JSON.parse(systemSaves[1]!).dispatch.paused).toBe(true)
  })

  it('reports success and posts the nested payload when the write lands', async () => {
    await renderSettings()
    await saveSystemChange()

    await waitFor(() => {
      expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    })
    expect(JSON.parse(systemSaves[0]).dispatch.paused).toBe(true)
    expect(screen.queryByText('Settings were not saved')).toBeNull()
  })

  it('does NOT report success when a plugin settings write is rejected', async () => {
    plan.pluginSave = () => new Response(
      JSON.stringify({ error: 'Invalid plugin id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
    await renderSettings()
    const demoTab = await waitFor(() => screen.getByRole('button', { name: 'Demo' }))
    await act(async () => { fireEvent.click(demoTab) })
    const toggle = await waitFor(() => screen.getByRole('switch', { name: /demo enabled/i }))
    await act(async () => { fireEvent.click(toggle) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^save$/i })) })

    await waitFor(() => {
      expect(toastAdd).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'Invalid plugin id' }),
      )
    })
    expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    expect(screen.getByText('Settings were not saved')).toBeTruthy()
  })
})

describe('/settings load honesty', () => {
  it('shows an honest error instead of an empty form when values fail to load', async () => {
    plan.systemValues = () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 })
    await renderSettings()

    await waitFor(() => expect(screen.getByText('Settings could not be loaded')).toBeTruthy())
    // An empty form here would let the user save over their real config.
    expect(screen.queryByRole('switch', { name: /pause all dispatch/i })).toBeNull()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('shows an honest error instead of "No plugin settings" when discovery fails', async () => {
    plan.schemas = () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
    await renderSettings()

    await waitFor(() => expect(screen.getByText('Settings could not be loaded')).toBeTruthy())
    expect(screen.queryByText('No plugin settings')).toBeNull()
  })

  it('names the active settings region by a heading that is in the document', async () => {
    await renderSettings()
    await waitFor(() => screen.getByRole('switch', { name: /pause all dispatch/i }))

    const region = document.querySelector('[data-slot="page-body"]') as HTMLElement | null
    expect(region).not.toBeNull()
    const labelledBy = region!.getAttribute('aria-labelledby')
    if (labelledBy) expect(document.getElementById(labelledBy)).not.toBeNull()
    else expect(region!.getAttribute('aria-label')).toBeTruthy()
  })
})

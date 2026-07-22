// @vitest-environment jsdom

/**
 * Plugin ownership roots at the host route boundary.
 *
 * Slot ownership is covered in tests/sdk/slots.test.tsx. These tests pin the
 * other browser contribution path: routes registered by external plugins and
 * rendered through the host catch-all.
 */
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ComponentType } from 'react'
import { render, screen } from '@testing-library/react'
import '../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-plugin-ownership-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { registerPlugin } from '@makinbakin/sdk'
import { unregisterPlugin, usePluginOwnership } from '@makinbakin/sdk/internal'
import { Route as PluginCatchAllRoute } from '../../packages/host/src/routes/plugin-catchall'

const TEST_PLUGIN_ID = '__test_route_ownership'
const CatchAll = (PluginCatchAllRoute as unknown as { component: ComponentType }).component

function setURL(pathname: string): void {
  const happy = (window as unknown as { happyDOM?: { setURL: (url: string) => void } }).happyDOM
  happy?.setURL(`http://localhost:3737${pathname}`)
}

afterEach(() => {
  unregisterPlugin(TEST_PLUGIN_ID)
})

describe('plugin catch-all ownership', () => {
  it('wraps the matched page and preserves pathname and dynamic params', () => {
    function PluginPage(props: Record<string, unknown>) {
      const owner = usePluginOwnership()
      return (
        <div data-testid="plugin-page">
          {String(owner)}|{String(props.pathname)}|{String(props.recordId)}|
          {String((props.params as Record<string, unknown>).recordId)}
        </div>
      )
    }

    registerPlugin({
      id: TEST_PLUGIN_ID,
      routes: { '/ownership/[recordId]': PluginPage },
    })
    setURL('/ownership/record-42')

    const { container } = render(<CatchAll />)

    const root = container.querySelector(`[data-bakin-plugin="${TEST_PLUGIN_ID}"]`)
    expect(root).not.toBeNull()
    expect(root?.querySelector('[data-testid="plugin-page"]')).not.toBeNull()
    expect(screen.getByTestId('plugin-page').textContent).toBe(
      `${TEST_PLUGIN_ID}|/ownership/record-42|record-42|record-42`,
    )
  })

  it('keeps a crashing plugin page fallback inside its ownership root', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    function BrokenPage(): never {
      throw new Error('expected ownership test crash')
    }

    try {
      registerPlugin({
        id: TEST_PLUGIN_ID,
        routes: { '/ownership/broken': BrokenPage },
      })
      setURL('/ownership/broken')

      render(<CatchAll />)

      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain(`Plugin "${TEST_PLUGIN_ID}" failed to render this page.`)
      expect(alert.closest('[data-bakin-plugin]')?.getAttribute('data-bakin-plugin')).toBe(TEST_PLUGIN_ID)
    } finally {
      consoleError.mockRestore()
    }
  })
})

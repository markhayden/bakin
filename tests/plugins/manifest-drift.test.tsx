// @vitest-environment jsdom

/**
 * Manifest drift validation — the CI half of the lazy-loading drift check.
 *
 * Every clientful core plugin declares its nav/slots (and any routes) in
 * bakin-plugin.json `contributes.*`. The host trusts those declarations to
 * render the sidebar and decide when to lazy-load each client bundle — so
 * a declaration that doesn't match what `client.tsx` actually registers
 * breaks lazy loading in ways that only surface at runtime (sidebar
 * entries that dead-end, slots that never demand their plugin).
 *
 * This test imports each core plugin's client (running its registerPlugin
 * side effect) and applies the same `checkPluginDrift` comparison the host
 * runs as a startup diagnostic. Any drift fails CI with the host's own
 * warning text.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'

// Per CLAUDE.md — defensive resolver mocks. Client modules are browser-side
// React and must never touch ~/.bakin/ or ~/.openclaw/, but a transitive
// import could.
mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-manifest-drift-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-manifest-drift-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('@bakin/adapter-openclaw/home', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-manifest-drift-noop', 'openclaw')
  return {
    getOpenClawHome: () => base,
    getOpenClawPath: (...parts: string[]) => join(base, ...parts),
    resetOpenClawHome: () => {},
  }
})
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { setManifestNav, unregisterPlugin } from '@makinbakin/sdk/internal'
import { readPluginManifestJson } from '../../packages/core/src/plugins/manifest'
import { checkPluginDrift } from '../../packages/host/src/plugin-host/drift-check'

// Every core plugin that ships a client.tsx. git + images are server-only.
const CLIENTFUL_CORE_PLUGINS = [
  'assets',
  'explore',
  'health',
  'memory',
  'models',
  'schedule',
  'tasks',
  'team',
  'workflows',
] as const

afterAll(() => {
  for (const id of CLIENTFUL_CORE_PLUGINS) {
    unregisterPlugin(id)
    setManifestNav(id, null)
  }
})

describe('core plugin manifest drift (lazy-loading contract)', () => {
  for (const pluginId of CLIENTFUL_CORE_PLUGINS) {
    it(`${pluginId}: client registrations match contributes.{nav,routes,slots}`, () => {
      const { readFileSync } = require('fs') as typeof import('fs')
      const manifest = readPluginManifestJson(
        readFileSync(`${process.cwd()}/plugins/${pluginId}/bakin-plugin.json`, 'utf-8'),
      )

      // Declarative metadata is mandatory for clientful core plugins — a
      // client with none would silently fall back to eager loading. Explore
      // is the deliberate exception to nav ownership: the shell links to its
      // declared page slot through Make Bakin Yours.
      if (pluginId === 'explore') {
        expect(manifest.contributes?.nav ?? []).toEqual([])
      } else {
        expect(manifest.contributes?.nav?.length ?? 0).toBeGreaterThan(0)
      }
      expect(manifest.contributes?.slots?.length ?? 0).toBeGreaterThan(0)

      // Import runs registerPlugin as a side effect (same as the browser).
      require(`../../plugins/${pluginId}/client`)
      setManifestNav(pluginId, manifest.contributes?.nav ?? null)

      expect(checkPluginDrift(pluginId, manifest.contributes)).toEqual([])
    })
  }

  it('eager escape hatch stays limited to badge-provider plugins', () => {
    const { readFileSync } = require('fs') as typeof import('fs')
    const eager = CLIENTFUL_CORE_PLUGINS.filter((id) => {
      const manifest = readPluginManifestJson(
        readFileSync(`${process.cwd()}/plugins/${id}/bakin-plugin.json`, 'utf-8'),
      )
      return manifest.contributes?.eager === true
    })
    // tasks + health + assets run nav-badge providers that must mount at
    // boot (assets: the D7 unmanaged-import badge). Growing this list
    // shrinks the lazy-loading win — do it deliberately.
    expect(eager.sort()).toEqual(['assets', 'health', 'tasks'])
  })
})

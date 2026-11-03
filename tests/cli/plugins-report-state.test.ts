/** `bakin plugins list` renders staleness from the engine's last successful observation (#1007 B 8.4) — never from a lockfile marker. */
import { describe, expect, it } from 'bun:test'
import { pluginState } from '../../src/core/cli/ui/reports/plugins'

const NOW = Date.parse('2026-10-20T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()

describe('pluginState', () => {
  it('an offered update wins over everything', () => {
    expect(pluginState({ upgradeAvailable: true, updateObservedAt: daysAgo(30), status: 'failed' }, NOW)).toBe('update available')
  })

  it('an observation older than a week is a stale hint with its age', () => {
    expect(pluginState({ upgradeAvailable: false, updateObservedAt: daysAgo(19), status: 'active' }, NOW)).toBe('stale 19d')
  })

  it('a recent observation, or none yet, shows the plugin status', () => {
    expect(pluginState({ upgradeAvailable: false, updateObservedAt: daysAgo(2), status: 'active' }, NOW)).toBe('active')
    expect(pluginState({ upgradeAvailable: false, updateObservedAt: null, status: 'active' }, NOW)).toBe('active')
    expect(pluginState({ upgradeAvailable: false, status: 'failed' }, NOW)).toBe('failed')
  })
})

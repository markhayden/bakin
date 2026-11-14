/** What `bakin start` says and does once the server is listening. Pure decisions; no process is spawned. */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `bakin-test-startup-announce-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { addressBox, openerFor, shouldAnnounce, shouldOpenBrowser, type StartupContext } from '../../src/core/startup-announce'

/** A person who ran `bakin start` in a terminal on their Mac. */
const AT_THE_DESK: StartupContext = { interactiveStart: true, noOpen: false, isTTY: true, platform: 'darwin', env: {} }
const opens = (over: Partial<StartupContext>) => shouldOpenBrowser({ ...AT_THE_DESK, ...over })

describe('opening the browser', () => {
  it('opens for a person who ran `bakin start` at a terminal on a machine with a screen', () => {
    expect(opens({})).toBe(true)
    expect(opens({ platform: 'win32' })).toBe(true)
    expect(opens({ platform: 'linux', env: { DISPLAY: ':0' } })).toBe(true)
    expect(opens({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } })).toBe(true)
  })

  it('never for a service, a restart, a pipe or CI', () => {
    expect(opens({ interactiveStart: false })).toBe(false)
    expect(opens({ isTTY: false })).toBe(false)
    expect(opens({ env: { CI: 'true' } })).toBe(false)
  })

  it('never over SSH, or on a Linux box with no display: there is no screen to open it on', () => {
    expect(opens({ env: { SSH_CONNECTION: '10.0.0.2 5555 10.0.0.1 22' } })).toBe(false)
    expect(opens({ env: { SSH_TTY: '/dev/ttys001' } })).toBe(false)
    expect(opens({ platform: 'linux' })).toBe(false)
  })

  it('not when told not to, by flag or by environment', () => {
    expect(opens({ noOpen: true })).toBe(false)
    expect(opens({ env: { BAKIN_NO_OPEN: '1' } })).toBe(false)
  })

  it('uses each platform\'s own opener, and none where there is none', () => {
    expect(openerFor('darwin', 'http://localhost:3737')).toEqual(['open', 'http://localhost:3737'])
    expect(openerFor('linux', 'http://localhost:3737')).toEqual(['xdg-open', 'http://localhost:3737'])
    expect(openerFor('win32', 'http://localhost:3737')).toEqual(['cmd', '/c', 'start', '""', 'http://localhost:3737'])
    expect(openerFor('aix', 'http://localhost:3737')).toBeNull()
  })
})

describe('the address box', () => {
  it('is shown to a person at a terminal, a service and CI get plain logs', () => {
    expect(shouldAnnounce({ isTTY: true, env: {} })).toBe(true)
    expect(shouldAnnounce({ isTTY: false, env: {} })).toBe(false)
    expect(shouldAnnounce({ isTTY: true, env: { CI: '1' } })).toBe(false)
    // A box over SSH is still useful: the address is the point; only the browser needs a screen.
    expect(shouldAnnounce({ isTTY: true, env: { SSH_TTY: '/dev/ttys001' } })).toBe(true)
  })

  it('names the local address, and the network one when there is one, in a closed frame', () => {
    const box = addressBox('http://localhost:3737', 'http://100.64.1.2:3737').split('\n').filter(Boolean)
    expect(box[0]!.startsWith('╭')).toBe(true)
    expect(box.at(-1)!.startsWith('╰')).toBe(true)
    expect(box.some((line) => line.includes('Local:    http://localhost:3737'))).toBe(true)
    expect(box.some((line) => line.includes('Network:  http://100.64.1.2:3737'))).toBe(true)
    // Every row the same width: the frame is closed.
    expect(new Set(box.map((line) => line.length)).size).toBe(1)
    expect(addressBox('http://localhost:3737', null)).not.toContain('Network')
  })
})

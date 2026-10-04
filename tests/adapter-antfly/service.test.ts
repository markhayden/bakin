/**
 * OS-service lifecycle — pure goldens + mocked exec. No real launchctl/
 * systemctl ever runs; the unit file byte-compare IS the fingerprint.
 */
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-antfly-service-${Date.now()}-${randomUUID()}`)
const savedEnv = { ANTFLY_HOME: process.env.ANTFLY_HOME, ANTFLY_PATH: process.env.ANTFLY_PATH, BAKIN_HOME: process.env.BAKIN_HOME, OPENCLAW_HOME: process.env.OPENCLAW_HOME }
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.ANTFLY_HOME = join(testDir, 'antfly-home')
process.env.ANTFLY_PATH = join(testDir, 'antfly-home', 'bin', 'antfly')

import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import {
  buildServiceArgv,
  detectServiceMode,
  ensureProvisioned,
  launchdPlistPath,
  renderLaunchdPlist,
  renderSystemdUnit,
  restartService,
  servicePaths,
  startService,
  systemdUnitPath,
  type ServiceIo,
} from '../../packages/adapter-antfly/src/service'
import { unitDataDir } from '../../packages/adapter-antfly/src/service-ownership'
import { DEFAULT_SETTINGS } from '../../packages/adapter-antfly/src/defaults'

beforeEach(() => rmSync(testDir, { recursive: true, force: true }))
afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(testDir, { recursive: true, force: true })
})

function fakeIo(overrides: Partial<ServiceIo> & { record?: string[][]; loaded?: boolean } = {}): ServiceIo & { record: string[][]; loaded: () => boolean } {
  const record: string[][] = overrides.record ?? []
  let loaded = overrides.loaded ?? true
  return {
    platform: overrides.platform ?? 'darwin',
    hasCommand: overrides.hasCommand ?? (() => true),
    // Preload pre-check: goldens assume models are present on disk; the
    // real probe would silently drop --preload-model in a bare test env.
    modelReady: overrides.modelReady ?? (() => true),
    tempRoots: [],
    portsReleased: overrides.portsReleased ?? (async () => true),
    env: { HOME: testDir, ...overrides.env },
    exec: overrides.exec ?? (async (cmd, args) => {
      record.push([cmd, ...args])
      if (args[0] === 'print') return { code: loaded ? 0 : 113, stdout: '', stderr: loaded ? '' : 'Could not find service' }
      if (args[1] === 'is-active') return { code: loaded ? 0 : 3, stdout: loaded ? 'active\n' : 'inactive\n', stderr: '' }
      if (args[0] === 'bootout' || args[1] === 'stop') loaded = false
      if (args[0] === 'bootstrap' || args[1] === 'start' || args[1] === 'enable') loaded = true
      return { code: 0, stdout: '', stderr: '' }
    }),
    record,
    loaded: () => loaded,
  }
}

describe('detectServiceMode', () => {
  it('guest for non-default URLs; env override wins; platform fallback to child', () => {
    expect(detectServiceMode({ ...DEFAULT_SETTINGS, url: 'http://search.lan:9000' }, fakeIo())).toBe('guest')
    expect(detectServiceMode(DEFAULT_SETTINGS, fakeIo({ env: { HOME: testDir, BAKIN_SEARCH_SERVICE_MODE: 'child' } }))).toBe('child')
    expect(detectServiceMode(DEFAULT_SETTINGS, fakeIo({ platform: 'darwin' }))).toBe('launchd')
    expect(detectServiceMode(DEFAULT_SETTINGS, fakeIo({ platform: 'linux' }))).toBe('systemd')
    expect(detectServiceMode(DEFAULT_SETTINGS, fakeIo({ platform: 'linux', hasCommand: () => false }))).toBe('child')
  })
})

describe('unit rendering (goldens)', () => {
  const paths = { binary: '/opt/antfly/bin/antfly', dataDir: '/home/u/.bakin/antfly', modelsDir: '/home/u/.antfly/inference/models', logFile: '/home/u/.bakin/logs/antfly.log' }

  it('argv preloads every antfly-provider embedder, deduped, same across supervisors', () => {
    const argv = buildServiceArgv(DEFAULT_SETTINGS, paths, { modelReady: () => true })
    expect(argv).toEqual([
      '/opt/antfly/bin/antfly', 'standalone',
      '--host', '127.0.0.1',
      '--port', '3738',
      '--health-port', '3739',
      '--data-dir', '/home/u/.bakin/antfly',
      '--models-dir', '/home/u/.antfly/inference/models',
      '--preload-model', 'embedder:BAAI/bge-small-en-v1.5',
      '--preload-model', 'embedder:antflydb/clipclap',
    ])
  })

  it('argv leaves a model failing the distribution check OFF the preloads (crash-loop guard)', () => {
    // The engine EXITS on a preload it cannot load; the supervisor respawn
    // turns one broken model into an invisible crash loop (161 respawns,
    // 2026-07-21). A broken model must degrade, never preload.
    const argv = buildServiceArgv(DEFAULT_SETTINGS, paths, { modelReady: (m) => m !== 'antflydb/clipclap' })
    expect(argv).toContain('embedder:BAAI/bge-small-en-v1.5')
    expect(argv.join(' ')).not.toContain('clipclap')
  })

  it('launchd plist: KeepAlive, RunAtLoad, log paths, escaped argv', () => {
    const plist = renderLaunchdPlist(buildServiceArgv(DEFAULT_SETTINGS, paths, { modelReady: () => true }), paths.logFile)
    expect(plist).toContain('<string>io.bakin.antfly</string>')
    expect(plist).toContain('<key>KeepAlive</key>\n  <true/>')
    expect(plist).toContain('<key>NumberOfFiles</key>')
    expect(plist).toContain('<integer>65536</integer>')
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>')
    expect(plist).toContain('<string>/home/u/.bakin/logs/antfly.log</string>')
    expect(plist).toContain('<string>--preload-model</string>')
  })

  it('systemd unit: Restart=always, append logs, install target', () => {
    const unit = renderSystemdUnit(buildServiceArgv(DEFAULT_SETTINGS, paths), paths.logFile)
    expect(unit).toContain('Restart=always')
    expect(unit).toContain('LimitNOFILE=65536')
    expect(unit).toContain('StandardOutput=append:/home/u/.bakin/logs/antfly.log')
    expect(unit).toContain('WantedBy=default.target')
    expect(unit).toContain('ExecStart=/opt/antfly/bin/antfly standalone --host 127.0.0.1 --port 3738')
  })
})

describe('ensureProvisioned idempotence', () => {
  it('launchd: explicit install writes and bootstraps; subsequent owner boot performs only a status probe', async () => {
    const io = fakeIo({ platform: 'darwin' })
    const first = await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })
    expect(first).toEqual({ mode: 'launchd', action: 'provisioned' })
    expect(existsSync(launchdPlistPath(io))).toBe(true)
    expect(io.record.some((c) => c[0] === 'launchctl' && c[1] === 'bootstrap')).toBe(true)

    const io2 = fakeIo({ platform: 'darwin' })
    const second = await ensureProvisioned(DEFAULT_SETTINGS, io2)
    expect(second).toEqual({ mode: 'launchd', action: 'unchanged' })
    // #859: 'unchanged' now also verifies the unit is LOADED — exactly one
    // read-only probe, still zero writes/bootstraps.
    expect(io2.record).toHaveLength(1)
    expect(io2.record[0][1]).toBe('print')
  })

  it('launchd: identical plist but unit NOT loaded → bootstrap + reloaded (#859 self-heal)', async () => {
    const io = fakeIo({ platform: 'darwin' })
    await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' }) // plist on disk
    const record: string[][] = []
    const io2 = fakeIo({
      platform: 'darwin',
      record,
      exec: async (cmd, args) => {
        record.push([cmd, ...args])
        if (args[0] === 'print') return { code: 113, stdout: '', stderr: 'Could not find service' }
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    const result = await ensureProvisioned(DEFAULT_SETTINGS, io2)
    expect(result).toEqual({ mode: 'launchd', action: 'reloaded' })
    const bootstrap = io2.record.find((c) => c[1] === 'bootstrap')
    expect(bootstrap).toBeDefined()
    expect(bootstrap![3]).toBe(launchdPlistPath(io2))
  })

  it('systemd: identical unit + active → one is-active probe, unchanged; inactive → reload, enable and start', async () => {
    const io = fakeIo({ platform: 'linux' })
    await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' }) // unit on disk

    const active = fakeIo({ platform: 'linux' })
    expect(await ensureProvisioned(DEFAULT_SETTINGS, active)).toEqual({ mode: 'systemd', action: 'unchanged' })
    expect(active.record).toHaveLength(1)
    expect(active.record[0]).toEqual(['systemctl', '--user', 'is-active', 'bakin-antfly.service'])

    const record: string[][] = []
    const inactive = fakeIo({
      platform: 'linux',
      record,
      exec: async (cmd, args) => {
        record.push([cmd, ...args])
        if (args[1] === 'is-active') return { code: 3, stdout: 'inactive\n', stderr: '' }
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    expect(await ensureProvisioned(DEFAULT_SETTINGS, inactive)).toEqual({ mode: 'systemd', action: 'reloaded' })
    expect(inactive.record).toContainEqual(['systemctl', '--user', 'daemon-reload'])
    expect(inactive.record).toContainEqual(['systemctl', '--user', 'enable', '--now', 'bakin-antfly.service'])
  })

  it('systemd: activating counts as loaded — no redundant start', async () => {
    const io = fakeIo({ platform: 'linux' })
    await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })
    const record: string[][] = []
    const activating = fakeIo({
      platform: 'linux',
      record,
      exec: async (cmd, args) => {
        record.push([cmd, ...args])
        if (args[1] === 'is-active') return { code: 3, stdout: 'activating\n', stderr: '' }
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    expect(await ensureProvisioned(DEFAULT_SETTINGS, activating)).toEqual({ mode: 'systemd', action: 'unchanged' })
    expect(activating.record).toHaveLength(1)
  })

  it('launchd: settings drift rewrites the plist and restarts (bootout + bootstrap)', async () => {
    const io = fakeIo({ platform: 'darwin' })
    await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })
    const drifted = {
      ...DEFAULT_SETTINGS,
      embedders: { default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5', dimension: 384 } },
    }
    const io2 = fakeIo({ platform: 'darwin' })
    const result = await ensureProvisioned(drifted, io2)
    expect(result.action).toBe('restarted')
    expect(io2.record.some((c) => c[1] === 'bootout')).toBe(true)
    expect(io2.record.some((c) => c[1] === 'bootstrap')).toBe(true)
    expect(readFileSync(launchdPlistPath(io2), 'utf-8')).not.toContain('clipclap')
  })

  it('launchd: a failed bootstrap propagates the supervisor error', async () => {
    const io = fakeIo({
      exec: async (cmd, args) => {
        io.record.push([cmd, ...args])
        return args[0] === 'bootstrap' ? { code: 5, stdout: '', stderr: 'bootstrap denied' } : { code: 0, stdout: '', stderr: '' }
      },
    })
    await expect(ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })).rejects.toThrow('bootstrap denied')
    expect(io.record.some((c) => c[1] === 'load')).toBe(false)
    expect(existsSync(`${launchdPlistPath(io)}.lock`)).toBe(false)
  })

  it('systemd: writes unit, daemon-reloads, enables --now', async () => {
    const io = fakeIo({ platform: 'linux' })
    const result = await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })
    expect(result).toEqual({ mode: 'systemd', action: 'provisioned' })
    expect(existsSync(systemdUnitPath(io))).toBe(true)
    expect(io.record).toContainEqual(['systemctl', '--user', 'daemon-reload'])
    expect(io.record).toContainEqual(['systemctl', '--user', 'enable', '--now', 'bakin-antfly.service'])
  })

  it('systemd: owner settings drift updates configuration and leaves the service running', async () => {
    const io = fakeIo({ platform: 'linux' })
    await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })
    const drifted = { ...DEFAULT_SETTINGS, embedders: { default: DEFAULT_SETTINGS.embedders.default } }

    const result = await ensureProvisioned(drifted, io)

    expect(result.action).toBe('restarted')
    expect(io.loaded()).toBe(true)
    expect(readFileSync(systemdUnitPath(io), 'utf8')).not.toContain('clipclap')
  })

  for (const operation of ['daemon-reload', 'enable']) {
    it(`systemd: retries a failed ${operation} with the new owner's configuration and autostart`, async () => {
      const paths = servicePaths()
      const previousDataDir = join(testDir, 'previous-owner', 'antfly')
      let cachedDataDir = previousDataDir
      let runningDataDir: string | null = previousDataDir
      let enabled = false
      let failing = true
      const io = fakeIo({
        platform: 'linux',
        portsReleased: async () => runningDataDir === null,
        exec: async (_command, args) => {
          const command = args[1]
          if (command === 'is-active') return { code: runningDataDir ? 0 : 3, stdout: runningDataDir ? 'active' : 'inactive', stderr: '' }
          if (command === 'stop') runningDataDir = null
          if (command === operation && failing) return { code: 1, stdout: '', stderr: `${operation} denied` }
          if (command === 'daemon-reload') cachedDataDir = unitDataDir(readFileSync(systemdUnitPath(io), 'utf8'), 'systemd')
          if (command === 'enable') enabled = true
          if (command === 'start' || command === 'enable') runningDataDir = cachedDataDir
          return { code: 0, stdout: '', stderr: '' }
        },
      })
      const unitPath = systemdUnitPath(io)
      mkdirSync(dirname(unitPath), { recursive: true })
      writeFileSync(unitPath, renderSystemdUnit(buildServiceArgv(DEFAULT_SETTINGS, { ...paths, dataDir: previousDataDir }, { modelReady: io.modelReady }), paths.logFile))

      await expect(ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })).rejects.toThrow(`${operation} denied`)
      const claimedUnit = readFileSync(unitPath, 'utf8')
      expect(unitDataDir(claimedUnit, 'systemd')).toBe(paths.dataDir)
      expect(runningDataDir).toBeNull()
      // Identical on-disk configuration must not bypass a repeated failure.
      await expect(ensureProvisioned(DEFAULT_SETTINGS, io)).rejects.toThrow(`${operation} denied`)
      expect(runningDataDir).toBeNull()
      expect(existsSync(`${unitPath}.lock`)).toBe(false)

      failing = false
      expect(await ensureProvisioned(DEFAULT_SETTINGS, io)).toEqual({ mode: 'systemd', action: 'reloaded' })
      expect(runningDataDir).toBe(paths.dataDir)
      expect(enabled).toBe(true)
      expect(readFileSync(unitPath, 'utf8')).toBe(claimedUnit)
      expect(existsSync(`${unitPath}.lock`)).toBe(false)
    })

    it(`systemd: failed ${operation} cannot report a successful install`, async () => {
      const io = fakeIo({
        platform: 'linux',
        exec: async (command, args) => {
          io.record.push([command, ...args])
          return { code: args[1] === operation ? 1 : 0, stdout: '', stderr: args[1] === operation ? `${operation} denied` : '' }
        },
      })

      await expect(ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })).rejects.toThrow(`${operation} denied`)

      expect(existsSync(`${systemdUnitPath(io)}.lock`)).toBe(false)
    })
  }

  for (const platform of ['darwin', 'linux'] as const) {
    it(`${platform}: failed unloaded-owner recovery preserves configuration and reports failure`, async () => {
      const installed = fakeIo({ platform })
      await ensureProvisioned(DEFAULT_SETTINGS, installed, { intent: 'install' })
      const unitPath = platform === 'darwin' ? launchdPlistPath(installed) : systemdUnitPath(installed)
      const original = readFileSync(unitPath, 'utf8')
      const io = fakeIo({
        platform,
        exec: async (_command, args) => {
          if (args[0] === 'print') return { code: 113, stdout: '', stderr: 'Could not find service' }
          if (args[1] === 'is-active') return { code: 3, stdout: 'inactive', stderr: '' }
          return { code: 1, stdout: '', stderr: 'start denied' }
        },
      })

      await expect(ensureProvisioned(DEFAULT_SETTINGS, io)).rejects.toThrow('start denied')

      expect(readFileSync(unitPath, 'utf8')).toBe(original)
      expect(existsSync(`${unitPath}.lock`)).toBe(false)
    })
  }

  it('guest and unsupervised child modes do not provision service units', async () => {
    const guest = fakeIo()
    expect(await ensureProvisioned({ ...DEFAULT_SETTINGS, url: 'http://other:1234' }, guest)).toEqual({ mode: 'guest', action: 'skipped' })
    expect(guest.record).toHaveLength(0)
    const child = fakeIo({ hasCommand: () => false, env: { HOME: testDir, BAKIN_SEARCH_SERVICE_MODE: 'child' } })
    expect(await ensureProvisioned(DEFAULT_SETTINGS, child)).toEqual({ mode: 'child', action: 'skipped' })
    expect(child.record).toHaveLength(0)
  })
})

describe('startService owned-service recovery (#859)', () => {
  it('launchd: an already loaded owner is left running', async () => {
    const io = fakeIo()
    await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })
    const original = readFileSync(launchdPlistPath(io), 'utf8')
    const owner = fakeIo()

    await startService(DEFAULT_SETTINGS, owner)

    expect(owner.loaded()).toBe(true)
    expect(owner.record.map((command) => command[1])).toEqual(['print'])
    expect(readFileSync(launchdPlistPath(owner), 'utf8')).toBe(original)
  })

  it('launchd: an unloaded owner bootstraps its existing plist', async () => {
    const io = fakeIo()
    await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })
    const original = readFileSync(launchdPlistPath(io), 'utf8')
    const owner = fakeIo({ loaded: false })

    await startService(DEFAULT_SETTINGS, owner)

    expect(owner.loaded()).toBe(true)
    expect(owner.record.some((command) => command[1] === 'bootstrap')).toBe(true)
    expect(readFileSync(launchdPlistPath(owner), 'utf8')).toBe(original)
  })

  it('launchd: a missing plist needs explicit install instead of implicit repair', async () => {
    const io = fakeIo()

    await expect(startService(DEFAULT_SETTINGS, io)).rejects.toThrow('unclaimed')

    expect(existsSync(launchdPlistPath(io))).toBe(false)
    expect(io.record).toEqual([])
  })
})

describe('restartService preserves owned configuration', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    it(`${platform}: stop and start return the owned service to a running state`, async () => {
      const io = fakeIo({ platform })
      await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })
      const unitPath = platform === 'darwin' ? launchdPlistPath(io) : systemdUnitPath(io)
      const original = readFileSync(unitPath, 'utf8')
      io.record.length = 0

      await restartService(DEFAULT_SETTINGS, io)

      expect(io.loaded()).toBe(true)
      expect(readFileSync(unitPath, 'utf8')).toBe(original)
      expect(io.record.some((command) => command.includes(platform === 'darwin' ? 'bootout' : 'stop'))).toBe(true)
      expect(io.record.some((command) => command.includes(platform === 'darwin' ? 'bootstrap' : 'enable'))).toBe(true)
    })
  }

  it('launchd: an already unloaded owner can be restarted', async () => {
    await ensureProvisioned(DEFAULT_SETTINGS, fakeIo(), { intent: 'install' })
    const io = fakeIo({ loaded: false })

    await restartService(DEFAULT_SETTINGS, io)

    expect(io.loaded()).toBe(true)
    expect(io.record.some((command) => command[1] === 'bootstrap')).toBe(true)
  })

  it('guest: throws because the engine is externally managed', async () => {
    const io = fakeIo()
    await expect(restartService({ ...DEFAULT_SETTINGS, url: 'http://other:1234' }, io)).rejects.toThrow('externally managed')
    expect(io.record).toHaveLength(0)
  })
})

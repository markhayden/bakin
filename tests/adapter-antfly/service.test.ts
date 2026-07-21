/**
 * OS-service lifecycle — pure goldens + mocked exec. No real launchctl/
 * systemctl ever runs; the unit file byte-compare IS the fingerprint.
 */
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-antfly-service-${Date.now()}-${randomUUID()}`)
// paths.ts reads ANTFLY_HOME lazily per call, but set it before imports anyway.
process.env.ANTFLY_HOME = join(testDir, 'antfly-home')

import { describe, it, expect, afterAll, mock } from 'bun:test'

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
  systemdUnitPath,
  type ServiceIo,
} from '../../packages/adapter-antfly/src/service'
import { DEFAULT_SETTINGS } from '../../packages/adapter-antfly/src/defaults'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function fakeIo(overrides: Partial<ServiceIo> & { record?: string[][] } = {}): ServiceIo & { record: string[][] } {
  const record: string[][] = overrides.record ?? []
  return {
    platform: overrides.platform ?? 'darwin',
    hasCommand: overrides.hasCommand ?? (() => true),
    env: { HOME: testDir, ...overrides.env },
    exec: overrides.exec ?? (async (cmd, args) => {
      record.push([cmd, ...args])
      return { code: 0, stdout: '', stderr: '' }
    }),
    record,
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
    const argv = buildServiceArgv(DEFAULT_SETTINGS, paths)
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

  it('launchd plist: KeepAlive, RunAtLoad, log paths, escaped argv', () => {
    const plist = renderLaunchdPlist(buildServiceArgv(DEFAULT_SETTINGS, paths), paths.logFile)
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
  it('launchd: first call writes plist + bootstraps; identical second call does NOTHING', async () => {
    const io = fakeIo({ platform: 'darwin' })
    const first = await ensureProvisioned(DEFAULT_SETTINGS, io)
    expect(first).toEqual({ mode: 'launchd', action: 'provisioned' })
    expect(existsSync(launchdPlistPath(io))).toBe(true)
    expect(io.record.some((c) => c[0] === 'launchctl' && c[1] === 'bootstrap')).toBe(true)

    const io2 = fakeIo({ platform: 'darwin' })
    const second = await ensureProvisioned(DEFAULT_SETTINGS, io2)
    expect(second).toEqual({ mode: 'launchd', action: 'unchanged' })
    expect(io2.record).toHaveLength(0)
  })

  it('launchd: settings drift rewrites the plist and restarts (bootout + bootstrap)', async () => {
    const io = fakeIo({ platform: 'darwin' })
    await ensureProvisioned(DEFAULT_SETTINGS, io)
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

  it('launchd: bootstrap failure falls back to legacy load', async () => {
    rmSync(launchdPlistPath(fakeIo()), { force: true })
    const io = fakeIo({
      platform: 'darwin',
      exec: async (cmd, args) => {
        io.record.push([cmd, ...args])
        return args[0] === 'bootstrap' ? { code: 5, stdout: '', stderr: 'not supported' } : { code: 0, stdout: '', stderr: '' }
      },
    })
    await ensureProvisioned(DEFAULT_SETTINGS, io)
    expect(io.record.some((c) => c[1] === 'load')).toBe(true)
  })

  it('systemd: writes unit, daemon-reloads, enables --now', async () => {
    const io = fakeIo({ platform: 'linux' })
    const result = await ensureProvisioned(DEFAULT_SETTINGS, io)
    expect(result).toEqual({ mode: 'systemd', action: 'provisioned' })
    expect(existsSync(systemdUnitPath(io))).toBe(true)
    expect(io.record).toContainEqual(['systemctl', '--user', 'daemon-reload'])
    expect(io.record).toContainEqual(['systemctl', '--user', 'enable', '--now', 'bakin-antfly.service'])
  })

  it('guest and child modes never touch disk or exec', async () => {
    const guest = fakeIo()
    expect(await ensureProvisioned({ ...DEFAULT_SETTINGS, url: 'http://other:1234' }, guest)).toEqual({ mode: 'guest', action: 'skipped' })
    expect(guest.record).toHaveLength(0)
    const child = fakeIo({ env: { HOME: testDir, BAKIN_SEARCH_SERVICE_MODE: 'child' } })
    expect(await ensureProvisioned(DEFAULT_SETTINGS, child)).toEqual({ mode: 'child', action: 'skipped' })
    expect(child.record).toHaveLength(0)
  })
})

describe('restartService (graceful — SIGTERM, never a blind kill)', () => {
  it('launchd: SIGTERM via launchctl kill; KeepAlive respawns', async () => {
    const io = fakeIo()
    await restartService(DEFAULT_SETTINGS, io)
    expect(io.record).toHaveLength(1)
    expect(io.record[0].slice(0, 3)).toEqual(['launchctl', 'kill', 'SIGTERM'])
  })

  it('launchd: falls back to kickstart when the label is not loaded', async () => {
    const record: string[][] = []
    const io = fakeIo({
      record,
      exec: async (cmd, args) => {
        record.push([cmd, ...args])
        // `launchctl kill` fails (service not loaded); kickstart succeeds.
        return { code: args[0] === 'kill' ? 113 : 0, stdout: '', stderr: '' }
      },
    })
    await restartService(DEFAULT_SETTINGS, io)
    expect(record[1].slice(0, 3)).toEqual(['launchctl', 'kickstart', '-k'])
  })

  it('systemd: systemctl --user restart', async () => {
    const io = fakeIo({ platform: 'linux' })
    await restartService(DEFAULT_SETTINGS, io)
    expect(io.record).toContainEqual(['systemctl', '--user', 'restart', 'bakin-antfly.service'])
  })

  it('guest: throws — the engine is not ours to restart', async () => {
    const io = fakeIo()
    await expect(restartService({ ...DEFAULT_SETTINGS, url: 'http://other:1234' }, io)).rejects.toThrow('externally managed')
    expect(io.record).toHaveLength(0)
  })
})

/**
 * #826: a second Bakin home must never take over the user's shared search
 * service during boot. All service files, homes, and binaries are sandboxed;
 * supervisor commands are recorded, never executed.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'

const sandbox = mkdtempSync(join(tmpdir(), 'bakin-test-search-ownership-'))
const savedEnv = {
  HOME: process.env.HOME,
  BAKIN_HOME: process.env.BAKIN_HOME,
  OPENCLAW_HOME: process.env.OPENCLAW_HOME,
  ANTFLY_HOME: process.env.ANTFLY_HOME,
  ANTFLY_PATH: process.env.ANTFLY_PATH,
}
process.env.HOME = join(sandbox, 'os-home')
process.env.BAKIN_HOME = join(sandbox, 'active-home')
process.env.OPENCLAW_HOME = join(sandbox, 'openclaw')
process.env.ANTFLY_HOME = join(sandbox, 'antfly-home')
process.env.ANTFLY_PATH = join(sandbox, 'antfly-home', 'bin', 'antfly')

let activeHome = process.env.BAKIN_HOME
let caseRoot = sandbox
let caseNumber = 0
const contentDirMock = () => ({
  getContentDir: () => activeHome,
  getBakinPaths: () => ({
    home: activeHome,
    audit: join(activeHome, 'audit.jsonl'),
    tasks: join(activeHome, 'tasks'),
    logs: join(activeHome, 'logs'),
    db: join(activeHome, 'bakin.db'),
    media: join(activeHome, 'media'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(sandbox, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(sandbox, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

const {
  buildServiceArgv,
  detectServiceMode,
  ensureProvisioned,
  getServiceAccess,
  launchdPlistPath,
  renderLaunchdPlist,
  renderSystemdUnit,
  removeService,
  restartService,
  startService,
  stopService,
  systemdUnitPath,
} = await import('../../packages/adapter-antfly/src/service')
const { DEFAULT_SETTINGS } = await import('../../packages/adapter-antfly/src/defaults')
const { unitDataDir } = await import('../../packages/adapter-antfly/src/service-ownership')
import type { ServiceIo } from '../../packages/adapter-antfly/src/service'

beforeEach(() => {
  caseRoot = join(sandbox, `case-${++caseNumber}`)
  activeHome = join(caseRoot, 'active-home')
  process.env.BAKIN_HOME = activeHome
  mkdirSync(activeHome, { recursive: true })
})

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(sandbox, { recursive: true, force: true })
})

function fakeSupervisor(mode: 'launchd' | 'systemd', loaded = true) {
  const commands: string[][] = []
  const io: ServiceIo & { tempRoots: readonly string[] } = {
    platform: mode === 'launchd' ? 'darwin' : 'linux',
    env: { HOME: join(caseRoot, 'os-home') },
    // The fixture is under the test sandbox but represents a permanent home.
    // Temporary-home cases explicitly set their own roots below.
    tempRoots: [],
    portsReleased: async () => true,
    hasCommand: () => true,
    modelReady: () => true,
    exec: async (command, args) => {
      commands.push([command, ...args])
      if (args[0] === 'print' || args[1] === 'is-active') {
        return { code: loaded ? 0 : 3, stdout: loaded ? 'active\n' : 'inactive\n', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  }
  return { io, commands }
}

function seedForeignUnit(mode: 'launchd' | 'systemd', io: ServiceIo, ownerHome = join(caseRoot, 'existing-owner')) {
  const paths = {
    binary: join(sandbox, 'antfly-home', 'bin', 'antfly'),
    dataDir: join(ownerHome, 'antfly'),
    modelsDir: join(sandbox, 'antfly-home', 'inference', 'models'),
    logFile: join(ownerHome, 'logs', 'antfly.log'),
  }
  const argv = buildServiceArgv(DEFAULT_SETTINGS, paths, { modelReady: () => true })
  const unitPath = mode === 'launchd' ? launchdPlistPath(io) : systemdUnitPath(io)
  const original = mode === 'launchd'
    ? renderLaunchdPlist(argv, paths.logFile)
    : renderSystemdUnit(argv, paths.logFile)
  mkdirSync(dirname(unitPath), { recursive: true })
  writeFileSync(unitPath, original)
  return { unitPath, original }
}

describe('#826 service ownership isolation', () => {
  for (const mode of ['launchd', 'systemd'] as const) {
    it(`${mode}: installing from a relative home remains owned on the next boot`, async () => {
      activeHome = relative(process.cwd(), activeHome)
      const { io, commands } = fakeSupervisor(mode)
      const unitPath = mode === 'launchd' ? launchdPlistPath(io) : systemdUnitPath(io)

      expect((await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })).action).toBe('provisioned')
      const installed = readFileSync(unitPath, 'utf8')
      commands.length = 0
      const boot = await ensureProvisioned(DEFAULT_SETTINGS, io)

      expect(boot.action).toBe('unchanged')
      expect(readFileSync(unitPath, 'utf8')).toBe(installed)
      expect(commands).toHaveLength(1)
      expect(commands[0]).toContain(mode === 'launchd' ? 'print' : 'is-active')
    })

    for (const loaded of [true, false]) {
      it(`${mode}: boot preserves a foreign ${loaded ? 'loaded' : 'unloaded'} unit without supervisor calls or new data`, async () => {
        const { io, commands } = fakeSupervisor(mode, loaded)
        const { unitPath, original } = seedForeignUnit(mode, io)

        const result = await ensureProvisioned(DEFAULT_SETTINGS, io)

        expect(readFileSync(unitPath, 'utf-8')).toBe(original)
        expect(result.action).toBe('refused-foreign-home')
        expect(commands).toEqual([])
        expect(existsSync(join(activeHome, 'antfly'))).toBe(false)
        expect(existsSync(join(activeHome, 'logs'))).toBe(false)
      })
    }

    it(`${mode}: boot cannot silently claim a missing service`, async () => {
      const { io, commands } = fakeSupervisor(mode)
      const unitPath = mode === 'launchd' ? launchdPlistPath(io) : systemdUnitPath(io)

      const result = await ensureProvisioned(DEFAULT_SETTINGS, io)

      expect(existsSync(unitPath)).toBe(false)
      expect(result.action).toStartWith('refused-')
      expect(commands).toEqual([])
      expect(existsSync(join(activeHome, 'antfly'))).toBe(false)
      expect(existsSync(join(activeHome, 'logs'))).toBe(false)
    })

    it(`${mode}: even explicit install cannot transfer the service to a temporary home`, async () => {
      const { io, commands } = fakeSupervisor(mode)
      io.tempRoots = [caseRoot]
      const { unitPath, original } = seedForeignUnit(mode, io)

      const result = await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })

      expect(readFileSync(unitPath, 'utf-8')).toBe(original)
      expect(result.action).toStartWith('refused-')
      expect(commands).toEqual([])
      expect(existsSync(join(activeHome, 'antfly'))).toBe(false)
      expect(existsSync(join(activeHome, 'logs'))).toBe(false)
    })

    it(`${mode}: a failed stop during deliberate claim preserves the prior owner's unit and data`, async () => {
      const { io, commands } = fakeSupervisor(mode)
      const { unitPath, original } = seedForeignUnit(mode, io)
      const ownerData = join(caseRoot, 'existing-owner', 'antfly')
      mkdirSync(ownerData, { recursive: true })
      writeFileSync(join(ownerData, 'index-marker'), 'owned index')
      io.exec = async (command, args) => {
        commands.push([command, ...args])
        if (args[0] === 'bootout' || args[1] === 'stop') return { code: 1, stdout: '', stderr: 'stop denied' }
        return { code: 0, stdout: 'loaded', stderr: '' }
      }

      await expect(ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })).rejects.toThrow('Cannot stop search service')

      expect(readFileSync(unitPath, 'utf8')).toBe(original)
      expect(readFileSync(join(ownerData, 'index-marker'), 'utf8')).toBe('owned index')
      expect(existsSync(join(activeHome, 'antfly'))).toBe(false)
      expect(existsSync(join(activeHome, 'logs'))).toBe(false)
      expect(existsSync(`${unitPath}.lock`)).toBe(false)
    })

    it(`${mode}: an occupied port prevents publishing a claimed home`, async () => {
      const { io } = fakeSupervisor(mode)
      const { unitPath, original } = seedForeignUnit(mode, io)
      io.portsReleased = async () => false

      await expect(ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })).rejects.toThrow('ports are still occupied')

      expect(readFileSync(unitPath, 'utf8')).toBe(original)
      expect(existsSync(join(activeHome, 'antfly'))).toBe(false)
      expect(existsSync(`${unitPath}.lock`)).toBe(false)
    })

    for (const [name, control] of Object.entries({ start: startService, stop: stopService, restart: restartService, remove: removeService })) {
      it(`${mode}: a foreign home cannot ${name} the shared service`, async () => {
        const { io, commands } = fakeSupervisor(mode)
        const { unitPath, original } = seedForeignUnit(mode, io)

        await expect(control(DEFAULT_SETTINGS, io)).rejects.toThrow('belongs to')

        expect(readFileSync(unitPath, 'utf8')).toBe(original)
        expect(commands).toEqual([])
        expect(existsSync(join(activeHome, 'antfly'))).toBe(false)
        expect(existsSync(`${unitPath}.lock`)).toBe(false)
      })
    }

    it(`${mode}: rendered spaces, quotes and literal expansion characters retain the home identity`, () => {
      activeHome = join(caseRoot, 'A & B <qa> "quoted" \'single\' $cost %share')
      mkdirSync(activeHome, { recursive: true })
      const { io } = fakeSupervisor(mode)
      seedForeignUnit(mode, io, activeHome)

      const access = getServiceAccess(DEFAULT_SETTINGS, io)

      expect(access).toMatchObject({ allowed: true })
      expect(access.ownership?.kind).toBe('owner')
    })

    it(`${mode}: literal backslashes survive unit rendering and parsing`, () => {
      // Bun 1.3.13 cannot realpath a POSIX filename with a literal backslash.
      // Exercise the unit format independently from that runtime limitation.
      const dataDir = join(caseRoot, 'literal\\folder', 'antfly')
      const argv = ['antfly', 'standalone', '--data-dir', dataDir]
      const unit = mode === 'launchd'
        ? renderLaunchdPlist(argv, join(activeHome, 'logs', 'antfly.log'))
        : renderSystemdUnit(argv, join(activeHome, 'logs', 'antfly.log'))

      expect(unitDataDir(unit, mode)).toBe(dataDir)
    })

    it(`${mode}: a whole-home symlink is the same owner`, () => {
      const originalHome = activeHome
      activeHome = join(caseRoot, 'home-alias')
      symlinkSync(originalHome, activeHome)
      const { io } = fakeSupervisor(mode)
      seedForeignUnit(mode, io, originalHome)

      expect(getServiceAccess(DEFAULT_SETTINGS, io).allowed).toBe(true)
    })

    it(`${mode}: an engine-data symlink cannot grant ownership or deliberate claim permission`, async () => {
      const { io, commands } = fakeSupervisor(mode)
      const { unitPath, original } = seedForeignUnit(mode, io)
      const ownerData = join(caseRoot, 'existing-owner', 'antfly')
      mkdirSync(ownerData, { recursive: true })
      symlinkSync(ownerData, join(activeHome, 'antfly'))

      const access = getServiceAccess(DEFAULT_SETTINGS, io)
      const result = await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })

      expect(access.allowed).toBe(false)
      expect(access.ownership?.claimable).toBe(false)
      expect(result.action).toBe('refused-unknown-owner')
      expect(readFileSync(unitPath, 'utf8')).toBe(original)
      expect(commands).toEqual([])
    })

    it(`${mode}: malformed ownership evidence refuses boot without rewriting the unit`, async () => {
      const { io, commands } = fakeSupervisor(mode)
      const { unitPath } = seedForeignUnit(mode, io)
      writeFileSync(unitPath, 'invalid service configuration')

      const result = await ensureProvisioned(DEFAULT_SETTINGS, io)

      expect(result.action).toBe('refused-unknown-owner')
      expect(readFileSync(unitPath, 'utf8')).toBe('invalid service configuration')
      expect(commands).toEqual([])
      expect(existsSync(join(activeHome, 'antfly'))).toBe(false)
    })

    it(`${mode}: a service file that cannot be read does not grant install permission`, async () => {
      const { io, commands } = fakeSupervisor(mode)
      const unitPath = mode === 'launchd' ? launchdPlistPath(io) : systemdUnitPath(io)
      // A directory gives an unreadable file deterministically, including
      // privileged CI where chmod(000) still permits reading a regular file.
      mkdirSync(unitPath, { recursive: true })

      const result = await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })

      expect(result.action).toBe('refused-unknown-owner')
      expect(getServiceAccess(DEFAULT_SETTINGS, io).ownership?.claimable).toBe(false)
      expect(commands).toEqual([])
      expect(existsSync(join(activeHome, 'antfly'))).toBe(false)
    })
  }

  it('temporary-root checks include whole-home aliases', async () => {
    const targetHome = activeHome
    activeHome = join(caseRoot, 'home-alias')
    symlinkSync(targetHome, activeHome)
    const { io, commands } = fakeSupervisor('launchd')
    io.tempRoots = [targetHome]
    const { unitPath, original } = seedForeignUnit('launchd', io, targetHome)

    const result = await ensureProvisioned(DEFAULT_SETTINGS, io, { intent: 'install' })

    expect(result.action).toBe('refused-temporary-home')
    expect(readFileSync(unitPath, 'utf8')).toBe(original)
    expect(commands).toEqual([])
  })

  it('a permanent name resembling mktemp and a temporary-root sibling are not temporary homes', () => {
    activeHome = join(caseRoot, 'tmp.project123')
    mkdirSync(activeHome)
    const { io } = fakeSupervisor('launchd')
    io.tempRoots = [join(caseRoot, 'tmp')]
    seedForeignUnit('launchd', io, activeHome)

    expect(getServiceAccess(DEFAULT_SETTINGS, io).allowed).toBe(true)
  })

  for (const url of [
    'http://127.0.0.1:3738/',
    'http://LOCALHOST:3738',
    'http://localhost:3738/',
    'http://127.0.0.1:3738/db/v1?example=1',
  ]) {
    it(`default origin spelling ${url} cannot bypass ownership as a guest`, async () => {
      const { io, commands } = fakeSupervisor('launchd')
      const { unitPath, original } = seedForeignUnit('launchd', io)
      const settings = { ...DEFAULT_SETTINGS, url }

      expect(detectServiceMode(settings, io)).toBe('launchd')
      const result = await ensureProvisioned(settings, io)

      expect(result.action).toBe('refused-foreign-home')
      expect(readFileSync(unitPath, 'utf-8')).toBe(original)
      expect(commands).toEqual([])
      expect(existsSync(join(activeHome, 'antfly'))).toBe(false)
    })
  }
})
